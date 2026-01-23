-- Migration to add Mistral STT enhancement fields to whatsapp_messages table
-- Run this in your Supabase SQL editor

-- Add new columns for enhanced transcription
ALTER TABLE whatsapp_messages
ADD COLUMN IF NOT EXISTS raw_transcript TEXT,
ADD COLUMN IF NOT EXISTS transcript_language TEXT,
ADD COLUMN IF NOT EXISTS transcript_confidence FLOAT,
ADD COLUMN IF NOT EXISTS transcript_method TEXT;

-- Add comment for documentation
COMMENT ON COLUMN whatsapp_messages.raw_transcript IS 'Raw transcript before Mistral enhancement';
COMMENT ON COLUMN whatsapp_messages.transcript_language IS 'Detected language of the transcript';
COMMENT ON COLUMN whatsapp_messages.transcript_confidence IS 'Confidence score of the transcription (0-1)';
COMMENT ON COLUMN whatsapp_messages.transcript_method IS 'STT method used: local_whisper, openai, groq, mistral_enhanced';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_transcript_method ON whatsapp_messages(transcript_method);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_transcript_language ON whatsapp_messages(transcript_language);