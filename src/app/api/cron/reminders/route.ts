import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { generateReminderResponse } from "@/lib/autoResponder";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        console.log("--- Running Reminder Cron Job ---");

        // Security Check: Only allow requests with the correct Bearer token
        const authHeader = req.headers.get("authorization");
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            console.error("Unauthorized cron attempt");
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 1. Find the latest message for every distinct conversation in the last 2 hours
        // We only care about conversations where the last message was from the assistant (MtMessage)
        const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const THIRTY_MINS_AGO = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const FORTY_FIVE_MINS_AGO = new Date(Date.now() - 45 * 60 * 1000).toISOString();

        // Query: Get recent messages
        const { data: messages, error } = await supabase
            .from("whatsapp_messages")
            .select("from_number, to_number, event_type, received_at, raw_payload")
            .gt("received_at", TWO_HOURS_AGO)
            .order("received_at", { ascending: false });

        if (error) throw error;
        if (!messages || messages.length === 0) {
            return NextResponse.json({ message: "No recent messages found" });
        }

        // 2. Identify stale conversations
        // Key is "business_number:user_number"
        const conversations = new Map<string, any>();
        
        for (const msg of messages) {
            const userNum = msg.event_type === "MoMessage" ? msg.from_number : msg.to_number;
            const bizNum = msg.event_type === "MoMessage" ? msg.to_number : msg.from_number;
            const key = `${bizNum}:${userNum}`;
            
            if (!conversations.has(key)) {
                conversations.set(key, msg);
            }
        }

        const results = [];

        for (const [key, lastMsg] of conversations.entries()) {
            const [bizNum, userNum] = key.split(":");

            // Criteria for reminder:
            // - Last message was MtMessage (AI)
            // - Sent between 30 and 45 mins ago
            // - Not already a reminder
            const isStale = 
                lastMsg.event_type === "MtMessage" &&
                lastMsg.received_at <= THIRTY_MINS_AGO &&
                lastMsg.received_at >= FORTY_FIVE_MINS_AGO &&
                !lastMsg.raw_payload?.isReminder;

            if (isStale) {
                console.log(`Sending reminder to ${userNum} (Biz: ${bizNum})`);
                const reminderResult = await generateReminderResponse(userNum, bizNum);
                results.push({ user: userNum, status: reminderResult.success ? "sent" : "failed", error: reminderResult.error });
            }
        }

        return NextResponse.json({
            processed: conversations.size,
            reminders_triggered: results.length,
            details: results
        });

    } catch (error: any) {
        console.error("Cron Error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
