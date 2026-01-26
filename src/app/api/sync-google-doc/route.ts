import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { readGoogleDoc } from "@/lib/googleDoc";
import { embedText } from "@/lib/embeddings";
import { chunkText } from "@/lib/chunk";
import { createHash } from "crypto";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    let body;
    try {
      body = await req.json();
    } catch (jsonError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { phone_number } = body;

    if (!phone_number) {
      return NextResponse.json(
        { error: "phone_number is required" },
        { status: 400 }
      );
    }

    // 1️⃣ Get saved doc mapping for this phone number
    let docMapping;
    try {
      const { data, error: mappingError } = await supabase
        .from("google_doc_mappings")
        .select("*")
        .eq("phone_number", phone_number)
        .single();

      if (mappingError) {
        if (mappingError.code === 'PGRST116') {
          return NextResponse.json(
            { error: "No Google Doc configured for this number" },
            { status: 404 }
          );
        }
        throw mappingError;
      }

      docMapping = data;
    } catch (dbError) {
      console.error("Database error fetching doc mapping:", dbError);
      return NextResponse.json(
        { error: "Database error while fetching doc mapping" },
        { status: 500 }
      );
    }

    if (!docMapping.doc_id) {
      return NextResponse.json(
        { error: "Invalid doc mapping - missing doc_id" },
        { status: 400 }
      );
    }

    console.log(`Reading Google Doc: ${docMapping.doc_id}`);

    // 2️⃣ Read current Google Doc data
    let docText;
    try {
      docText = await readGoogleDoc(docMapping.doc_id);
    } catch (docError: any) {
      console.error("Google Docs API error:", docError);

      // Handle specific Google API errors
      if (docError.code === 403) {
        return NextResponse.json(
          { error: "Google Doc access denied. Please share the doc with the service account email." },
          { status: 403 }
        );
      }

      if (docError.code === 404) {
        return NextResponse.json(
          { error: "Google Doc not found. Please check the doc URL." },
          { status: 404 }
        );
      }

      // For other errors, return 500 as unexpected
      return NextResponse.json(
        { error: "Failed to read Google Doc" },
        { status: 500 }
      );
    }

    if (!docText) {
      return NextResponse.json({
        totalChunks: 0,
        newChunks: 0,
        deletedChunks: 0,
        message: "No content found in the document"
      });
    }

    // 3️⃣ Chunk the document text
    const chunks = chunkText(docText, 1600, 200);
    console.log(`Document chunked into ${chunks.length} chunks`);

    // 4️⃣ Process chunks - create hashes
    const currentDocHashes = new Set<string>();

    const chunkData: Array<{
      hash: string;
      content: string;
    }> = [];

    chunks.forEach((chunk) => {
      // Generate SHA256 hash
      const hash = createHash('sha256')
        .update(chunk)
        .digest('hex');

      currentDocHashes.add(hash);
      chunkData.push({
        hash,
        content: chunk
      });
    });

    console.log(`Found ${chunkData.length} chunks in doc`);

    // 5️⃣ Get existing chunks for this phone number and source
    let existingChunks: Array<{ id: string; row_hash: string; content: string }> = [];
    try {
      const { data: existingData, error: existingError } = await supabase
        .from("chunks")
        .select("id, row_hash, content")
        .eq("phone_number", phone_number)
        .eq("source", "google_doc");

      if (existingError) {
        console.error("Error fetching existing chunks:", existingError);
        return NextResponse.json(
          { error: "Failed to fetch existing chunks" },
          { status: 500 }
        );
      }

      existingChunks = existingData || [];
    } catch (fetchError) {
      console.error("Database error fetching chunks:", fetchError);
      return NextResponse.json(
        { error: "Database error fetching chunks" },
        { status: 500 }
      );
    }

    // 6️⃣ Calculate what to add, delete, update
    const existingHashes = new Set(existingChunks.map(c => c.row_hash));
    const existingHashToChunk = new Map(existingChunks.map(c => [c.row_hash, c]));

    const toAdd = chunkData.filter(chunk => !existingHashes.has(chunk.hash));
    const toDelete = existingChunks.filter(chunk => !currentDocHashes.has(chunk.row_hash));
    const toUpdate = chunkData.filter(chunk => {
      const existing = existingHashToChunk.get(chunk.hash);
      return existing && existing.content !== chunk.content;
    });

    console.log(`To add: ${toAdd.length}, to delete: ${toDelete.length}, to update: ${toUpdate.length}`);

    let added = 0;
    let deleted = 0;
    let updated = 0;

    // 7️⃣ Delete old chunks
    if (toDelete.length > 0) {
      try {
        const deleteIds = toDelete.map(chunk => chunk.id);
        const { error: deleteError } = await supabase
          .from("chunks")
          .delete()
          .in("id", deleteIds);

        if (deleteError) {
          console.error("Error deleting chunks:", deleteError);
          return NextResponse.json(
            { error: "Failed to delete old chunks" },
            { status: 500 }
          );
        }

        deleted = toDelete.length;
        console.log(`Deleted ${deleted} old chunks`);
      } catch (deleteError) {
        console.error("Database error during deletion:", deleteError);
        return NextResponse.json(
          { error: "Database error during deletion" },
          { status: 500 }
        );
      }
    }

    // 8️⃣ Add new chunks with embeddings
    if (toAdd.length > 0) {
      try {
        for (const chunk of toAdd) {
          const embedding = await embedText(chunk.content);

          const { error: insertError } = await supabase
            .from("chunks")
            .insert({
              phone_number,
              content: chunk.content,
              embedding,
              source: "google_doc",
              row_hash: chunk.hash
            });

          if (insertError) {
            console.error("Error inserting chunk:", insertError);
            return NextResponse.json(
              { error: "Failed to insert new chunk" },
              { status: 500 }
            );
          }

          added++;
        }

        console.log(`Added ${added} new chunks`);
      } catch (addError) {
        console.error("Database error during addition:", addError);
        return NextResponse.json(
          { error: "Database error during addition" },
          { status: 500 }
        );
      }
    }

    // 9️⃣ Update existing chunks (if content changed)
    if (toUpdate.length > 0) {
      try {
        for (const chunk of toUpdate) {
          const embedding = await embedText(chunk.content);

          const existing = existingHashToChunk.get(chunk.hash);
          if (existing) {
            const { error: updateError } = await supabase
              .from("chunks")
              .update({
                content: chunk.content,
                embedding
              })
              .eq("id", existing.id);

            if (updateError) {
              console.error("Error updating chunk:", updateError);
              return NextResponse.json(
                { error: "Failed to update chunk" },
                { status: 500 }
              );
            }

            updated++;
          }
        }

        console.log(`Updated ${updated} chunks`);
      } catch (updateError) {
        console.error("Database error during update:", updateError);
        return NextResponse.json(
          { error: "Database error during update" },
          { status: 500 }
        );
      }
    }

    // 🔟 Update the mapping with sync info
    try {
      const { error: updateMappingError } = await supabase
        .from("google_doc_mappings")
        .update({
          last_synced_at: new Date().toISOString(),
          last_chunk_count: chunkData.length
        })
        .eq("phone_number", phone_number);

      if (updateMappingError) {
        console.error("Error updating doc mapping:", updateMappingError);
        // Don't fail the whole operation for this
      }
    } catch (mappingUpdateError) {
      console.error("Database error updating mapping:", mappingUpdateError);
    }

    return NextResponse.json({
      totalChunks: chunkData.length,
      newChunks: added,
      deletedChunks: deleted,
      updatedChunks: updated,
      message: "Google Doc synced successfully"
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}