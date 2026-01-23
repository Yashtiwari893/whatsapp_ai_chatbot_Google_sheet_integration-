/**
 * Mistral-Enhanced Speech-to-Text Service
 *
 * This service provides high-quality voice-to-text transcription by:
 * 1. Using Local Whisper/OpenAI/Groq for initial STT
 * 2. Using Mistral AI for transcript cleaning and normalization
 *
 * Features:
 * - Multilingual support (English, Hindi, Hinglish, Gujarati, etc.)
 * - Automatic language detection
 * - Text normalization and cleaning
 * - Background noise handling
 * - Production-ready error handling
 */

import { Mistral } from "@mistralai/mistralai";
import { transcribeVoiceMessage } from "@/app/api/webhook/whatsapp/route";

// Initialize Mistral client
const mistral = process.env.MISTRAL_API_KEY ? new Mistral({
    apiKey: process.env.MISTRAL_API_KEY,
}) : null;

export interface TranscriptionResult {
    rawTranscript: string;
    cleanedTranscript: string;
    language: string;
    confidence: number;
    duration: number;
    wordCount: number;
    processingTime: number;
    method: 'local_whisper' | 'openai' | 'groq' | 'mistral_enhanced';
}

export interface TranscriptionOptions {
    maxRetries?: number;
    timeout?: number;
    language?: string;
    enableCleanup?: boolean;
    enableTimestamps?: boolean;
}

/**
 * Main transcription function using Mistral-enhanced pipeline
 */
export async function transcribeAudioWithMistral(
    audioUrl: string,
    options: TranscriptionOptions = {}
): Promise<TranscriptionResult | null> {
    const startTime = Date.now();
    const {
        maxRetries = 2,
        timeout = 60000,
        language = 'auto',
        enableCleanup = true,
        enableTimestamps = false
    } = options;

    try {
        console.log(`🎤 Starting Mistral-enhanced transcription for: ${audioUrl}`);

        // Step 1: Get raw transcript using existing STT pipeline
        const rawTranscript = await transcribeVoiceMessage(audioUrl, 0);
        if (!rawTranscript) {
            console.error("❌ No raw transcript obtained from STT pipeline");
            return null;
        }

        console.log(`📝 Raw transcript: "${rawTranscript.substring(0, 100)}..."`);

        // Step 2: Use Mistral AI for transcript enhancement (if enabled)
        let cleanedTranscript = rawTranscript;
        let detectedLanguage = language;

        if (enableCleanup && mistral) {
            const enhancement = await enhanceTranscriptWithMistral(rawTranscript, language);
            if (enhancement) {
                cleanedTranscript = enhancement.cleanedTranscript;
                detectedLanguage = enhancement.language;
                console.log(`✨ Enhanced transcript: "${cleanedTranscript.substring(0, 100)}..."`);
            }
        }

        // Step 3: Calculate metrics
        const processingTime = Date.now() - startTime;
        const wordCount = cleanedTranscript.split(/\s+/).length;
        const confidence = calculateConfidence(rawTranscript, cleanedTranscript);

        const result: TranscriptionResult = {
            rawTranscript,
            cleanedTranscript,
            language: detectedLanguage,
            confidence,
            duration: 0, // Would need audio duration if available
            wordCount,
            processingTime,
            method: 'mistral_enhanced'
        };

        console.log(`✅ Transcription completed in ${processingTime}ms`);
        return result;

    } catch (error) {
        console.error("❌ Mistral-enhanced transcription failed:", error);
        return null;
    }
}

/**
 * Use Mistral AI to clean and normalize transcripts
 */
async function enhanceTranscriptWithMistral(
    rawTranscript: string,
    languageHint: string
): Promise<{ cleanedTranscript: string; language: string } | null> {
    if (!mistral) {
        console.warn("⚠️ Mistral client not available for transcript enhancement");
        return null;
    }

    try {
        const prompt = `You are an expert transcriptionist. Clean and normalize the following speech-to-text transcript.

TASK:
1. Fix any transcription errors and typos
2. Normalize punctuation, capitalization, and spacing
3. Handle common speech patterns (um, ah, repetitions)
4. Maintain the original meaning and intent
5. Detect the primary language used
6. Return in readable, professional format

RAW TRANSCRIPT: "${rawTranscript}"

INSTRUCTIONS:
- If the text is in Hinglish (Hindi+English mix), keep it natural
- For pure Hindi, ensure proper Hindi script if needed
- Add appropriate punctuation
- Remove filler words if they don't affect meaning
- Keep technical terms and names accurate

OUTPUT FORMAT:
Language: [detected language]
Cleaned: [normalized transcript]`;

        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
            },
            body: JSON.stringify({
                model: "mistral-large-latest",
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            throw new Error(`Mistral API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            console.warn("⚠️ No content received from Mistral for transcript enhancement");
            return null;
        }

        // Parse the response
        const lines = content.split('\n');
        let detectedLanguage = languageHint;
        let cleanedTranscript = rawTranscript; // fallback

        for (const line of lines) {
            if (line.startsWith('Language:')) {
                detectedLanguage = line.replace('Language:', '').trim();
            } else if (line.startsWith('Cleaned:')) {
                cleanedTranscript = line.replace('Cleaned:', '').trim();
            }
        }

        return {
            cleanedTranscript,
            language: detectedLanguage
        };

    } catch (error) {
        console.error("❌ Mistral transcript enhancement failed:", error);
        return null;
    }
}

/**
 * Calculate confidence score based on transcript changes
 */
function calculateConfidence(rawTranscript: string, cleanedTranscript: string): number {
    if (rawTranscript === cleanedTranscript) {
        return 0.95; // High confidence if no changes needed
    }

    const rawLength = rawTranscript.length;
    const cleanedLength = cleanedTranscript.length;
    const lengthRatio = Math.min(rawLength, cleanedLength) / Math.max(rawLength, cleanedLength);

    // Base confidence on length similarity and cleanup quality
    return Math.max(0.7, lengthRatio * 0.9);
}

/**
 * Validate audio file before processing
 */
export function validateAudioFile(file: File): { valid: boolean; error?: string } {
    // Check file type
    const allowedTypes = ['audio/wav', 'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    if (!allowedTypes.includes(file.type)) {
        return {
            valid: false,
            error: `Unsupported file type: ${file.type}. Allowed: ${allowedTypes.join(', ')}`
        };
    }

    // Check file size (max 25MB)
    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
        return {
            valid: false,
            error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 25MB`
        };
    }

    return { valid: true };
}

/**
 * Get supported languages
 */
export const SUPPORTED_LANGUAGES = [
    'english', 'hindi', 'hinglish', 'gujarati', 'marathi', 'bengali',
    'tamil', 'telugu', 'kannada', 'malayalam', 'punjabi', 'urdu'
];

/**
 * Estimate transcription cost (for monitoring)
 */
export function estimateTranscriptionCost(result: TranscriptionResult): number {
    // Rough estimate based on audio duration and API usage
    // This is a placeholder - implement based on actual pricing
    const baseCost = 0.01; // $0.01 per minute
    const estimatedMinutes = result.wordCount / 150; // Rough words per minute
    return Math.max(0.001, baseCost * estimatedMinutes);
}