import { NextRequest, NextResponse } from 'next/server';
import { Mistral } from '@mistralai/mistralai';

// Initialize Mistral client
const client = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

interface TranscriptionResult {
  rawTranscript: string;
  cleanedTranscript: string;
  language?: string;
  timestamps?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Validates file type and size
 */
function validateAudioFile(file: File): { isValid: boolean; error?: string } {
  const allowedTypes = ['audio/wav', 'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/x-m4a'];
  const maxSize = 25 * 1024 * 1024; // 25MB limit

  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: `Unsupported file type. Allowed: ${allowedTypes.join(', ')}`
    };
  }

  if (file.size > maxSize) {
    return {
      isValid: false,
      error: `File too large. Maximum size: 25MB`
    };
  }

  return { isValid: true };
}

/**
 * Normalizes and cleans the transcript text
 */
function normalizeTranscript(text: string): string {
  return text
    // Fix spacing around punctuation
    .replace(/(\w)([.,!?;:])/g, '$1$2')
    .replace(/([.,!?;:])(\w)/g, '$1 $2')
    // Remove extra spaces
    .replace(/\s+/g, ' ')
    // Capitalize first letter of sentences
    .replace(/(^\w|\.\s*\w)/g, (match) => match.toUpperCase())
    // Trim whitespace
    .trim();
}

/**
 * Processes audio file with Mistral STT API
 */
async function transcribeAudio(audioBuffer: ArrayBuffer, filename: string): Promise<TranscriptionResult> {
  try {
    // Create a Blob from the ArrayBuffer
    const audioBlob = new Blob([audioBuffer], { type: 'audio/webm' });

    // Call Mistral STT API
    const response = await client.audio.transcriptions.complete({
      file: audioBlob,
      model: 'mistral-large-latest',
      timestampGranularities: ['segment'],
    });

    const rawTranscript = response.text || '';
    const cleanedTranscript = normalizeTranscript(rawTranscript);

    // Extract timestamps if available
    const timestamps = response.segments?.map(segment => ({
      start: segment.start || 0,
      end: segment.end || 0,
      text: segment.text || '',
    }));

    return {
      rawTranscript,
      cleanedTranscript,
      language: response.language || undefined,
      timestamps,
    };

  } catch (error) {
    console.error('Mistral STT API error:', error);
    throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * POST handler for audio transcription
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('audio') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    // Validate file
    const validation = validateAudioFile(file);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Convert file to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Transcribe audio
    const result = await transcribeAudio(arrayBuffer, file.name);

    return NextResponse.json({
      success: true,
      data: result,
    });

  } catch (error) {
    console.error('Transcription error:', error);

    // Handle specific API errors
    if (error instanceof Error) {
      if (error.message.includes('rate limit')) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please try again later.' },
          { status: 429 }
        );
      }
      if (error.message.includes('authentication')) {
        return NextResponse.json(
          { error: 'Authentication failed. Check API key.' },
          { status: 401 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Transcription failed. Please try again.' },
      { status: 500 }
    );
  }
}

/**
 * GET handler for health check
 */
export async function GET() {
  return NextResponse.json({
    status: 'STT service is running',
    supportedFormats: ['wav', 'mp3', 'webm', 'm4a'],
    maxFileSize: '25MB',
  });
}