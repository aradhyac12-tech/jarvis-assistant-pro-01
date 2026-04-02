import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitExceededResponse, rateLimitHeaders, type RateLimitConfig } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token, x-device-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Rate limit: 200 requests per minute per session (needs headroom for rapid button presses + polling)
const RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60000, // 1 minute
  maxRequests: 200,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get session token from header
    const sessionToken = req.headers.get("x-session-token");
    
    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: "Missing session token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Apply rate limiting based on session token
    const rateLimitResult = checkRateLimit(`device-commands:${sessionToken}`, RATE_LIMIT_CONFIG);
    
    if (!rateLimitResult.allowed) {
      console.warn(`[device-commands] Rate limit exceeded for session: ${sessionToken.slice(0, 8)}...`);
      return rateLimitExceededResponse(rateLimitResult, RATE_LIMIT_CONFIG, corsHeaders);
    }

    // Validate session token and get device_id with retry for transient errors
    let session = null;
    let sessionError = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await supabase
        .from("device_sessions")
        .select("device_id, expires_at, remember_device, last_active")
        .eq("session_token", sessionToken)
        .maybeSingle();
      
      session = result.data;
      sessionError = result.error;
      
      // Success or definite error (not transient)
      if (!sessionError || !sessionError.message?.toLowerCase().includes("connection")) {
        break;
      }
      
      console.log(`Session query attempt ${attempt} failed with transient error, retrying...`);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 200 * attempt));
      }
    }

    if (sessionError) {
      console.error("Session validation failed after retries:", sessionError);
      // Return 503 for transient errors, 401 for actual auth issues
      const isTransient = sessionError.message?.toLowerCase().includes("connection");
      return new Response(
        JSON.stringify({ error: isTransient ? "Temporary server error, please retry" : "Invalid or expired session" }),
        { status: isTransient ? 503 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (!session) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if session has expired using expires_at column
    const expiresAt = new Date(session.expires_at);
    if (Date.now() > expiresAt.getTime()) {
      // Clean up expired session
      await supabase.from("device_sessions").delete().eq("session_token", sessionToken);
      return new Response(
        JSON.stringify({ error: "Session expired" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update last_active only every 5 minutes to reduce DB writes and latency
    const lastActive = new Date(session.last_active || 0).getTime();
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - lastActive > REFRESH_INTERVAL_MS) {
      const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 365 days for remembered
      const SESSION_SHORT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for temp
      const newExpiry = session.remember_device
        ? new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString()
        : new Date(Date.now() + SESSION_SHORT_TTL_MS).toISOString();
      
      // Fire and forget - don't await to keep response fast
      supabase
        .from("device_sessions")
        .update({ last_active: new Date().toISOString(), expires_at: newExpiry })
        .eq("session_token", sessionToken)
        .then(() => {});
    }

    const { action, commandType, payload, commandId } = await req.json();

    switch (action) {
      case "insert": {
        // Determine priority: user-initiated commands are high priority
        const BACKGROUND_COMMANDS = new Set([
          "clipboard_check", "get_system_state", "get_volume", "get_brightness",
          "get_system_stats", "get_media_state",
        ]);
        const isBackground = BACKGROUND_COMMANDS.has(commandType);

        // Insert a new command for the validated device
        const { data, error } = await supabase
          .from("commands")
          .insert({
            device_id: session.device_id,
            command_type: commandType,
            payload: payload || {},
            status: "pending",
            user_id: session.device_id, // Use device_id as placeholder user_id
          })
          .select("id")
          .single();

        if (error) {
          console.error("Insert error:", error);
          throw error;
        }

        return new Response(
          JSON.stringify({ success: true, commandId: data.id, priority: isBackground ? "low" : "high" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "poll": {
        // Poll for command result - only for commands belonging to this device
        if (!commandId) {
          return new Response(
            JSON.stringify({ error: "Missing commandId" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data, error } = await supabase
          .from("commands")
          .select("status, result")
          .eq("id", commandId)
          .eq("device_id", session.device_id) // Ensure command belongs to this device
          .maybeSingle();

        if (error) {
          console.error("Poll error:", error);
          throw error;
        }

        if (!data) {
          return new Response(
            JSON.stringify({ error: "Command not found or access denied" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ status: data.status, result: data.result }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Invalid action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("Error in device-commands:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
