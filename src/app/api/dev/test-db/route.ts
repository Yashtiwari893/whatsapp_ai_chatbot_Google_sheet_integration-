import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  try {
    // Test basic connection
    const { data: testData, error: testError } = await supabase
      .from("google_sheet_mappings")
      .select("*")
      .limit(1);

    if (testError) {
      return NextResponse.json({
        success: false,
        error: testError.message,
        code: testError.code,
        details: testError.details,
        hint: testError.hint
      });
    }

    return NextResponse.json({
      success: true,
      message: "Database connection successful",
      table_exists: true,
      sample_data: testData
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: "Unexpected error",
      details: err instanceof Error ? err.message : String(err)
    });
  }
}