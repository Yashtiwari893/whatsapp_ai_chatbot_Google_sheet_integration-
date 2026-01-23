import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { generateAutoResponse } from "@/lib/autoResponder";
import OpenAI from "openai";
import Groq from "groq-sdk";
import { exec } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// Set FFmpeg path to use bundled binary
if (ffmpegStatic) {
    ffmpeg.setFfmpegPath(ffmpegStatic);
}

// Type definition for WhatsApp webhook payload
type WhatsAppWebhookPayload = {
    messageId: string;
    channel: string;
    from: string;
    to: string;
    receivedAt: string;
    content: {
        contentType: string;
        text?: string;
        media?: {
            type: string;
            url: string;
        };
    };
    whatsapp?: {
        senderName?: string;
    };
    timestamp: string;
    event: string;
    isin24window?: boolean;
    isResponded?: boolean;
    UserResponse?: string;
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
}) : null;

const groq = process.env.GROQ_API_KEY ? new Groq({
    apiKey: process.env.GROQ_API_KEY,
}) : null;

// Function to transcribe voice message using Local Whisper (primary) with API fallbacks
async function transcribeVoiceMessage(mediaUrl: string, retryCount = 0): Promise<string | null> {
    const maxRetries = 2;

    try {
        console.log("Starting voice transcription process for:", mediaUrl);

        // Download the audio file
        const response = await fetch(mediaUrl);
        if (!response.ok) {
            throw new Error(`Failed to download audio: ${response.status}`);
        }

        const audioBuffer = await response.arrayBuffer();
        console.log("Audio downloaded, size:", audioBuffer.byteLength, "bytes");

        // Try Local Whisper first (FREE)
        console.log("Attempting Local Whisper transcription...");
        const localTranscription = await transcribeWithLocalWhisper(audioBuffer);
        if (localTranscription) {
            console.log("✅ Local Whisper transcription successful");
            return localTranscription;
        }

        console.log("❌ Local Whisper failed, trying OpenAI Whisper fallback...");

        // Fallback 1: OpenAI Whisper
        if (openai) {
            const openaiTranscription = await transcribeWithOpenAI(audioBuffer);
            if (openaiTranscription) {
                console.log("✅ OpenAI Whisper fallback successful");
                return openaiTranscription;
            }
        }

        console.log("❌ OpenAI Whisper failed, trying Groq fallback...");

        // Fallback 2: Groq (if available)
        if (groq) {
            const groqTranscription = await transcribeWithGroq(audioBuffer);
            if (groqTranscription) {
                console.log("✅ Groq fallback successful");
                return groqTranscription;
            }
        }

        console.log("❌ All transcription methods failed");
        return null;

    } catch (error) {
        console.error(`Voice transcription failed (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);

        // Retry logic for transient failures
        if (retryCount < maxRetries) {
            console.log(`Retrying transcription in 3 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            return transcribeVoiceMessage(mediaUrl, retryCount + 1);
        }

        console.error("All transcription attempts failed");
        return null;
    }
}

// Local Whisper transcription using Python CLI
async function transcribeWithLocalWhisper(audioBuffer: ArrayBuffer): Promise<string | null> {
    let tempDir = "";
    let oggPath = "";
    let wavPath = "";

    try {
        // Check if whisper command is available
        const whisperAvailable = await checkWhisperAvailability();
        if (!whisperAvailable) {
            console.log("Whisper CLI not available in this environment, skipping local transcription");
            return null;
        }

        // Create temp directory
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "whisper-"));
        oggPath = path.join(tempDir, "audio.ogg");
        wavPath = path.join(tempDir, "audio.wav");

        // Write OGG file
        await fs.writeFile(oggPath, Buffer.from(audioBuffer));

        // Convert OGG to WAV using FFmpeg
        await new Promise<void>((resolve, reject) => {
            ffmpeg(oggPath)
                .toFormat('wav')
                .audioCodec('pcm_s16le')
                .audioChannels(1)
                .audioFrequency(16000)
                .on('end', () => resolve())
                .on('error', (err) => {
                    console.error("FFmpeg conversion failed:", err);
                    reject(err);
                })
                .save(wavPath);
        });

        // Call Whisper CLI
        const transcription = await new Promise<string>((resolve, reject) => {
            const command = `whisper "${wavPath}" --model base --language hi --output_format txt --output_dir "${tempDir}" --fp16 False`;
            console.log("Running Whisper CLI:", command);

            exec(command, { timeout: 60000 }, (error, _stdout, _stderr) => {
                if (error) {
                    console.error("Whisper CLI error:", error);
                    reject(error);
                    return;
                }

                // Read the generated text file
                const txtPath = path.join(tempDir, "audio.txt");
                fs.readFile(txtPath, 'utf8')
                    .then(content => resolve(content.trim()))
                    .catch(reject);
            });
        });

        if (transcription && transcription.length > 0) {
            return transcription;
        }

        return null;

    } catch (error) {
        console.error("Local Whisper transcription failed:", error);
        return null;
    } finally {
        // Cleanup temp files
        try {
            if (tempDir) {
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        } catch (cleanupError) {
            console.warn("Failed to cleanup temp files:", cleanupError);
        }
    }
}

