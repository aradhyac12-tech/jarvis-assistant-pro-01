import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

serve(async (req) => {
  const { headers, method } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ======================== WebSocket upgrade ========================
  if (upgradeHeader.toLowerCase() === "websocket") {
    const url = new URL(req.url);
    const sessionToken = url.searchParams.get("session_token");
    const sessionId = url.searchParams.get("sessionId") || crypto.randomUUID();
    const clientType = url.searchParams.get("type") || "phone"; // 'phone' or 'pc'
    const direction = (url.searchParams.get("direction") || "phone_to_pc") as
      'phone_to_pc' | 'pc_to_phone' | 'bidirectional';

    if (!sessionToken) {
      console.warn(`[audio-relay] Rejected: Missing session token for session=${sessionId}`);
      return new Response("Unauthorized: Missing session token", { status: 401, headers: corsHeaders });
    }

    // Validate session
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: session, error: sessionError } = await supabase
      .from("device_sessions")
      .select("device_id, expires_at")
      .eq("session_token", sessionToken)
      .maybeSingle();

    if (sessionError || !session) {
      console.warn(`[audio-relay] Rejected: Invalid session token for session=${sessionId}`);
      return new Response("Unauthorized: Invalid session", { status: 401, headers: corsHeaders });
    }

    if (new Date(session.expires_at) < new Date()) {
      console.warn(`[audio-relay] Rejected: Expired session for session=${sessionId}`);
      return new Response("Unauthorized: Session expired", { status: 401, headers: corsHeaders });
    }

    const { data: device } = await supabase
      .from("devices")
      .select("user_id")
      .eq("id", session.device_id)
      .maybeSingle();

    if (!device) {
      console.warn(`[audio-relay] Rejected: Device not found for session=${sessionId}`);
      return new Response("Unauthorized: Device not found", { status: 401, headers: corsHeaders });
    }

    console.log(`[audio-relay] Authenticated: session=${sessionId}, type=${clientType}, device=${session.device_id}`);

    const { socket, response } = Deno.upgradeWebSocket(req, {
      idleTimeout: 120,
    });

    // Use BroadcastChannel to relay between isolates (each WS upgrade runs in its own isolate)
    const channelName = `audio-relay-${sessionId}`;
    const bc = new BroadcastChannel(channelName);

    let currentDirection = direction;
    let alive = true;

    socket.onopen = () => {
      console.log(`[audio-relay] ${clientType} connected to session ${sessionId}`);

      // Announce presence to the other isolate
      bc.postMessage({
        type: "peer_connected",
        from: clientType,
        direction: currentDirection,
      });
    };

    socket.onmessage = (event) => {
      if (!alive) return;

      try {
        if (typeof event.data === "string") {
          const msg = JSON.parse(event.data);

          if (msg.type === "ping") {
            try { socket.send(JSON.stringify({ type: "pong" })); } catch {}
            return;
          }

          if (msg.type === "set_direction") {
            currentDirection = msg.direction;
            bc.postMessage({
              type: "direction_changed",
              direction: msg.direction,
              from: clientType,
            });
            return;
          }

          // Forward text messages to peer via BroadcastChannel
          bc.postMessage({
            type: "text",
            data: event.data,
            from: clientType,
          });
        } else {
          // Binary audio data — check direction before forwarding
          const shouldForward =
            currentDirection === "bidirectional" ||
            (currentDirection === "phone_to_pc" && clientType === "phone") ||
            (currentDirection === "pc_to_phone" && clientType === "pc");

          if (shouldForward) {
            // Convert binary to base64 for BroadcastChannel (doesn't support binary directly)
            const arr = new Uint8Array(event.data instanceof ArrayBuffer ? event.data : event.data.buffer);
            
            // Send binary data as array for maximum fidelity
            bc.postMessage({
              type: "binary",
              data: Array.from(arr),
              from: clientType,
            });
          }
        }
      } catch (e) {
        console.error(`[audio-relay] Message error:`, e);
      }
    };

    // Receive from the OTHER isolate via BroadcastChannel
    bc.onmessage = (event: MessageEvent) => {
      if (!alive || socket.readyState !== WebSocket.OPEN) return;
      const msg = event.data;

      // Only process messages from the OTHER client type
      if (msg.from === clientType) return;

      try {
        if (msg.type === "peer_connected") {
          socket.send(JSON.stringify({
            type: "peer_connected",
            peer: msg.from,
            direction: msg.direction,
          }));
          // Send back our presence
          bc.postMessage({
            type: "peer_connected",
            from: clientType,
            direction: currentDirection,
          });
        } else if (msg.type === "direction_changed") {
          currentDirection = msg.direction;
          socket.send(JSON.stringify({
            type: "direction_changed",
            direction: msg.direction,
          }));
        } else if (msg.type === "text") {
          socket.send(msg.data);
        } else if (msg.type === "binary") {
          // Convert back to binary
          const buf = new Uint8Array(msg.data).buffer;
          socket.send(buf);
        } else if (msg.type === "peer_disconnected") {
          socket.send(JSON.stringify({
            type: "peer_disconnected",
            peer: msg.from,
          }));
        }
      } catch (e) {
        console.error(`[audio-relay] BC forward error:`, e);
      }
    };

    socket.onclose = () => {
      console.log(`[audio-relay] ${clientType} disconnected from session ${sessionId}`);
      alive = false;
      bc.postMessage({ type: "peer_disconnected", from: clientType });
      try { bc.close(); } catch {}
    };

    socket.onerror = (e) => {
      console.error(`[audio-relay] Socket error for ${clientType} in session ${sessionId}:`, e);
    };

    return response;
  }

  // ======================== HTTP endpoints ========================
  if (method === 'POST') {
    try {
      const body = await req.json();
      const { action, sessionId } = body;

      if (action === 'create_session') {
        const newSessionId = sessionId || crypto.randomUUID();
        return new Response(
          JSON.stringify({
            success: true,
            sessionId: newSessionId,
            wsUrl: `wss://${PROJECT_REF}.functions.supabase.co/functions/v1/audio-relay?sessionId=${newSessionId}`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (action === 'close_session') {
        // Broadcast close to all isolates in the session
        const bc = new BroadcastChannel(`audio-relay-${sessionId}`);
        bc.postMessage({ type: "force_close", from: "server" });
        setTimeout(() => { try { bc.close(); } catch {} }, 1000);
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Unknown action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (e) {
      console.error('[audio-relay] HTTP error:', e);
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // GET health check
  return new Response(
    JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
