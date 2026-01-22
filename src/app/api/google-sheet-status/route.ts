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

    // Get sheet mapping and sync status
    const { data: mapping, error: mappingError } = await supabase
      .from("google_sheet_mappings")
      .select("sheet_id, last_synced_at, last_row_count")
      .eq("phone_number", phoneNumber)
      .single();

    if (mappingError && mappingError.code !== 'PGRST116') {
      console.error("Error fetching sheet mapping:", mappingError);
      return NextResponse.json(
        { error: "Failed to fetch sheet status" },
        { status: 500 }
      );
    }

    // Get chunk count for this phone number
    const { count: chunkCount, error: countError } = await supabase
      .from("chunks")
      .select("*", { count: 'exact', head: true })
      .eq("phone_number", phoneNumber)
      .eq("source", "google_sheet");

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
      connected: isConnected,
      hasData,
      sheet_id: mapping?.sheet_id || null,
      last_synced_at: mapping?.last_synced_at || null,
      total_chunks: chunkCount || 0,
      last_row_count: mapping?.last_row_count || 0,
      sync_status: isConnected ? (hasData ? "synced" : "pending_sync") : "not_connected"
    });

  } catch (error) {
    console.error("Error in google sheet status API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}