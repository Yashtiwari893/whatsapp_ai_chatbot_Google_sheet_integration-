import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const phone_number = "1234567890";
    console.log("Testing insert...");
    
    const { error: insertError } = await supabase
        .from("phone_document_mapping")
        .insert({
            phone_number: phone_number,
            intent: "Test intent",
            system_prompt: "Test prompt",
            file_id: null,
        });

    console.log("Insert result:", insertError || "Success");
}

test();
