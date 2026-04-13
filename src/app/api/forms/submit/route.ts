import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// POST /api/forms/submit — submit a filled form, save to notes
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { form_template_id, conversation_id, task_id, submitted_by, responses, complete_task } = body;

  if (!form_template_id || !conversation_id || !responses) {
    return NextResponse.json({ error: "form_template_id, conversation_id, and responses are required" }, { status: 400 });
  }

  // Get the form template with fields
  const { data: template } = await supabase
    .from("form_templates")
    .select("*, fields:form_fields(*)")
    .eq("id", form_template_id)
    .order("sort_order", { referencedTable: "form_fields" })
    .single();

  if (!template) {
    return NextResponse.json({ error: "Form template not found" }, { status: 404 });
  }

  // Build formatted note text from responses
  const lines: string[] = [`📋 ${template.name}`, ""];
  for (const field of (template.fields || [])) {
    const value = responses[field.id] ?? responses[field.label] ?? "";
    const displayValue = Array.isArray(value) ? value.join(", ") : String(value);
    lines.push(`**${field.label}:** ${displayValue || "—"}`);
  }
  lines.push("");
  lines.push(`_Submitted ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}_`);
  const noteText = lines.join("\n");

  // Save note
  const { data: note, error: noteErr } = await supabase
    .from("notes")
    .insert({
      conversation_id,
      text: noteText,
      author_id: submitted_by || null,
    })
    .select()
    .single();

  if (noteErr) return NextResponse.json({ error: noteErr.message }, { status: 500 });

  // Save submission record
  const { data: submission, error: subErr } = await supabase
    .from("form_submissions")
    .insert({
      form_template_id,
      conversation_id,
      task_id: task_id || null,
      submitted_by: submitted_by || null,
      responses,
      note_id: note?.id || null,
    })
    .select()
    .single();

  if (subErr) console.error("Submission save error:", subErr.message);

  // Optionally complete the task
  if (complete_task && task_id) {
    await supabase.from("tasks")
      .update({ status: "completed", is_done: true, completed_at: new Date().toISOString() })
      .eq("id", task_id);
  }

  // Log activity
  await supabase.from("activity_log").insert({
    conversation_id,
    actor_id: submitted_by || null,
    action: "form_submitted",
    details: { form_name: template.name, form_template_id, task_id, fields_count: template.fields?.length },
  });

  return NextResponse.json({ success: true, note, submission });
}
