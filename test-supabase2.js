import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log("Testing insert...");
    
    const { error: insertError } = await supabase
        .from("phone_document_mapping")
        .insert({
            phone_number: "1234567890",
            intent: "Test intent",
            system_prompt: "Test prompt",
            file_id: null,
        });

    fs.writeFileSync("output-test-supabase.json", JSON.stringify(insertError, null, 2));
}

test();
