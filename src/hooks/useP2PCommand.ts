import { useCallback, useRef, useEffect, useState } from "react";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useFastCommand } from "@/hooks/useFastCommand";
import { getFunctionsWsBase } from "@/lib/relay";
import { useNetworkMonitor, NetworkInfo } from "@/hooks/useNetworkMonitor";
import { useLocalP2P } from "@/hooks/useLocalP2P";

export type ConnectionMode = "local_p2p" | "p2p" | "websocket" | "fallback" | "disconnected";

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
  const localP2P = useLocalP2P(); // Local P2P WebSocket server
  
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("disconnected");
  const [latency, setLatency] = useState(0);
  const [autoP2P, setAutoP2P] = useState(true); // Auto-switch toggle
  const [autoLocalP2P, setAutoLocalP2P] = useState(true); // Try local P2P first
  
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
  const localP2PCheckRef = useRef<number | null>(null);

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
      
      // Try local P2P first for lowest latency
      if (localP2P.isReady) {
        localP2P.sendPing();
        return;
      }
      
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(msg);
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(msg);
      }
    }, 2000);
  }, [localP2P]);

  // Try to connect to local P2P server when on same network
  const tryLocalP2PConnection = useCallback(async () => {
    if (!autoLocalP2P || !networkMonitor.networkState.sameNetwork) return;
    
    const pcInfo = networkMonitor.networkState.pc;
    if (!pcInfo?.localIp && !pcInfo?.networkPrefix) return;
    
    console.log("[LocalP2P] Attempting local P2P connection...");
    
    // Try known PC IP first, then discover
    await localP2P.checkAndConnect(
      pcInfo.networkPrefix || "",
      pcInfo.localIp || undefined
    );
    
    if (localP2P.isReady) {
      console.log("[LocalP2P] ✅ Local P2P connected!");
      setConnectionMode("local_p2p");
      setLatency(localP2P.state.latency);
    }
  }, [autoLocalP2P, networkMonitor.networkState, localP2P]);

  // Handle network changes - auto-switch between modes
  useEffect(() => {
    networkMonitor.onNetworkChange((sameNetwork) => {
      if (sameNetwork) {
        // Same network - try local P2P first
        if (autoLocalP2P) {
          console.log("[P2P] 🔄 Same network detected, trying local P2P...");
          tryLocalP2PConnection();
        } else if (autoP2P && connectionMode === "websocket") {
          console.log("[P2P] 🔄 Same network detected, upgrading to WebRTC P2P...");
          tryP2PUpgrade();
        }
      } else {
        // Different network - disconnect local P2P, use WebSocket/Cloud
        if (connectionMode === "local_p2p") {
          console.log("[P2P] 🔄 Different network, disconnecting local P2P...");
          localP2P.disconnect();
          setConnectionMode("websocket");
        } else if (connectionMode === "p2p") {
          console.log("[P2P] 🔄 Different network, downgrading to WebSocket...");
          cleanupP2P();
          setConnectionMode("websocket");
        }
      }
    });
  }, [networkMonitor, autoP2P, autoLocalP2P, connectionMode, tryP2PUpgrade, cleanupP2P, localP2P, tryLocalP2PConnection]);

  // Monitor local P2P state changes
  useEffect(() => {
    if (localP2P.isReady && connectionMode !== "local_p2p") {
      setConnectionMode("local_p2p");
      setLatency(localP2P.state.latency);
    } else if (!localP2P.isReady && connectionMode === "local_p2p") {
      // Local P2P disconnected, fall back
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setConnectionMode("websocket");
      } else {
        connectWebSocket();
      }
    }
  }, [localP2P.isReady, localP2P.state.latency, connectionMode, connectWebSocket]);

  // Connect on mount and start monitoring
  useEffect(() => {
    if (sessionToken && deviceId) {
      connectWebSocket();
      networkMonitor.startMonitoring();
      startLatencyMeasurement();
      
      // Try local P2P after a short delay
      if (autoLocalP2P) {
        localP2PCheckRef.current = window.setTimeout(() => {
          tryLocalP2PConnection();
        }, 1000);
      }
    }
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      cleanupP2P();
      localP2P.disconnect();
      networkMonitor.stopMonitoring();
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (localP2PCheckRef.current) {
        clearTimeout(localP2PCheckRef.current);
      }
    };
  }, [sessionToken, deviceId, connectWebSocket, networkMonitor, startLatencyMeasurement, cleanupP2P, localP2P, autoLocalP2P, tryLocalP2PConnection]);

  // Fire command with lowest latency path
  const fireCommand = useCallback((commandType: string, payload: Record<string, unknown> = {}) => {
    const msg = JSON.stringify({ type: "command", commandType, payload });

    // Priority 1: Local P2P (fastest, ~2-5ms)
    if (localP2P.isReady) {
      if (localP2P.sendCommand(commandType, payload)) {
        return;
      }
    }

    // Priority 2: WebRTC P2P (fast, ~5-15ms)
    if (dataChannelRef.current?.readyState === "open") {
      dataChannelRef.current.send(msg);
      return;
    }

    // Priority 3: Direct WebSocket (~20-50ms)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
      return;
    }

    // Priority 4: Supabase edge function fallback (~50-100ms)
    console.debug("[P2P] Using fallback for command:", commandType);
    fallbackCommand(commandType, payload);
  }, [fallbackCommand, localP2P]);

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

  // Toggle local P2P preference
  const toggleAutoLocalP2P = useCallback(() => {
    setAutoLocalP2P((prev) => !prev);
  }, []);

  // Force P2P upgrade attempt
  const forceP2PUpgrade = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      tryP2PUpgrade();
    }
  }, [tryP2PUpgrade]);

  // Force local P2P connection attempt
  const forceLocalP2P = useCallback(() => {
    tryLocalP2PConnection();
  }, [tryLocalP2PConnection]);

  // Get effective latency based on current mode
  const effectiveLatency = connectionMode === "local_p2p" 
    ? localP2P.state.latency 
    : latency;

  return {
    fireCommand,
    fireMouse,
    fireKey,
    fireScroll,
    fireClick,
    connectionMode,
    latency: effectiveLatency,
    isConnected: connectionMode !== "disconnected",
    autoP2P,
    autoLocalP2P,
    toggleAutoP2P,
    toggleAutoLocalP2P,
    forceP2PUpgrade,
    forceLocalP2P,
    networkState: networkMonitor.networkState,
    localP2PState: localP2P.state,
  };
}
