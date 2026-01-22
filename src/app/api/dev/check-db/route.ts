import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  try {
    // Check if google_sheet_mappings table exists and get its structure
    const { data: mappingsData, error: mappingsError } = await supabase
      .from("google_sheet_mappings")
      .select("*")
      .limit(1);

    // Check if chunks table exists and get its structure
    const { data: chunksData, error: chunksError } = await supabase
      .from("chunks")
      .select("*")
      .limit(1);

    return NextResponse.json({
      success: true,
      tables: {
        google_sheet_mappings: {
          exists: !mappingsError,
          error: mappingsError?.message,
          sample: mappingsData
        },
        chunks: {
          exists: !chunksError,
          error: chunksError?.message,
          sample: chunksData
        }
      }
    });
  } catch (err) {
    console.error("Database check error:", err);
    return NextResponse.json(
      { error: "Failed to check database" },
      { status: 500 }
    );
  }
}