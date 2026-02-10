import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token, x-device-key',
};

/**
 * Camera/Screen Relay using Supabase Realtime Broadcast
 * 
 * This solves the stateless edge function problem by using Supabase Realtime
 * as the shared communication layer instead of in-memory state.
 * 
 * Flow:
 * 1. Agent (phone) connects and broadcasts frames to channel `stream:{sessionId}`
 * 2. Browser (pc) subscribes to the same channel and receives frames
 * 3. Both can be on different edge function instances - doesn't matter!
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Local tracking for WebSocket connections (per-instance only)
const localConnections = new Map<string, { socket: WebSocket; type: string; channel: any }>();

serve(async (req) => {
  const { headers, method } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Handle WebSocket upgrade for camera streaming
  if (upgradeHeader.toLowerCase() === "websocket") {
    const url = new URL(req.url);
    const sessionToken = url.searchParams.get("session_token");
    const sessionId = url.searchParams.get("sessionId") || crypto.randomUUID();
    const clientType = url.searchParams.get("type") || "phone"; // 'phone' (sender) or 'pc' (receiver)
    const targetFps = Math.min(parseInt(url.searchParams.get("fps") || "30", 10), 90);
    const quality = parseInt(url.searchParams.get("quality") || "50", 10);
    const useBinary = url.searchParams.get("binary") === "true";

    // Validate session token before upgrading WebSocket
    if (!sessionToken) {
      console.warn(`[camera-relay] Rejected: Missing session token for session=${sessionId}`);
      return new Response("Unauthorized: Missing session token", { status: 401, headers: corsHeaders });
    }

    // Validate session token against database
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: session, error: sessionError } = await supabaseAuth
      .from("device_sessions")
      .select("device_id, expires_at")
      .eq("session_token", sessionToken)
      .maybeSingle();

    if (sessionError || !session) {
      console.warn(`[camera-relay] Rejected: Invalid session token for session=${sessionId}`);
      return new Response("Unauthorized: Invalid session", { status: 401, headers: corsHeaders });
    }

    // Check expiration
    if (new Date(session.expires_at) < new Date()) {
      console.warn(`[camera-relay] Rejected: Expired session for session=${sessionId}`);
      return new Response("Unauthorized: Session expired", { status: 401, headers: corsHeaders });
    }

    // Verify device exists
    const { data: device } = await supabaseAuth
      .from("devices")
      .select("user_id")
      .eq("id", session.device_id)
      .maybeSingle();

    if (!device) {
      console.warn(`[camera-relay] Rejected: Device not found for session=${sessionId}`);
      return new Response("Unauthorized: Device not found", { status: 401, headers: corsHeaders });
    }

    console.log(`[camera-relay] Authenticated WebSocket upgrade: session=${sessionId}, type=${clientType}, device=${session.device_id}`);

    const { socket, response } = Deno.upgradeWebSocket(req);
    const connectionId = `${sessionId}:${clientType}:${crypto.randomUUID().slice(0, 8)}`;

    // Create Supabase client for Realtime
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      realtime: {
        params: { eventsPerSecond: 100 }
      }
    });

    const channelName = `stream:${sessionId}`;
    let frameCount = 0;
    let lastFrameTime = 0;
    const minInterval = 1000 / targetFps;

    socket.onopen = () => {
      console.log(`[camera-relay] ${clientType} connected: ${connectionId}`);

      // Create/join the Realtime broadcast channel
      const channel = supabase.channel(channelName, {
        config: {
          broadcast: { self: false } // Don't echo back to sender
        }
      });

      // PC (receiver) listens for frames
      if (clientType === 'pc') {
        channel.on('broadcast', { event: 'frame' }, (payload) => {
          if (socket.readyState === WebSocket.OPEN) {
            try {
              // Forward frame data to browser
              if (payload.payload?.binary) {
                // Binary frame as base64 - decode and send as ArrayBuffer
                const binaryStr = atob(payload.payload.data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                  bytes[i] = binaryStr.charCodeAt(i);
                }
                socket.send(bytes.buffer);
              } else {
                // JSON frame
                socket.send(JSON.stringify(payload.payload));
              }
            } catch (e) {
              console.error(`[camera-relay] Frame forward error:`, e);
            }
          }
        });

        // Listen for peer events
        channel.on('broadcast', { event: 'peer_status' }, (payload) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(payload.payload));
          }
        });
      }

      channel.subscribe((status) => {
        console.log(`[camera-relay] Channel ${channelName} status: ${status}`);
        
        if (status === 'SUBSCRIBED') {
          // Notify peer that we connected
          channel.send({
            type: 'broadcast',
            event: 'peer_status',
            payload: { type: 'peer_connected', peer: clientType, targetFps, quality }
          });

          // Send connection confirmation to client
          socket.send(JSON.stringify({
            type: 'connected',
            sessionId,
            channelName,
            clientType
          }));
        }
      });

      localConnections.set(connectionId, { socket, type: clientType, channel });
    };

    socket.onmessage = async (event) => {
      const conn = localConnections.get(connectionId);
      if (!conn?.channel) return;

      try {
        // Handle binary frames (from phone/agent)
        if (event.data instanceof ArrayBuffer || event.data instanceof Uint8Array) {
          const now = Date.now();
          if (now - lastFrameTime < minInterval) return; // Throttle
          
          lastFrameTime = now;
          frameCount++;

          // Convert binary to base64 for broadcast (Realtime doesn't support raw binary)
          const bytes = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data);
          const binary = String.fromCharCode(...bytes);
          const base64 = btoa(binary);

          await conn.channel.send({
            type: 'broadcast',
            event: 'frame',
            payload: { binary: true, data: base64, frameNumber: frameCount, timestamp: now }
          });
          return;
        }

        // Handle JSON messages
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);

          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            return;
          }

          // Frame data (JSON encoded)
          if (msg.type === 'camera_frame' || msg.type === 'screen_frame') {
            const now = Date.now();
            if (now - lastFrameTime < minInterval) return;
            
            lastFrameTime = now;
            frameCount++;

            await conn.channel.send({
              type: 'broadcast',
              event: 'frame',
              payload: { ...msg, frameNumber: frameCount, timestamp: now }
            });
            return;
          }

          // Forward other messages
          await conn.channel.send({
            type: 'broadcast',
            event: 'message',
            payload: msg
          });
        }
      } catch (e) {
        console.error(`[camera-relay] Message error:`, e);
      }
    };

    socket.onclose = () => {
      console.log(`[camera-relay] ${clientType} disconnected: ${connectionId}`);
      
      const conn = localConnections.get(connectionId);
      if (conn?.channel) {
        // Notify peers of disconnect
        conn.channel.send({
          type: 'broadcast',
          event: 'peer_status',
          payload: { type: 'peer_disconnected', peer: clientType }
        }).finally(() => {
          supabase.removeChannel(conn.channel);
        });
      }
      
      localConnections.delete(connectionId);
    };

    socket.onerror = (e) => {
      console.error(`[camera-relay] Socket error:`, e);
    };

    return response;
  }

  // HTTP endpoints for diagnostics
  if (method === 'POST') {
    try {
      const body = await req.json();
      const { action, sessionId } = body;

      if (action === 'create_session') {
        const newSessionId = sessionId || crypto.randomUUID();
        const host = new URL(req.url).host;
        const ref = host.split(".")[0];

        return new Response(
          JSON.stringify({
            success: true,
            sessionId: newSessionId,
            wsUrl: `wss://${ref}.functions.supabase.co/functions/v1/camera-relay?sessionId=${newSessionId}`,
            note: 'Using Realtime broadcast - instances are now shared'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (action === 'get_session') {
        // With Realtime, we can't easily query session state
        // Return info about local connections only
        const localCount = [...localConnections.keys()].filter(k => k.startsWith(sessionId)).length;
        return new Response(
          JSON.stringify({
            success: true,
            note: 'Sessions use Realtime broadcast - state is distributed',
            localConnectionsForSession: localCount
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Unknown action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (e) {
      console.error('[camera-relay] HTTP error:', e);
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // GET endpoint for health check
  return new Response(
    JSON.stringify({
      status: 'ok',
      transport: 'supabase-realtime-broadcast',
      note: 'Frames routed via Realtime - no instance isolation issues',
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
