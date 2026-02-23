import { useCallback } from "react";

/**
 * Native network info detection for Capacitor APK.
 * Falls back gracefully in browser.
 */
export function useNativeNetwork() {
  const getLocalIp = useCallback(async (): Promise<string | null> => {
    // Try Capacitor Network plugin first
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        // In native, we can use the Network plugin or a custom plugin
        // For now, use WebRTC ICE candidate trick which works in WebView too
        return await getIpViaWebRTC();
      }
    } catch {}
    
    // Fallback to WebRTC
    return getIpViaWebRTC();
  }, []);

  return { getLocalIp };
}

async function getIpViaWebRTC(): Promise<string | null> {
  return new Promise((resolve) => {
    let pc: RTCPeerConnection | null = null;
    let resolved = false;

    try {
      pc = new RTCPeerConnection({ iceServers: [] });
    } catch {
      resolve(null);
      return;
    }

    pc.createDataChannel("");

    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; pc?.close(); resolve(null); }
    }, 2000);

    pc.onicecandidate = (e) => {
      if (resolved || !e.candidate) return;
      const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match && !match[1].startsWith("0.") && match[1] !== "0.0.0.0") {
        resolved = true;
        clearTimeout(timeout);
        pc?.close();
        resolve(match[1]);
      }
    };

    pc.createOffer()
      .then(offer => pc?.setLocalDescription(offer))
      .catch(() => {
        if (!resolved) { resolved = true; clearTimeout(timeout); pc?.close(); resolve(null); }
      });
  });
}
