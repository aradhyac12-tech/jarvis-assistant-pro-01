import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { checkRateLimit, rateLimitExceededResponse, rateLimitHeaders, type RateLimitConfig } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
};

// Rate limit: 10 requests per minute per session (ElevenLabs has quota limits)
const RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60000, // 1 minute
  maxRequests: 10,
};

/**
 * ElevenLabs Text-to-Speech Edge Function
 * 
 * Converts text to natural speech using ElevenLabs API.
 * Returns base64-encoded audio for playback.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    
    if (!ELEVENLABS_API_KEY) {
      console.error("ELEVENLABS_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get session token for rate limiting
    const sessionToken = req.headers.get("x-session-token");
    const authHeader = req.headers.get("Authorization");
    const rateLimitKey = sessionToken || authHeader?.slice(0, 32) || "anonymous";
    
    // Apply rate limiting
    const rateLimitResult = checkRateLimit(`elevenlabs-tts:${rateLimitKey}`, RATE_LIMIT_CONFIG);
    
    if (!rateLimitResult.allowed) {
      console.warn(`[elevenlabs-tts] Rate limit exceeded for key: ${rateLimitKey.slice(0, 8)}...`);
      return rateLimitExceededResponse(rateLimitResult, RATE_LIMIT_CONFIG, corsHeaders);
    }

    const { text, voiceId } = await req.json();

    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "Text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default to "Roger" voice - a natural male voice good for assistant
    // Other options: Sarah (EXAVITQu4vr4xnSDxMaL), Jarvis-like Roger (CwhRBWXzGAHq8TQ4Fs17)
    const selectedVoiceId = voiceId || "CwhRBWXzGAHq8TQ4Fs17";

    console.log(`TTS request: ${text.substring(0, 50)}... | Voice: ${selectedVoiceId}`);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5", // Fast, low latency
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs TTS error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "TTS generation failed", details: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = base64Encode(audioBuffer);

    console.log(`TTS generated: ${audioBuffer.byteLength} bytes`);

    return new Response(
      JSON.stringify({ audioContent: base64Audio }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in elevenlabs-tts:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
