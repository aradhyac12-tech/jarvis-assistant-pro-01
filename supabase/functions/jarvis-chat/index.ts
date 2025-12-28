import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, userId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Detect language (simple detection for Hindi/English)
    const hindiRegex = /[\u0900-\u097F]/;
    const isHindi = hindiRegex.test(message);
    const language = isHindi ? "hi" : "en";

    console.log(`Processing message: "${message}" | Language: ${language} | User: ${userId}`);

    const systemPrompt = `You are JARVIS, an advanced AI assistant that can control a user's PC. You speak naturally and helpfully.
${isHindi ? "The user is speaking Hindi. Respond in Hindi using Devanagari script." : "Respond in English."}
You can help with: system controls (volume, brightness, power), opening apps, playing music, file management, and general questions.
Keep responses concise and friendly. If asked to perform an action, confirm what you'll do.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("AI Gateway error:", error);
      throw new Error("Failed to get AI response");
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || "I apologize, I could not process that request.";

    console.log(`AI Response: "${aiResponse.slice(0, 100)}..."`);

    return new Response(
      JSON.stringify({ response: aiResponse, language }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in jarvis-chat:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
