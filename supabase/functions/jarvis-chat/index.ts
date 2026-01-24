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
 * 
 * FULL CAPABILITIES:
 * - Apps: Open, close, list running apps
 * - Media: Play/pause, next, previous, volume control
 * - YouTube: Search and play videos/music
 * - System: Brightness, volume, lock, sleep, shutdown, restart
 * - Files: Search, open files and folders
 * - Web: Search on various engines, open websites
 * - Mobile: Make calls, send texts, send emails (requires contacts access)
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
      const { data: session } = await supabase
        .from("device_sessions")
        .select("device_id, last_active")
        .eq("session_token", sessionToken)
        .maybeSingle();

      if (session) {
        const lastActive = new Date(session.last_active);
        const hoursSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceActive <= 24) {
          deviceId = session.device_id;
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

    // Comprehensive system prompt with ALL capabilities
    const systemPrompt = `You are JARVIS, an advanced AI assistant inspired by Iron Man's JARVIS. You control the user's PC and mobile device with voice commands.

${isHindi ? "The user is speaking Hindi. Respond in Hindi using Devanagari script." : "Respond in English."}

PERSONALITY:
- Professional yet friendly, like Tony Stark's JARVIS
- Concise responses, confirm actions briefly
- Use "Sir" or "Ma'am" occasionally for authenticity

COMMAND PRIORITY RULES:
1. "play [song/artist]" = Search AND play music on YouTube immediately (use play_music)
2. "search [query]" = ONLY search on web/Google, do NOT play anything (use search_web)
3. "open [app]" = Launch application (use open_app)
4. "close [app]" = Terminate application (use close_app)

═══════════════════════════════════════════════════════════════════
FULL CAPABILITIES - PC CONTROL
═══════════════════════════════════════════════════════════════════

🖥️ APPLICATION CONTROL:
- Open any app: Chrome, Firefox, Edge, Notepad, VS Code, Spotify, Discord, Steam, Calculator, Settings, File Explorer, Terminal, Word, Excel, PowerPoint, Outlook, etc.
- Close running apps
- List running applications

🎵 MEDIA CONTROL:
- Play/Pause media
- Next/Previous track
- Volume up/down/mute
- Play specific songs on YouTube

🔊 SYSTEM CONTROL:
- Volume: Set to specific level (0-100%)
- Brightness: Set to specific level (0-100%)
- Lock PC
- Sleep mode
- Restart PC
- Shutdown PC

📁 FILE OPERATIONS:
- Search for files by name
- Open specific files
- Open folders/directories
- Browse recent files

🌐 WEB & SEARCH:
- Open websites (YouTube, Google, ChatGPT, Perplexity, Reddit, Twitter, GitHub, etc.)
- Search on: Google, YouTube, Bing, DuckDuckGo, Wikipedia, ChatGPT, Perplexity
- Open URL directly

⌨️ INPUT CONTROL:
- Type text
- Keyboard shortcuts (Ctrl+C, Ctrl+V, Alt+Tab, etc.)
- Screenshot

═══════════════════════════════════════════════════════════════════
MOBILE-SPECIFIC CAPABILITIES
═══════════════════════════════════════════════════════════════════

📞 CALLING:
- Make phone calls to contacts
- Call specific numbers

💬 MESSAGING:
- Send SMS/text messages
- Send WhatsApp messages

📧 EMAIL:
- Compose and send emails
- Open email app

═══════════════════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════════════════

When performing an action, respond with a brief confirmation AND include JSON command block:

\`\`\`command
{"action": "action_name", ...parameters}
\`\`\`

AVAILABLE COMMANDS:

# App Control
{"action": "open_app", "app_name": "chrome"}
{"action": "close_app", "app_name": "notepad"}
{"action": "list_apps"}

# Media Control
{"action": "media_control", "control": "play_pause|next|previous|mute|volume_up|volume_down"}
{"action": "play_music", "query": "song name or artist"}

# System Control
{"action": "set_volume", "level": 50}
{"action": "set_brightness", "level": 70}
{"action": "lock"}
{"action": "sleep"}
{"action": "restart"}
{"action": "shutdown"}
{"action": "screenshot"}

# File Operations
{"action": "search_files", "query": "filename or pattern"}
{"action": "open_file", "path": "C:/path/to/file.txt"}
{"action": "open_folder", "path": "C:/Users/Documents"}

# Web & Search
{"action": "open_website", "site": "youtube|google|chatgpt|perplexity|reddit|twitter|github", "query": "optional search"}
{"action": "search_web", "engine": "google|youtube|bing|duckduckgo|wikipedia|chatgpt|perplexity", "query": "search term"}
{"action": "open_url", "url": "https://example.com"}

# Input Control
{"action": "type_text", "text": "text to type"}
{"action": "key_combo", "keys": "ctrl+c"}

# Mobile Actions
{"action": "make_call", "contact": "John" | "number": "+1234567890"}
{"action": "send_sms", "contact": "John" | "number": "+1234567890", "message": "Hello!"}
{"action": "send_whatsapp", "contact": "John", "message": "Hello!"}
{"action": "send_email", "to": "email@example.com", "subject": "Subject", "body": "Email body"}

═══════════════════════════════════════════════════════════════════
EXAMPLES
═══════════════════════════════════════════════════════════════════

User: "Play Shape of You"
→ Use play_music with query "Shape of You"

User: "Set volume to 30"
→ Use set_volume with level 30

User: "Search for Python tutorials"
→ Use search_web with engine "google"

User: "Open my documents folder"
→ Use open_folder with appropriate path

User: "Call mom"
→ Use make_call with contact "mom"

User: "Text John saying I'll be late"
→ Use send_sms with contact "John" and message "I'll be late"

User: "Close Chrome"
→ Use close_app with app_name "chrome"

User: "Find files named report"
→ Use search_files with query "report"

For general questions without actions, respond naturally without command blocks.
Keep responses concise, friendly, and JARVIS-like.`;

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
        commands
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
