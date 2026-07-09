export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { authenticateBearer, hasScope } from "@/lib/api-token-auth";
import { checkAndRecordRateLimit, rateLimitedResponse } from "@/lib/api-token-rate-limit";
import { downloadAttachmentBytes } from "@/lib/attachments-storage";
import { fetchAttachmentRowByIdOrThrow } from "@/lib/external-attachments";

// ── GET /api/external/attachments/[id] ─────────────────────────────────
//
// Bearer-token authenticated. Requires conversations:read scope.
//
// Streams the raw bytes of one attachment back to the agent. This is the
// download_url target advertised in the `attachments` arrays of the
// message.received webhook and GET /api/external/conversations/{id}.
//
// FAIL-LOUD by design: this is a direct agent request (not the sync path),
// so errors return explicit 4xx/5xx instead of degrading silently —
// the agent needs to know a download failed so it can retry.
//
// Never exposes storage_path or content_id.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await authenticateBearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasScope(token, "conversations:read")) {
    return NextResponse.json(
      { error: "Token missing required scope: conversations:read" },
      { status: 403 }
    );
  }

  const rl = await checkAndRecordRateLimit(token.id, `/api/external/attachments/${params.id}`);
  if (!rl.allowed) return rateLimitedResponse(rl);

  // Metadata lookup — throwing variant so a PostgREST failure surfaces as
  // a 500 rather than masquerading as a 404.
  let row;
  try {
    row = await fetchAttachmentRowByIdOrThrow(params.id);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Attachment lookup failed: ${e?.message || "unknown"}` },
      { status: 500 }
    );
  }
  if (!row) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const supabase = createServerClient();
  const file = await downloadAttachmentBytes(supabase, row.storage_path);
  if (!file) {
    return NextResponse.json(
      { error: "Attachment file could not be retrieved from storage" },
      { status: 502 }
    );
  }

  // Prefer the DB's mime_type (set at sync time from the actual MIME part);
  // fall back to what Storage reports, then octet-stream.
  const contentType = row.mime_type || file.contentType || "application/octet-stream";

  // Sanitize the filename for the Content-Disposition header — strip
  // quotes/control chars so a hostile filename can't break the header.
  const safeName = (row.filename || "attachment.bin")
    .replace(/[\r\n"\\]/g, "_")
    .slice(0, 200);

  return new NextResponse(file.bytes as any, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
