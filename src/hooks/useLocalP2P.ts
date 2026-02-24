import { useCallback, useRef, useState, useEffect } from "react";

export interface LocalP2PState {
  isAvailable: boolean;
  isConnected: boolean;
  pcIp: string | null;
  port: number;
  lastCheckTime: number;
  latency: number;
  transport: "ws" | "http" | null;
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: number;
};

const LOCAL_P2P_PORT = 9876;
const LOCAL_P2P_HTTP_PORT = 9877;
const PROBE_TIMEOUT_MS = 1500;
const KNOWN_IP_TIMEOUT_MS = 3000;
const KEEPALIVE_INTERVAL_MS = 8000; // Ping every 8s to maintain connection
const RECONNECT_COOLDOWN_MS = 15000; // Don't retry discovery more than once per 15s
const CONNECTION_STABLE_MS = 5000; // Wait 5s before declaring disconnected

function isNativeApp(): boolean {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function isWsBlocked(): boolean {
  if (window.location.protocol !== "https:") return false;
  if (isNativeApp()) return false;
  return true;
}

function canUseHttpP2P(): boolean {
  if (window.location.protocol !== "https:") return true;
  if (isNativeApp()) return true;
  return false;
}

/** Probe an IP via HTTP GET */
async function probeHttpServer(ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  if (!canUseHttpP2P()) return false;
  try {
    const controller = new AbortController();
    const tid = window.setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${ip}:${LOCAL_P2P_HTTP_PORT}/ping`, {
      signal: controller.signal,
      mode: "cors",
    });
    clearTimeout(tid);
    if (!res.ok) return false;
    const data = await res.json();
    return data?.type === "pong";
  } catch {
    return false;
  }
}

/** Probe via WS */
function probeWsServer(ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://${ip}:${LOCAL_P2P_PORT}/p2p`);
      const timeoutId = window.setTimeout(() => { ws.close(); resolve(false); }, timeoutMs);
      ws.onopen = () => { clearTimeout(timeoutId); ws.close(); resolve(true); };
      ws.onerror = () => { clearTimeout(timeoutId); resolve(false); };
    } catch { resolve(false); }
  });
}

