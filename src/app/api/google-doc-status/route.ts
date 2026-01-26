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

    // Get doc mapping and sync status
    const { data: mapping, error: mappingError } = await supabase
      .from("google_doc_mappings")
      .select("doc_id, doc_name, last_synced_at, last_chunk_count")
      .eq("phone_number", phoneNumber)
      .single();

    if (mappingError && mappingError.code !== 'PGRST116') {
      console.error("Error fetching doc mapping:", mappingError);
      return NextResponse.json(
        { error: "Failed to fetch doc status" },
        { status: 500 }
      );
    }

    // Get chunk count for this phone number
    const { count: chunkCount, error: countError } = await supabase
      .from("chunks")
      .select("*", { count: 'exact', head: true })
      .eq("phone_number", phoneNumber)
      .eq("source", "google_doc");

    if (countError) {
      console.error("Error counting chunks:", countError);
      return NextResponse.json(
        { error: "Failed to count chunks" },
        { status: 500 }
      );
    }

    const isConnected = !!mapping;
    const hasData = (chunkCount || 0) > 0;

    return NextResponse.json({
      success: true,
      isConnected,
      hasData,
      docId: mapping?.doc_id || null,
      docName: mapping?.doc_name || null,
      lastSyncedAt: mapping?.last_synced_at || null,
      chunkCount: chunkCount || 0,
      lastChunkCount: mapping?.last_chunk_count || 0
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}