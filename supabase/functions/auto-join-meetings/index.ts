import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Auto-Join Scheduled Meetings Edge Function
 * 
 * This function checks for scheduled meetings that are due to start
 * and sends join commands to the respective devices.
 * 
 * Should be triggered via cron job every minute.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const windowStart = new Date(now.getTime() - 60000); // 1 minute ago
    const windowEnd = new Date(now.getTime() + 60000); // 1 minute from now

    console.log(`[AutoJoin] Checking for scheduled meetings between ${windowStart.toISOString()} and ${windowEnd.toISOString()}`);

    // Find meetings scheduled to start within the window
    const { data: meetings, error: meetingsError } = await supabase
      .from("saved_meetings")
      .select(`
        id,
        meeting_name,
        meeting_id,
        meeting_password,
        meeting_link,
        device_id,
        user_id,
        mute_audio,
        mute_video,
        take_screenshot,
        next_scheduled_at,
        scheduled_time,
        scheduled_days
      `)
      .eq("auto_join_enabled", true)
      .gte("next_scheduled_at", windowStart.toISOString())
      .lte("next_scheduled_at", windowEnd.toISOString());

    if (meetingsError) {
      console.error("[AutoJoin] Error fetching meetings:", meetingsError);
      throw meetingsError;
    }

    if (!meetings || meetings.length === 0) {
      console.log("[AutoJoin] No meetings scheduled for now");
      return new Response(
        JSON.stringify({ success: true, message: "No meetings due", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[AutoJoin] Found ${meetings.length} meetings to auto-join`);

    const results = [];

    for (const meeting of meetings) {
      try {
        console.log(`[AutoJoin] Processing: ${meeting.meeting_name}`);

        // Get device info to find session
        const { data: device } = await supabase
          .from("devices")
          .select("id, is_online, device_key")
          .eq("id", meeting.device_id)
          .single();

        if (!device || !device.is_online) {
          console.log(`[AutoJoin] Device ${meeting.device_id} is offline, skipping`);
          results.push({
            meeting_id: meeting.id,
            status: "skipped",
            reason: "Device offline",
          });
          continue;
        }

        // Create join command
        const commandPayload = {
          meeting_id: meeting.meeting_id || undefined,
          meeting_link: meeting.meeting_link || undefined,
          password: meeting.meeting_password || undefined,
          mute_audio: meeting.mute_audio ?? true,
          mute_video: meeting.mute_video ?? true,
          take_screenshot: meeting.take_screenshot ?? true,
          auto_join: true,
        };

        // Insert command for the device
        const { data: command, error: cmdError } = await supabase
          .from("commands")
          .insert({
            device_id: meeting.device_id,
            user_id: meeting.user_id,
            command_type: "join_zoom",
            payload: commandPayload,
            status: "pending",
          })
          .select()
          .single();

        if (cmdError) {
          console.error(`[AutoJoin] Command insert error:`, cmdError);
          results.push({
            meeting_id: meeting.id,
            status: "error",
            error: cmdError.message,
          });
          continue;
        }

        // Log the auto-join
        await supabase.from("meeting_join_logs").insert({
          meeting_id: meeting.id,
          user_id: meeting.user_id,
          status: "auto_joining",
          auto_joined: true,
        });

        // Update last_auto_joined_at
        await supabase
          .from("saved_meetings")
          .update({ 
            last_auto_joined_at: now.toISOString(),
            last_used_at: now.toISOString(),
          })
          .eq("id", meeting.id);

        console.log(`[AutoJoin] Command created for ${meeting.meeting_name}: ${command.id}`);
        results.push({
          meeting_id: meeting.id,
          meeting_name: meeting.meeting_name,
          status: "queued",
          command_id: command.id,
        });

      } catch (err) {
        console.error(`[AutoJoin] Error processing meeting ${meeting.id}:`, err);
        results.push({
          meeting_id: meeting.id,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${meetings.length} meetings`,
        count: meetings.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[AutoJoin] Fatal error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
