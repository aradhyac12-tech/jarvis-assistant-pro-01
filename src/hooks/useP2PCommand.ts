import { useCallback, useRef, useEffect, useState } from "react";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useFastCommand } from "@/hooks/useFastCommand";
import { useNetworkMonitor, NetworkInfo } from "@/hooks/useNetworkMonitor";
import { useLocalP2P } from "@/hooks/useLocalP2P";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

export type ConnectionMode = "local_p2p" | "p2p" | "websocket" | "fallback" | "disconnected";

/**
 * P2P/WebSocket hybrid command system with continuous network monitoring.
 * Automatically switches between modes based on network detection:
 * - Same network: WebRTC P2P (5-10ms latency)
 * - Different network: WebSocket direct (20-50ms latency)
 * - Fallback: Supabase edge function (50-100ms latency)
 * 
 * OPTIMIZED: Uses requestAnimationFrame for 60fps mouse input,
 * velocity-based acceleration, and haptic feedback.
 */
export function useP2PCommand() {
  const { session } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();
  const { fireCommand: fallbackCommand } = useFastCommand();
  const networkMonitor = useNetworkMonitor(5000); // Check every 5 seconds (reduced from 2s)
  const localP2P = useLocalP2P(); // Local P2P WebSocket server
  const haptics = useHapticFeedback();
  
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("disconnected");
  const [latency, setLatency] = useState(0);
  const [autoP2P, setAutoP2P] = useState(true); // Auto-switch toggle
  const [autoLocalP2P, setAutoLocalP2P] = useState(true); // Try local P2P first
  
  // Legacy placeholder: WebRTC upgrade previously used a direct WebSocket signaling channel.
  // We keep the ref to avoid touching unrelated parts of the hook too much.
  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const lastPingRef = useRef<number>(0);
  const pingIntervalRef = useRef<number | null>(null);

  // Used to prevent ghost/accidental remote input execution on the agent
  const inputSessionIdRef = useRef<string>(crypto.randomUUID());
  
  // RAF-based mouse batching for 60fps smooth input
  const mouseAccumulator = useRef({ x: 0, y: 0, lastSend: 0 });
  const mouseRafRef = useRef<number | null>(null);
  const scrollAccumulator = useRef({ delta: 0, lastSend: 0 });
  const scrollRafRef = useRef<number | null>(null);
  const zoomAccumulator = useRef({ delta: 0, lastSend: 0 });
  const zoomRafRef = useRef<number | null>(null);
  
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
    // NOTE: WebRTC signaling previously depended on a WebSocket endpoint.
    // The current backend command endpoint is HTTP-only, so we keep WebRTC disabled
    // until we add a proper signaling channel.
    return;
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

  // NOTE: The previous direct WebSocket command channel pointed at an HTTP-only backend.
  // We now treat the cloud path as "fallback" (HTTP/fast-fire) and rely on Local P2P for speed.

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
      // If not on local P2P, we don't have a reliable low-latency ping channel.
    }, 2000);
  }, [localP2P]);

  // Refs to avoid stale closures in callbacks
  const autoLocalP2PRef = useRef(autoLocalP2P);
  const autoP2PRef = useRef(autoP2P);
  const connectionModeRef = useRef(connectionMode);
  
  useEffect(() => { autoLocalP2PRef.current = autoLocalP2P; }, [autoLocalP2P]);
  useEffect(() => { autoP2PRef.current = autoP2P; }, [autoP2P]);
  useEffect(() => { connectionModeRef.current = connectionMode; }, [connectionMode]);

  // Try to connect to local P2P server when on same network
  // Stable callback that reads from refs
  const tryLocalP2PConnection = useCallback(async () => {
    if (!autoLocalP2PRef.current) return;
    
    const pcInfo = networkMonitor.networkState.pc;
    const phoneInfo = networkMonitor.networkState.phone;
    
    // Check if we're on the same network by comparing prefixes
    const phonePrefix = phoneInfo?.networkPrefix || "";
    const pcPrefix = pcInfo?.networkPrefix || "";
    const sameNetwork = !!(phonePrefix && pcPrefix && phonePrefix === pcPrefix);

    // If we don't have PC info yet (common on first load), still try discovery
    // using the phone's network prefix.
    if (!sameNetwork && !phonePrefix && !pcInfo?.localIp) return;
    
    console.log("[LocalP2P] Attempting local P2P connection...", {
      phonePrefix,
      pcPrefix,
      sameNetwork,
      pcIp: pcInfo?.localIp
    });
    
    // Try known PC IP first, then discover based on phone's network prefix
    const targetPrefix = pcPrefix || phonePrefix;
    await localP2P.checkAndConnect(
      targetPrefix,
      pcInfo?.localIp || undefined
    );
    
    if (localP2P.isReady) {
      console.log("[LocalP2P] ✅ Local P2P connected!");
      setConnectionMode("local_p2p");
      setLatency(localP2P.state.latency);
    }
  }, [localP2P, networkMonitor.networkState.pc, networkMonitor.networkState.phone]);

  // Handle network changes - auto-switch between modes
  // Register callback once, use refs for latest state
  useEffect(() => {
    const handleNetworkChange = (sameNetwork: boolean) => {
      if (sameNetwork) {
        // Same network - try local P2P first
        if (autoLocalP2PRef.current) {
          console.log("[P2P] 🔄 Same network detected, trying local P2P...");
          // Defer to avoid sync issues
          setTimeout(() => tryLocalP2PConnection(), 100);
        }
      } else {
        // Different network - disconnect local P2P, use WebSocket/Cloud
        if (connectionModeRef.current === "local_p2p") {
          console.log("[P2P] 🔄 Different network, disconnecting local P2P...");
          localP2P.disconnect();
          setConnectionMode("fallback");
        } else if (connectionModeRef.current === "p2p") {
          console.log("[P2P] 🔄 Different network, downgrading to WebSocket...");
          cleanupP2P();
          setConnectionMode("fallback");
        }
      }
    };
    
    networkMonitor.onNetworkChange(handleNetworkChange);
    // No cleanup needed - onNetworkChange just stores the callback in a ref
  }, [networkMonitor, tryP2PUpgrade, cleanupP2P, localP2P, tryLocalP2PConnection]);

  // Monitor local P2P state changes
  useEffect(() => {
    if (localP2P.isReady && connectionMode !== "local_p2p") {
      setConnectionMode("local_p2p");
      setLatency(localP2P.state.latency);
    } else if (!localP2P.isReady && connectionMode === "local_p2p") {
      // Local P2P disconnected, fall back to cloud
      setConnectionMode("fallback");
    }
  }, [localP2P.isReady, localP2P.state.latency, connectionMode]);

  // Connect on mount and start monitoring
  // Only re-run when session/device changes, not on every callback recreation
  // Feed PC info from device's system_info into network monitor for auto-discovery
  useEffect(() => {
    if (!selectedDevice?.system_info) return;
    const sysInfo = selectedDevice.system_info as any;
    const localIps = sysInfo?.local_ips as string[] | undefined;
    const p2pPort = sysInfo?.p2p_port as number | undefined;
    if (localIps && localIps.length > 0) {
      const pcIp = localIps[0];
      const prefix = pcIp.split(".").slice(0, 3).join(".");
      networkMonitor.updatePcInfo({
        localIp: pcIp,
        networkPrefix: prefix,
        connectionType: "ethernet",
        isOnline: true,
      });
    }
  }, [selectedDevice?.system_info, networkMonitor]);

  // Periodic local P2P retry — keeps trying every 10s until connected
  const localP2PRetryRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (!sessionToken || !deviceId) return;

    // Cloud path is always available via fallback command execution.
    setConnectionMode("fallback");
    networkMonitor.startMonitoring();
    startLatencyMeasurement();
    
    // Try local P2P after a short delay
    localP2PCheckRef.current = window.setTimeout(() => {
      if (autoLocalP2PRef.current) {
        tryLocalP2PConnection();
      }
    }, 1000);

    // Periodic retry: if not on local_p2p yet and autoLocalP2P is on, keep trying
    localP2PRetryRef.current = window.setInterval(() => {
      if (
        autoLocalP2PRef.current &&
        connectionModeRef.current !== "local_p2p" &&
        !localP2P.isReady
      ) {
        console.log("[P2P] Auto-retry local P2P connection...");
        tryLocalP2PConnection();
      }
    }, 10000);
    
    return () => {
      cleanupP2P();
      localP2P.disconnect();
      networkMonitor.stopMonitoring();
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (localP2PCheckRef.current) {
        clearTimeout(localP2PCheckRef.current);
      }
      if (localP2PRetryRef.current) {
        clearInterval(localP2PRetryRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, deviceId]);

  // Fire command with lowest latency path
  const withInputSession = useCallback((payload: Record<string, unknown>) => {
    return { ...payload, input_session: inputSessionIdRef.current };
  }, []);

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

  // ============ ULTRA-SMOOTH RAF-BASED INPUT BATCHING ============
  // Uses requestAnimationFrame for 60fps mouse updates (KDE Connect style)
  
  // Mouse: RAF-based batching for maximum smoothness
  const MOUSE_THRESHOLD = 1.5;
  const MOUSE_MIN_INTERVAL_MS = 16; // ~60fps
  
  const fireMouse = useCallback((deltaX: number, deltaY: number) => {
    mouseAccumulator.current.x += deltaX;
    mouseAccumulator.current.y += deltaY;

    // Use RAF for smooth 60fps updates
    if (mouseRafRef.current !== null) return;

    mouseRafRef.current = requestAnimationFrame(() => {
      const now = performance.now();
      const elapsed = now - mouseAccumulator.current.lastSend;
      
      // Only send if enough time passed and movement exceeds threshold
      if (elapsed >= MOUSE_MIN_INTERVAL_MS) {
        const { x, y } = mouseAccumulator.current;
        if (Math.abs(x) >= MOUSE_THRESHOLD || Math.abs(y) >= MOUSE_THRESHOLD) {
          // Apply subtle acceleration for large movements
          const magnitude = Math.sqrt(x * x + y * y);
          const accel = magnitude > 20 ? 1.15 : 1.0;
          
          // If we are on cloud fallback, throttle harder to avoid queue/lag.
          const cloudThrottled = connectionModeRef.current === "fallback";
          if (!cloudThrottled || magnitude > 6) {
            fireCommand(
              "mouse_move",
              withInputSession({
                x: Math.round(x * accel),
                y: Math.round(y * accel),
                relative: true,
              })
            );
          }
        }
        mouseAccumulator.current = { x: 0, y: 0, lastSend: now };
      }
      mouseRafRef.current = null;
    });
  }, [fireCommand, withInputSession]);

  // Scroll: RAF-based with smooth accumulation
  const SCROLL_THRESHOLD = 2;
  const SCROLL_MIN_INTERVAL_MS = 32; // ~30fps for scroll
  
  const fireScroll = useCallback((deltaY: number) => {
    // Natural scroll direction, scaled appropriately
    scrollAccumulator.current.delta += deltaY * -0.3;

    if (scrollRafRef.current !== null) return;

    scrollRafRef.current = requestAnimationFrame(() => {
      const now = performance.now();
      const elapsed = now - scrollAccumulator.current.lastSend;
      
      if (elapsed >= SCROLL_MIN_INTERVAL_MS) {
        const amount = Math.round(scrollAccumulator.current.delta);
        if (Math.abs(amount) >= SCROLL_THRESHOLD) {
           fireCommand("mouse_scroll", withInputSession({ amount }));
          haptics.scroll();
        }
        scrollAccumulator.current = { delta: 0, lastSend: now };
      }
      scrollRafRef.current = null;
    });
  }, [fireCommand, haptics, withInputSession]);

  // Pinch-to-zoom: Debounced with single command
  const ZOOM_THRESHOLD = 0.04;
  const ZOOM_MIN_INTERVAL_MS = 80;
  
  const fireZoom = useCallback((delta: number) => {
    zoomAccumulator.current.delta += delta;

    if (zoomRafRef.current !== null) return;

    zoomRafRef.current = requestAnimationFrame(() => {
      const now = performance.now();
      const elapsed = now - zoomAccumulator.current.lastSend;
      
      if (elapsed >= ZOOM_MIN_INTERVAL_MS) {
        const amount = zoomAccumulator.current.delta;
        if (Math.abs(amount) >= ZOOM_THRESHOLD) {
           fireCommand("pinch_zoom", withInputSession({ 
            direction: amount > 0 ? "in" : "out",
            steps: Math.min(Math.ceil(Math.abs(amount) * 3), 5)
           }));
          haptics.zoom();
        }
        zoomAccumulator.current = { delta: 0, lastSend: now };
      }
      zoomRafRef.current = null;
    });
  }, [fireCommand, haptics, withInputSession]);

  const fireKey = useCallback((key: string) => {
    if (key.includes("+")) {
      const keys = key.toLowerCase().split("+").map(k => k.trim());
      fireCommand("key_combo", withInputSession({ keys }));
    } else {
      fireCommand("press_key", withInputSession({ key: key.toLowerCase() }));
    }
    haptics.tap();
  }, [fireCommand, haptics, withInputSession]);

  const fireClick = useCallback((button: "left" | "right" | "middle" = "left") => {
    fireCommand("mouse_click", withInputSession({ button }));
    if (button === "right") {
      haptics.doubleTap();
    } else {
      haptics.tap();
    }
  }, [fireCommand, haptics, withInputSession]);

  // 3-finger gesture: Show Desktop (Win+D)
  const fireGesture3Finger = useCallback(() => {
    fireCommand("gesture_3_finger", withInputSession({}));
    haptics.gesture3Finger();
  }, [fireCommand, haptics, withInputSession]);

  // 4-finger swipe: Virtual desktop switch
  const fireGesture4Finger = useCallback((direction: "left" | "right") => {
    fireCommand("gesture_4_finger", withInputSession({ direction }));
    haptics.gesture4Finger();
  }, [fireCommand, haptics, withInputSession]);

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
    tryP2PUpgrade();
  }, [tryP2PUpgrade]);

  // Force local P2P connection attempt
  const forceLocalP2P = useCallback(() => {
    tryLocalP2PConnection();
  }, [tryLocalP2PConnection]);


  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (mouseRafRef.current) cancelAnimationFrame(mouseRafRef.current);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
    };
  }, []);

  // Get effective latency based on current mode
  const effectiveLatency = connectionMode === "local_p2p" 
    ? localP2P.state.latency 
    : latency;

  return {
    fireCommand,
    fireMouse,
    fireKey,
    fireScroll,
    fireZoom,
    fireClick,
    fireGesture3Finger,
    fireGesture4Finger,
    inputSessionId: inputSessionIdRef.current,
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
    haptics,
  };
}