/** Try both transports */
async function probeBothTransports(ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<"ws" | "http" | null> {
  const [wsOk, httpOk] = await Promise.all([
    probeWsServer(ip, timeoutMs),
    probeHttpServer(ip, timeoutMs),
  ]);
  if (wsOk) return "ws";
  if (httpOk) return "http";
  return null;
}

/** Send a command via HTTP POST */
async function httpCommand(
  ip: string,
  commandType: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 30000
): Promise<any> {
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const tid = window.setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`http://${ip}:${LOCAL_P2P_HTTP_PORT}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commandType, payload, requestId }),
    signal: controller.signal,
    mode: "cors",
  });
  clearTimeout(tid);
  if (!res.ok) throw new Error(`HTTP P2P error: ${res.status}`);
  const data = await res.json();
  if (data.type === "command_error") throw new Error(data.error || "Command failed");
  return data.result;
}

/**
 * Stable P2P hook with keepalive, reconnect cooldown, and debounced state changes.
 * Prevents rapid switching between P2P and cloud modes.
 */
export function useLocalP2P() {
  const [state, setState] = useState<LocalP2PState>({
    isAvailable: false,
    isConnected: false,
    pcIp: null,
    port: LOCAL_P2P_PORT,
    lastCheckTime: 0,
    latency: 0,
    transport: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const httpModeRef = useRef<boolean>(false);
  const keepaliveRef = useRef<number | null>(null);
  const lastPingRef = useRef<number>(0);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const lastDiscoveryRef = useRef<number>(0); // Cooldown tracker
  const connectedIpRef = useRef<string | null>(null); // Remember connected IP
  const disconnectTimerRef = useRef<number | null>(null); // Debounce disconnect
  const isConnectingRef = useRef<boolean>(false);

  // Save/load known PC IP
  const saveKnownIp = useCallback((ip: string) => {
    connectedIpRef.current = ip;
    try { localStorage.setItem("jarvis_p2p_known_ip", ip); } catch {}
  }, []);

  const getKnownIp = useCallback((): string | null => {
    return connectedIpRef.current || localStorage.getItem("jarvis_p2p_known_ip");
  }, []);

  // Keepalive: ping periodically to maintain the connection
  const startKeepalive = useCallback((ip: string) => {
    if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    
    keepaliveRef.current = window.setInterval(async () => {
      // WS keepalive
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        lastPingRef.current = Date.now();
        wsRef.current.send(JSON.stringify({ type: "ping", t: lastPingRef.current }));
        return;
      }
      
      // HTTP keepalive
      if (httpModeRef.current) {
        const start = Date.now();
        const ok = await probeHttpServer(ip, 3000);
        if (ok) {
          setState(prev => ({ ...prev, latency: Date.now() - start }));
          return;
        }
      }
      
      // Both failed — but DON'T immediately disconnect. Give it a grace period.
      if (!disconnectTimerRef.current) {
        console.log("[LocalP2P] Keepalive missed, starting grace period...");
        disconnectTimerRef.current = window.setTimeout(() => {
          // Re-check before actually disconnecting
          const wsAlive = wsRef.current?.readyState === WebSocket.OPEN;
          if (!wsAlive && !httpModeRef.current) {
            console.log("[LocalP2P] Grace period expired, disconnecting.");
            handleDisconnect();
          }
          disconnectTimerRef.current = null;
        }, CONNECTION_STABLE_MS);
      }
    }, KEEPALIVE_INTERVAL_MS);
  }, []);

  const stopKeepalive = useCallback(() => {
    if (keepaliveRef.current) {
      clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    wsRef.current = null;
    httpModeRef.current = false;
    stopKeepalive();
    for (const [id, pending] of pendingRef.current.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Local P2P disconnected"));
      pendingRef.current.delete(id);
    }
    setState(prev => ({ ...prev, isConnected: false, isAvailable: false, transport: null }));
  }, [stopKeepalive]);

  // Probe with caching — only probe known IP, skip full discovery if within cooldown
  const probeLocalServer = useCallback(async (ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<"ws" | "http" | null> => {
    return probeBothTransports(ip, timeoutMs);
  }, []);

  // Discover — with cooldown to prevent spamming
  const discoverLocalServer = useCallback(async (networkPrefix: string): Promise<string | null> => {
    const now = Date.now();
    if (now - lastDiscoveryRef.current < RECONNECT_COOLDOWN_MS) {
      console.log("[LocalP2P] Discovery cooldown active, skipping scan.");
      return null;
    }
    lastDiscoveryRef.current = now;

    const COMMON_PREFIXES = ["192.168.1", "192.168.0", "192.168.2", "10.0.0", "10.0.1"];
    const prefixes = networkPrefix ? [networkPrefix] : COMMON_PREFIXES;
    const prioritySuffixes = [".1", ".2", ".3", ".4", ".5", ".6", ".7", ".8", ".9", ".10", ".11", ".12", ".15", ".20", ".25", ".50", ".100", ".150", ".200", ".254"];

    for (const prefix of prefixes) {
      const probes = prioritySuffixes.map(async (suffix) => {
        const ip = prefix + suffix;
        const transport = await probeBothTransports(ip);
        return transport ? ip : null;
      });
      const results = await Promise.all(probes);
      const found = results.find(ip => ip !== null);
      if (found) {
        console.log(`[LocalP2P] Found server at ${found}`);
        return found;
      }
    }

    console.log("[LocalP2P] No server found");
    return null;
  }, []);

  // Connect — with lock to prevent concurrent attempts
  const connect = useCallback(async (pcIp: string): Promise<boolean> => {
    if (isConnectingRef.current) return false;
    if (wsRef.current?.readyState === WebSocket.OPEN && connectedIpRef.current === pcIp) return true;
    if (httpModeRef.current && connectedIpRef.current === pcIp) return true;

    isConnectingRef.current = true;

    // Cancel any pending disconnect
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }

    try {
      // If WS is blocked, use HTTP-only
      if (isWsBlocked()) {
        const httpOk = await probeHttpServer(pcIp, KNOWN_IP_TIMEOUT_MS);
        if (httpOk) {
          console.log(`[LocalP2P] ✅ Connected via HTTP to ${pcIp}:${LOCAL_P2P_HTTP_PORT}`);
          httpModeRef.current = true;
          saveKnownIp(pcIp);
          startKeepalive(pcIp);
          setState(prev => ({ ...prev, isAvailable: true, isConnected: true, pcIp, transport: "http" }));
          return true;
        }
        return false;
      }

      // Try WS first
      const connected = await new Promise<boolean>((resolve) => {
        let ws: WebSocket;
        try {
          ws = new WebSocket(`ws://${pcIp}:${LOCAL_P2P_PORT}/p2p`);
        } catch { resolve(false); return; }

        const timeoutId = window.setTimeout(() => { ws.close(); resolve(false); }, 3000);

        ws.onopen = () => {
          clearTimeout(timeoutId);
          console.log("[LocalP2P] ✅ WS connected!");
          wsRef.current = ws;
          httpModeRef.current = false;
          saveKnownIp(pcIp);
          startKeepalive(pcIp);
          setState(prev => ({ ...prev, isAvailable: true, isConnected: true, pcIp, transport: "ws" }));
          resolve(true);
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "pong") {
              const latency = Date.now() - lastPingRef.current;
              setState(prev => ({ ...prev, latency }));
              // Cancel any pending disconnect timer on successful pong
              if (disconnectTimerRef.current) {
                clearTimeout(disconnectTimerRef.current);
                disconnectTimerRef.current = null;
              }
            } else if ((msg.type === "command_result" || msg.type === "command_error") && msg.requestId) {
              const pending = pendingRef.current.get(String(msg.requestId));
              if (pending) {
                clearTimeout(pending.timeoutId);
                pendingRef.current.delete(String(msg.requestId));
                if (msg.type === "command_error") pending.reject(new Error(msg.error || "Command failed"));
                else pending.resolve(msg.result);
              }
            }
          } catch {}
        };

        ws.onclose = () => {
          // Don't immediately disconnect — use grace period
          if (wsRef.current === ws) {
            console.log("[LocalP2P] WS closed, starting grace period before disconnect...");
            if (!disconnectTimerRef.current) {
              disconnectTimerRef.current = window.setTimeout(() => {
                if (wsRef.current === ws || wsRef.current?.readyState !== WebSocket.OPEN) {
                  handleDisconnect();
                }
                disconnectTimerRef.current = null;
              }, CONNECTION_STABLE_MS);
            }
          }
        };

        ws.onerror = async () => {
          clearTimeout(timeoutId);
          // Try HTTP fallback
          const httpOk = await probeHttpServer(pcIp, KNOWN_IP_TIMEOUT_MS);
          if (httpOk) {
            httpModeRef.current = true;
            saveKnownIp(pcIp);
            startKeepalive(pcIp);
            setState(prev => ({ ...prev, isAvailable: true, isConnected: true, pcIp, transport: "http" }));
            resolve(true);
          } else {
            resolve(false);
          }
        };
      });

      if (!connected) {
        setState(prev => ({ ...prev, isAvailable: false, isConnected: false }));
      }
      return connected;
    } finally {
      isConnectingRef.current = false;
    }
  }, [saveKnownIp, startKeepalive, handleDisconnect]);

  // Disconnect explicitly
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    httpModeRef.current = false;
    stopKeepalive();
    for (const [id, pending] of pendingRef.current.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Local P2P disconnected"));
      pendingRef.current.delete(id);
    }
    setState(prev => ({ ...prev, isConnected: false, transport: null }));
  }, [stopKeepalive]);

  // Send command (fire-and-forget)
  const sendCommand = useCallback((commandType: string, payload: Record<string, unknown> = {}): boolean => {
    if (httpModeRef.current && state.pcIp) {
      httpCommand(state.pcIp, commandType, payload).catch(() => {});
      return true;
    }
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    try {
      wsRef.current.send(JSON.stringify({ type: "command", commandType, payload }));
      return true;
    } catch { return false; }
  }, [state.pcIp]);

  // Request/response command
  const invokeCommand = useCallback(
    async (commandType: string, payload: Record<string, unknown> = {}, timeoutMs = 30000) => {
      if (httpModeRef.current && state.pcIp) {
        return httpCommand(state.pcIp, commandType, payload, timeoutMs);
      }
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        throw new Error("Local P2P not connected");
      }
      const requestId = crypto.randomUUID();
      const promise = new Promise<any>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          pendingRef.current.delete(requestId);
          reject(new Error("Local P2P command timeout"));
        }, timeoutMs);
        pendingRef.current.set(requestId, { resolve, reject, timeoutId });
      });
      wsRef.current.send(JSON.stringify({ type: "command", requestId, commandType, payload }));
      return promise;
    },
    [state.pcIp]
  );

  const sendPing = useCallback(() => {
    if (httpModeRef.current && state.pcIp) {
      const start = Date.now();
      probeHttpServer(state.pcIp, 2000).then(() => {
        setState(prev => ({ ...prev, latency: Date.now() - start }));
      });
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      lastPingRef.current = Date.now();
      wsRef.current.send(JSON.stringify({ type: "ping", t: lastPingRef.current }));
    }
  }, [state.pcIp]);

  // Check and connect — with smart prioritization
  const checkAndConnect = useCallback(async (networkPrefix: string, knownPcIp?: string) => {
    // Already connected and stable? Just verify with a ping.
    if ((wsRef.current?.readyState === WebSocket.OPEN || httpModeRef.current) && connectedIpRef.current) {
      // Quick health check
      const transport = await probeBothTransports(connectedIpRef.current, 2000);
      if (transport) {
        setState(prev => ({ ...prev, lastCheckTime: Date.now() }));
        return; // Still connected, no need to re-discover
      }
      // Lost connection, fall through to reconnect
      console.log("[LocalP2P] Lost connection to known IP, re-discovering...");
    }

    // Try known IPs first (saved IP, provided IP, manual IP)
    const savedIp = getKnownIp();
    const manualIp = localStorage.getItem("jarvis_manual_pc_ip") || "";
    const ipsToTry = [...new Set([savedIp, knownPcIp, manualIp].filter(Boolean) as string[])];

    for (const ip of ipsToTry) {
      console.log(`[LocalP2P] Trying known IP ${ip}...`);
      const transport = await probeBothTransports(ip, KNOWN_IP_TIMEOUT_MS);
      if (transport) {
        const ok = await connect(ip);
        if (ok) {
          setState(prev => ({ ...prev, lastCheckTime: Date.now() }));
          return;
        }
      }
    }

    // Full discovery (with cooldown)
    const pcIp = await discoverLocalServer(networkPrefix);
    if (pcIp) {
      await connect(pcIp);
    } else {
      setState(prev => ({ ...prev, isAvailable: false, isConnected: false, lastCheckTime: Date.now() }));
    }
  }, [connect, discoverLocalServer, getKnownIp]);

  // Cleanup
  useEffect(() => {
    return () => {
      disconnect();
      stopKeepalive();
    };
  }, [disconnect, stopKeepalive]);

  return {
    state,
    connect,
    disconnect,
    sendCommand,
    invokeCommand,
    sendPing,
    checkAndConnect,
    discoverLocalServer,
    isReady: state.isConnected && (httpModeRef.current || wsRef.current?.readyState === WebSocket.OPEN),
  };
}
