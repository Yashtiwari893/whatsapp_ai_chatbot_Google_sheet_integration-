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

    // 1️⃣ Fetch sheet mapping for this phone number
    const { data: mapping, error: mappingError } = await supabase
      .from("google_sheet_mappings")
      .select("sheet_id, last_synced_at, last_row_count")
      .eq("phone_number", phoneNumber)
      .single();

    if (mappingError || !mapping) {
      return NextResponse.json({
        success: true,
        connected: false,
        message: "No Google Sheet connected",
        rows: [],
        total: 0,
        last_synced_at: null
      });
    }

    // 2️⃣ Get first 20 chunks for preview
    const { data: chunks, error: chunksError } = await supabase
      .from("chunks")
      .select("content")
      .eq("phone_number", phoneNumber)
      .eq("source", "google_sheet")
      .order("id")
      .limit(20);

    if (chunksError) {
      console.error("Error fetching chunks:", chunksError);
      return NextResponse.json(
        { error: "Failed to fetch sheet data" },
        { status: 500 }
      );
    }

    // 3️⃣ Parse chunks back into row objects for display
    const rows = (chunks || []).map(chunk => {
      try {
        // Try to parse as JSON first (if stored as objects)
        return JSON.parse(chunk.content);
      } catch {
        // If not JSON, treat as single column
        return { "Content": chunk.content };
      }
    });

    return NextResponse.json({
      success: true,
      connected: true,
      rows,
      total: mapping.last_row_count || 0,
      last_synced_at: mapping.last_synced_at
    });

  } catch (error) {
    console.error("Error in sheet preview API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
