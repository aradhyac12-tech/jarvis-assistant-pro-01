import { useCallback, useRef, useState, useEffect } from "react";

export interface LocalP2PState {
  isAvailable: boolean;
  isConnected: boolean;
  pcIp: string | null;
  port: number;
  lastCheckTime: number;
  latency: number;
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: number;
};

const LOCAL_P2P_PORT = 9876;
const LOCAL_P2P_HTTP_PORT = 9877; // HTTP API port (WS port + 1)
const PROBE_TIMEOUT_MS = 1200; // Increased for reliability on slower LANs
const KNOWN_IP_TIMEOUT_MS = 2500; // Extra time for known PC IP

function isNativeApp(): boolean {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/** Returns true if ws:// connections are blocked (HTTPS browser, not native) */
function isWsBlocked(): boolean {
  if (window.location.protocol !== "https:") return false;
  if (isNativeApp()) return false;
  return true;
}

/**
 * Check if HTTP-based P2P is available.
 * CapacitorHttp routes fetch() through native, bypassing mixed-content.
 * So even on HTTPS, fetch("http://LAN_IP:9877/ping") works in the APK.
 */
function canUseHttpP2P(): boolean {
  if (window.location.protocol !== "https:") return true;
  // In Capacitor with CapacitorHttp, fetch is native — mixed content OK
  if (isNativeApp()) return true;
  return false;
}

/** Probe an IP via HTTP GET (works with CapacitorHttp in APK) */
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

/** Probe via WS with configurable timeout */
function probeWsServer(ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://${ip}:${LOCAL_P2P_PORT}/p2p`);
      const timeoutId = window.setTimeout(() => {
        ws.close();
        resolve(false);
      }, timeoutMs);
      ws.onopen = () => { clearTimeout(timeoutId); ws.close(); resolve(true); };
      ws.onerror = () => { clearTimeout(timeoutId); resolve(false); };
    } catch { resolve(false); }
  });
}

/** Try both WS and HTTP probes in parallel, return true if either succeeds */
async function probeBothTransports(ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const results = await Promise.all([
    probeWsServer(ip, timeoutMs),
    probeHttpServer(ip, timeoutMs),
  ]);
  return results.some(Boolean);
}

/** Send a command via HTTP POST (fallback when WS is blocked) */
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
 * Hook for detecting and connecting to the local P2P WebSocket server
 * running on the Python agent (localhost:9876 when on same network).
 */
