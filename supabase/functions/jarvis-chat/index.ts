import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
};

/**
 * Jarvis Chat Edge Function
 * 
 * AI-powered chat that can translate natural language into PC commands.
 * Supports both JWT auth (logged-in users) and session token auth (paired devices).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try session token auth first (for paired devices without login)
    const sessionToken = req.headers.get("x-session-token");
    let deviceId: string | null = null;
    let userId: string | null = null;

    if (sessionToken) {
      // Validate session token
      const { data: session } = await supabase
        .from("device_sessions")
        .select("device_id, last_active")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (session) {
        // Check if session is still active (within 24 hours)
        const lastActive = new Date(session.last_active);
        const hoursSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceActive <= 24) {
          deviceId = session.device_id;
          // Update last_active
          await supabase
            .from("device_sessions")
            .update({ last_active: new Date().toISOString() })
            .eq("session_token", sessionToken);
        }
      }
    }

    // Fall back to JWT auth if no valid session token
    if (!deviceId) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const supabaseAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader } }
        });
        const { data: { user } } = await supabaseAnon.auth.getUser();
        if (user) {
          userId = user.id;
        }
      }
    }

    // Require some form of auth
    if (!deviceId && !userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized - please pair your device or login" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { message } = await req.json();

    // Validate input
    if (!message || typeof message !== "string" || message.length > 10000) {
      return new Response(
        JSON.stringify({ error: "Invalid message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Detect language (simple detection for Hindi/English)
    const hindiRegex = /[\u0900-\u097F]/;
    const isHindi = hindiRegex.test(message);
    const language = isHindi ? "hi" : "en";

    console.log(`Processing message | Device: ${deviceId || 'N/A'} | User: ${userId || 'N/A'} | Language: ${language}`);

    // Enhanced system prompt that instructs AI to return structured commands
    const systemPrompt = `You are JARVIS, an advanced AI assistant that controls the user's PC. You can execute commands directly.

${isHindi ? "The user is speaking Hindi. Respond in Hindi using Devanagari script." : "Respond in English."}

IMPORTANT RULES:
1. "play [song/artist]" = Search AND play the song on YouTube immediately
2. "search [query]" = ONLY search Google/web, do NOT play anything
3. For music requests like "play ordinary" or "play Shape of You" - ALWAYS use play_music action

CAPABILITIES:
- Open apps: Chrome, Edge, Firefox, Notepad, Spotify, VS Code, Discord, Steam, Calculator, etc.
- Open websites: YouTube, Google, ChatGPT, Perplexity, Reddit, Twitter, etc.
- Search: Google, YouTube, ChatGPT, Perplexity, Wikipedia, Bing (use search_web action)
- Play music: Search and play on YouTube (use play_music action) - DEFAULT when user says "play X"
- System controls: Volume (0-100), Brightness (0-100), Lock, Sleep, Restart, Shutdown
- Media controls: Play/Pause, Next, Previous, Mute
- Type text: Type any text on the keyboard

RESPONSE FORMAT:
When asked to perform an action, respond with a brief confirmation AND include a JSON command block at the end:

\`\`\`command
{"action": "open_app", "app_name": "chrome"}
\`\`\`

Available command actions:
- {"action": "open_app", "app_name": "app name"}
- {"action": "open_website", "site": "youtube", "query": "optional search"}
- {"action": "search_web", "engine": "google|youtube|bing|duckduckgo|wikipedia|chatgpt|perplexity", "query": "search term"} - ONLY for searching, NOT playing
- {"action": "play_music", "query": "song name"} - Use this when user says "play X" to search AND play music
- {"action": "set_volume", "level": 50}
- {"action": "set_brightness", "level": 50}
- {"action": "media_control", "control": "play_pause|next|previous|mute|volume_up|volume_down"}
- {"action": "lock"}
- {"action": "sleep"}
- {"action": "restart"}
- {"action": "shutdown"}
- {"action": "type_text", "text": "text to type"}

EXAMPLES:
- User: "play ordinary" → Use play_music with query "ordinary"
- User: "search python tutorials" → Use search_web with engine "google"
- User: "open YouTube and search for cats" → Use open_website

For general questions without actions, just respond naturally without command blocks.
Keep responses concise and friendly.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("AI Gateway error:", error);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits depleted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error("Failed to get AI response");
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || "I apologize, I could not process that request.";

    // Extract commands from the response
    const commandRegex = /```command\s*\n?([\s\S]*?)\n?```/g;
    const commands: Array<Record<string, unknown>> = [];
    let match;

    while ((match = commandRegex.exec(aiResponse)) !== null) {
      try {
        const cmd = JSON.parse(match[1].trim());
        commands.push(cmd);
      } catch {
        console.warn("Failed to parse command:", match[1]);
      }
    }

    // Clean response (remove command blocks for display)
    const cleanResponse = aiResponse.replace(/```command[\s\S]*?```/g, "").trim();

    console.log(`AI Response generated | Commands: ${commands.length}`);

    return new Response(
      JSON.stringify({ 
        response: cleanResponse, 
        language,
        commands // Array of commands to execute
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in jarvis-chat:", error);
    return new Response(
      JSON.stringify({ error: "An error occurred processing your request" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
