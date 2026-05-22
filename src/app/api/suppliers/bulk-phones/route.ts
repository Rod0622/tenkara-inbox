// src/app/api/suppliers/bulk-phones/route.ts
//
// POST /api/suppliers/bulk-phones?mode=preview
//   body: { csv: string }
//   Returns: { rows: PreviewRow[], summary }
//   Parses the CSV, classifies each row, performs no writes.
//
// POST /api/suppliers/bulk-phones?mode=apply
//   body: { rows: PreviewRow[] }      // only the rows to actually apply
//   Returns: { applied, failed, details }
//   Writes phones to supplier_contact_persons. Creates new persons under
//   existing suppliers as needed.
//
// CSV format: supplier_name, person_name, phone
//   - Header row optional (auto-detected by sniffing first row)
//   - Quoted values supported for commas in names
//   - One person per row. Multiple phones for same person? Last one wins
//     (within the CSV) — we don't store multiple phones per person here.
//
// Behavior (matches Rod's choices):
//   - Skip row if supplier_name doesn't match any supplier_contacts.name
//   - Auto-CREATE supplier_contact_persons row if person_name doesn't exist
//     under the matched supplier
//   - If person exists with NO phone → set the phone
//   - If person exists WITH a phone → overwrite, flag as "will_overwrite"
//   - Phone normalized to E.164 (US default if no country code)
//   - Reject row if phone is unparseable
//
// Admin only.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { normalizeE164 } from "@/lib/phone";

