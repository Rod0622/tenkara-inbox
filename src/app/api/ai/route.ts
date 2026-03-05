import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { askKara } from "@/lib/ai";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { conversation, query } = await req.json();
    if (!conversation || !query) {
      return NextResponse.json({ error: "Missing conversation or query" }, { status: 400 });
    }

    const response = await askKara(conversation, query);

    return NextResponse.json({ text: response });
  } catch (error: any) {
    console.error("AI error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
