-- Add API key columns to phone_document_mapping table
ALTER TABLE phone_document_mapping 
ADD COLUMN IF NOT EXISTS gemini_api_key TEXT,
ADD COLUMN IF NOT EXISTS groq_api_key TEXT,
ADD COLUMN IF NOT EXISTS mistral_api_key TEXT;

-- Update existing rows (optional, keeps them using env vars if NULL)
COMMENT ON COLUMN phone_document_mapping.gemini_api_key IS 'Custom Gemini API Key for this user';
COMMENT ON COLUMN phone_document_mapping.groq_api_key IS 'Custom Groq API Key for this user';
COMMENT ON COLUMN phone_document_mapping.mistral_api_key IS 'Custom Mistral API Key for this user';