// Check if Whisper CLI is available
async function checkWhisperAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
        exec('whisper --help', { timeout: 5000 }, (error) => {
            if (error) {
                console.log("Whisper CLI not available:", error.message);
                resolve(false);
            } else {
                console.log("Whisper CLI is available");
                resolve(true);
            }
        });
    });
}

// OpenAI Whisper fallback
async function transcribeWithOpenAI(audioBuffer: ArrayBuffer): Promise<string | null> {
    try {
        if (!openai) return null;

        const audioFile = new File([audioBuffer], "audio.ogg", { type: "audio/ogg" });

        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-1",
            language: "hi",
            response_format: "text",
            temperature: 0,
        });

        return transcription && typeof transcription === 'string' && transcription.trim().length > 0
            ? transcription.trim()
            : null;

    } catch (error) {
        console.error("OpenAI Whisper fallback failed:", error);
        return null;
    }
}

// Groq fallback (using their API if they support transcription)
async function transcribeWithGroq(_audioBuffer: ArrayBuffer): Promise<string | null> {
    try {
        if (!groq) return null;

        // Note: Groq primarily supports text generation, not audio transcription
        // This is a placeholder - in practice, you might need to check if Groq has STT capabilities
        // For now, we'll skip Groq as it doesn't have Whisper-like transcription
        console.log("Groq does not support audio transcription, skipping...");
        return null;

    } catch (error) {
        console.error("Groq fallback failed:", error);
        return null;
    }
}

export async function POST(req: Request) {
    try {
        const payload: WhatsAppWebhookPayload = await req.json();

        console.log("Received WhatsApp webhook:", payload);

        // Validate required fields
        if (!payload.messageId || !payload.from || !payload.to) {
            return NextResponse.json(
                { error: "Missing required fields: messageId, from, or to" },
                { status: 400 }
            );
        }

        // Insert or update message in database (handle duplicates)
        const { data, error } = await supabase
            .from("whatsapp_messages")
            .upsert(
                {
                    message_id: payload.messageId,
                    channel: payload.channel,
                    from_number: payload.from,
                    to_number: payload.to,
                    received_at: payload.receivedAt,
                    content_type: payload.content?.contentType,
                    content_text: payload.content?.text || payload.UserResponse, // Initial text, will update if voice
                    sender_name: payload.whatsapp?.senderName,
                    event_type: payload.event,
                    is_in_24_window: payload.isin24window || false,
                    is_responded: payload.isResponded || false,
                    raw_payload: payload,
                },
                {
                    onConflict: "message_id",
                    ignoreDuplicates: false
                }
            )
            .select();

        if (error) {
            console.error("Database error:", error);
            throw error;
        }

        console.log("Message stored/updated successfully:", data);

        // Check if this message has already been responded to
        const existingMessage = data?.[0];
        const alreadyResponded = existingMessage?.auto_respond_sent;

        // Determine message text - handle both text and voice messages
        let messageText = payload.content?.text || payload.UserResponse;
        const isVoiceMessage = payload.content?.contentType === "media" && payload.content?.media?.type === "audio";

        console.log("Message analysis:", {
            contentType: payload.content?.contentType,
            mediaType: payload.content?.media?.type,
            hasMediaUrl: !!payload.content?.media?.url,
            isVoiceMessage,
            alreadyResponded,
            event: payload.event
        });

        if (isVoiceMessage && payload.content?.media?.url && !alreadyResponded) {
            console.log("Voice message detected, transcribing...");
            const transcription = await transcribeVoiceMessage(payload.content.media.url);
            if (transcription) {
                messageText = transcription;
                console.log("Using transcribed text for auto-response");

                // Update the database with transcribed text
                await supabase
                    .from("whatsapp_messages")
                    .update({ content_text: messageText })
                    .eq("message_id", payload.messageId);
            } else {
                console.log("Transcription failed, skipping auto-response for voice message");
                messageText = undefined; // Skip processing if transcription fails
            }
        }

        // Trigger auto-response if it's a user message and hasn't been responded to yet
        if (messageText && payload.event === "MoMessage" && !alreadyResponded) {
            console.log("Processing auto-response for message:", payload.messageId);

            // Process directly - await the full response
            // Use payload.to (the business number) to look up the correct file/credentials
            const result = await generateAutoResponse(
                payload.from,
                payload.to,
                messageText,
                payload.messageId
            );

            if (result.success) {
                console.log("✅ Auto-response sent successfully");

                // Mark the message as responded in the database
                await supabase
                    .from("whatsapp_messages")
                    .update({
                        auto_respond_sent: true,
                        response_sent_at: new Date().toISOString()
                    })
                    .eq("message_id", payload.messageId);

            } else {
                console.error("❌ Auto-response failed:", result.error);
            }
        } else if (alreadyResponded) {
            console.log("Skipping auto-response - already sent for message:", payload.messageId);
        }

        return NextResponse.json({
            success: true,
            message: "WhatsApp message received and stored",
            data: data?.[0],
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("WEBHOOK_ERROR:", message, err);
        return NextResponse.json(
            { error: message, details: err },
            { status: 500 }
        );
    }
}

// Optional: Add GET endpoint for webhook verification (some services require this)
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    // Verify token (set this in your environment variables)
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "your_verify_token";

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook verified successfully");
        return new Response(challenge, { status: 200 });
    }

    return NextResponse.json(
        { error: "Verification failed" },
        { status: 403 }
    );
}
