-- Migration script for Google Sheet RAG system
-- Run this in your Supabase SQL editor

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Create google_sheet_mappings table
CREATE TABLE IF NOT EXISTS google_sheet_mappings (
    phone_number TEXT PRIMARY KEY,
    sheet_id TEXT NOT NULL,
    last_synced_at TIMESTAMPTZ,
    last_row_count INTEGER DEFAULT 0
);

-- Create chunks table
CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024), -- Mistral embeddings are 1024-dimensional
    source TEXT NOT NULL,
    row_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chunks_phone_source ON chunks(phone_number, source);
CREATE INDEX IF NOT EXISTS idx_chunks_row_hash ON chunks(row_hash);
CREATE INDEX IF NOT EXISTS idx_google_sheet_mappings_phone ON google_sheet_mappings(phone_number);

-- Enable RLS (Row Level Security)
ALTER TABLE google_sheet_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

-- Create RPC function for general vector search
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector(1024),
    match_count int DEFAULT 5,
    target_file text DEFAULT NULL
)
RETURNS TABLE(
    id uuid,
    chunk text,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- For now, return chunks (can be extended for file-based search later)
    RETURN QUERY
    SELECT
        c.id,
        c.content as chunk,
        1 - (c.embedding <=> query_embedding) as similarity
    FROM chunks c
    WHERE (target_file IS NULL OR c.source = 'file')  -- Basic filtering
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Create RPC function for vector search by phone number
CREATE OR REPLACE FUNCTION match_documents_by_phone(
    query_embedding vector(1024),
    match_count int DEFAULT 5,
    target_phone text DEFAULT NULL
)
RETURNS TABLE(
    id uuid,
    content text,
    similarity float,
    source text,
    source_row_hash text
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.content,
        1 - (c.embedding <=> query_embedding) as similarity,
        c.source,
        c.row_hash as source_row_hash
    FROM chunks c
    WHERE (target_phone IS NULL OR c.phone_number = target_phone)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Create google_doc_mappings table
CREATE TABLE IF NOT EXISTS google_doc_mappings (
    phone_number TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    doc_name TEXT,
    last_synced_at TIMESTAMPTZ,
    last_chunk_count INTEGER DEFAULT 0
);

-- Create index for google_doc_mappings
CREATE INDEX IF NOT EXISTS idx_google_doc_mappings_phone ON google_doc_mappings(phone_number);

-- Enable RLS for google_doc_mappings
ALTER TABLE google_doc_mappings ENABLE ROW LEVEL SECURITY;

-- Create policy for google_doc_mappings
CREATE POLICY "Allow all operations on google_doc_mappings" ON google_doc_mappings FOR ALL USING (true);