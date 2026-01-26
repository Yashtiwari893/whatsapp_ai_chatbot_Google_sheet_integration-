import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const phoneNumber = searchParams.get("phone_number");

    if (!phoneNumber) {
      return NextResponse.json(
        { success: false, error: "phone_number is required" },
        { status: 400 }
      );
    }

    // 1️⃣ Fetch doc mapping for this phone number
    const { data: mapping, error: mappingError } = await supabase
      .from("google_doc_mappings")
      .select("doc_id, doc_name, last_synced_at, last_chunk_count")
      .eq("phone_number", phoneNumber)
      .single();

    if (mappingError || !mapping) {
      return NextResponse.json({
        success: true,
        connected: false,
        message: "No Google Doc connected",
        chunks: [],
        total: 0,
        last_synced_at: null
      });
    }

    // 2️⃣ Get first 20 chunks for preview
    const { data: chunks, error: chunksError } = await supabase
      .from("chunks")
      .select("content")
      .eq("phone_number", phoneNumber)
      .eq("source", "google_doc")
      .order("id")
      .limit(20);

    if (chunksError) {
      console.error("Error fetching chunks:", chunksError);
      return NextResponse.json(
        { error: "Failed to fetch doc data" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      connected: true,
      docId: mapping.doc_id,
      docName: mapping.doc_name,
      chunks: chunks || [],
      total: chunks?.length || 0,
      last_synced_at: mapping.last_synced_at
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}