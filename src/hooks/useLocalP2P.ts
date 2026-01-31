import { useCallback, useRef, useState, useEffect } from "react";

export interface LocalP2PState {
  isAvailable: boolean;
  isConnected: boolean;
  pcIp: string | null;
  port: number;
  lastCheckTime: number;
  latency: number;
}

const LOCAL_P2P_PORT = 9876;
const PROBE_TIMEOUT_MS = 500; // Very short timeout for local network

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
  const probeTimeoutRef = useRef<number | null>(null);
  const lastPingRef = useRef<number>(0);
  const reconnectTimerRef = useRef<number | null>(null);

  // Probe a specific IP for local P2P server
  const probeLocalServer = useCallback(async (ip: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://${ip}:${LOCAL_P2P_PORT}/p2p`);
      const timeoutId = window.setTimeout(() => {
        ws.close();
        resolve(false);
      }, PROBE_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(timeoutId);
        ws.close();
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timeoutId);
        resolve(false);
      };
    });
  }, []);

  // Try to discover local P2P server by probing network IPs
  const discoverLocalServer = useCallback(async (networkPrefix: string): Promise<string | null> => {
    if (!networkPrefix) return null;

    console.log(`[LocalP2P] Discovering server on network ${networkPrefix}.*`);

    // Common PC IPs to try first (most likely)
    const prioritySuffixes = [".1", ".2", ".100", ".101", ".10", ".50", ".200", ".150", ".5"];
    
    // Try priority IPs first in parallel
    const priorityProbes = prioritySuffixes.map(async (suffix) => {
      const ip = networkPrefix + suffix;
      const available = await probeLocalServer(ip);
      return available ? ip : null;
    });

    const priorityResults = await Promise.all(priorityProbes);
    const foundPriority = priorityResults.find((ip) => ip !== null);
    
    if (foundPriority) {
      console.log(`[LocalP2P] Found server at ${foundPriority}`);
      return foundPriority;
    }

    // Extended scan - probe more IPs (2-254, excluding already tried)
    const triedSuffixes = new Set(prioritySuffixes.map(s => parseInt(s.slice(1))));
    
    // Scan in batches of 10 to avoid overwhelming network
    for (let batch = 0; batch < 5; batch++) {
      const start = batch * 10 + 1;
      const end = start + 10;
      const batchProbes: Promise<string | null>[] = [];
      
      for (let i = start; i < end && i <= 50; i++) {
        if (triedSuffixes.has(i)) continue;
        const ip = `${networkPrefix}.${i}`;
        batchProbes.push(
          probeLocalServer(ip).then(available => available ? ip : null)
        );
      }
      
      const batchResults = await Promise.all(batchProbes);
      const foundBatch = batchResults.find((ip) => ip !== null);
      if (foundBatch) {
        console.log(`[LocalP2P] Found server at ${foundBatch}`);
        return foundBatch;
      }
    }

    console.log("[LocalP2P] No server found on network");
    return null;
  }, [probeLocalServer]);

  // Connect to local P2P WebSocket server
  const connect = useCallback(async (pcIp: string): Promise<boolean> => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return true;
    }

    return new Promise((resolve) => {
      console.log(`[LocalP2P] Connecting to ws://${pcIp}:${LOCAL_P2P_PORT}/p2p`);
      const ws = new WebSocket(`ws://${pcIp}:${LOCAL_P2P_PORT}/p2p`);

      const timeoutId = window.setTimeout(() => {
        ws.close();
        resolve(false);
      }, 2000);

      ws.onopen = () => {
        clearTimeout(timeoutId);
        console.log("[LocalP2P] ✅ Connected to local P2P server!");
        wsRef.current = ws;
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
          }
        } catch {}
      };

      ws.onclose = () => {
        wsRef.current = null;
        setState((prev) => ({
          ...prev,
          isConnected: false,
        }));
      };

      ws.onerror = () => {
        clearTimeout(timeoutId);
        setState((prev) => ({
          ...prev,
          isAvailable: false,
          isConnected: false,
        }));
        resolve(false);
      };
    });
  }, []);

  // Disconnect from local P2P server
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      isConnected: false,
    }));
  }, []);

  // Send command through local P2P
  const sendCommand = useCallback((commandType: string, payload: Record<string, unknown> = {}): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      wsRef.current.send(JSON.stringify({
        type: "command",
        commandType,
        payload,
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  // Send ping for latency measurement
  const sendPing = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      lastPingRef.current = Date.now();
      wsRef.current.send(JSON.stringify({ type: "ping", t: lastPingRef.current }));
    }
  }, []);

  // Check availability and connect if possible
  const checkAndConnect = useCallback(async (networkPrefix: string, knownPcIp?: string) => {
    // If we have a known PC IP, try that first
    if (knownPcIp) {
      const available = await probeLocalServer(knownPcIp);
      if (available) {
        await connect(knownPcIp);
        setState((prev) => ({ ...prev, lastCheckTime: Date.now() }));
        return;
      }
    }

    // Otherwise discover
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
      if (probeTimeoutRef.current) {
        clearTimeout(probeTimeoutRef.current);
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    sendCommand,
    sendPing,
    checkAndConnect,
    discoverLocalServer,
    isReady: state.isConnected && wsRef.current?.readyState === WebSocket.OPEN,
  };
}
