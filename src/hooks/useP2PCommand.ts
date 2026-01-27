import { useCallback, useRef, useEffect, useState } from "react";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useFastCommand } from "@/hooks/useFastCommand";
import { getFunctionsWsBase } from "@/lib/relay";
import { useNetworkMonitor, NetworkInfo } from "@/hooks/useNetworkMonitor";

export type ConnectionMode = "p2p" | "websocket" | "fallback" | "disconnected";

/**
 * P2P/WebSocket hybrid command system with continuous network monitoring.
 * Automatically switches between modes based on network detection:
 * - Same network: WebRTC P2P (5-10ms latency)
 * - Different network: WebSocket direct (20-50ms latency)
 * - Fallback: Supabase edge function (50-100ms latency)
 */
export function useP2PCommand() {
  const { session } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();
  const { fireCommand: fallbackCommand } = useFastCommand();
  const networkMonitor = useNetworkMonitor(2000); // Check every 2 seconds
  
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("disconnected");
  const [latency, setLatency] = useState(0);
  const [autoP2P, setAutoP2P] = useState(true); // Auto-switch toggle
  
  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const lastPingRef = useRef<number>(0);
  const pingIntervalRef = useRef<number | null>(null);
  const mouseAccumulator = useRef({ x: 0, y: 0 });
  const mouseTimerRef = useRef<number | null>(null);
  const connectionAttempts = useRef(0);
  const maxAttempts = 3;
  const isUpgradingRef = useRef(false);

  const sessionToken = session?.session_token;
  const deviceId = selectedDevice?.id || session?.device_id;

  // Cleanup P2P connection
  const cleanupP2P = useCallback(() => {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    isUpgradingRef.current = false;
  }, []);

  // Attempt P2P upgrade via WebRTC
  const tryP2PUpgrade = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (isUpgradingRef.current || dataChannelRef.current?.readyState === "open") return;

    isUpgradingRef.current = true;
    console.log("[P2P] Attempting P2P upgrade...");

    try {
      // Cleanup any existing connection
      cleanupP2P();

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      // Create data channel for commands
      const dc = pc.createDataChannel("commands", {
        ordered: false,
        maxRetransmits: 0,
      });

      dc.onopen = () => {
        console.log("[P2P] ✅ Data channel open - P2P active!");
        setConnectionMode("p2p");
        dataChannelRef.current = dc;
        isUpgradingRef.current = false;
      };

      dc.onclose = () => {
        console.log("[P2P] Data channel closed");
        dataChannelRef.current = null;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          setConnectionMode("websocket");
        }
      };

      dc.onerror = (err) => {
        console.error("[P2P] Data channel error:", err);
        isUpgradingRef.current = false;
      };

      dc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "pong") {
            setLatency(Date.now() - lastPingRef.current);
          } else if (msg.type === "network_info" && msg.data) {
            // Update PC network info for continuous monitoring
            const pcInfo: NetworkInfo = {
              localIp: msg.data.local_ips?.[0] || "",
              networkPrefix: msg.data.network_prefix || "",
              connectionType: "ethernet",
              isOnline: true,
            };
            networkMonitor.updatePcInfo(pcInfo);
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
          isUpgradingRef.current = false;
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            setConnectionMode("websocket");
          }
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

      // Timeout for P2P upgrade
      setTimeout(() => {
        if (isUpgradingRef.current && dataChannelRef.current?.readyState !== "open") {
          console.log("[P2P] Upgrade timeout, staying on WebSocket");
          isUpgradingRef.current = false;
        }
      }, 5000);

    } catch (err) {
      console.error("[P2P] Upgrade failed:", err);
      isUpgradingRef.current = false;
    }
  }, [cleanupP2P, networkMonitor]);

  // Handle P2P answer from agent
  const handleP2PAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (!peerRef.current) return;
    try {
      await peerRef.current.setRemoteDescription(answer);
      console.log("[P2P] Answer set successfully");
    } catch (err) {
      console.error("[P2P] Failed to set answer:", err);
    }
  }, []);

  // Handle ICE candidate
  const handleICECandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!peerRef.current) return;
    try {
      await peerRef.current.addIceCandidate(candidate);
    } catch (err) {
      console.debug("[P2P] ICE candidate error:", err);
    }
  }, []);

  // Connect via WebSocket
  const connectWebSocket = useCallback(() => {
    if (!sessionToken || !deviceId || wsRef.current?.readyState === WebSocket.OPEN) return;

    const WS_BASE = getFunctionsWsBase();
    const ws = new WebSocket(
      `${WS_BASE}/functions/v1/device-commands?sessionToken=${sessionToken}&deviceId=${deviceId}&mode=direct`
    );

    ws.onopen = () => {
      console.log("[P2P] WebSocket connected");
      setConnectionMode("websocket");
      connectionAttempts.current = 0;
      
      // Request PC network info immediately
      ws.send(JSON.stringify({ type: "command", commandType: "get_network_info", payload: {} }));
      
      // Try P2P upgrade if on same network
      if (networkMonitor.networkState.sameNetwork && autoP2P) {
        tryP2PUpgrade();
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        
        if (msg.type === "p2p_offer") {
          // We're the initiator, shouldn't receive offers
        } else if (msg.type === "p2p_answer") {
          handleP2PAnswer(msg.answer);
        } else if (msg.type === "p2p_ice") {
          handleICECandidate(msg.candidate);
        } else if (msg.type === "pong") {
          setLatency(Date.now() - lastPingRef.current);
        } else if (msg.type === "network_info" || msg.commandType === "get_network_info") {
          // Update PC network info
          const data = msg.data || msg.result;
          if (data) {
            const pcInfo: NetworkInfo = {
              localIp: data.local_ips?.[0] || data.pc_ip || "",
              networkPrefix: data.network_prefix || data.pc_prefix || "",
              connectionType: "ethernet",
              isOnline: true,
            };
            networkMonitor.updatePcInfo(pcInfo);
          }
        }
      } catch (err) {
        console.debug("[P2P] Message parse error:", err);
      }
    };

    ws.onclose = () => {
      console.log("[P2P] WebSocket disconnected");
      connectionAttempts.current++;
      cleanupP2P();
      
      if (connectionAttempts.current < maxAttempts) {
        setConnectionMode("fallback");
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
  }, [sessionToken, deviceId, autoP2P, tryP2PUpgrade, handleP2PAnswer, handleICECandidate, cleanupP2P, networkMonitor]);

  // Start latency measurement
  const startLatencyMeasurement = useCallback(() => {
    if (pingIntervalRef.current) return;
    
    pingIntervalRef.current = window.setInterval(() => {
      lastPingRef.current = Date.now();
      const msg = JSON.stringify({ type: "ping", t: lastPingRef.current });
      
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(msg);
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(msg);
      }
    }, 2000);
  }, []);

  // Handle network changes - auto-switch P2P
  useEffect(() => {
    networkMonitor.onNetworkChange((sameNetwork) => {
      if (!autoP2P) return;
      
      if (sameNetwork && connectionMode === "websocket") {
        console.log("[P2P] 🔄 Same network detected, upgrading to P2P...");
        tryP2PUpgrade();
      } else if (!sameNetwork && connectionMode === "p2p") {
        console.log("[P2P] 🔄 Different network detected, downgrading to WebSocket...");
        cleanupP2P();
        setConnectionMode("websocket");
      }
    });
  }, [networkMonitor, autoP2P, connectionMode, tryP2PUpgrade, cleanupP2P]);

  // Connect on mount and start monitoring
  useEffect(() => {
    if (sessionToken && deviceId) {
      connectWebSocket();
      networkMonitor.startMonitoring();
      startLatencyMeasurement();
    }
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      cleanupP2P();
      networkMonitor.stopMonitoring();
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [sessionToken, deviceId, connectWebSocket, networkMonitor, startLatencyMeasurement, cleanupP2P]);

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

  // Batched mouse movement (16ms = 60fps)
  const MOUSE_BATCH_MS = 16;
  const MOUSE_THRESHOLD = 1.5;

  const fireMouse = useCallback((deltaX: number, deltaY: number) => {
    mouseAccumulator.current.x += deltaX;
    mouseAccumulator.current.y += deltaY;

    if (mouseTimerRef.current !== null) return;

    mouseTimerRef.current = window.setTimeout(() => {
      const { x, y } = mouseAccumulator.current;
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

  // Manual P2P toggle
  const toggleAutoP2P = useCallback(() => {
    setAutoP2P((prev) => !prev);
  }, []);

  // Force P2P upgrade attempt
  const forceP2PUpgrade = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      tryP2PUpgrade();
    }
  }, [tryP2PUpgrade]);

  return {
    fireCommand,
    fireMouse,
    fireKey,
    fireScroll,
    fireClick,
    connectionMode,
    latency,
    isConnected: connectionMode !== "disconnected",
    autoP2P,
    toggleAutoP2P,
    forceP2PUpgrade,
    networkState: networkMonitor.networkState,
  };
}
