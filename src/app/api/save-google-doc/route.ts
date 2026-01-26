import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: Request) {
  try {
    console.log("Testing save-google-doc API");

    const body = await req.json();
    console.log("Request body:", body);

    const { phone_number, doc_url } = body;

    if (!phone_number || !doc_url) {
      return NextResponse.json(
        { error: "phone_number and doc_url are required" },
        { status: 400 }
      );
    }

    console.log("Extracting doc_id from URL:", doc_url);
    let doc_id = doc_url;
    const match = doc_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match?.[1]) doc_id = match[1];

    console.log("Doc ID:", doc_id);

    // First, try to select from the table to see if it exists
    console.log("Testing table access...");
    const { data: existing, error: selectError } = await supabase
      .from("google_doc_mappings")
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
      .from("google_doc_mappings")
      .upsert(
        {
          phone_number,
          doc_id,
          last_synced_at: null,
          last_chunk_count: 0
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
      doc_id,
      message: "Google Doc mapping saved successfully"
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}