import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
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

    // Validate session token and get device_id
    const { data: session, error: sessionError } = await supabase
      .from("device_sessions")
      .select("device_id, last_active")
      .eq("session_token", sessionToken)
      .maybeSingle();

    if (sessionError || !session) {
      console.error("Session validation failed:", sessionError);
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if session is still active (within 24 hours)
    const lastActive = new Date(session.last_active);
    const hoursSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60);
    if (hoursSinceActive > 24) {
      return new Response(
        JSON.stringify({ error: "Session expired" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update last_active
    await supabase
      .from("device_sessions")
      .update({ last_active: new Date().toISOString() })
      .eq("session_token", sessionToken);

    const { action, commandType, payload, commandId } = await req.json();

    switch (action) {
      case "insert": {
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
          JSON.stringify({ success: true, commandId: data.id }),
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
