import { useCallback, useRef, useEffect, useState } from "react";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useFastCommand } from "@/hooks/useFastCommand";
import { getFunctionsWsBase } from "@/lib/relay";

/**
 * P2P/WebSocket hybrid command system for ultra-low latency.
 * - Same network: WebRTC P2P (5-10ms latency)
 * - Different network: WebSocket direct (20-50ms latency)
 * - Fallback: Supabase edge function (50-100ms latency)
 * 
 * This bypasses Supabase backend polling for real-time controls.
 */
export function useP2PCommand() {
  const { session } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();
  const { fireCommand: fallbackCommand, fireMouse: fallbackMouse, fireKey: fallbackKey, fireScroll: fallbackScroll } = useFastCommand();
  
  const [connectionMode, setConnectionMode] = useState<"p2p" | "websocket" | "fallback" | "disconnected">("disconnected");
  const [latency, setLatency] = useState(0);
  
  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const lastPingRef = useRef<number>(0);
  const mouseAccumulator = useRef({ x: 0, y: 0 });
  const mouseTimerRef = useRef<number | null>(null);
  const connectionAttempts = useRef(0);
  const maxAttempts = 3;

  const sessionToken = session?.session_token;
  const deviceId = selectedDevice?.id || session?.device_id;

  // Connect via WebSocket for signaling and fallback
  const connectWebSocket = useCallback(() => {
    if (!sessionToken || !deviceId || wsRef.current?.readyState === WebSocket.OPEN) return;

    const WS_BASE = getFunctionsWsBase();
    const ws = new WebSocket(
      `${WS_BASE}/functions/v1/device-commands?sessionToken=${sessionToken}&deviceId=${deviceId}&mode=direct`
    );

    ws.onopen = () => {
      console.log("[P2P] WebSocket connected");
      setConnectionMode("websocket");
      // Try to upgrade to P2P
      tryP2PUpgrade();
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        
        // Handle P2P signaling
        if (msg.type === "p2p_offer") {
          handleP2POffer(msg.offer);
        } else if (msg.type === "p2p_answer") {
          handleP2PAnswer(msg.answer);
        } else if (msg.type === "p2p_ice") {
          handleICECandidate(msg.candidate);
        } else if (msg.type === "pong") {
          const now = Date.now();
          setLatency(now - lastPingRef.current);
        }
      } catch (err) {
        console.debug("[P2P] Message parse error:", err);
      }
    };

    ws.onclose = () => {
      console.log("[P2P] WebSocket disconnected");
      connectionAttempts.current++;
      
      if (connectionAttempts.current < maxAttempts) {
        setConnectionMode("fallback"); // Use Supabase fallback
        // Reconnect after delay
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = window.setTimeout(connectWebSocket, 3000);
      } else {
        setConnectionMode("fallback");
        console.log("[P2P] Max attempts reached, using fallback mode");
      }
    };

    ws.onerror = (err) => {
      console.error("[P2P] WebSocket error:", err);
      setConnectionMode("fallback");
    };

    wsRef.current = ws;
  }, [sessionToken, deviceId]);

  // Attempt P2P upgrade via WebRTC
  const tryP2PUpgrade = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      // Create data channel for commands
      const dc = pc.createDataChannel("commands", {
        ordered: false, // Lower latency for mouse movements
        maxRetransmits: 0, // No retransmits for real-time
      });

      dc.onopen = () => {
        console.log("[P2P] Data channel open - P2P active!");
        setConnectionMode("p2p");
        dataChannelRef.current = dc;
        // Start latency measurement
        measureLatency();
      };

      dc.onclose = () => {
        console.log("[P2P] Data channel closed");
        if (connectionMode === "p2p") {
          setConnectionMode("websocket");
        }
        dataChannelRef.current = null;
      };

      dc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "pong") {
            setLatency(Date.now() - lastPingRef.current);
          }
        } catch {}
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: "p2p_ice",
            candidate: event.candidate,
          }));
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("[P2P] Connection state:", pc.connectionState);
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setConnectionMode("websocket");
        }
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer via WebSocket
      wsRef.current.send(JSON.stringify({
        type: "p2p_offer",
        offer: pc.localDescription,
      }));

      peerRef.current = pc;
    } catch (err) {
      console.error("[P2P] Upgrade failed:", err);
    }
  }, [connectionMode]);

  const handleP2POffer = useCallback(async (offer: RTCSessionDescriptionInit) => {
    // This is for the receiving end (Python agent)
    // Web app initiates, so this shouldn't be called here
  }, []);

  const handleP2PAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (!peerRef.current) return;
    try {
      await peerRef.current.setRemoteDescription(answer);
      console.log("[P2P] Answer set successfully");
    } catch (err) {
      console.error("[P2P] Failed to set answer:", err);
    }
  }, []);

  const handleICECandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!peerRef.current) return;
    try {
      await peerRef.current.addIceCandidate(candidate);
    } catch (err) {
      console.debug("[P2P] ICE candidate error:", err);
    }
  }, []);

  const measureLatency = useCallback(() => {
    const ping = () => {
      lastPingRef.current = Date.now();
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(JSON.stringify({ type: "ping", t: lastPingRef.current }));
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping", t: lastPingRef.current }));
      }
    };
    setInterval(ping, 2000);
  }, []);

  // Connect on mount
  useEffect(() => {
    if (sessionToken && deviceId) {
      connectWebSocket();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (peerRef.current) {
        peerRef.current.close();
        peerRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [sessionToken, deviceId, connectWebSocket]);

  // Fire command with lowest latency path
  const fireCommand = useCallback((commandType: string, payload: Record<string, unknown> = {}) => {
    const msg = JSON.stringify({ type: "command", commandType, payload });

    // Try P2P first
    if (dataChannelRef.current?.readyState === "open") {
      dataChannelRef.current.send(msg);
      return;
    }

    // Fallback to WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
      return;
    }

    // Last resort: use Supabase edge function fallback
    console.debug("[P2P] Using fallback for command:", commandType);
    fallbackCommand(commandType, payload);
  }, [fallbackCommand]);

  // Batched mouse movement for smoothness (KDE Connect style - 16ms = 60fps)
  const MOUSE_BATCH_MS = 16;
  const MOUSE_THRESHOLD = 1.5; // Minimum movement before sending

  const fireMouse = useCallback((deltaX: number, deltaY: number) => {
    mouseAccumulator.current.x += deltaX;
    mouseAccumulator.current.y += deltaY;

    if (mouseTimerRef.current !== null) return;

    mouseTimerRef.current = window.setTimeout(() => {
      const { x, y } = mouseAccumulator.current;
      // Only send if movement exceeds threshold (reduces spam)
      if (Math.abs(x) >= MOUSE_THRESHOLD || Math.abs(y) >= MOUSE_THRESHOLD) {
        fireCommand("mouse_move", { x: Math.round(x), y: Math.round(y), relative: true });
      }
      mouseAccumulator.current = { x: 0, y: 0 };
      mouseTimerRef.current = null;
    }, MOUSE_BATCH_MS);
  }, [fireCommand]);

  const fireKey = useCallback((key: string) => {
    if (key.includes("+")) {
      const keys = key.toLowerCase().split("+").map(k => k.trim());
      fireCommand("key_combo", { keys });
    } else {
      fireCommand("press_key", { key: key.toLowerCase() });
    }
  }, [fireCommand]);

  const fireScroll = useCallback((deltaY: number) => {
    fireCommand("mouse_scroll", { amount: Math.round(deltaY * -0.5) });
  }, [fireCommand]);

  const fireClick = useCallback((button: "left" | "right" | "middle" = "left") => {
    fireCommand("mouse_click", { button });
  }, [fireCommand]);

  return {
    fireCommand,
    fireMouse,
    fireKey,
    fireScroll,
    fireClick,
    connectionMode,
    latency,
    isConnected: connectionMode !== "disconnected",
  };
}
