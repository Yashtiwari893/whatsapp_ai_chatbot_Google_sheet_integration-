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

        console.log(`Detected language: ${detectedLanguage} for message: "${messageText.substring(0, 50)}..."`);

        // Detect selected service from conversation history
        if (conversationText.includes("the look") && !conversationText.includes("the system") && !conversationText.includes("the reach")) {
            selectedService = "the_look";
            currentStep = conversationText.includes("budget") ? "budget" : conversationText.includes("book") ? "booking" : "discovery";
        } else if (conversationText.includes("the system") && !conversationText.includes("the look") && !conversationText.includes("the reach")) {
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
        } else if (currentMessageLower.includes("the system") && !currentMessageLower.includes("the look") && !currentMessageLower.includes("the reach")) {
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
            `You are a strategic marketing agency consultant and sales qualifier.\n\n` +
            `HUMAN REALISM:\n` +
            `- NEVER say you are AI, a bot, or automated\n` +
            `- Sound like a real human brand consultant\n` +
            `- Be natural, confident, warm, and business-smart\n` +
            `- Use conversational language, not robotic or scripted\n` +
            `- Match the user's language: English, Hindi, Hinglish, Gujarati\n` +
            `- Continue in the same language if user switches\n\n` +
            `AGENCY SERVICES (3 PILLARS):\n` +
            `1. The Look — Branding, Visual Identity, Content, Creative Direction\n` +
            `2. The System — Websites, Funnels, Automation, CRM, Digital Infrastructure\n` +
            `3. The Reach — Advertising, Performance Marketing, PR, Growth Campaigns\n\n` +
            `CONSULTANT BEHAVIOR:\n` +
            `- Understand business stage (idea, startup, growing, scaling)\n` +
            `- Ask smart questions about goals, challenges, budget\n` +
            `- Educate before selling - explain concepts naturally\n` +
            `- Recommend services with authority and clarity\n` +
            `- Avoid technical overload unless specifically asked\n` +
            `- If unsure about information, say you don't have enough data\n\n` +
            `SALES APPROACH:\n` +
            `- Do NOT hard-sell aggressively\n` +
            `- Guide naturally toward booking a 15-minute System Audit\n` +
            `- Position audit as helpful opportunity, not sales trap\n` +
            `- Build trust first, close second\n` +
            `- Focus on user's needs and challenges\n\n` +
            `LANGUAGE REQUIREMENTS:\n` +
            `- DETECTED USER LANGUAGE: ${detectedLanguage.toUpperCase()}\n` +
            `- You MUST reply in the SAME LANGUAGE as the user\n` +
            `- Maintain consistent language throughout conversation\n` +
            `- Use appropriate script and vocabulary for the detected language\n` +
            `- Do NOT switch languages unless user explicitly requests it\n\n` +
            `CONVERSATION FLOW:\n` +
            `- Remember previous messages in the conversation\n` +
            `- Build upon what was discussed before\n` +
            `- Don't repeat information already provided\n` +
            `- Guide the conversation logically to next steps\n` +
            `- Stay focused on the current topic/service\n` +
            `- If user changes topic, acknowledge and transition smoothly\n\n` +
            `CONTENT GUIDANCE:\n` +
            `- Use the provided context to answer questions naturally\n` +
            `- If information is missing, ask for clarification politely\n` +
            `- Don't dump raw text - weave information into conversation\n` +
            `- Be helpful and build trust like a real consultant`;

        let systemPrompt: string;
        if (customSystemPrompt) {
            // Combine custom prompt with marketing consultant guidance
            systemPrompt = `${customSystemPrompt}\n\nIMPORTANT: Act as a human marketing consultant. Respond in ${detectedLanguage.toUpperCase()} only. Guide toward 15-minute System Audit naturally.\n\n${documentRules}`;
        } else {
            // Use default marketing consultant prompt
            systemPrompt = `You are a strategic marketing agency consultant helping businesses grow.\n\nRespond in ${detectedLanguage.toUpperCase()} only. Focus on understanding their business needs and guiding them toward a 15-minute System Audit.\n\n${documentRules}`;
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
            let lookSpecificPrompt = `${systemPrompt}\n\nSERVICE FOCUS - THE LOOK (Branding & Visual Identity):\n` +
                `- Discuss: logo design, brand identity, visual storytelling, content creation, creative direction\n` +
                `- Understand their brand personality and target audience\n` +
                `- Ask about their vision and current brand challenges\n` +
                `- Guide toward understanding how visual identity impacts business growth\n` +
                `- Naturally suggest a 15-minute System Audit to assess their current brand foundation\n` +
                `- Stay focused on visual identity until they express interest in other areas`;

            // If user is confirming something, guide them toward audit
            if (isConfirmation && (conversationText.includes("strategy") || conversationText.includes("brand"))) {
                lookSpecificPrompt += `\n\nUSER SHOWING INTEREST - NEXT STEPS:\n` +
                    `- Acknowledge their interest in branding/visual identity\n` +
                    `- Suggest the 15-minute System Audit as a helpful first step\n` +
                    `- Position it as understanding their current brand health before recommending solutions`;
            }

            systemPrompt = lookSpecificPrompt;
            console.log("Applied The Look service focus");
        } else if (selectedService === "the_system" && !isGreeting) {
            // For The System service, focus on digital infrastructure
            let systemSpecificPrompt = `${systemPrompt}\n\nSERVICE FOCUS - THE SYSTEM (Digital Infrastructure):\n` +
                `- Discuss: websites, funnels, automation, CRM, digital systems\n` +
                `- Understand their current tech stack and pain points\n` +
                `- Ask about their customer journey and conversion challenges\n` +
                `- Guide toward understanding how systems impact scalability\n` +
                `- This is our core audit area - emphasize the 15-minute System Audit\n` +
                `- Position audit as essential for identifying growth bottlenecks`;

            systemPrompt = systemSpecificPrompt;
            console.log("Applied The System service focus");
        } else if (selectedService === "the_reach" && !isGreeting) {
            // For The Reach service, focus on growth and marketing
            let reachSpecificPrompt = `${systemPrompt}\n\nSERVICE FOCUS - THE REACH (Growth & Marketing):\n` +
                `- Discuss: advertising, performance marketing, PR, growth campaigns\n` +
                `- Understand their target market and current marketing efforts\n` +
                `- Ask about their growth goals and current ROI\n` +
                `- Guide toward understanding how marketing scales business\n` +
                `- Suggest System Audit first to ensure foundation is solid before marketing spend\n` +
                `- Position audit as identifying the best marketing opportunities`;

            systemPrompt = reachSpecificPrompt;
            console.log("Applied The Reach service focus");
        } else if (isAskingServices && !selectedService) {
            // User is asking about services, provide marketing agency overview
            systemPrompt += `\n\nUSER ASKING ABOUT SERVICES:\n` +
                `- Introduce yourself as a marketing consultant\n` +
                `- Explain our three pillars: The Look (branding), The System (infrastructure), The Reach (growth)\n` +
                `- Ask about their business stage and main challenges\n` +
                `- Guide conversation toward understanding their needs\n` +
                `- Suggest 15-minute System Audit as a helpful starting point`;
            console.log("Applied services overview context");
        }

        // If it's a greeting and we have context, respond warmly
        if (isGreeting && contextText) {
            const greetingResponse = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [
                    {
                        role: "system",
                        content: `${systemPrompt}\n\nThe user greeted you. Respond warmly in ${detectedLanguage.toUpperCase()} as a marketing consultant. Ask how you can help them grow their business today. Keep it natural and welcoming.`
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
            temperature: 0.7, // Balanced temperature for natural, confident responses
            max_tokens: 200, // Allow for conversational length while keeping it concise
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
