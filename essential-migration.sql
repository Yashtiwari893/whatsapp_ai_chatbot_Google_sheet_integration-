-- Essential migration for Google Sheet RAG system
-- Run this FIRST in your Supabase SQL editor

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing tables if they exist (for clean migration)
DROP TABLE IF EXISTS chunks CASCADE;
DROP TABLE IF EXISTS google_sheet_mappings CASCADE;

-- Create google_sheet_mappings table
CREATE TABLE google_sheet_mappings (
    phone_number TEXT PRIMARY KEY,
    sheet_id TEXT NOT NULL,
    last_synced_at TIMESTAMPTZ,
    last_row_count INTEGER DEFAULT 0
);

-- Create chunks table
CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024), -- Mistral embeddings are 1024-dimensional
    source TEXT NOT NULL,
    row_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_chunks_phone_source ON chunks(phone_number, source);
CREATE INDEX idx_chunks_row_hash ON chunks(row_hash);
CREATE INDEX idx_google_sheet_mappings_phone ON google_sheet_mappings(phone_number);

-- Enable RLS (Row Level Security)
ALTER TABLE google_sheet_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all operations for now)
CREATE POLICY "Allow all operations on google_sheet_mappings" ON google_sheet_mappings FOR ALL USING (true);
CREATE POLICY "Allow all operations on chunks" ON chunks FOR ALL USING (true);

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