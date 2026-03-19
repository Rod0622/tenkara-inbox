import { NextRequest, NextResponse } from "next/server";

const GOOGLE_SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL || "";
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// Comma-separated list of allowed Shared Drive names (empty = show all)
const ALLOWED_DRIVES = (process.env.GOOGLE_ALLOWED_DRIVES || "").split(",").map(s => s.trim()).filter(Boolean);
// If set, uploads go directly to this folder (skip drive/folder picker)
const DEFAULT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || "";

// ── JWT Token Generation (no external deps) ─────────
async function getAccessToken(): Promise<string> {
  if (!GOOGLE_SERVICE_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error("Google Drive credentials not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: GOOGLE_SERVICE_EMAIL,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encode = (obj: any) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const unsignedToken = `${encode(header)}.${encode(payload)}`;

  // Sign with RSA-SHA256 using Node.js crypto
  const crypto = await import("crypto");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsignedToken);
  const signature = sign.sign(GOOGLE_PRIVATE_KEY, "base64url");

  const jwt = `${unsignedToken}.${signature}`;

  // Exchange JWT for access token
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google auth failed: ${err.error_description || err.error || res.statusText}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ── GET /api/drive — List shared drives, folders, or files ──
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "drives";
  const driveId = req.nextUrl.searchParams.get("drive_id");
  const folderId = req.nextUrl.searchParams.get("folder_id");

  try {
    const token = await getAccessToken();

    if (action === "config") {
      // Return drive config for the UI
      if (DEFAULT_FOLDER_ID) {
        return NextResponse.json({
          mode: "direct",
          folderId: DEFAULT_FOLDER_ID,
          message: "Files will be saved to the configured folder",
        });
      }
      return NextResponse.json({ mode: "picker" });
    }

    if (action === "drives") {
      // Try the drives endpoint first
      const res = await fetch(`${DRIVE_API}/drives?pageSize=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (res.ok) {
        const data = await res.json();
        const drivesList = (data.drives || []).map((d: any) => ({ id: d.id, name: d.name }));
        const filteredDrives = ALLOWED_DRIVES.length > 0
          ? drivesList.filter((d: any) => ALLOWED_DRIVES.some(name => d.name.toLowerCase() === name.toLowerCase()))
          : drivesList;
        
        if (filteredDrives.length > 0) {
          return NextResponse.json({ drives: filteredDrives });
        }
      }

      // Fallback: search for shared drives via files endpoint
      // This works better for service accounts that are members (not owners)
      const fallbackRes = await fetch(
        `${DRIVE_API}/files?q=mimeType='application/vnd.google-apps.folder'&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&spaces=drive&fields=files(id,name,driveId)&pageSize=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        // Extract unique drive IDs from the files
        const driveIds = new Set<string>();
        const drivesMap = new Map<string, string>();
        
        for (const f of (fallbackData.files || [])) {
          if (f.driveId && !driveIds.has(f.driveId)) {
            driveIds.add(f.driveId);
            // Fetch drive name
            const driveRes = await fetch(
              `${DRIVE_API}/drives/${f.driveId}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (driveRes.ok) {
              const driveData = await driveRes.json();
              drivesMap.set(f.driveId, driveData.name || f.driveId);
            }
          }
        }

        const drives = Array.from(drivesMap.entries()).map(([id, name]) => ({ id, name }));
        const filteredFallback = ALLOWED_DRIVES.length > 0
          ? drives.filter((d: any) => ALLOWED_DRIVES.some(name => d.name.toLowerCase() === name.toLowerCase()))
          : drives;
        if (filteredFallback.length > 0) {
          return NextResponse.json({ drives: filteredFallback });
        }
      }

      // Last resort: try getting a specific drive if we know the name
      return NextResponse.json({ drives: [], debug: "No shared drives found via any method" });
    }

    if (action === "folders") {
      // List folders within a drive or folder
      const parentId = folderId || driveId;
      if (!parentId) return NextResponse.json({ error: "drive_id or folder_id required" }, { status: 400 });

      const query = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const params = new URLSearchParams({
        q: query,
        fields: "files(id,name,mimeType)",
        orderBy: "name",
        pageSize: "100",
        ...(driveId ? { driveId, includeItemsFromAllDrives: "true", supportsAllDrives: "true", corpora: "drive" } : { supportsAllDrives: "true", includeItemsFromAllDrives: "true" }),
      });

      const res = await fetch(`${DRIVE_API}/files?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || res.statusText);
      }
      const data = await res.json();
      return NextResponse.json({
        folders: (data.files || []).map((f: any) => ({ id: f.id, name: f.name })),
      });
    }

    if (action === "files") {
      // List files in a folder (for "Insert from Drive")
      const parentId = folderId || driveId;
      if (!parentId) return NextResponse.json({ error: "drive_id or folder_id required" }, { status: 400 });

      const query = `'${parentId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
      const params = new URLSearchParams({
        q: query,
        fields: "files(id,name,mimeType,size,webViewLink,thumbnailLink,iconLink)",
        orderBy: "modifiedTime desc",
        pageSize: "50",
        ...(driveId ? { driveId, includeItemsFromAllDrives: "true", supportsAllDrives: "true", corpora: "drive" } : { supportsAllDrives: "true", includeItemsFromAllDrives: "true" }),
      });

      const res = await fetch(`${DRIVE_API}/files?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || res.statusText);
      }
      const data = await res.json();
      return NextResponse.json({
        files: (data.files || []).map((f: any) => ({
          id: f.id, name: f.name, mimeType: f.mimeType,
          size: f.size ? parseInt(f.size) : 0,
          webViewLink: f.webViewLink, iconLink: f.iconLink,
        })),
      });
    }

    if (action === "download") {
      const fileId = req.nextUrl.searchParams.get("file_id");
      if (!fileId) return NextResponse.json({ error: "file_id required" }, { status: 400 });

      const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return NextResponse.json({ error: err.error?.message || res.statusText }, { status: 500 });
      }

      const buffer = await res.arrayBuffer();
      
      // Get file metadata for content type
      const metaRes = await fetch(`${DRIVE_API}/files/${fileId}?fields=name,mimeType,size&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meta = metaRes.ok ? await metaRes.json() : {};

      return new NextResponse(buffer, {
        headers: {
          "Content-Type": meta.mimeType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${meta.name || "file"}"`,
        },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── POST /api/drive — Upload file to Google Drive ───
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    const token = await getAccessToken();

    if (action === "upload") {
      // Upload a file from base64 data
      const { fileName, mimeType, data, folderId: targetFolderId, driveId: targetDriveId } = body;

      if (!fileName || !data) {
        return NextResponse.json({ error: "fileName and data required" }, { status: 400 });
      }

      // Create file metadata
      const metadata: any = {
        name: fileName,
        ...(targetFolderId ? { parents: [targetFolderId] } : targetDriveId ? { parents: [targetDriveId] } : {}),
      };

      const fileBytes = Buffer.from(data, "base64");

      // Use multipart upload
      const boundary = "tenkara_upload_boundary";
      const multipartBody = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${mimeType || "application/octet-stream"}`,
        "Content-Transfer-Encoding: base64",
        "",
        data,
        `--${boundary}--`,
      ].join("\r\n");

      const uploadRes = await fetch(
        `${UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        return NextResponse.json(
          { error: `Upload failed: ${err.error?.message || uploadRes.statusText}` },
          { status: 500 }
        );
      }

      const result = await uploadRes.json();
      return NextResponse.json({
        success: true,
        file: { id: result.id, name: result.name, webViewLink: result.webViewLink },
      });
    }

    if (action === "upload_attachment") {
      // Download attachment from email and upload to Drive in one step
      const { messageId, attachmentId, fileName, folderId: targetFolderId, driveId: targetDriveId } = body;

      if (!messageId || !attachmentId) {
        return NextResponse.json({ error: "messageId and attachmentId required" }, { status: 400 });
      }

      // Fetch attachment from our attachments API
      const baseUrl = req.nextUrl.origin;
      const attRes = await fetch(
        `${baseUrl}/api/attachments?message_id=${messageId}&attachment_id=${attachmentId}`
      );

      if (!attRes.ok) {
        return NextResponse.json({ error: "Failed to fetch attachment" }, { status: 500 });
      }

      const attBuffer = await attRes.arrayBuffer();
      const base64Data = Buffer.from(attBuffer).toString("base64");
      const contentType = attRes.headers.get("content-type") || "application/octet-stream";

      // Upload to Drive
      const metadata: any = {
        name: fileName || "attachment",
        ...(targetFolderId ? { parents: [targetFolderId] } : targetDriveId ? { parents: [targetDriveId] } : {}),
      };

      const boundary = "tenkara_upload_boundary";
      const multipartBody = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${contentType}`,
        "Content-Transfer-Encoding: base64",
        "",
        base64Data,
        `--${boundary}--`,
      ].join("\r\n");

      const uploadRes = await fetch(
        `${UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        return NextResponse.json(
          { error: `Upload failed: ${err.error?.message || uploadRes.statusText}` },
          { status: 500 }
        );
      }

      const result = await uploadRes.json();
      return NextResponse.json({
        success: true,
        file: { id: result.id, name: result.name },
      });
    }

    if (action === "create_folder") {
      const { folderName, parentFolderId, driveId: parentDriveId } = body;
      if (!folderName) {
        return NextResponse.json({ error: "folderName required" }, { status: 400 });
      }

      const metadata: any = {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentFolderId ? { parents: [parentFolderId] } : parentDriveId ? { parents: [parentDriveId] } : {}),
      };

      const createRes = await fetch(
        `${DRIVE_API}/files?supportsAllDrives=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(metadata),
        }
      );

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        return NextResponse.json({ error: `Create folder failed: ${err.error?.message || createRes.statusText}` }, { status: 500 });
      }

      const folder = await createRes.json();
      return NextResponse.json({
        success: true,
        folder: { id: folder.id, name: folder.name },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}