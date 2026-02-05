import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { generateAutoResponse } from "@/lib/autoResponder";
import OpenAI from "openai";
// import speech from "@google-cloud/speech";

import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsappSender";

// Import our Mistral STT function
import { transcribeAudio, TranscriptionResult } from "../../stt/mistral/route";

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

// Initialize Google Speech client
// const speechClient = new speech.SpeechClient({
//     credentials: {
//         client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
//         private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
//     },
// });

// Function to transcribe voice message to text using Mistral STT
async function transcribeVoiceMessage(mediaUrl: string): Promise<{ text: string; result: TranscriptionResult } | null> {
    try {
        console.log("Downloading audio from:", mediaUrl);

        // Download the audio file
        const response = await fetch(mediaUrl);
        if (!response.ok) {
            throw new Error(`Failed to download audio: ${response.status}`);
        }

        const audioBuffer = await response.arrayBuffer();
        console.log("Audio file size:", audioBuffer.byteLength, "bytes");

        console.log("Sending to Mistral Speech-to-Text API for transcription");

        // Use the imported transcribeAudio function
        const result = await transcribeAudio(audioBuffer, 'voice-message.ogg');

        const transcription = result.cleanedTranscript || result.rawTranscript;

        if (!transcription) {
            console.log("No transcription returned from Mistral STT API");
            return null;
        }

        console.log("Transcription successful:", transcription.substring(0, 100) + (transcription.length > 100 ? "..." : ""));
        console.log("Detected language:", result.language || 'unknown');

        return { text: transcription, result };
    } catch (error) {
        console.error("Voice transcription failed:", error);
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
        // Accept both 'audio' (some providers) and 'voice' (WhatsApp voice note) as voice messages
        const isVoiceMessage = payload.content?.contentType === "media" &&
            (payload.content?.media?.type === "audio" || payload.content?.media?.type === "voice");

        console.log("Message analysis:", {
            contentType: payload.content?.contentType,
            mediaType: payload.content?.media?.type,
            hasMediaUrl: !!payload.content?.media?.url,
            isVoiceMessage,
            alreadyResponded,
            event: payload.event
        });

        // Helper: send fallback reply when transcription fails or when outside 24h
        async function sendFallbackForVoice() {
            try {
                // Get auth credentials for this business number
                const { data: mapping } = await supabase
                    .from("phone_document_mapping")
                    .select("*")
                    .eq("phone_number", payload.to)
                    .single();

                const authToken = mapping?.auth_token;
                const origin = mapping?.origin;

                // Mark original message as responded
                await supabase
                    .from("whatsapp_messages")
                    .update({
                        auto_respond_sent: true,
                        response_sent_at: new Date().toISOString()
                    })
                    .eq("message_id", payload.messageId);

                // If inside 24-hour window -> send a normal text fallback
                if (payload.isin24window) {
                    if (authToken && origin) {
                        await sendWhatsAppMessage(payload.from, "🎧 Voice message received. Please type your message.", authToken, origin);
                    }

                    await supabase
                        .from("whatsapp_messages")
                        .insert([{
                            message_id: `auto_${payload.messageId}_${Date.now()}`,
                            channel: "whatsapp",
                            from_number: payload.to,
                            to_number: payload.from,
                            received_at: new Date().toISOString(),
                            content_type: "text",
                            content_text: "🎧 Voice message received. Please type your message.",
                            sender_name: "AI Assistant",
                            event_type: "MtMessage",
                            is_in_24_window: true,
                            is_responded: false,
                            auto_respond_sent: true,
                            raw_payload: { messageId: payload.messageId, isAutoResponse: true }
                        }]);

                    return;
                }

                // Outside 24-hour window -> try to send an approved template
                const templateId = process.env.WHATSAPP_DEFAULT_TEMPLATE_ID || mapping?.outside_24h_template_id || mapping?.template_id;

                if (templateId && authToken && origin) {
                    await sendWhatsAppTemplate(payload.from, { templateId: templateId, parameters: {} }, authToken, origin);

                    await supabase
                        .from("whatsapp_messages")
                        .insert([{
                            message_id: `auto_${payload.messageId}_${Date.now()}`,
                            channel: "whatsapp",
                            from_number: payload.to,
                            to_number: payload.from,
                            received_at: new Date().toISOString(),
                            content_type: "template",
                            content_text: `Template:${templateId}`,
                            sender_name: "AI Assistant",
                            event_type: "MtMessage",
                            is_in_24_window: false,
                            is_responded: false,
                            auto_respond_sent: true,
                            raw_payload: { messageId: payload.messageId, isAutoResponse: true, templateId }
                        }]);

                    return;
                }

                // If no template is configured, fallback to text with a short note
                if (authToken && origin) {
                    await sendWhatsAppMessage(payload.from, "🎧 We received your voice message but cannot reply outside the 24-hour window. Please type your message or message again when possible.", authToken, origin);
                }

                await supabase
                    .from("whatsapp_messages")
                    .insert([{
                        message_id: `auto_${payload.messageId}_${Date.now()}`,
                        channel: "whatsapp",
                        from_number: payload.to,
                        to_number: payload.from,
                        received_at: new Date().toISOString(),
                        content_type: "text",
                        content_text: "🎧 We received your voice message but cannot reply outside the 24-hour window. Please type your message or message again when possible.",
                        sender_name: "AI Assistant",
                        event_type: "MtMessage",
                        is_in_24_window: false,
                        is_responded: false,
                        auto_respond_sent: true,
                        raw_payload: { messageId: payload.messageId, isAutoResponse: true }
                    }]);

            } catch (err) {
                console.error("Error sending fallback for voice message:", err);
            }
        }

        if (isVoiceMessage && payload.content?.media?.url && !alreadyResponded) {
            console.log("Voice message detected, transcribing...");
            const transcriptionResult = await transcribeVoiceMessage(payload.content.media.url);
            if (transcriptionResult) {
                messageText = transcriptionResult.text;
                console.log("Using transcribed text for auto-response");

                // Update the database with transcribed text and transcription details
                await supabase
                    .from("whatsapp_messages")
                    .update({
                        content_text: messageText,
                        raw_transcript: transcriptionResult.result.rawTranscript,
                        transcript_language: transcriptionResult.result.language,
                        transcript_method: 'mistral-stt'
                    })
                    .eq("message_id", payload.messageId);
            } else {
                console.log("Transcription failed, sending fallback reply for voice message");
                // Send fallback (text or template depending on 24h window)
                await sendFallbackForVoice();
                // Ensure we don't further process this message
                messageText = undefined;
            }
        }

        // Trigger auto-response if it's a user message and hasn't been responded to yet
        if (messageText && payload.event === "MoMessage" && !alreadyResponded) {
            console.log("Processing auto-response for message:", payload.messageId);

            // If inside 24-hour window -> generate a dynamic reply
            if (payload.isin24window) {
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
            } else {
                // Outside 24-hour window -> try to send an approved template instead of arbitrary text
                try {
                    const { data: mapping } = await supabase
                        .from("phone_document_mapping")
                        .select("*")
                        .eq("phone_number", payload.to)
                        .single();

                    const authToken = mapping?.auth_token;
                    const origin = mapping?.origin;
                    const templateId = process.env.WHATSAPP_DEFAULT_TEMPLATE_ID || mapping?.outside_24h_template_id || mapping?.template_id;

                    if (templateId && authToken && origin) {
                        await sendWhatsAppTemplate(payload.from, { templateId, parameters: { message: messageText.substring(0, 4000) } }, authToken, origin);

                        await supabase
                            .from("whatsapp_messages")
                            .insert([{
                                message_id: `auto_${payload.messageId}_${Date.now()}`,
                                channel: "whatsapp",
                                from_number: payload.to,
                                to_number: payload.from,
                                received_at: new Date().toISOString(),
                                content_type: "template",
                                content_text: `Template:${templateId}`,
                                sender_name: "AI Assistant",
                                event_type: "MtMessage",
                                is_in_24_window: false,
                                is_responded: false,
                                auto_respond_sent: true,
                                raw_payload: { messageId: payload.messageId, isAutoResponse: true, templateId }
                            }]);

                        // Mark original message as responded
                        await supabase
                            .from("whatsapp_messages")
                            .update({
                                auto_respond_sent: true,
                                response_sent_at: new Date().toISOString()
                            })
                            .eq("message_id", payload.messageId);

                    } else {
                        // No template configured - fallback to a short text informing about 24h policy
                        if (authToken && origin) {
                            await sendWhatsAppMessage(payload.from, "🎧 We received your voice message but cannot reply outside the 24-hour window. Please type your message or message again when possible.", authToken, origin);
                        }

                        await supabase
                            .from("whatsapp_messages")
                            .insert([{
                                message_id: `auto_${payload.messageId}_${Date.now()}`,
                                channel: "whatsapp",
                                from_number: payload.to,
                                to_number: payload.from,
                                received_at: new Date().toISOString(),
                                content_type: "text",
                                content_text: "🎧 We received your voice message but cannot reply outside the 24-hour window. Please type your message or message again when possible.",
                                sender_name: "AI Assistant",
                                event_type: "MtMessage",
                                is_in_24_window: false,
                                is_responded: false,
                                auto_respond_sent: true,
                                raw_payload: { messageId: payload.messageId, isAutoResponse: true }
                            }]);

                        await supabase
                            .from("whatsapp_messages")
                            .update({
                                auto_respond_sent: true,
                                response_sent_at: new Date().toISOString()
                            })
                            .eq("message_id", payload.messageId);
                    }
                } catch (err) {
                    console.error("Error sending template/fallback for outside-24h message:", err);
                }
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
