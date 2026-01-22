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
    sent?: boolean; // Whether message was sent via WhatsApp
};

/**
 * Generate an automatic response for a WhatsApp message
 * @param fromNumber - The sender's phone number (who sent the message)
 * @param toNumber - The business WhatsApp number (where message was received)
 * @param messageText - The text of the message
 * @param messageId - The unique message ID
 */
export async function generateAutoResponse(
    fromNumber: string,
    toNumber: string,
    messageText: string,
    messageId: string
): Promise<AutoResponseResult> {
    try {
        // 1. Get all documents mapped to this 'to' number (business number)
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

        // 1.5. Fetch phone mapping details including system prompt and credentials
        const { data: phoneMappings, error: mappingError } = await supabase
            .from("phone_document_mapping")
            .select("system_prompt, intent, auth_token, origin")
            .eq("phone_number", toNumber);

        if (mappingError || !phoneMappings || phoneMappings.length === 0) {
            console.error("Error fetching phone mappings:", mappingError);
            return {
                success: false,
                error: "Failed to fetch phone mapping details",
            };
        }

        // Get system prompt and credentials from first mapping (they should all be the same)
        const customSystemPrompt = phoneMappings[0].system_prompt;
        const auth_token = phoneMappings[0].auth_token;
        const origin = phoneMappings[0].origin;

        console.log(`Retrieved ${phoneMappings.length} mappings for phone ${toNumber}`);
        console.log(`Intent: ${phoneMappings[0].intent}`);
        console.log(`Has custom system prompt: ${!!customSystemPrompt}`);
        if (customSystemPrompt) {
            console.log(`Custom system prompt (first 100 chars): ${customSystemPrompt.substring(0, 100)}...`);
        }

        if (!auth_token || !origin) {
            console.error("No credentials found for phone number");
            return {
                success: false,
                error: "No WhatsApp API credentials found. Please set credentials in the Configuration tab.",
            };
        }

        // 2. Embed the user query
        const queryEmbedding = await embedText(messageText);

        if (!queryEmbedding) {
            return {
                success: false,
                error: "Failed to generate embedding for message",
            };
        }

        // 3. Retrieve relevant chunks from all mapped documents and direct phone chunks
        const matches = await retrieveRelevantChunksForPhoneNumber(
            queryEmbedding,
            toNumber,
            5
        );

        if (matches.length === 0) {
            console.log("No relevant chunks found");
        }

        const contextText = matches.map((m) => m.chunk).join("\n\n");

        // 4. Get conversation history for this phone number
        const { data: historyRows } = await supabase
            .from("whatsapp_messages")
            .select("content_text, event_type, from_number, to_number")
            .or(`from_number.eq.${fromNumber},to_number.eq.${fromNumber}`) // Messages involving this user
            .order("received_at", { ascending: true })
            .limit(30); // Last 30 messages for better context maintenance

        // Build conversation history (user messages and AI responses)
        const history = (historyRows || [])
            .filter(m => m.content_text && (m.event_type === "MoMessage" || m.event_type === "MtMessage"))
            .map(m => ({
                role: m.event_type === "MoMessage" ? "user" as const : "assistant" as const,
                content: m.content_text
            }));

        // 5. Analyze conversation context to detect selected service and language
        const conversationText = history.map(h => h.content).join(" ").toLowerCase();
        let selectedService: string | null = null;
        let currentStep: string = "discovery";
        let detectedLanguage: string = "hinglish"; // Default fallback

        // Language detection logic
        const detectLanguage = (text: string): string => {
            const lowerText = text.toLowerCase();

            // Gujarati detection (ગુજરાતી characters and common words)
            const gujaratiChars = /[અ-હ્]/;
            const gujaratiWords = /\b(છે|શું|હું|તું|આ|તે|હતું|હોય|કરવું|જવું|આવવું|ખાવું|પીવું|સૂવું|બેસવું|ઊભું|રહેવું|કેમ|ક્યાં|ક્યારે|કોણ|શું|હા|ના|થોડું|ઘણું|સારું|ખરાબ|મોટું|નાનું|હેલો|નમસ્તે|ધન્યવાદ|કૃપા|કરીને|મળશે|બતાવો|આપો|લો|હો|ગયો|ગઈ|ગયા|હતો|હતી|હતા)\b/;
            if (gujaratiChars.test(text) || gujaratiWords.test(lowerText)) {
                return "gujarati";
            }

            // Hindi detection (हिंदी characters and common words)
            const hindiChars = /[अ-ह्]/;
            const hindiWords = /\b(है|हूँ|हो|कर|जा|आ|था|थी|थे|करना|जाना|आना|खाना|पीना|सोना|बैठना|खड़ा|रहना|क्या|कौन|कब|कहाँ|क्यों|कैसे|हाँ|नहीं|थोड़ा|बहुत|अच्छा|बुरा|बड़ा|छोटा|मैं|तू|वह|हम|तुम|वे|यह|ये|हेलो|नमस्ते|धन्यवाद|कृपया|करिए|मिलेगा|बताओ|दो|हो|गया|गई|गये|था|थी|थे|करो|करें|देखो|देखें)\b/;
            if (hindiChars.test(text) || hindiWords.test(lowerText)) {
                return "hindi";
            }

            // English detection (primarily English words, no native script)
            const englishWords = /\b(the|is|are|was|were|has|have|had|will|would|can|could|should|may|might|must|do|does|did|make|made|get|got|take|took|come|came|go|went|see|saw|know|knew|think|thought|say|said|tell|told|work|worked|help|helped|need|needed|want|wanted|use|used|find|found|give|gave|take|took|put|put|call|called|ask|asked|try|tried|seem|seemed|feel|felt|become|became|leave|left|let|let)\b/;
            const hasEnglishWords = englishWords.test(lowerText);
            const hasNativeScript = hindiChars.test(text) || gujaratiChars.test(text);

            if (hasEnglishWords && !hasNativeScript) {
                return "english";
            }

            // Mixed language detection
            if (hasEnglishWords && (hindiChars.test(text) || gujaratiChars.test(text))) {
                // Determine dominant language
                const englishWordCount = (lowerText.match(englishWords) || []).length;
                const nativeCharCount = (text.match(/[अ-ह્અ-હ્]/g) || []).length;

                if (nativeCharCount > englishWordCount * 2) {
                    return hindiChars.test(text) ? "hindi" : "gujarati";
                } else if (englishWordCount > nativeCharCount) {
                    return "english";
                } else {
                    return "hinglish"; // Balanced mix
                }
            }

            // Default to hinglish if unclear
            return "hinglish";
        };

        // Detect language from current message
        detectedLanguage = detectLanguage(messageText);

        // Also check recent conversation history for language consistency
        if (history.length > 0) {
            const recentMessage = history[history.length - 1].content;
            const recentLanguage = detectLanguage(recentMessage);

            // If recent message was in a different language, check if current message confirms the switch
            if (recentLanguage !== detectedLanguage) {
                // Keep the recent language unless current message strongly indicates a different language
                const currentStrength = detectedLanguage === "english" ? 1 :
                                      detectedLanguage === "hindi" ? 2 :
                                      detectedLanguage === "gujarati" ? 3 : 0;
                const recentStrength = recentLanguage === "english" ? 1 :
                                     recentLanguage === "hindi" ? 2 :
                                     recentLanguage === "gujarati" ? 3 : 0;

                if (recentStrength > currentStrength) {
                    detectedLanguage = recentLanguage;
                }
            }
        }

        // Force English only for professional responses
        detectedLanguage = "english";

        console.log(`Detected language: ${detectedLanguage} for message: "${messageText.substring(0, 50)}..."`);

        // Detect selected service from conversation history
        if (conversationText.includes("the look") && !conversationText.includes("the system") && !conversationText.includes("the reach")) {
            selectedService = "the_look";
            currentStep = conversationText.includes("budget") ? "budget" : conversationText.includes("book") ? "booking" : "discovery";
        } else if ((conversationText.includes("the system") || conversationText.includes("seo") || conversationText.includes("search engine") || conversationText.includes("website") || conversationText.includes("audit")) && !conversationText.includes("the look") && !conversationText.includes("the reach")) {
            selectedService = "the_system";
            currentStep = conversationText.includes("budget") ? "budget" : conversationText.includes("audit") ? "audit" : "discovery";
        } else if (conversationText.includes("the reach") && !conversationText.includes("the look") && !conversationText.includes("the system")) {
            selectedService = "the_reach";
            currentStep = conversationText.includes("budget") ? "budget" : conversationText.includes("campaign") ? "campaign" : "discovery";
        }

        // Additional check: if current message mentions a specific service, update context
        const currentMessageLower = messageText.toLowerCase();
        if (currentMessageLower.includes("the look") && !currentMessageLower.includes("the system") && !currentMessageLower.includes("the reach")) {
            selectedService = "the_look";
            currentStep = "discovery";
        } else if ((currentMessageLower.includes("the system") || currentMessageLower.includes("seo") || currentMessageLower.includes("search engine") || currentMessageLower.includes("website") || currentMessageLower.includes("audit")) && !currentMessageLower.includes("the look") && !currentMessageLower.includes("the reach")) {
            selectedService = "the_system";
            currentStep = "discovery";
        } else if (currentMessageLower.includes("the reach") && !currentMessageLower.includes("the look") && !currentMessageLower.includes("the system")) {
            selectedService = "the_reach";
            currentStep = "discovery";
        }

        console.log(`Conversation context: service=${selectedService}, step=${currentStep}, language=${detectedLanguage}`);

        // SAFETY CHECKS - Redirect inappropriate queries
        const lowerMessage = messageText.toLowerCase();
        const inappropriatePatterns = [
            /\b(illegal|drugs?|weapons?|hack|crack|porn|sex|adult|nude|naked)\b/i,
            /\b(password|otp|verification|code|pin)\b.*\b(send|give|share)\b/i,
            /\b(politics?|election|voting?|government|minister|party)\b/i,
            /\b(violence|kill|harm|hurt|attack|threat)\b/i
        ];

        const isInappropriate = inappropriatePatterns.some(pattern => pattern.test(lowerMessage));
        if (isInappropriate) {
            const safetyResponse = detectedLanguage === "hindi" || detectedLanguage === "hinglish"
                ? "माफ़ कीजिए, मैं मार्केटिंग और बिज़नेस ग्रोथ से संबंधित चर्चा में मदद कर सकता हूं। अन्य विषयों पर मैं सलाह नहीं दे सकता। आपकी बिज़नेस ग्रोथ के लिए क्या मदद चाहिए?"
                : detectedLanguage === "gujarati"
                ? "માફ કરશો, હું માર્કેટિંગ અને બિઝનેસ ગ્રોथ સંબંધિત ચર્ચામાં મદદ કરી શકું છું. અન્ય વિષયો પર હું સલાહ આપી શકતો નથી. તમારા બિઝનેસ ગ્રોथ માટે શું મદદ જોઈએ?"
                : "I'm sorry, I can help with marketing and business growth discussions. I can't provide advice on other topics. How can I help you grow your business?";

            const sendResult = await sendWhatsAppMessage(fromNumber, safetyResponse, auth_token, origin);
            if (sendResult.success) {
                await supabase.from("whatsapp_messages").insert([{
                    message_id: `auto_${messageId}_safety_${Date.now()}`,
                    channel: "whatsapp",
                    from_number: toNumber,
                    to_number: fromNumber,
                    received_at: new Date().toISOString(),
                    content_type: "text",
                    content_text: safetyResponse,
                    sender_name: "Marketing Consultant",
                    event_type: "MtMessage",
                    is_in_24_window: true,
                    is_responded: false,
                    auto_respond_sent: false,
                    raw_payload: { messageId: `auto_${messageId}_safety_${Date.now()}`, isSafetyResponse: true }
                }]);

                await supabase.from("whatsapp_messages").update({
                    auto_respond_sent: true,
                    response_sent_at: new Date().toISOString()
                }).eq("message_id", messageId);

                return { success: true, response: safetyResponse, sent: true };
            }
        }

        // 6. Generate response using Groq with conversational system prompt
        const documentRules =
            `You are a friendly WhatsApp assistant chatting naturally with customers.\n\n` +
            `RESPONSE STYLE:\n` +
            `- Sound like a real human executive on WhatsApp\n` +
            `- Use casual, conversational language\n` +
            `- Mix Hindi and English (Hinglish) when it feels natural\n` +
            `- Keep replies SHORT (2-3 lines max)\n` +
            `- Use emojis occasionally 😊 (not too much)\n` +
            `- Ask ONE small follow-up question if helpful\n` +
            `- Never say "As an AI..." or "I am here to help you with..."\n` +
            `- Always acknowledge greetings properly (hi/hello/hey)\n` +
            `- Reference what the user just said naturally\n\n` +
            `LANGUAGE REQUIREMENTS:\n` +
            `- DETECTED USER LANGUAGE: ${detectedLanguage.toUpperCase()}\n` +
            `- You MUST reply in the SAME LANGUAGE as the user\n` +
            `- Maintain consistent language throughout conversation\n` +
            `- Use appropriate script and vocabulary for the detected language\n` +
            `- Do NOT switch languages unless user explicitly requests it\n\n` +
            `CONVERSATION CONTEXT RULES:\n` +
            `- SELECTED SERVICE: ${selectedService || 'none'}\n` +
            `- CURRENT STEP: ${currentStep}\n` +
            `- Stay strictly within the selected service context\n` +
            `- Do NOT introduce other services unless user explicitly asks\n` +
            `- If user says "yes" to a question about current service, continue with that service\n` +
            `- Only cross-sell after current service flow is complete\n` +
            `- Maintain service focus throughout conversation\n\n` +
            `CONTENT GUIDANCE:\n` +
            `- Use the provided context to answer questions naturally\n` +
            `- If you don't have the info in context, politely ask for clarification\n` +
            `- Don't dump raw text - weave information into conversation\n` +
            `- Be helpful and friendly, like chatting with a customer`;

        let systemPrompt: string;
        if (customSystemPrompt) {
            // Combine custom prompt with language and conversation guidance
            systemPrompt = `${customSystemPrompt}\n\nLANGUAGE: Reply in ${detectedLanguage.toUpperCase()} only.\n\n${documentRules}`;
        } else {
            // Use default friendly WhatsApp assistant prompt
            systemPrompt = `You are a friendly WhatsApp assistant helping customers with questions and requests.\n\nLANGUAGE: Reply in ${detectedLanguage.toUpperCase()} only.\n\n${documentRules}`;
        }

        // Check if this is a greeting
        const isGreeting = /^(hi|hello|hey|namaste|hii|hai|good morning|good afternoon|good evening)/i.test(messageText.trim());

        // Check if this is a confirmation/affirmation within service context
        const isConfirmation = /^(yes|yep|yeah|haan|han|sure|okay|ok|theek|right|correct)/i.test(messageText.trim());

        // Check if user is asking about services
        const isAskingServices = /service|services|what do you|offer|provide/i.test(messageText.toLowerCase());

        // Special handling for service-specific conversations
        if (selectedService === "the_look" && !isGreeting) {
            // For The Look service, stay focused on visual identity topics
            let lookSpecificPrompt = `${systemPrompt}\n\nSERVICE FOCUS - THE LOOK (Visual Identity):\n` +
                `- ONLY discuss: logo, branding, color themes, visuals, content creation\n` +
                `- Next logical questions: logo style, brand personality, usage context\n` +
                `- DO NOT mention: SEO, WhatsApp API, web development, social media marketing\n` +
                `- If user says "yes" to strategy question, ask about logo/brand details\n` +
                `- Stay in visual identity context until user explicitly changes service`;

            // If user is confirming something, guide them to next logical step in The Look
            if (isConfirmation && conversationText.includes("strategy")) {
                lookSpecificPrompt += `\n\nUSER CONFIRMED STRATEGY INTEREST - NEXT STEPS:\n` +
                    `- Ask about logo preferences, brand personality, or visual style\n` +
                    `- Do not jump to other services or marketing topics\n` +
                    `- Focus on visual identity deliverables`;
            }

            systemPrompt = lookSpecificPrompt;
            console.log("Applied The Look service focus");
        } else if (isAskingServices && !selectedService) {
            // User is asking about services, provide marketing agency overview
            systemPrompt += `\n\nUSER ASKING ABOUT SERVICES:\n` +
                `- Provide overview of all three services: The Look, The System, The Reach\n` +
                `- Ask which service interests them\n` +
                `- Do not dive deep into any one service yet`;
            console.log("Applied services overview context");
        }

        // If it's a greeting and we have context, respond warmly
        if (isGreeting && contextText) {
            const greetingResponse = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [
                    {
                        role: "system",
                        content: `${systemPrompt}\n\nThe user just greeted you in ${detectedLanguage.toUpperCase()}. Respond warmly in the SAME LANGUAGE and ask how you can help them today. Keep it short and friendly.`
                    },
                    { role: "user", content: messageText }
                ],
                temperature: 0.9,
                max_tokens: 150,
            });

            const response = greetingResponse.choices[0].message.content;
            if (response) {
                // Send greeting response
                const sendResult = await sendWhatsAppMessage(fromNumber, response, auth_token, origin);
                if (sendResult.success) {
                    // Store and mark as responded
                    const responseMessageId = `auto_${messageId}_greeting_${Date.now()}`;
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
                        is_in_24_window: true,
                        is_responded: false,
                        auto_respond_sent: false,
                        raw_payload: { messageId: responseMessageId, isGreetingResponse: true }
                    }]);

                    await supabase.from("whatsapp_messages").update({
                        auto_respond_sent: true,
                        response_sent_at: new Date().toISOString()
                    }).eq("message_id", messageId);

                    return { success: true, response, sent: true };
                }
            }
        }

        // For non-greetings or when no context, use full RAG logic
        const messages = [
            {
                role: "system" as const,
                content: `${systemPrompt}\n\nCONTEXT FROM DOCUMENTS:\n${contextText || "No specific context available - respond conversationally and ask for clarification if needed."}\n\nCONVERSATION CONTEXT: Maintain the flow of this ongoing conversation. Reference previous messages appropriately.`
            },
            ...history.slice(-12), // Include last 12 messages (6 pairs) for better context maintenance
            { role: "user" as const, content: messageText }
        ];

        console.log(`Final system prompt (first 200 chars): ${systemPrompt.substring(0, 200)}...`);
        console.log(`Context text length: ${contextText?.length || 0} characters`);
        console.log(`Conversation history: ${history.length} messages`);

        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 0.8, // Higher temperature for more natural, varied responses
            max_tokens: 300, // Allow slightly longer responses for natural conversation
        });

        const response = completion.choices[0].message.content;

        if (!response) {
            return {
                success: false,
                error: "No response generated from LLM",
            };
        }

        // 6. Send the response via WhatsApp using file-specific credentials
        const sendResult = await sendWhatsAppMessage(fromNumber, response, auth_token, origin);

        if (!sendResult.success) {
            console.error("Failed to send WhatsApp message:", sendResult.error);
            // Still mark as attempted in database
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

        // 6.5. Store the AI response in the database for conversation history
        const responseMessageId = `auto_${messageId}_${Date.now()}`;
        await supabase
            .from("whatsapp_messages")
            .insert([
                {
                    message_id: responseMessageId,
                    channel: "whatsapp",
                    from_number: toNumber, // Business number (sender)
                    to_number: fromNumber, // Customer number (recipient)
                    received_at: new Date().toISOString(),
                    content_type: "text",
                    content_text: response,
                    sender_name: "AI Assistant",
                    event_type: "MtMessage", // Mobile Terminated (outgoing)
                    is_in_24_window: true,
                    is_responded: false,
                    raw_payload: {
                        messageId: responseMessageId,
                        channel: "whatsapp",
                        from: toNumber,
                        to: fromNumber,
                        content: { contentType: "text", text: response },
                        event: "MtMessage",
                        isAutoResponse: true
                    },
                },
            ]);

        // 7. Mark the message as responded in database
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
