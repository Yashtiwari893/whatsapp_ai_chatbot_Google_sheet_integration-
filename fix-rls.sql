-- Fix for Row-Level Security (RLS) policies blocking inserts from the application
-- Run this script in your Supabase SQL Editor

-- 1. phone_document_mapping
ALTER TABLE phone_document_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on phone_document_mapping" ON phone_document_mapping;
CREATE POLICY "Allow all operations on phone_document_mapping" ON phone_document_mapping FOR ALL USING (true);

-- 2. rag_files (just in case this is also missing policies)
ALTER TABLE IF EXISTS rag_files ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_catalog.pg_tables 
        WHERE schemaname = 'public' AND tablename = 'rag_files'
    ) THEN
        DROP POLICY IF EXISTS "Allow all operations on rag_files" ON rag_files;
        CREATE POLICY "Allow all operations on rag_files" ON rag_files FOR ALL USING (true);
    END IF;
END $$;

-- 3. whatsapp_messages (just in case this is also missing policies)
ALTER TABLE IF EXISTS whatsapp_messages ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_catalog.pg_tables 
        WHERE schemaname = 'public' AND tablename = 'whatsapp_messages'
    ) THEN
        DROP POLICY IF EXISTS "Allow all operations on whatsapp_messages" ON whatsapp_messages;
        CREATE POLICY "Allow all operations on whatsapp_messages" ON whatsapp_messages FOR ALL USING (true);
    END IF;
END $$;
