import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CameraSession {
  phoneSocket: WebSocket | null;
  pcSocket: WebSocket | null;
  lastFrameTime: number;
  frameCount: number;
  targetFps: number;
  quality: number;
  lastActivity: number;
  useBinaryMode: boolean; // New: support binary frame transfers
}

// Store active camera sessions
const cameraSessions = new Map<string, CameraSession>();

// Session cleanup interval (every 30 seconds)
const CLEANUP_INTERVAL = 30000;
const SESSION_TIMEOUT = 60000; // 60 seconds of inactivity
const MAX_FPS = 90; // Support up to 90 FPS for smooth streaming

// Cleanup stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of cameraSessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      console.log(`[camera-relay] Cleaning up stale session: ${sessionId}`);
      if (session.phoneSocket?.readyState === WebSocket.OPEN) {
        session.phoneSocket.close();
      }
      if (session.pcSocket?.readyState === WebSocket.OPEN) {
        session.pcSocket.close();
      }
      cameraSessions.delete(sessionId);
    }
  }
}, CLEANUP_INTERVAL);

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
    const sessionId = url.searchParams.get("sessionId") || crypto.randomUUID();
    const clientType = url.searchParams.get("type") || "phone"; // 'phone' or 'pc'
    const targetFps = Math.min(parseInt(url.searchParams.get("fps") || "30", 10), MAX_FPS);
    const quality = parseInt(url.searchParams.get("quality") || "50", 10);
    const useBinary = url.searchParams.get("binary") === "true";

    console.log(`[camera-relay] WebSocket upgrade: session=${sessionId}, type=${clientType}, fps=${targetFps}, quality=${quality}, binary=${useBinary}`);

    const { socket, response } = Deno.upgradeWebSocket(req);

    // Initialize or get session
    if (!cameraSessions.has(sessionId)) {
      cameraSessions.set(sessionId, {
        phoneSocket: null,
        pcSocket: null,
        lastFrameTime: 0,
        frameCount: 0,
        targetFps,
        quality,
        lastActivity: Date.now(),
        useBinaryMode: useBinary,
      });
    }

    const session = cameraSessions.get(sessionId)!;

    socket.onopen = () => {
      console.log(`[camera-relay] ${clientType} connected to session ${sessionId}`);
      
      if (clientType === 'phone') {
        // Close existing phone connection if any (reconnect scenario)
        if (session.phoneSocket && session.phoneSocket.readyState === WebSocket.OPEN) {
          console.log(`[camera-relay] Closing existing phone connection for reconnect`);
          session.phoneSocket.close();
        }
        session.phoneSocket = socket;
      } else {
        // Close existing PC connection if any (reconnect scenario)
        if (session.pcSocket && session.pcSocket.readyState === WebSocket.OPEN) {
          console.log(`[camera-relay] Closing existing PC connection for reconnect`);
          session.pcSocket.close();
        }
        session.pcSocket = socket;
      }
      session.lastActivity = Date.now();

      // Notify the other party
      const otherSocket = clientType === 'phone' ? session.pcSocket : session.phoneSocket;
      if (otherSocket && otherSocket.readyState === WebSocket.OPEN) {
        otherSocket.send(JSON.stringify({ 
          type: 'peer_connected', 
          peer: clientType,
          targetFps: session.targetFps,
          quality: session.quality
        }));
      }

      // Send connection status to the connecting client
      socket.send(JSON.stringify({
        type: 'connected',
        sessionId,
        peerConnected: !!(clientType === 'phone' ? session.pcSocket : session.phoneSocket),
      }));
    };

    socket.onmessage = (event) => {
      session.lastActivity = Date.now();
      
      try {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          
          // Control messages
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            return;
          }

          if (msg.type === 'set_fps') {
            session.targetFps = msg.fps;
            // Notify PC about new FPS target
            if (session.pcSocket && session.pcSocket.readyState === WebSocket.OPEN) {
              session.pcSocket.send(JSON.stringify({ type: 'fps_changed', fps: msg.fps }));
            }
            return;
          }

          if (msg.type === 'set_quality') {
            session.quality = msg.quality;
            // Notify PC about new quality
            if (session.pcSocket && session.pcSocket.readyState === WebSocket.OPEN) {
              session.pcSocket.send(JSON.stringify({ type: 'quality_changed', quality: msg.quality }));
            }
            return;
          }

          const isFrame = msg.type === 'camera_frame' || msg.type === 'screen_frame';

          if (isFrame) {
            // Frame throttling - check if enough time has passed
            const now = Date.now();
            const minInterval = 1000 / session.targetFps;

            if (now - session.lastFrameTime >= minInterval) {
              session.lastFrameTime = now;
              session.frameCount++;

              // Forward frames to the opposite peer (phone <-> pc)
              const targetSocket = clientType === 'phone' ? session.pcSocket : session.phoneSocket;
              if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                targetSocket.send(
                  JSON.stringify({
                    type: msg.type,
                    data: msg.data,
                    width: msg.width,
                    height: msg.height,
                    frameNumber: session.frameCount,
                    timestamp: now,
                  })
                );
              }
            }
            return;
          }

          // Forward other JSON messages to the appropriate peer
          const targetSocket = clientType === 'phone' ? session.pcSocket : session.phoneSocket;
          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(event.data);
          }
        } else {
          // Binary data (raw frame bytes) - forward with throttling
          // NOTE: Normalize Uint8Array -> ArrayBuffer slice for maximum compatibility.
          const now = Date.now();
          const minInterval = 1000 / session.targetFps;

          if (now - session.lastFrameTime >= minInterval) {
            session.lastFrameTime = now;
            session.frameCount++;

            const targetSocket = clientType === 'phone' ? session.pcSocket : session.phoneSocket;
            if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
              const payload = event.data instanceof Uint8Array
                ? event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength)
                : event.data;
              targetSocket.send(payload);
            }
          }
        }
      } catch (e) {
        console.error(`[camera-relay] Message error:`, e);
      }
    };

    socket.onclose = () => {
      console.log(`[camera-relay] ${clientType} disconnected from session ${sessionId}`);
      
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
        cameraSessions.delete(sessionId);
        console.log(`[camera-relay] Session ${sessionId} cleaned up`);
      }
    };

    socket.onerror = (e) => {
      console.error(`[camera-relay] Socket error:`, e);
    };

    return response;
  }

  // HTTP endpoints for session management
  if (method === 'POST') {
    try {
      const body = await req.json();
      const { action, sessionId, fps, quality } = body;

      if (action === 'create_session') {
        const newSessionId = sessionId || crypto.randomUUID();
        cameraSessions.set(newSessionId, {
          phoneSocket: null,
          pcSocket: null,
          lastFrameTime: 0,
          frameCount: 0,
          targetFps: Math.min(fps || 30, MAX_FPS),
          quality: quality || 50,
          lastActivity: Date.now(),
          useBinaryMode: false,
        });

        const host = new URL(req.url).host;
        const ref = host.split(".")[0];

        return new Response(
          JSON.stringify({
            success: true,
            sessionId: newSessionId,
            wsUrl: `wss://${ref}.functions.supabase.co/functions/v1/camera-relay?sessionId=${newSessionId}`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (action === 'get_session') {
        const session = cameraSessions.get(sessionId);
        return new Response(
          JSON.stringify({
            success: !!session,
            session: session ? {
              hasPhone: !!session.phoneSocket,
              hasPC: !!session.pcSocket,
              frameCount: session.frameCount,
              targetFps: session.targetFps,
              quality: session.quality,
              lastActivity: session.lastActivity,
            } : null
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (action === 'close_session') {
        const session = cameraSessions.get(sessionId);
        if (session) {
          [session.phoneSocket, session.pcSocket].forEach(s => {
            if (s && s.readyState === WebSocket.OPEN) {
              s.close();
            }
          });
          cameraSessions.delete(sessionId);
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
      activeSessions: cameraSessions.size,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
