import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════
// /api/forms/submissions — Batch 13
//
// GET ?form_template_id=xxx
//   Returns all submissions for a form template with submitter + conversation info.
//
// GET ?form_template_id=xxx&format=csv
//   Returns the same data as a CSV download.
//
// Pagination uses PAGE=1000 to respect Supabase's max_rows cap (see Batch 10
// fix #2 for context).
// ═══════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const url = req.nextUrl;
  const formTemplateId = url.searchParams.get("form_template_id");
  const format = url.searchParams.get("format") || "json";

  if (!formTemplateId) {
    return NextResponse.json({ error: "form_template_id is required" }, { status: 400 });
  }

  // Fetch the form template so we have its fields (for column ordering on CSV)
  const { data: template, error: templateErr } = await supabase
    .from("form_templates")
    .select("id, name, fields:form_fields(id, label, field_type, sort_order)")
    .eq("id", formTemplateId)
    .order("sort_order", { referencedTable: "form_fields" })
    .maybeSingle();

  if (templateErr) {
    return NextResponse.json({ error: templateErr.message }, { status: 500 });
  }
  if (!template) {
    return NextResponse.json({ error: "Form template not found" }, { status: 404 });
  }

  // Paginate to get ALL submissions (Supabase caps at 1000 per query)
  let allSubmissions: any[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: batch, error: batchErr } = await supabase
      .from("form_submissions")
      .select(`
        id,
        form_template_id,
        conversation_id,
        task_id,
        submitted_by,
        responses,
        note_id,
        created_at,
        submitter:team_members!form_submissions_submitted_by_fkey(id, name, email, color, initials),
        conversation:conversations(id, subject, from_email, from_name)
      `)
      .eq("form_template_id", formTemplateId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (batchErr) {
      return NextResponse.json({ error: batchErr.message }, { status: 500 });
    }
    if (!batch || batch.length === 0) break;
    allSubmissions = allSubmissions.concat(batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  // CSV export branch
  if (format === "csv") {
    const fields = (template.fields || []).slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const fieldHeaders = fields.map((f: any) => f.label);
    const headerRow = ["Submitted At", "Submitted By", "Submitter Email", "Conversation Subject", "Contact Email", ...fieldHeaders];

    const rows = allSubmissions.map((sub: any) => {
      const submitter = sub.submitter || {};
      const convo = sub.conversation || {};
      const responses = sub.responses || {};
      // Field values in field order (by field.id, with fallback to label)
      const fieldValues = fields.map((f: any) => {
        const raw = responses[f.id] ?? responses[f.label] ?? "";
        if (Array.isArray(raw)) return raw.join("; ");
        if (typeof raw === "boolean") return raw ? "Yes" : "No";
        return String(raw);
      });
      return [
        sub.created_at ? new Date(sub.created_at).toISOString() : "",
        submitter.name || "",
        submitter.email || "",
        convo.subject || "",
        convo.from_email || "",
        ...fieldValues,
      ];
    });

    const escape = (val: string) => {
      const s = String(val ?? "");
      if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const csv = [headerRow, ...rows]
      .map((row) => row.map(escape).join(","))
      .join("\r\n");

    const safeName = template.name.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 50) || "form";
    const today = new Date().toISOString().slice(0, 10);
    const filename = `${safeName}_submissions_${today}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // JSON branch
  return NextResponse.json({
    template: { id: template.id, name: template.name, fields: template.fields || [] },
    submissions: allSubmissions,
    count: allSubmissions.length,
  });
}
