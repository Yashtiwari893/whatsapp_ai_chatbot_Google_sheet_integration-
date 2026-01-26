import { supabase } from "./supabaseClient";
import { embedText } from "./embeddings";
import { retrieveRelevantChunksForPhoneNumber } from "./retrieval";
import { getFilesForPhoneNumber } from "./phoneMapping";
import { sendWhatsAppMessage } from "./whatsappSender";
import Groq from "groq-sdk";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY!,
});

export type AutoResponseResult = {
    success: boolean;
    response?: string;
    error?: string;
    noDocuments?: boolean;
    sent?: boolean;
};

/**
 * Generate an automatic response for a WhatsApp message
 * Works with ANY custom system prompt - not limited to marketing
 */
export async function generateAutoResponse(
    fromNumber: string,
    toNumber: string,
    messageText: string,
    messageId: string
): Promise<AutoResponseResult> {
    try {
        // 1. Get all documents mapped to this business number
        const fileIds = await getFilesForPhoneNumber(toNumber);

        if (fileIds.length === 0) {
            console.log(`No documents mapped for business number: ${toNumber}`);
            return {
                success: false,
                noDocuments: true,
                error: "No documents mapped to this business number",
            };
        }

        console.log(`Found ${fileIds.length} document(s) for business number ${toNumber}`);

        // 2. Fetch phone mapping details including custom system prompt and credentials
        const { data: phoneMappings, error: mappingError } = await supabase
            .from("phone_document_mapping")
            .select("system_prompt, auth_token, origin")
            .eq("phone_number", toNumber);

        if (mappingError || !phoneMappings || phoneMappings.length === 0) {
            console.error("Error fetching phone mappings:", mappingError);
            return {
                success: false,
                error: "Failed to fetch phone mapping details",
            };
        }

        const customSystemPrompt = phoneMappings[0].system_prompt;
        const auth_token = phoneMappings[0].auth_token;
        const origin = phoneMappings[0].origin;

        console.log(`Retrieved mappings for phone ${toNumber}`);
        console.log(`Has custom system prompt: ${!!customSystemPrompt}`);

        if (!auth_token || !origin) {
            console.error("No credentials found for phone number");
            return {
                success: false,
                error: "No WhatsApp API credentials found. Please set credentials in the Configuration tab.",
            };
        }

        // 3. Embed the user query for RAG
        const queryEmbedding = await embedText(messageText);

        if (!queryEmbedding) {
            return {
                success: false,
                error: "Failed to generate embedding for message",
            };
        }

        // 4. Retrieve relevant chunks from documents
        const matches = await retrieveRelevantChunksForPhoneNumber(
            queryEmbedding,
            toNumber,
            5
        );

        const contextText = matches.length > 0 
            ? matches.map((m) => m.chunk).join("\n\n")
            : "";

        console.log(`Retrieved ${matches.length} relevant chunks`);

        // 5. Get conversation history
        const { data: historyRows } = await supabase
            .from("whatsapp_messages")
            .select("content_text, event_type, from_number, to_number")
            .or(`from_number.eq.${fromNumber},to_number.eq.${fromNumber}`)
            .order("received_at", { ascending: true })
            .limit(20);

        const history = (historyRows || [])
            .filter(m => m.content_text && (m.event_type === "MoMessage" || m.event_type === "MtMessage"))
            .map(m => ({
                role: m.event_type === "MoMessage" ? "user" as const : "assistant" as const,
                content: m.content_text
            }));

        console.log(`Loaded ${history.length} messages from conversation history`);

        // 6. Detect language from user's message
        const detectedLanguage = detectLanguage(messageText, history);
        console.log(`Detected language: ${detectedLanguage}`);

        // 7. Build the system prompt
        let systemPrompt: string;

        if (customSystemPrompt && customSystemPrompt.trim().length > 0) {
            // USER PROVIDED CUSTOM PROMPT - Use it as the base
            systemPrompt = customSystemPrompt;
            
            // Add helpful formatting guidelines
            systemPrompt += `\n\n=== RESPONSE GUIDELINES ===\n`;
            systemPrompt += `- Keep responses conversational and natural\n`;
            systemPrompt += `- User's preferred language: ${detectedLanguage}\n`;
            systemPrompt += `- Reference conversation history when relevant\n`;
            systemPrompt += `- Use the provided context from documents to answer questions accurately\n`;
            
        } else {
            // NO CUSTOM PROMPT - Use friendly default
            systemPrompt = 
                `You are a helpful WhatsApp assistant.\n\n` +
                `RESPONSE STYLE:\n` +
                `- Be friendly, conversational, and helpful\n` +
                `- Keep responses concise (2-4 lines)\n` +
                `- Reply in the user's language: ${detectedLanguage}\n` +
                `- Reference previous conversation naturally\n` +
                `- Use emojis sparingly when appropriate 😊\n\n` +
                `YOUR ROLE:\n` +
                `- Answer questions based on the provided context\n` +
                `- If you don't have information, politely say so\n` +
                `- Ask clarifying questions when needed\n` +
                `- Maintain a helpful and professional tone`;
        }

        // 8. Add document context to system prompt
        if (contextText) {
            systemPrompt += `\n\n=== CONTEXT FROM KNOWLEDGE BASE ===\n${contextText}\n`;
        } else {
            systemPrompt += `\n\n=== NOTE ===\nNo specific context available for this query. Respond based on general knowledge and conversation history.\n`;
        }

        // 9. Build messages array for LLM
        const messages = [
            {
                role: "system" as const,
                content: systemPrompt
            },
            ...history.slice(-10), // Last 10 messages for context
            { 
                role: "user" as const, 
                content: messageText 
            }
        ];

        console.log(`Sending to LLM with ${messages.length} total messages`);

        // 10. Generate response using Groq
        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 0.7,
            max_tokens: 300,
        });

        const response = completion.choices[0].message.content;

        if (!response) {
            return {
                success: false,
                error: "No response generated from LLM",
            };
        }

        console.log(`Generated response: ${response.substring(0, 100)}...`);

        // 11. Send the response via WhatsApp
        const sendResult = await sendWhatsAppMessage(fromNumber, response, auth_token, origin);

        if (!sendResult.success) {
            console.error("Failed to send WhatsApp message:", sendResult.error);
            
            await supabase
                .from("whatsapp_messages")
                .update({
                    auto_respond_sent: false,
                    response_sent_at: new Date().toISOString(),
                })
                .eq("message_id", messageId);

            return {
                success: false,
                response,
                sent: false,
                error: `Generated response but failed to send: ${sendResult.error}`,
            };
        }

        // 12. Store the AI response in database
        const responseMessageId = `auto_${messageId}_${Date.now()}`;
        await supabase
            .from("whatsapp_messages")
            .insert([
                {
                    message_id: responseMessageId,
                    channel: "whatsapp",
                    from_number: toNumber,
                    to_number: fromNumber,
                    received_at: new Date().toISOString(),
                    content_type: "text",
                    content_text: response,
                    sender_name: "AI Assistant",
                    event_type: "MtMessage",
                    is_in_24_window: true,
                    is_responded: false,
                    auto_respond_sent: false,
                    raw_payload: {
                        messageId: responseMessageId,
                        isAutoResponse: true
                    },
                },
            ]);

        // 13. Mark original message as responded
        await supabase
            .from("whatsapp_messages")
            .update({
                auto_respond_sent: true,
                response_sent_at: new Date().toISOString(),
            })
            .eq("message_id", messageId);

        console.log(`✅ Auto-response sent successfully to ${fromNumber}`);

        return {
            success: true,
            response,
            sent: true,
        };
    } catch (error) {
        console.error("Auto-response error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * Detect language from message and conversation history
 */
function detectLanguage(text: string, history: Array<{role: string, content: string}>): string {
    const lowerText = text.toLowerCase();

    // Gujarati detection
    const gujaratiChars = /[અ-હ્]/;
    const gujaratiWords = /\b(છે|શું|હું|તું|આ|તે|હતું|હોય|કરવું|જવું|આવવું|ખાવું|પીવું|સૂવું|બેસવું|ઊભું|રહેવું|કેમ|ક્યાં|ક્યારે|કોણ|શું|હા|ના|થોડું|ઘણું|સારું|ખરાબ|મોટું|નાનું|હેલો|નમસ્તે|ધન્યવાદ)\b/;
    if (gujaratiChars.test(text) || gujaratiWords.test(lowerText)) {
        return "gujarati";
    }

    // Hindi detection
    const hindiChars = /[अ-ह्]/;
    const hindiWords = /\b(है|हूँ|हो|कर|जा|आ|था|थी|थे|करना|जाना|आना|खाना|पीना|सोना|बैठना|खड़ा|रहना|क्या|कौन|कब|कहाँ|क्यों|कैसे|हाँ|नहीं|थोड़ा|बहुत|अच्छा|बुरा|बड़ा|छोटा|मैं|तू|वह|हम|तुम|वे|यह|ये|हेलो|नमस्ते|धन्यवाद)\b/;
    if (hindiChars.test(text) || hindiWords.test(lowerText)) {
        return "hindi";
    }

    // English detection
    const englishWords = /\b(the|is|are|was|were|has|have|had|will|would|can|could|should|may|might|must|do|does|did|make|get|take|come|go|see|know|think|say|tell|work|help|need|want|use|find|give)\b/;
    const hasEnglishWords = englishWords.test(lowerText);
    const hasNativeScript = hindiChars.test(text) || gujaratiChars.test(text);

    if (hasEnglishWords && !hasNativeScript) {
        return "english";
    }

    // Mixed language (Hinglish)
    if (hasEnglishWords && hasNativeScript) {
        return "hinglish";
    }

    // Check conversation history for consistency
    if (history.length > 0) {
        const recentMessage = history[history.length - 1].content;
        if (hindiChars.test(recentMessage)) return "hindi";
        if (gujaratiChars.test(recentMessage)) return "gujarati";
    }

    // Default
    return "english";
}