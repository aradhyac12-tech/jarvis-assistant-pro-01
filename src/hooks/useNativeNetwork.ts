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
    const candidates: string[] = [];

    try {
      pc = new RTCPeerConnection({ iceServers: [] });
    } catch {
      resolve(null);
      return;
    }

    pc.createDataChannel("");

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      pc?.close();
      // Prefer private LAN IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
      // over CGNAT (100.64.x.x), loopback, or link-local
      const isPrivate = (ip: string) =>
        ip.startsWith("192.168.") ||
        ip.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
      const privateIp = candidates.find(isPrivate);
      resolve(privateIp || candidates[0] || null);
    };

    const timeout = setTimeout(finish, 2500);

    pc.onicecandidate = (e) => {
      if (resolved) return;
      if (!e.candidate) {
        // Gathering complete
        finish();
        return;
      }
      const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match && !match[1].startsWith("0.") && match[1] !== "0.0.0.0" && !match[1].startsWith("127.")) {
        candidates.push(match[1]);
      }
    };

    pc.createOffer()
      .then(offer => pc?.setLocalDescription(offer))
      .catch(() => {
        if (!resolved) { resolved = true; clearTimeout(timeout); pc?.close(); resolve(null); }
      });
  });
}
