import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Store active audio sessions
const audioSessions = new Map<string, {
  phoneSocket: WebSocket | null;
  pcSocket: WebSocket | null;
  direction: 'phone_to_pc' | 'pc_to_phone' | 'bidirectional';
  lastActivity: number;
}>();

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
    const sessionId = url.searchParams.get("sessionId") || crypto.randomUUID();
    const clientType = url.searchParams.get("type") || "phone"; // 'phone' or 'pc'
    const direction = url.searchParams.get("direction") || "phone_to_pc";

    console.log(`[audio-relay] WebSocket upgrade: session=${sessionId}, type=${clientType}, direction=${direction}`);

    const { socket, response } = Deno.upgradeWebSocket(req);

    // Initialize or get session
    if (!audioSessions.has(sessionId)) {
      audioSessions.set(sessionId, {
        phoneSocket: null,
        pcSocket: null,
        direction: direction as 'phone_to_pc' | 'pc_to_phone' | 'bidirectional',
        lastActivity: Date.now(),
      });
    }

    const session = audioSessions.get(sessionId)!;

    socket.onopen = () => {
      console.log(`[audio-relay] ${clientType} connected to session ${sessionId}`);
      
      if (clientType === 'phone') {
        session.phoneSocket = socket;
      } else {
        session.pcSocket = socket;
      }
      session.lastActivity = Date.now();

      // Notify the other party
      const otherSocket = clientType === 'phone' ? session.pcSocket : session.phoneSocket;
      if (otherSocket && otherSocket.readyState === WebSocket.OPEN) {
        otherSocket.send(JSON.stringify({ 
          type: 'peer_connected', 
          peer: clientType,
          direction: session.direction 
        }));
      }
    };

    socket.onmessage = (event) => {
      session.lastActivity = Date.now();
      
      try {
        // Handle both binary (audio) and text (control) messages
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          
          // Control messages
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          
          if (msg.type === 'set_direction') {
            session.direction = msg.direction;
            // Notify both parties
            [session.phoneSocket, session.pcSocket].forEach(s => {
              if (s && s.readyState === WebSocket.OPEN) {
                s.send(JSON.stringify({ type: 'direction_changed', direction: msg.direction }));
              }
            });
            return;
          }

          // Forward JSON messages to the appropriate peer
          const targetSocket = clientType === 'phone' ? session.pcSocket : session.phoneSocket;
          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(event.data);
          }
        } else {
          // Binary audio data - forward based on direction
          const shouldForward = 
            (session.direction === 'bidirectional') ||
            (session.direction === 'phone_to_pc' && clientType === 'phone') ||
            (session.direction === 'pc_to_phone' && clientType === 'pc');

          if (shouldForward) {
            const targetSocket = clientType === 'phone' ? session.pcSocket : session.phoneSocket;
            if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
              targetSocket.send(event.data);
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
        session.phoneSocket = null;
      } else {
        session.pcSocket = null;
      }

      // Notify the other party
      const otherSocket = clientType === 'phone' ? session.pcSocket : session.phoneSocket;
      if (otherSocket && otherSocket.readyState === WebSocket.OPEN) {
        otherSocket.send(JSON.stringify({ type: 'peer_disconnected', peer: clientType }));
      }

      // Clean up empty sessions
      if (!session.phoneSocket && !session.pcSocket) {
        audioSessions.delete(sessionId);
        console.log(`[audio-relay] Session ${sessionId} cleaned up`);
      }
    };

    socket.onerror = (e) => {
      console.error(`[audio-relay] Socket error:`, e);
    };

    return response;
  }

  // HTTP endpoint for session management
  if (method === 'POST') {
    try {
      const body = await req.json();
      const { action, sessionId, deviceId } = body;

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
            wsUrl: `wss://gatcapfurmevdesilwco.functions.supabase.co/functions/v1/audio-relay?sessionId=${newSessionId}`
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
              s.close();
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
