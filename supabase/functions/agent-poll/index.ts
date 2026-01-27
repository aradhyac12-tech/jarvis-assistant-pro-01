import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-key",
};

/**
 * Agent Poll Edge Function
 * 
 * Called by the Python agent running on the PC.
 * Validates device_key header and returns pending commands.
 * Also handles command status updates.
 * 
 * Actions:
 * - poll: Get pending commands for the device
 * - complete: Mark a command as completed with result
 * - heartbeat: Update device online status
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get device_key from header
    const deviceKey = req.headers.get("x-device-key");

    if (!deviceKey) {
      return new Response(
        JSON.stringify({ error: "Missing device key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate device_key and get device
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, name, is_online")
      .eq("device_key", deviceKey)
      .maybeSingle();

    if (deviceError || !device) {
      console.error("Device validation failed:", deviceError);
      return new Response(
        JSON.stringify({ error: "Invalid device key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const deviceId = device.id;
    const { action, commandId, result, systemInfo, volume, brightness } = await req.json();

    switch (action) {
      case "poll": {
        // Filter out stale commands (older than 60 seconds) to prevent auto-execution of old commands
        const staleThreshold = new Date(Date.now() - 60 * 1000).toISOString();
        
        // Get pending commands for this device that are not stale
        const { data: commands, error: cmdError } = await supabase
          .from("commands")
          .select("id, command_type, payload, created_at")
          .eq("device_id", deviceId)
          .eq("status", "pending")
          .gte("created_at", staleThreshold) // Only commands created in the last 60 seconds
          .order("created_at", { ascending: true })
          .limit(10);
        
        // Also clean up old stale commands to prevent database bloat
        const cleanupThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min old
        await supabase
          .from("commands")
          .update({ status: "expired" })
          .eq("device_id", deviceId)
          .eq("status", "pending")
          .lt("created_at", cleanupThreshold);

        if (cmdError) {
          console.error("Command fetch error:", cmdError);
          throw cmdError;
        }

        // Claim commands to avoid collisions (e.g. duplicate agent loops / double polling)
        if (commands && commands.length > 0) {
          const ids = commands.map((c) => c.id);
          const { error: claimError } = await supabase
            .from("commands")
            .update({ status: "running" })
            .in("id", ids)
            .eq("device_id", deviceId)
            .eq("status", "pending");

          if (claimError) {
            console.error("Command claim error:", claimError);
          }
        }

        return new Response(
          JSON.stringify({ success: true, commands: commands || [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "complete": {
        // Mark command as completed
        if (!commandId) {
          return new Response(
            JSON.stringify({ error: "Missing commandId" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const status = result?.success !== false ? "completed" : "failed";

        const { error: updateError } = await supabase
          .from("commands")
          .update({
            status,
            result: result || {},
            executed_at: new Date().toISOString(),
          })
          .eq("id", commandId)
          .eq("device_id", deviceId);

        if (updateError) {
          console.error("Command update error:", updateError);
          throw updateError;
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "heartbeat": {
        // Update device status
        const updateData: Record<string, unknown> = {
          is_online: true,
          last_seen: new Date().toISOString(),
        };

        if (typeof volume === "number") updateData.current_volume = volume;
        if (typeof brightness === "number") updateData.current_brightness = brightness;
        if (systemInfo) updateData.system_info = systemInfo;

        const { error: hbError } = await supabase
          .from("devices")
          .update(updateData)
          .eq("id", deviceId);

        if (hbError) {
          console.error("Heartbeat error:", hbError);
          throw hbError;
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "register": {
        // Update device registration info
        const { pairingCode, pairingExpiresAt, isLocked } = await req.json();

        const updateData: Record<string, unknown> = {
          is_online: true,
          last_seen: new Date().toISOString(),
        };

        if (pairingCode) updateData.pairing_code = pairingCode;
        if (pairingExpiresAt) updateData.pairing_expires_at = pairingExpiresAt;
        if (typeof isLocked === "boolean") updateData.is_locked = isLocked;
        if (typeof volume === "number") updateData.current_volume = volume;
        if (typeof brightness === "number") updateData.current_brightness = brightness;
        if (systemInfo) updateData.system_info = systemInfo;

        const { error: regError } = await supabase
          .from("devices")
          .update(updateData)
          .eq("id", deviceId);

        if (regError) {
          console.error("Register error:", regError);
          throw regError;
        }

        return new Response(
          JSON.stringify({ success: true, deviceId }),
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
    console.error("Error in agent-poll:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
