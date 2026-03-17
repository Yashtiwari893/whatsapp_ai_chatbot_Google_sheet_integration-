import { supabase } from "./supabaseClient";
import { embedText } from "./embeddings";
import { retrieveRelevantChunksForPhoneNumber } from "./retrieval";
import { getFilesForPhoneNumber } from "./phoneMapping";
import { sendWhatsAppMessage } from "./whatsappSender";
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY!,
});

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

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
        console.log(`--- Starting Fast Auto-Response for ${toNumber} ---`);
        const startTime = Date.now();

        // 1. Parallelize initial data fetching (DB calls + Embedding)
        // These don't depend on each other, so we run them all at once.
        const [fileIds, mappingResult, queryEmbedding, historyResult] = await Promise.all([
            getFilesForPhoneNumber(toNumber),
            supabase
                .from("phone_document_mapping")
                .select("system_prompt, auth_token, origin")
                .eq("phone_number", toNumber)
                .single(),
            embedText(messageText),
            supabase
                .from("whatsapp_messages")
                .select("content_text, event_type, from_number, to_number")
                .or(`and(from_number.eq.${fromNumber},to_number.eq.${toNumber}),and(from_number.eq.${toNumber},to_number.eq.${fromNumber})`)
                .order("received_at", { ascending: true })
                .limit(20)
        ]);

        if (fileIds.length === 0) {
            console.log(`No documents mapped for business number: ${toNumber}`);
            return {
                success: false,
                noDocuments: true,
                error: "No documents mapped to this business number",
            };
        }

        const phoneMapping = mappingResult.data;
        if (mappingResult.error || !phoneMapping) {
            console.error("Error fetching phone mapping:", mappingResult.error);
            return {
                success: false,
                error: "Failed to fetch phone mapping details",
            };
        }

        const customSystemPrompt = phoneMapping.system_prompt;
        const auth_token = phoneMapping.auth_token;
        const origin = phoneMapping.origin;

        if (!auth_token || !origin) {
            console.error("No credentials found for phone number");
            return {
                success: false,
                error: "No WhatsApp API credentials found",
            };
        }

        if (!queryEmbedding) {
            return {
                success: false,
                error: "Failed to generate embedding",
            };
        }

        // 2. Vector Search (Depends on embedding)
        const matches = await retrieveRelevantChunksForPhoneNumber(
            queryEmbedding,
            toNumber,
            5
        );

        const contextText = matches.length > 0 
            ? matches.map((m) => m.chunk).join("\n\n")
            : "";

        // 3. Process history
        const historyRows = historyResult.data || [];
        const history = historyRows
            .filter(m => m.content_text && (m.event_type === "MoMessage" || m.event_type === "MtMessage"))
            .map(m => ({
                role: m.event_type === "MoMessage" ? "user" as const : "assistant" as const,
                content: m.content_text
            }));

        // 4. Detect language
        const detectedLanguage = detectLanguage(messageText, history);
        
        console.log(`Pre-processing took ${Date.now() - startTime}ms`);

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

        // 10. Generate response with Triple Fallback (Groq 70B -> Groq 8B -> Gemini)
        let response = "";
        let attemptStartTime = Date.now();

        async function tryGroq(model: string) {
            console.log(`Attempting Groq ${model}...`);
            const completion = await groq.chat.completions.create({
                model: model,
                messages,
                temperature: 0.7,
                max_tokens: 1200,
            });
            return completion.choices[0].message.content || "";
        }

        try {
            response = await tryGroq("llama-3.3-70b-versatile");
            console.log(`Groq 70B success in ${Date.now() - attemptStartTime}ms`);
        } catch (groq70Error: any) {
            console.warn("Groq 70B failed, trying Groq 8B (Higher Limit)...", groq70Error.message);
            try {
                attemptStartTime = Date.now();
                // 8B has much higher rate limits and is very fast
                response = await tryGroq("llama-3.1-8b-instant");
                console.log(`Groq 8B success in ${Date.now() - attemptStartTime}ms`);
            } catch (groq8Error: any) {
                console.error("Groq 8B also failed, trying Gemini (Google Fallback)...", groq8Error.message);
                
                if (genAI) {
                    try {
                        attemptStartTime = Date.now();
                        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                        
                        // Format messages for Gemini
                        const geminiMessages = messages.map(m => ({
                            role: m.role === "system" ? "user" : (m.role === "user" ? "user" : "model"),
                            parts: [{ text: m.content }]
                        }));

                        const result = await model.generateContent({
                            contents: geminiMessages.slice(1), 
                            systemInstruction: messages[0].content,
                        });
                        
                        response = result.response.text();
                        console.log(`Gemini fallback success in ${Date.now() - attemptStartTime}ms`);
                    } catch (geminiError: any) {
                        console.error("Gemini failed too:", geminiError.message);
                        return { success: false, error: "All AI models failed (Groq 70B, 8B, and Gemini)" };
                    }
                } else {
                    return { success: false, error: "Both Groq models failed and Gemini API key not configured" };
                }
            }
        }

        // 11. Send the response via WhatsApp (Splitting into multiple messages if long)
        // We split by double newlines or single newlines if paragraphs are long
        const messageChunks = response
            .split(/\n\n+/)
            .map(chunk => chunk.trim())
            .filter(chunk => chunk.length > 0);

        console.log(`Splitting response into ${messageChunks.length} chunks`);

        let allSent = true;
        let lastError = "";

        for (let i = 0; i < messageChunks.length; i++) {
            const chunk = messageChunks[i];
            
            // Send to WhatsApp
            const sendResult = await sendWhatsAppMessage(fromNumber, chunk, auth_token, origin);
            
            if (sendResult.success) {
                // Store each chunk in the database
                const responseMessageId = `auto_${messageId}_${Date.now()}_${i}`;
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
                            content_text: chunk,
                            sender_name: "AI Assistant",
                            event_type: "MtMessage",
                            is_in_24_window: true,
                            is_responded: false,
                            auto_respond_sent: false,
                            raw_payload: {
                                messageId: responseMessageId,
                                isAutoResponse: true,
                                chunkIndex: i
                            },
                        },
                    ]);
                
                // Add a small delay between messages to simulate typing (except for the last message)
                if (i < messageChunks.length - 1) {
                    const delay = Math.min(1500, 800 + (chunk.length * 5)); // Dynamic delay based on length
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } else {
                allSent = false;
                lastError = sendResult.error || "Unknown error";
                console.error(`Failed to send chunk ${i}:`, lastError);
            }
        }

        if (!allSent && messageChunks.length > 0) {
            return {
                success: false,
                response,
                sent: false,
                error: `Failed to send some/all chunks: ${lastError}`,
            };
        }

        // 13. Mark original message as responded
        await supabase
            .from("whatsapp_messages")
            .update({
                auto_respond_sent: true,
                response_sent_at: new Date().toISOString(),
            })
            .eq("message_id", messageId);

        console.log(`✅ Auto-response chunks sent successfully to ${fromNumber}`);

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
    const hindiWords = /\b(है|हूँ|हो|कर|जा|આ|था|थी|थे|करना|जाना|आना|खाना|पीना|सोना|बैठना|खड़ा|रहना|क्या|कौन|कब|कहाँ|क्यों|कैसे|हाँ|नहीं|थोड़ा|बहुत|अच्छा|बुरा|बड़ा|छोटा|मैं|तू|वह|हम|तुम|वे|यह|ये|हेलो|नमस्ते|धन्यवाद)\b/;
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

