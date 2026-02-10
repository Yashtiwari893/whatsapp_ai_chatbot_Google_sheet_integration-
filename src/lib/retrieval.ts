import { supabase } from "@/lib/supabaseClient";

/**
 * Retrieve relevant chunks by query embedding
 * Searches across all phone numbers by default
 */
export async function retrieveRelevantChunks(
    queryEmbedding: number[],
    fileId?: string,
    limit = 5
) {
    const { data, error } = await supabase.rpc("match_documents_by_phone", {
        query_embedding: queryEmbedding,
        match_count: limit,
        target_phone: null, // Search across all phone numbers
    });

    if (error) {
        console.error("VECTOR SEARCH ERROR:", error);
        throw error;
    }

    return data as { id: string; content: string; similarity: number; source: string; source_row_hash: string }[];
}

/**
 * Retrieve relevant chunks from multiple files (legacy support)
 */
export async function retrieveRelevantChunksFromFiles(
    queryEmbedding: number[],
    fileIds: string[],
    limit = 5
) {
    if (fileIds.length === 0) {
        return [];
    }

    if (fileIds.length === 1) {
        return retrieveRelevantChunks(queryEmbedding, fileIds[0], limit);
    }

    // For multiple files, search and merge
    const allChunks: { id: string; content: string; similarity: number; source: string; source_row_hash: string; file_id: string }[] = [];

    for (const fileId of fileIds) {
        const chunks = await retrieveRelevantChunks(queryEmbedding, fileId, limit);
        allChunks.push(...chunks.map(c => ({ ...c, file_id: fileId })));
    }

    // Sort by similarity and return top N
    return allChunks
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
}

/**
 * Retrieve relevant chunks for a phone number (Google Sheets + Google Docs + legacy files)
 */
export async function retrieveRelevantChunksForPhoneNumber(
    queryEmbedding: number[],
    phoneNumber: string,
    limit = 5
) {
    console.log(`Retrieving chunks for phone number: ${phoneNumber}, limit: ${limit}`);

    // Get direct chunks for this phone number (Google Sheets + Google Docs)
    const { data: directChunks, error } = await supabase.rpc("match_documents_by_phone", {
        query_embedding: queryEmbedding,
        match_count: limit * 2, // Get more results to filter later
        target_phone: phoneNumber,
    });

    if (error) {
        console.error("VECTOR SEARCH ERROR for phone chunks:", error);
    }

    // Map direct chunks with source information
    const phoneChunks = (directChunks || []).map((c: any) => ({
        id: c.id,
        chunk: c.content,
        similarity: c.similarity,
        source_type: c.source, // "google_sheet" or "google_doc"
        row_hash: c.source_row_hash,
        metadata: {
            source: c.source
        }
    }));

    console.log(`Found ${phoneChunks.length} direct chunks for phone ${phoneNumber}`);
    if (phoneChunks.length > 0) {
        const sourceCounts = phoneChunks.reduce((acc: Record<string, number>, c: any) => {
            acc[c.source_type] = (acc[c.source_type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        console.log(`Source breakdown:`, sourceCounts);
    }

    // Get file IDs for this phone number (legacy support)
    const { data: fileIds } = await supabase
        .from("phone_document_mapping")
        .select("file_id")
        .eq("phone_number", phoneNumber);

    const fileChunks = fileIds?.length ?
        await retrieveRelevantChunksFromFiles(queryEmbedding, fileIds.map(f => f.file_id), limit) :
        [];

    console.log(`Found ${fileChunks.length} file-based chunks for phone ${phoneNumber}`);

    // Combine and sort all chunks
    const allChunks = [
        ...phoneChunks.map((c: any) => ({ ...c, chunk: c.chunk })),
        ...fileChunks.map((c: any) => ({ ...c, chunk: c.content, source_type: "file" }))
    ];

    // Sort by similarity and return top results
    const sortedChunks = allChunks
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

    console.log(`Returning ${sortedChunks.length} total chunks with sources:`,
        sortedChunks.map(c => ({ source: c.source_type, similarity: c.similarity.toFixed(3) })));

    return sortedChunks;
}