export function useLocalP2P() {
  const [state, setState] = useState<LocalP2PState>({
    isAvailable: false,
    isConnected: false,
    pcIp: null,
    port: LOCAL_P2P_PORT,
    lastCheckTime: 0,
    latency: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const httpModeRef = useRef<boolean>(false); // true = using HTTP fallback instead of WS
  const probeTimeoutRef = useRef<number | null>(null);
  const lastPingRef = useRef<number>(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());

  // Probe a specific IP for local P2P server (try both WS + HTTP in parallel)
  const probeLocalServer = useCallback(async (ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> => {
    return probeBothTransports(ip, timeoutMs);
  }, []);

  // Try to discover local P2P server by probing network IPs
  // Enhanced: also tries common LAN prefixes if provided prefix is empty (APK fallback)
  const discoverLocalServer = useCallback(async (networkPrefix: string): Promise<string | null> => {
    // Common LAN prefixes to try when we don't have the phone's prefix
    const COMMON_LAN_PREFIXES = [
      "192.168.1",
      "192.168.0",
      "192.168.2",
      "10.0.0",
      "10.0.1",
      "172.16.0",
    ];

    // Prefixes to scan - if provided, use it; otherwise scan common ones
    const prefixesToScan = networkPrefix ? [networkPrefix] : COMMON_LAN_PREFIXES;

    console.log(`[LocalP2P] Discovering server on prefixes:`, prefixesToScan);

    // Common PC IPs to try first — covers DHCP ranges on most routers
    const prioritySuffixes = [".1", ".2", ".3", ".4", ".5", ".6", ".7", ".8", ".9", ".10", ".11", ".12", ".15", ".20", ".25", ".30", ".50", ".100", ".101", ".102", ".150", ".200", ".254"];

    for (const prefix of prefixesToScan) {
      // Try priority IPs first in parallel
      const priorityProbes = prioritySuffixes.map(async (suffix) => {
        const ip = prefix + suffix;
        const available = await probeLocalServer(ip);
        return available ? ip : null;
      });

      const priorityResults = await Promise.all(priorityProbes);
      const foundPriority = priorityResults.find((ip) => ip !== null);
      
      if (foundPriority) {
        console.log(`[LocalP2P] Found server at ${foundPriority}`);
        return foundPriority;
      }
    }

    // Extended scan on the first prefix only (avoid too many probes)
    const primaryPrefix = prefixesToScan[0];
    if (!primaryPrefix) {
      console.log("[LocalP2P] No prefix available for extended scan");
      return null;
    }

    const triedSuffixes = new Set(prioritySuffixes.map((s) => parseInt(s.slice(1), 10)));
    const BATCH_SIZE = 30;
    const MAX_IP = 254;

    for (let start = 1; start <= MAX_IP; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE - 1, MAX_IP);
      const batchProbes: Promise<string | null>[] = [];

      for (let i = start; i <= end; i++) {
        if (triedSuffixes.has(i)) continue;
        const ip = `${primaryPrefix}.${i}`;
        batchProbes.push(probeLocalServer(ip).then((available) => (available ? ip : null)));
      }

      const batchResults = await Promise.all(batchProbes);
      const foundBatch = batchResults.find((ip) => ip !== null);
      if (foundBatch) {
        console.log(`[LocalP2P] Found server at ${foundBatch}`);
        return foundBatch;
      }
    }

    console.log("[LocalP2P] No server found on any network");
    return null;
  }, [probeLocalServer]);

  // Connect to local P2P WebSocket server
  const connect = useCallback(async (pcIp: string): Promise<boolean> => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return true;
    }

    // If WS is blocked, use HTTP-only mode
    if (isWsBlocked()) {
      // Verify HTTP probe works
      const httpOk = await probeHttpServer(pcIp);
      if (httpOk) {
        console.log(`[LocalP2P] ✅ Connected via HTTP fallback to ${pcIp}:${LOCAL_P2P_HTTP_PORT}`);
        httpModeRef.current = true;
        setState((prev) => ({
          ...prev,
          isAvailable: true,
          isConnected: true,
          pcIp,
        }));
        return true;
      }
      return false;
    }

    return new Promise((resolve) => {
      console.log(`[LocalP2P] Connecting to ws://${pcIp}:${LOCAL_P2P_PORT}/p2p`);
      let ws: WebSocket;
      try {
        ws = new WebSocket(`ws://${pcIp}:${LOCAL_P2P_PORT}/p2p`);
      } catch {
        resolve(false);
        return;
      }

      const timeoutId = window.setTimeout(() => {
        ws.close();
        resolve(false);
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeoutId);
        console.log("[LocalP2P] ✅ Connected to local P2P server!");
        wsRef.current = ws;
        httpModeRef.current = false;
        setState((prev) => ({
          ...prev,
          isAvailable: true,
          isConnected: true,
          pcIp,
        }));
        resolve(true);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "pong") {
            const latency = Date.now() - lastPingRef.current;
            setState((prev) => ({ ...prev, latency }));
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
        wsRef.current = null;
        for (const [id, pending] of pendingRef.current.entries()) {
          clearTimeout(pending.timeoutId);
          pending.reject(new Error("Local P2P disconnected"));
          pendingRef.current.delete(id);
        }
        setState((prev) => ({ ...prev, isConnected: false }));
      };

      ws.onerror = async () => {
        clearTimeout(timeoutId);
        // WS failed — try HTTP fallback before giving up
        console.log(`[LocalP2P] WS failed, trying HTTP fallback to ${pcIp}:${LOCAL_P2P_HTTP_PORT}...`);
        const httpOk = await probeHttpServer(pcIp, KNOWN_IP_TIMEOUT_MS);
        if (httpOk) {
          console.log(`[LocalP2P] ✅ Connected via HTTP fallback to ${pcIp}:${LOCAL_P2P_HTTP_PORT}`);
          httpModeRef.current = true;
          setState((prev) => ({
            ...prev,
            isAvailable: true,
            isConnected: true,
            pcIp,
          }));
          resolve(true);
        } else {
          setState((prev) => ({ ...prev, isAvailable: false, isConnected: false }));
          resolve(false);
        }
      };
    });
  }, []);

  // Disconnect from local P2P server
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    httpModeRef.current = false;

    for (const [id, pending] of pendingRef.current.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Local P2P disconnected"));
      pendingRef.current.delete(id);
    }

    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

  // Send command through local P2P (fire-and-forget)
  const sendCommand = useCallback((commandType: string, payload: Record<string, unknown> = {}): boolean => {
    // HTTP mode: fire-and-forget via fetch
    if (httpModeRef.current && state.pcIp) {
      httpCommand(state.pcIp, commandType, payload).catch(() => {});
      return true;
    }
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      wsRef.current.send(JSON.stringify({ type: "command", commandType, payload }));
      return true;
    } catch {
      return false;
    }
  }, [state.pcIp]);

  // Request/response style command invocation
  const invokeCommand = useCallback(
    async (commandType: string, payload: Record<string, unknown> = {}, timeoutMs = 30000) => {
      // HTTP mode: use fetch
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

  // Send ping for latency measurement
  const sendPing = useCallback(() => {
    if (httpModeRef.current && state.pcIp) {
      const start = Date.now();
      probeHttpServer(state.pcIp, 2000).then(() => {
        setState((prev) => ({ ...prev, latency: Date.now() - start }));
      });
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      lastPingRef.current = Date.now();
      wsRef.current.send(JSON.stringify({ type: "ping", t: lastPingRef.current }));
    }
  }, [state.pcIp]);

  // Check availability and connect if possible
  const checkAndConnect = useCallback(async (networkPrefix: string, knownPcIp?: string) => {
    // Also check manual IP from localStorage
    const manualIp = localStorage.getItem("jarvis_manual_pc_ip") || "";
    const ipsToTry = [knownPcIp, manualIp].filter(Boolean) as string[];

    // Try known IPs first with generous timeout
    for (const ip of ipsToTry) {
      console.log(`[LocalP2P] Probing known IP ${ip} with ${KNOWN_IP_TIMEOUT_MS}ms timeout...`);
      const available = await probeLocalServer(ip, KNOWN_IP_TIMEOUT_MS);
      if (available) {
        console.log(`[LocalP2P] ✅ Known IP ${ip} responded!`);
        await connect(ip);
        setState((prev) => ({ ...prev, lastCheckTime: Date.now() }));
        return;
      }
      console.log(`[LocalP2P] ❌ Known IP ${ip} did not respond`);
    }

    // Fall back to full discovery
    const pcIp = await discoverLocalServer(networkPrefix);
    if (pcIp) {
      await connect(pcIp);
    } else {
      setState((prev) => ({
        ...prev,
        isAvailable: false,
        isConnected: false,
        lastCheckTime: Date.now(),
      }));
    }
  }, [probeLocalServer, discoverLocalServer, connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
      if (probeTimeoutRef.current) clearTimeout(probeTimeoutRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [disconnect]);

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
