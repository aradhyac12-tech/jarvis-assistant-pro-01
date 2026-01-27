import { useState, useEffect, useCallback, useRef } from "react";

export interface NetworkInfo {
  localIp: string;
  networkPrefix: string;
  connectionType: "wifi" | "cellular" | "ethernet" | "unknown";
  isOnline: boolean;
}

export interface NetworkState {
  phone: NetworkInfo | null;
  pc: NetworkInfo | null;
  sameNetwork: boolean;
  lastChecked: number;
}

/**
 * Continuous network monitoring for P2P auto-switching.
 * Detects when phone and PC are on same network and triggers mode changes.
 * 
 * OPTIMIZED: Caches phone IP and reuses single RTCPeerConnection to prevent
 * "Cannot create so many PeerConnections" errors.
 */
export function useNetworkMonitor(checkIntervalMs = 5000) {
  const [networkState, setNetworkState] = useState<NetworkState>({
    phone: null,
    pc: null,
    sameNetwork: false,
    lastChecked: 0,
  });
  
  const [isMonitoring, setIsMonitoring] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const prevSameNetwork = useRef<boolean>(false);
  const onNetworkChangeRef = useRef<((sameNetwork: boolean) => void) | null>(null);
  
  // Cache phone network info to avoid creating RTCPeerConnection every check
  const cachedPhoneInfoRef = useRef<NetworkInfo | null>(null);
  const lastPhoneCheckRef = useRef<number>(0);
  const PHONE_CACHE_DURATION_MS = 30000; // Only re-detect phone IP every 30 seconds
  const isGettingPhoneInfoRef = useRef(false); // Prevent concurrent calls

  // Get phone's local IP using WebRTC (works in browsers) - with caching
  const getPhoneNetworkInfo = useCallback(async (): Promise<NetworkInfo | null> => {
    // Return cached if still valid
    const now = Date.now();
    if (
      cachedPhoneInfoRef.current &&
      now - lastPhoneCheckRef.current < PHONE_CACHE_DURATION_MS &&
      cachedPhoneInfoRef.current.isOnline === navigator.onLine
    ) {
      return cachedPhoneInfoRef.current;
    }

    // Prevent concurrent RTCPeerConnection creation
    if (isGettingPhoneInfoRef.current) {
      return cachedPhoneInfoRef.current;
    }

    try {
      isGettingPhoneInfoRef.current = true;
      
      // Check online status
      const isOnline = navigator.onLine;
      if (!isOnline) {
        const offlineInfo = { localIp: "", networkPrefix: "", connectionType: "unknown" as const, isOnline: false };
        cachedPhoneInfoRef.current = offlineInfo;
        lastPhoneCheckRef.current = now;
        return offlineInfo;
      }

      // Detect connection type
      let connectionType: NetworkInfo["connectionType"] = "unknown";
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (connection?.type) {
        const type = connection.type.toLowerCase();
        if (type.includes("wifi")) connectionType = "wifi";
        else if (type.includes("cellular") || type.includes("mobile")) connectionType = "cellular";
        else if (type.includes("ethernet")) connectionType = "ethernet";
      }

      // Use WebRTC to get local IP (single instance with proper cleanup)
      const result = await new Promise<NetworkInfo>((resolve) => {
        let pc: RTCPeerConnection | null = null;
        
        try {
          pc = new RTCPeerConnection({ iceServers: [] });
        } catch (err) {
          console.debug("[NetworkMonitor] Failed to create RTCPeerConnection:", err);
          resolve({ localIp: "", networkPrefix: "", connectionType, isOnline });
          return;
        }
        
        pc.createDataChannel("");
        
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            pc?.close();
            resolve({ localIp: "", networkPrefix: "", connectionType, isOnline });
          }
        }, 1500);

        pc.onicecandidate = (e) => {
          if (resolved) return;
          if (!e.candidate) return;
          
          const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (match && !match[1].startsWith("0.")) {
            resolved = true;
            clearTimeout(timeout);
            pc?.close();
            
            const ip = match[1];
            const parts = ip.split(".");
            const prefix = parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}` : "";
            
            resolve({ localIp: ip, networkPrefix: prefix, connectionType, isOnline });
          }
        };

        pc.createOffer()
          .then((offer) => pc?.setLocalDescription(offer))
          .catch(() => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              pc?.close();
              resolve({ localIp: "", networkPrefix: "", connectionType, isOnline });
            }
          });
      });

      cachedPhoneInfoRef.current = result;
      lastPhoneCheckRef.current = now;
      return result;
    } catch (err) {
      console.debug("[NetworkMonitor] Failed to get phone network info:", err);
      return cachedPhoneInfoRef.current;
    } finally {
      isGettingPhoneInfoRef.current = false;
    }
  }, []);

  // Check network status
  const checkNetwork = useCallback(async (pcInfo?: NetworkInfo) => {
    const phoneInfo = await getPhoneNetworkInfo();
    
    if (!phoneInfo) {
      setNetworkState((prev) => ({ ...prev, phone: null, sameNetwork: false, lastChecked: Date.now() }));
      return;
    }

    // Compare network prefixes
    const sameNetwork = !!(
      phoneInfo.networkPrefix &&
      pcInfo?.networkPrefix &&
      phoneInfo.networkPrefix === pcInfo.networkPrefix &&
      phoneInfo.isOnline
    );

    setNetworkState({
      phone: phoneInfo,
      pc: pcInfo || null,
      sameNetwork,
      lastChecked: Date.now(),
    });

    // Trigger callback on change
    if (sameNetwork !== prevSameNetwork.current) {
      console.log(`[NetworkMonitor] Network change: ${prevSameNetwork.current ? "P2P" : "Cloud"} → ${sameNetwork ? "P2P" : "Cloud"}`);
      prevSameNetwork.current = sameNetwork;
      onNetworkChangeRef.current?.(sameNetwork);
    }
  }, [getPhoneNetworkInfo]);

  // Update PC info from agent response
  const updatePcInfo = useCallback((info: NetworkInfo) => {
    setNetworkState((prev) => {
      const sameNetwork = !!(
        prev.phone?.networkPrefix &&
        info.networkPrefix &&
        prev.phone.networkPrefix === info.networkPrefix &&
        prev.phone.isOnline
      );

      if (sameNetwork !== prevSameNetwork.current) {
        console.log(`[NetworkMonitor] Network change (PC update): ${prevSameNetwork.current ? "P2P" : "Cloud"} → ${sameNetwork ? "P2P" : "Cloud"}`);
        prevSameNetwork.current = sameNetwork;
        setTimeout(() => onNetworkChangeRef.current?.(sameNetwork), 0);
      }

      return { ...prev, pc: info, sameNetwork, lastChecked: Date.now() };
    });
  }, []);

  // Set callback for network changes
  const onNetworkChange = useCallback((callback: (sameNetwork: boolean) => void) => {
    onNetworkChangeRef.current = callback;
  }, []);

  // Start/stop monitoring
  const startMonitoring = useCallback(() => {
    if (intervalRef.current) return;
    setIsMonitoring(true);
    
    // Initial check
    checkNetwork();
    
    // Periodic checks
    intervalRef.current = window.setInterval(() => {
      checkNetwork(networkState.pc || undefined);
    }, checkIntervalMs);
  }, [checkNetwork, checkIntervalMs, networkState.pc]);

  const stopMonitoring = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsMonitoring(false);
  }, []);

  // Listen for browser online/offline events
  useEffect(() => {
    const handleOnline = () => {
      console.log("[NetworkMonitor] Browser went online");
      checkNetwork(networkState.pc || undefined);
    };
    
    const handleOffline = () => {
      console.log("[NetworkMonitor] Browser went offline");
      setNetworkState((prev) => ({
        ...prev,
        phone: prev.phone ? { ...prev.phone, isOnline: false } : null,
        sameNetwork: false,
        lastChecked: Date.now(),
      }));
      onNetworkChangeRef.current?.(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for connection changes (WiFi/cellular switch)
    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener("change", handleOnline);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (connection) {
        connection.removeEventListener("change", handleOnline);
      }
    };
  }, [checkNetwork, networkState.pc]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    networkState,
    isMonitoring,
    startMonitoring,
    stopMonitoring,
    checkNetwork,
    updatePcInfo,
    onNetworkChange,
  };
}
