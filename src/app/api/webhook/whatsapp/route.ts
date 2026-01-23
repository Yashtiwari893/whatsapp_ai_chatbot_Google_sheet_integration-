import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { generateAutoResponse } from "@/lib/autoResponder";
import OpenAI from "openai";

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

// Function to transcribe voice message to text using OpenAI Whisper
async function transcribeVoiceMessage(mediaUrl: string, retryCount = 0): Promise<string | null> {
    const maxRetries = 2;

    try {
        console.log("Downloading audio from:", mediaUrl);

        // Download the audio file
        const response = await fetch(mediaUrl);
        if (!response.ok) {
            throw new Error(`Failed to download audio: ${response.status}`);
        }

        const audioBuffer = await response.arrayBuffer();
        const audioFile = new File([audioBuffer], "audio.ogg", { type: "audio/ogg" });

        console.log("Audio file size:", audioFile.size, "bytes");
        console.log("Sending to OpenAI Whisper API for transcription");

        if (!openai) {
            throw new Error("OpenAI client not initialized - missing API key");
        }

        // Transcribe using OpenAI Whisper API
        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-1",
            language: "hi", // Primary language: Hindi
            response_format: "text",
            temperature: 0, // More deterministic results
        });

        if (!transcription || typeof transcription !== 'string' || transcription.trim().length === 0) {
            console.log("No transcription returned from OpenAI Whisper API");
            return null;
        }

        const cleanedTranscription = transcription.trim();
        console.log("Transcription successful:", cleanedTranscription.substring(0, 100) + "...");
        return cleanedTranscription;

    } catch (error) {
        console.error(`Voice transcription failed (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);

        // Retry logic for transient failures
        if (retryCount < maxRetries) {
            console.log(`Retrying transcription in 2 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return transcribeVoiceMessage(mediaUrl, retryCount + 1);
        }

        console.error("All transcription attempts failed");
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