async function requireAdmin(): Promise<{ ok: boolean; userId?: string; resp?: NextResponse }> {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return { ok: false, resp: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.teamMember.role !== "admin") {
    return { ok: false, resp: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { ok: true, userId: session.teamMember.id };
}

// ── CSV parser (tiny, handles quoted commas) ────────────
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  out.push(current);
  return out.map((s) => s.trim());
}

function parseCsv(text: string): string[][] {
  // Handle both \r\n and \n line endings; skip blank lines
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map(parseCsvLine);
}

// ── Status codes for each row ──────────────────────────
type RowStatus =
  | "ok_new_person"         // ✓ Will create new person under existing supplier
  | "ok_set_phone"          // ✓ Will set phone on existing person (no current phone)
  | "ok_will_overwrite"     // ⚠ Will overwrite existing phone
  | "skip_supplier_not_found"
  | "skip_invalid_phone"
  | "skip_missing_data"
  | "skip_duplicate_person"; // ⚠ Multiple persons with same name under supplier

interface PreviewRow {
  line_number: number;
  raw: { supplier_name: string; person_name: string; phone: string };
  status: RowStatus;
  // Resolved IDs (when applicable)
  supplier_contact_id: string | null;
  supplier_contact_person_id: string | null;
  normalized_phone: string | null;
  existing_phone: string | null;
  message: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "preview";

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (mode === "preview") {
    return await handlePreview(body);
  }
  if (mode === "apply") {
    return await handleApply(body);
  }
  return NextResponse.json({ error: "mode must be 'preview' or 'apply'" }, { status: 400 });
}

async function handlePreview(body: any): Promise<NextResponse> {
  if (typeof body.csv !== "string" || !body.csv.trim()) {
    return NextResponse.json({ error: "body.csv (string) required" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Load all suppliers (case-insensitive name map) and all persons grouped by
  // supplier. The supplier list is small (hundreds at most); loading it all
  // is cheaper than per-row lookups.
  const [suppliersRes, personsRes] = await Promise.all([
    supabase.from("supplier_contacts").select("id, name"),
    supabase.from("supplier_contact_persons").select("id, supplier_contact_id, name, phone"),
  ]);

  if (suppliersRes.error) return NextResponse.json({ error: suppliersRes.error.message }, { status: 500 });
  if (personsRes.error) return NextResponse.json({ error: personsRes.error.message }, { status: 500 });

  const suppliers = (suppliersRes.data || []) as any[];
  const persons = (personsRes.data || []) as any[];

  // Build lookup: lowercase supplier name → supplier_contact_id
  const supplierByName = new Map<string, string>();
  for (const s of suppliers) {
    if (s.name) supplierByName.set(String(s.name).toLowerCase().trim(), s.id);
  }

  // Build lookup: `supplier_id|lowercase person name` → array of person rows
  const personsBySupplierAndName = new Map<string, any[]>();
  for (const p of persons) {
    if (!p.name) continue;
    const key = `${p.supplier_contact_id}|${String(p.name).toLowerCase().trim()}`;
    const list = personsBySupplierAndName.get(key) || [];
    list.push(p);
    personsBySupplierAndName.set(key, list);
  }

  // Parse the CSV
  let csvRows: string[][];
  try {
    csvRows = parseCsv(body.csv);
  } catch (e: any) {
    return NextResponse.json({ error: `CSV parse failed: ${e?.message}` }, { status: 400 });
  }

  if (csvRows.length === 0) {
    return NextResponse.json({ error: "CSV is empty" }, { status: 400 });
  }

  // Auto-detect header row: if the first row's third column doesn't look like
  // a phone (no digits), assume it's a header and skip it.
  let startIdx = 0;
  if (csvRows[0].length >= 3) {
    const thirdCol = csvRows[0][2];
    const digitCount = thirdCol.replace(/\D/g, "").length;
    if (digitCount < 7) {
      startIdx = 1; // looks like a header (e.g. "phone")
    }
  }

  const rows: PreviewRow[] = [];
  for (let i = startIdx; i < csvRows.length; i++) {
    const cols = csvRows[i];
    const lineNumber = i + 1; // 1-indexed for user
    const supplier_name = cols[0] || "";
    const person_name = cols[1] || "";
    const phone = cols[2] || "";

    const row: PreviewRow = {
      line_number: lineNumber,
      raw: { supplier_name, person_name, phone },
      status: "skip_missing_data",
      supplier_contact_id: null,
      supplier_contact_person_id: null,
      normalized_phone: null,
      existing_phone: null,
      message: "",
    };

    if (!supplier_name.trim() || !person_name.trim() || !phone.trim()) {
      row.status = "skip_missing_data";
      row.message = "Row is missing supplier_name, person_name, or phone";
      rows.push(row);
      continue;
    }

    const supplierKey = supplier_name.toLowerCase().trim();
    const supplierId = supplierByName.get(supplierKey);
    if (!supplierId) {
      row.status = "skip_supplier_not_found";
      row.message = `Supplier "${supplier_name}" not found`;
      rows.push(row);
      continue;
    }
    row.supplier_contact_id = supplierId;

    const normPhone = normalizeE164(phone);
    if (!normPhone) {
      row.status = "skip_invalid_phone";
      row.message = `Phone "${phone}" could not be normalized to E.164`;
      rows.push(row);
      continue;
    }
    row.normalized_phone = normPhone;

    const personKey = `${supplierId}|${person_name.toLowerCase().trim()}`;
    const matchingPersons = personsBySupplierAndName.get(personKey) || [];

    if (matchingPersons.length === 0) {
      row.status = "ok_new_person";
      row.message = `Will create new contact "${person_name}" under ${supplier_name} with phone ${normPhone}`;
    } else if (matchingPersons.length > 1) {
      row.status = "skip_duplicate_person";
      row.message = `Multiple contacts named "${person_name}" exist under ${supplier_name}; resolve manually`;
    } else {
      const existing = matchingPersons[0];
      row.supplier_contact_person_id = existing.id;
      row.existing_phone = existing.phone || null;
      if (!existing.phone) {
        row.status = "ok_set_phone";
        row.message = `Will set phone on "${person_name}" to ${normPhone}`;
      } else if (existing.phone === normPhone) {
        // Already matches — treat as no-op overwrite (still "ok" so user can include or exclude)
        row.status = "ok_set_phone";
        row.message = `"${person_name}" already has this phone (no-op)`;
      } else {
        row.status = "ok_will_overwrite";
        row.message = `Will overwrite "${person_name}"'s existing phone (${existing.phone} → ${normPhone})`;
      }
    }

    rows.push(row);
  }

  // Summary counts
  const summary = {
    total: rows.length,
    ok_new_person: rows.filter((r) => r.status === "ok_new_person").length,
    ok_set_phone: rows.filter((r) => r.status === "ok_set_phone").length,
    ok_will_overwrite: rows.filter((r) => r.status === "ok_will_overwrite").length,
    skip_supplier_not_found: rows.filter((r) => r.status === "skip_supplier_not_found").length,
    skip_invalid_phone: rows.filter((r) => r.status === "skip_invalid_phone").length,
    skip_duplicate_person: rows.filter((r) => r.status === "skip_duplicate_person").length,
    skip_missing_data: rows.filter((r) => r.status === "skip_missing_data").length,
  };

  return NextResponse.json({ rows, summary });
}

async function handleApply(body: any): Promise<NextResponse> {
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: "body.rows (array) required" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Only "ok_*" statuses are applied. Anything else is silently skipped.
  const applicable: PreviewRow[] = body.rows.filter((r: PreviewRow) =>
    r.status === "ok_new_person" ||
    r.status === "ok_set_phone" ||
    r.status === "ok_will_overwrite"
  );

  let applied = 0;
  let failed = 0;
  const details: Array<{ line_number: number; ok: boolean; message: string }> = [];

  for (const row of applicable) {
    try {
      if (!row.normalized_phone) {
        failed++;
        details.push({ line_number: row.line_number, ok: false, message: "Missing normalized phone (preview was stale)" });
        continue;
      }

      if (row.status === "ok_new_person") {
        if (!row.supplier_contact_id) {
          failed++;
          details.push({ line_number: row.line_number, ok: false, message: "Missing supplier_contact_id" });
          continue;
        }
        const { error } = await supabase
          .from("supplier_contact_persons")
          .insert({
            supplier_contact_id: row.supplier_contact_id,
            name: row.raw.person_name.trim(),
            phone: row.normalized_phone,
          });
        if (error) {
          failed++;
          details.push({ line_number: row.line_number, ok: false, message: error.message });
        } else {
          applied++;
          details.push({ line_number: row.line_number, ok: true, message: `Created new contact "${row.raw.person_name}"` });
        }
      } else {
        // ok_set_phone or ok_will_overwrite — update existing person
        if (!row.supplier_contact_person_id) {
          failed++;
          details.push({ line_number: row.line_number, ok: false, message: "Missing person id" });
          continue;
        }
        const { error } = await supabase
          .from("supplier_contact_persons")
          .update({ phone: row.normalized_phone })
          .eq("id", row.supplier_contact_person_id);
        if (error) {
          failed++;
          details.push({ line_number: row.line_number, ok: false, message: error.message });
        } else {
          applied++;
          const verb = row.status === "ok_will_overwrite" ? "Overwrote" : "Set";
          details.push({ line_number: row.line_number, ok: true, message: `${verb} phone for "${row.raw.person_name}"` });
        }
      }
    } catch (e: any) {
      failed++;
      details.push({ line_number: row.line_number, ok: false, message: e?.message || "Unknown error" });
    }
  }

  return NextResponse.json({ applied, failed, details, total_attempted: applicable.length });
}