/**
 * Generate a gentle reminder/follow-up message
 */
export async function generateReminderResponse(
    fromNumber: string, // The user's number
    toNumber: string,   // The business number
): Promise<AutoResponseResult> {
    try {
        console.log(`--- Generating Reminder for ${fromNumber} (via ${toNumber}) ---`);
        
        // 1. Fetch mapping and history
        const [mappingResult, historyResult] = await Promise.all([
            supabase
                .from("phone_document_mapping")
                .select("system_prompt, auth_token, origin")
                .eq("phone_number", toNumber)
                .single(),
            supabase
                .from("whatsapp_messages")
                .select("content_text, event_type, from_number, to_number, raw_payload")
                .or(`and(from_number.eq.${fromNumber},to_number.eq.${toNumber}),and(from_number.eq.${toNumber},to_number.eq.${fromNumber})`)
                .order("received_at", { ascending: true })
        ]);

        const phoneMapping = mappingResult.data;
        if (mappingResult.error || !phoneMapping) return { success: false, error: "Mapping not found" };

        const historyRows = (historyResult.data || []).slice(-10);
        const history = historyRows
            .filter(m => m.content_text && (m.event_type === "MoMessage" || m.event_type === "MtMessage"))
            .map(m => ({
                role: m.event_type === "MoMessage" ? "user" as const : "assistant" as const,
                content: m.content_text
            }));

        if (history.length === 0) return { success: false, error: "No history found" };

        // Check if the very last message was already a reminder
        const latestMsg = historyRows[historyRows.length - 1];
        if (latestMsg?.raw_payload?.isReminder) {
            console.log("Last message was already a reminder. Skipping.");
            return { success: false, error: "Reminder already sent" };
        }

        const lastAiMessage = history.filter(h => h.role === "assistant").pop()?.content || "";
        const detectedLanguage = detectLanguage(lastAiMessage, history);

        // 2. Build reminder prompt
        const systemPrompt = 
            `${phoneMapping.system_prompt || "You are a helpful assistant."}\n\n` +
            `=== REMINDER TASK ===\n` +
            `The user hasn't responded for 30 minutes. Your task is to send a VERY SHORT, gentle nudge to re-engage them.\n` +
            `- Be polite, non-pushy, and human-like.\n` +
            `- Reference the last topic briefly.\n` +
            `- Keep it to 1-2 lines MAX.\n` +
            `- Reply in ${detectedLanguage}.\n` +
            `- Don't sound like a bot.\n` +
            `- Do NOT use markdown bold/bullets.\n`;

        const messages = [
            { role: "system" as const, content: systemPrompt },
            ...history.slice(-5),
            { role: "user" as const, content: "[SYSTEM: The user has been silent for 30 mins. Send a short, natural follow-up in their language to check if they have more questions or want to proceed.]" }
        ];

        // 3. Generate with Fallback
        let response = "";
        try {
            const completion = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages,
                temperature: 0.8,
                max_tokens: 150,
            });
            response = completion.choices[0].message.content || "";
        } catch (e: any) {
            console.error("Groq reminder failed:", e.message);
            if (genAI) {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent({
                    contents: messages.map(m => ({
                        role: m.role === "system" ? "user" : (m.role === "user" ? "user" : "model"),
                        parts: [{ text: m.content }]
                    })).slice(1),
                    systemInstruction: messages[0].content,
                });
                response = result.response.text();
            }
        }

        if (!response) return { success: false, error: "No response generated" };

        // 4. Send to WhatsApp
        const sendResult = await sendWhatsAppMessage(fromNumber, response, phoneMapping.auth_token, phoneMapping.origin);

        if (sendResult.success) {
            const responseMessageId = `reminder_${fromNumber}_${Date.now()}`;
            await supabase.from("whatsapp_messages").insert([{
                message_id: responseMessageId,
                channel: "whatsapp",
                from_number: toNumber,
                to_number: fromNumber,
                received_at: new Date().toISOString(),
                content_type: "text",
                content_text: response,
                sender_name: "AI Assistant",
                event_type: "MtMessage",
                raw_payload: { isReminder: true }
            }]);
            return { success: true, response, sent: true };
        }

        return { success: false, error: sendResult.error };
    } catch (error) {
        console.error("Reminder error:", error);
        return { success: false, error: "Internal error" };
    }
}