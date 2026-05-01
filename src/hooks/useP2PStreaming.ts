/**
 * Provides P2P-aware WebSocket URLs for streaming (camera, screen, audio).
 * When local P2P is connected, returns ws://pcIp:9876/camera etc.
 * Otherwise falls back to cloud relay URLs.
 */

import { useMemo } from "react";
import { getFunctionsWsBase } from "@/lib/relay";
import { useDeviceSession } from "@/hooks/useDeviceSession";

interface P2PStreamingContext {
  /** True if local P2P is available for streaming */
  isP2P: boolean;
  pcIp: string | null;
  p2pPort: number;
  /** Get camera WS URL - uses P2P if available, otherwise cloud relay */
  getCameraUrl: (sessionId: string, opts: { fps: number; quality: number; cameraIndex?: number }) => string;
  /** Get screen WS URL */
  getScreenUrl: (sessionId: string, opts: { fps: number; quality: number; scale?: number; monitorIndex?: number }) => string;
  /** Get audio WS URL */
  getAudioUrl: (sessionId: string, opts: { direction: string; useSystemAudio?: boolean }) => string;
  /** Whether camera/screen commands should be skipped (P2P handles setup directly) */
  skipAgentCommand: boolean;
}

export function useP2PStreaming(): P2PStreamingContext {
  const { session } = useDeviceSession();
  const sessionToken = session?.session_token || "";

  // Check if local P2P is connected by reading state from localStorage/global.
  // Re-reads on every render so it picks up changes from useLocalP2P hook.
  const p2pState = useMemo(() => {
    const knownIp = localStorage.getItem("jarvis_p2p_known_ip");
    const p2pConnected = localStorage.getItem("jarvis_p2p_connected") === "true";
    return { ip: knownIp, connected: p2pConnected };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]); // Re-evaluate when session changes (proxy for connectivity change)

  // Also check if we're in a native app where ws:// is allowed
  const isNative = useMemo(() => {
    try {
      return !!(window as any).Capacitor?.isNativePlatform?.();
    } catch {
      return false;
    }
  }, []);

  const canUseWs = isNative || window.location.protocol !== "https:";
  const isP2P = !!(p2pState.connected && p2pState.ip && canUseWs);
  const pcIp = p2pState.ip;
  const p2pPort = 9876;

  const WS_BASE = getFunctionsWsBase();

  const getCameraUrl = useMemo(() => {
    return (sessionId: string, opts: { fps: number; quality: number; cameraIndex?: number }) => {
      if (isP2P && pcIp) {
        const params = new URLSearchParams({
          fps: String(opts.fps),
          quality: String(opts.quality),
          camera_index: String(opts.cameraIndex ?? 0),
        });
        return `ws://${pcIp}:${p2pPort}/camera?${params}`;
      }
      return `${WS_BASE}/functions/v1/camera-relay?sessionId=${sessionId}&type=pc&fps=${opts.fps}&quality=${opts.quality}&binary=true&session_token=${sessionToken}`;
    };
  }, [isP2P, pcIp, p2pPort, WS_BASE, sessionToken]);

  const getScreenUrl = useMemo(() => {
    return (sessionId: string, opts: { fps: number; quality: number; scale?: number; monitorIndex?: number }) => {
      if (isP2P && pcIp) {
        const params = new URLSearchParams({
          fps: String(opts.fps),
          quality: String(opts.quality),
          scale: String(opts.scale ?? 0.5),
          monitor_index: String(opts.monitorIndex ?? 1),
        });
        return `ws://${pcIp}:${p2pPort}/screen?${params}`;
      }
      return `${WS_BASE}/functions/v1/camera-relay?sessionId=${sessionId}&type=pc&fps=${opts.fps}&quality=${opts.quality}&binary=true&session_token=${sessionToken}`;
    };
  }, [isP2P, pcIp, p2pPort, WS_BASE, sessionToken]);

  const getAudioUrl = useMemo(() => {
    return (sessionId: string, opts: { direction: string; useSystemAudio?: boolean }) => {
      if (isP2P && pcIp) {
        const params = new URLSearchParams({
          direction: opts.direction,
          use_system_audio: String(opts.useSystemAudio ?? false),
        });
        return `ws://${pcIp}:${p2pPort}/audio?${params}`;
      }
      return `${WS_BASE}/functions/v1/audio-relay?sessionId=${sessionId}&type=phone&direction=${opts.direction}&session_token=${sessionToken}`;
    };
  }, [isP2P, pcIp, p2pPort, WS_BASE, sessionToken]);

  return {
    isP2P,
    pcIp,
    p2pPort,
    getCameraUrl,
    getScreenUrl,
    getAudioUrl,
    skipAgentCommand: isP2P, // When P2P, agent doesn't need separate start command
  };
}
