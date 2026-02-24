import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Extract project ref for WS URL construction
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

// Store active audio sessions
const audioSessions = new Map<string, {
  phoneSocket: WebSocket | null;
  pcSocket: WebSocket | null;
  direction: 'phone_to_pc' | 'pc_to_phone' | 'bidirectional';
  lastActivity: number;
  deviceId?: string;
}>();

// Cleanup stale sessions every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of audioSessions) {
    if (now - session.lastActivity > 300_000) { // 5 min stale
      [session.phoneSocket, session.pcSocket].forEach(s => {
        if (s && s.readyState === WebSocket.OPEN) try { s.close(); } catch {}
      });
      audioSessions.delete(id);
      console.log(`[audio-relay] Cleaned stale session ${id}`);
    }
  }
}, 60_000);

serve(async (req) => {
  const { headers, method } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Handle WebSocket upgrade for audio streaming
  if (upgradeHeader.toLowerCase() === "websocket") {
    const url = new URL(req.url);
    const sessionToken = url.searchParams.get("session_token");
    const sessionId = url.searchParams.get("sessionId") || crypto.randomUUID();
    const clientType = url.searchParams.get("type") || "phone"; // 'phone' or 'pc'
    const direction = url.searchParams.get("direction") || "phone_to_pc";

    // Validate session token before upgrading WebSocket
    if (!sessionToken) {
      console.warn(`[audio-relay] Rejected: Missing session token for session=${sessionId}`);
      return new Response("Unauthorized: Missing session token", { status: 401, headers: corsHeaders });
    }

    // Validate session token against database
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

    // Check expiration
    if (new Date(session.expires_at) < new Date()) {
      console.warn(`[audio-relay] Rejected: Expired session for session=${sessionId}`);
      return new Response("Unauthorized: Session expired", { status: 401, headers: corsHeaders });
    }

    // Verify device exists
    const { data: device } = await supabase
      .from("devices")
      .select("user_id")
      .eq("id", session.device_id)
      .maybeSingle();

    if (!device) {
      console.warn(`[audio-relay] Rejected: Device not found for session=${sessionId}`);
      return new Response("Unauthorized: Device not found", { status: 401, headers: corsHeaders });
    }

    console.log(`[audio-relay] Authenticated WebSocket upgrade: session=${sessionId}, type=${clientType}, device=${session.device_id}`);

    const { socket, response } = Deno.upgradeWebSocket(req, {
      idleTimeout: 120, // 2 min idle timeout (default is 30s which is too short)
    });

    // Initialize or get session
    if (!audioSessions.has(sessionId)) {
      audioSessions.set(sessionId, {
        phoneSocket: null,
        pcSocket: null,
        direction: direction as 'phone_to_pc' | 'pc_to_phone' | 'bidirectional',
        lastActivity: Date.now(),
        deviceId: session.device_id,
      });
    }

    const audioSession = audioSessions.get(sessionId)!;

    socket.onopen = () => {
      console.log(`[audio-relay] ${clientType} connected to session ${sessionId}`);
      
      // Close any existing socket for this client type (prevent duplicates)
      const existingSocket = clientType === 'phone' ? audioSession.phoneSocket : audioSession.pcSocket;
      if (existingSocket && existingSocket.readyState === WebSocket.OPEN) {
        try { existingSocket.close(); } catch {}
      }

      if (clientType === 'phone') {
        audioSession.phoneSocket = socket;
      } else {
        audioSession.pcSocket = socket;
      }
      audioSession.lastActivity = Date.now();

      // Notify the other party
      const otherSocket = clientType === 'phone' ? audioSession.pcSocket : audioSession.phoneSocket;
      if (otherSocket && otherSocket.readyState === WebSocket.OPEN) {
        try {
          otherSocket.send(JSON.stringify({ 
            type: 'peer_connected', 
            peer: clientType,
            direction: audioSession.direction 
          }));
          // Also tell the newly connected client about the existing peer
          socket.send(JSON.stringify({
            type: 'peer_connected',
            peer: clientType === 'phone' ? 'pc' : 'phone',
            direction: audioSession.direction,
          }));
        } catch {}
      }
    };

    socket.onmessage = (event) => {
      audioSession.lastActivity = Date.now();
      
      try {
        // Handle both binary (audio) and text (control) messages
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          
          // Control messages
          if (msg.type === 'ping') {
            try { socket.send(JSON.stringify({ type: 'pong' })); } catch {}
            return;
          }
          
          if (msg.type === 'set_direction') {
            audioSession.direction = msg.direction;
            // Notify both parties
            [audioSession.phoneSocket, audioSession.pcSocket].forEach(s => {
              if (s && s.readyState === WebSocket.OPEN) {
                try { s.send(JSON.stringify({ type: 'direction_changed', direction: msg.direction })); } catch {}
              }
            });
            return;
          }

          // Forward JSON messages to the appropriate peer
          const targetSocket = clientType === 'phone' ? audioSession.pcSocket : audioSession.phoneSocket;
          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            try { targetSocket.send(event.data); } catch {}
          }
        } else {
          // Binary audio data - forward based on direction
          const shouldForward = 
            (audioSession.direction === 'bidirectional') ||
            (audioSession.direction === 'phone_to_pc' && clientType === 'phone') ||
            (audioSession.direction === 'pc_to_phone' && clientType === 'pc');

          if (shouldForward) {
            const targetSocket = clientType === 'phone' ? audioSession.pcSocket : audioSession.phoneSocket;
            if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
              try { targetSocket.send(event.data); } catch {}
            }
          }
        }
      } catch (e) {
        console.error(`[audio-relay] Message error:`, e);
      }
    };

    socket.onclose = () => {
      console.log(`[audio-relay] ${clientType} disconnected from session ${sessionId}`);
      
      if (clientType === 'phone') {
        audioSession.phoneSocket = null;
      } else {
        audioSession.pcSocket = null;
      }

      // Notify the other party
      const otherSocket = clientType === 'phone' ? audioSession.pcSocket : audioSession.phoneSocket;
      if (otherSocket && otherSocket.readyState === WebSocket.OPEN) {
        try { otherSocket.send(JSON.stringify({ type: 'peer_disconnected', peer: clientType })); } catch {}
      }

      // Clean up empty sessions
      if (!audioSession.phoneSocket && !audioSession.pcSocket) {
        audioSessions.delete(sessionId);
        console.log(`[audio-relay] Session ${sessionId} cleaned up`);
      }
    };

    socket.onerror = (e) => {
      console.error(`[audio-relay] Socket error for ${clientType} in session ${sessionId}:`, e);
    };

    return response;
  }

  // HTTP endpoint for session management
  if (method === 'POST') {
    try {
      const body = await req.json();
      const { action, sessionId } = body;

      if (action === 'create_session') {
        const newSessionId = sessionId || crypto.randomUUID();
        audioSessions.set(newSessionId, {
          phoneSocket: null,
          pcSocket: null,
          direction: body.direction || 'phone_to_pc',
          lastActivity: Date.now(),
        });

        return new Response(
          JSON.stringify({
            success: true,
            sessionId: newSessionId,
            wsUrl: `wss://${PROJECT_REF}.functions.supabase.co/functions/v1/audio-relay?sessionId=${newSessionId}`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (action === 'get_session') {
        const session = audioSessions.get(sessionId);
        return new Response(
          JSON.stringify({
            success: !!session,
            session: session ? {
              hasPhone: !!session.phoneSocket,
              hasPC: !!session.pcSocket,
              direction: session.direction,
              lastActivity: session.lastActivity,
            } : null
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (action === 'close_session') {
        const session = audioSessions.get(sessionId);
        if (session) {
          [session.phoneSocket, session.pcSocket].forEach(s => {
            if (s && s.readyState === WebSocket.OPEN) {
              try { s.close(); } catch {}
            }
          });
          audioSessions.delete(sessionId);
        }
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

  // GET endpoint for health check
  return new Response(
    JSON.stringify({ 
      status: 'ok', 
      activeSessions: audioSessions.size,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
