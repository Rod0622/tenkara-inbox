export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const ALLOWED_COLORS = [
  "red", "orange", "yellow", "green", "blue", "purple", "pink", "gray",
];

// PATCH /api/conversations/color
// Body: { conversation_id, color, actor_id? }
// `color` should be one of ALLOWED_COLORS or null/empty to clear.
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_id, color, actor_id } = body;

  if (!conversation_id) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  // Normalize color value: null/empty/whitespace -> null (clears the color)
  let cleanedColor: string | null = null;
  if (color && typeof color === "string" && color.trim()) {
    const c = color.trim().toLowerCase();
    if (!ALLOWED_COLORS.includes(c)) {
      return NextResponse.json(
        { error: `Invalid color. Allowed: ${ALLOWED_COLORS.join(", ")} or null to clear` },
        { status: 400 }
      );
    }
    cleanedColor = c;
  }

  const { data, error } = await supabase
    .from("conversations")
    .update({ color: cleanedColor })
    .eq("id", conversation_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Activity log entry (best-effort)
  try {
    await supabase.from("activity_log").insert({
      conversation_id,
      actor_id: actor_id || null,
      action: cleanedColor ? "color_set" : "color_cleared",
      details: { color: cleanedColor },
    });
  } catch (_e) { /* best-effort */ }

  return NextResponse.json({ conversation: data });
}
