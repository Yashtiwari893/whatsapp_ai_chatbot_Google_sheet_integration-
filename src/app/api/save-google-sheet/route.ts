import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: Request) {
  try {
    console.log("Testing save-google-sheet API");

    const body = await req.json();
    console.log("Request body:", body);

    const { phone_number, sheet_url } = body;

    if (!phone_number || !sheet_url) {
      return NextResponse.json(
        { error: "phone_number and sheet_url are required" },
        { status: 400 }
      );
    }

    console.log("Extracting sheet_id from URL:", sheet_url);
    let sheet_id = sheet_url;
    const match = sheet_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match?.[1]) sheet_id = match[1];

    console.log("Sheet ID:", sheet_id);

    // First, try to select from the table to see if it exists
    console.log("Testing table access...");
    const { data: existing, error: selectError } = await supabase
      .from("google_sheet_mappings")
      .select("*")
      .eq("phone_number", phone_number)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      console.error("Select error:", selectError);
      return NextResponse.json(
        { error: `Table access error: ${selectError.message}`, code: selectError.code },
        { status: 500 }
      );
    }

    console.log("Existing record:", existing);

    // Now try the upsert
    console.log("Attempting upsert...");
    const { error } = await supabase
      .from("google_sheet_mappings")
      .upsert(
        {
          phone_number,
          sheet_id,
          last_synced_at: null,
          last_row_count: 0
        },
        { onConflict: "phone_number" }
      );

    if (error) {
      console.error("Upsert error:", error);
      return NextResponse.json(
        { error: `Database upsert error: ${error.message}`, code: error.code },
        { status: 500 }
      );
    }

    console.log("Success!");
    return NextResponse.json({
      success: true,
      sheet_id,
      message: "Google Sheet mapping saved successfully"
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
