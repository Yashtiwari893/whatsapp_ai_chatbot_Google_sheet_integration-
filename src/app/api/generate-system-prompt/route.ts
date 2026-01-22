import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { supabase } from "@/lib/supabaseClient";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { intent, phone_number } = body;

        if (!intent || !phone_number) {
            return NextResponse.json(
                { error: "Intent and phone_number are required" },
                { status: 400 }
            );
        }

        console.log("Generating system prompt for intent:", intent);

        // Use Groq to generate a system prompt based on the intent
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are an AI assistant that generates friendly, conversational system prompts for WhatsApp chatbots.

Given a business intent/purpose, create a system prompt that makes the chatbot behave like a real human sales/support executive on WhatsApp.

The system prompt should:
1. Make the chatbot sound like a friendly, helpful person chatting on WhatsApp
2. Use casual, conversational language with Hinglish (Hindi + English mix) when appropriate
3. Keep responses SHORT (2-3 lines max)
4. Use emojis occasionally 😊 (not excessive)
5. Ask ONE small follow-up question if helpful
6. Never use robotic or formal phrases like "As an AI..." or "I am here to help you with..."
7. Always acknowledge greetings properly (hi/hello/hey)
8. Reference the user's last message naturally
9. CRITICAL: Maintain conversation context and selected service focus
10. Do NOT jump between services randomly - stay focused on user's selected service
11. Only introduce other services when user explicitly asks or current flow is complete
12. CRITICAL: Detect and maintain user's language throughout conversation
13. Reply in the SAME language the user uses (Hindi, English, Gujarati, etc.)
14. Do NOT default to Hinglish - use the detected language consistently

For service-based businesses, emphasize:
- Detecting user's selected service (The Look, The System, The Reach)
- Staying within that service context throughout conversation
- Logical progression through service steps (discovery → details → budget → booking)
- Not treating generic "yes" responses as triggers for all services
- Language consistency: Always reply in user's detected language`
                },
                {
                    role: "user",
                    content: `Create a WhatsApp-style system prompt for a chatbot with this business purpose:\n\n"${intent}"\n\nThe chatbot should respond like a friendly human executive on WhatsApp - casual, helpful, and conversational. Generate only the system prompt text, no explanations.`
                }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 400,
        });

        const systemPrompt = completion.choices[0]?.message?.content || "";

        if (!systemPrompt) {
            throw new Error("Failed to generate system prompt");
        }

        console.log("Generated system prompt:", systemPrompt);

        // Check if phone number has any mappings
        const { data: existingMappings } = await supabase
            .from("phone_document_mapping")
            .select("*")
            .eq("phone_number", phone_number);

        if (existingMappings && existingMappings.length > 0) {
            // Update all existing mappings for this phone number
            const { error: updateError } = await supabase
                .from("phone_document_mapping")
                .update({
                    intent: intent,
                    system_prompt: systemPrompt,
                })
                .eq("phone_number", phone_number);

            if (updateError) {
                console.error("Error updating phone_document_mapping:", updateError);
                throw updateError;
            }
        } else {
            // Create a placeholder mapping with just intent and system_prompt
            // (file_id will be added when first file is uploaded)
            const { error: insertError } = await supabase
                .from("phone_document_mapping")
                .insert({
                    phone_number: phone_number,
                    intent: intent,
                    system_prompt: systemPrompt,
                    file_id: null, // Will be set when file is uploaded
                });

            if (insertError) {
                console.error("Error creating phone_document_mapping:", insertError);
                throw insertError;
            }
        }

        return NextResponse.json({
            success: true,
            system_prompt: systemPrompt,
            intent: intent,
        });

    } catch (error) {
        console.error("System prompt generation error:", error);

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to generate system prompt",
            },
            { status: 500 }
        );
    }
}
