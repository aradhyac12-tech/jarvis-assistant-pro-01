import { useState, useRef, useCallback, useEffect } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useP2PStreaming } from "@/hooks/useP2PStreaming";
import { useToast } from "@/hooks/use-toast";
import { addLog } from "@/components/IssueLog";

export interface ScreenReceiverState {
  active: boolean;
  frame: string | null;
  fps: number;
  latency: number;
  frameCount: number;
  error: string | null;
  wsConnected: boolean;
  peerConnected: boolean;
  sessionId: string | null;
  viaP2P: boolean;
}

export interface ScreenReceiverOptions {
  fps?: number;
  quality?: number;
  scale?: number;
  monitorIndex?: number;
  testPattern?: boolean;
}

export function useScreenReceiver() {
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const p2pStreaming = useP2PStreaming();
  const { toast } = useToast();

  const [state, setState] = useState<ScreenReceiverState>({
    active: false,
    frame: null,
    fps: 0,
    latency: 0,
    frameCount: 0,
    error: null,
    wsConnected: false,
    peerConnected: false,
    sessionId: null,
    viaP2P: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const fpsCounterRef = useRef({ frames: 0, lastCheck: Date.now() });
  const frameTimesRef = useRef<number[]>([]);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  const cleanup = useCallback(() => {
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    fpsCounterRef.current = { frames: 0, lastCheck: Date.now() };
    frameTimesRef.current = [];
    setState((prev) => ({
      ...prev,
      active: false,
      frame: null,
      fps: 0,
      latency: 0,
      frameCount: 0,
      wsConnected: false,
      peerConnected: false,
      sessionId: null,
    }));
  }, []);

  const start = useCallback(
    async (options: ScreenReceiverOptions = {}) => {
      const { fps = 30, quality = 70, scale = 0.5, monitorIndex = 1, testPattern = false } = options;

      // Check for session token
      if (!session?.session_token) {
        const errorMsg = "Not paired. Please connect your PC first.";
        setState((prev) => ({ ...prev, error: errorMsg }));
        toast({ title: "Screen Error", description: errorMsg, variant: "destructive" });
        return false;
      }

      cleanup();

      const sessionId = crypto.randomUUID();
      setState((prev) => ({ ...prev, sessionId, error: null }));

      const useP2P = p2pStreaming.isP2P && !testPattern;
      
      addLog("info", "web", `Screen connecting via ${useP2P ? "P2P" : "cloud relay"}...`);

      const wsUrl = p2pStreaming.getScreenUrl(sessionId, { fps, quality, scale, monitorIndex });
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onmessage = async (event) => {
        const now = Date.now();
        try {
          let arrayBuffer: ArrayBuffer | null = null;
          if (event.data instanceof ArrayBuffer) {
            arrayBuffer = event.data;
          } else if (event.data instanceof Blob && event.data.size > 0) {
            arrayBuffer = await event.data.arrayBuffer();
          }

          if (arrayBuffer && arrayBuffer.byteLength > 100) {
            const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
            const newUrl = URL.createObjectURL(blob);
            if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
            currentBlobUrlRef.current = newUrl;

            frameTimesRef.current.push(now);
            if (frameTimesRef.current.length > 10) frameTimesRef.current.shift();
            let latency = 0;
            if (frameTimesRef.current.length >= 2) {
              const gaps: number[] = [];
              for (let i = 1; i < frameTimesRef.current.length; i++) gaps.push(frameTimesRef.current[i] - frameTimesRef.current[i - 1]);
              latency = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
            }

            fpsCounterRef.current.frames++;
            const elapsed = now - fpsCounterRef.current.lastCheck;
            let currentFps = 0;
            if (elapsed >= 1000) {
              currentFps = Math.round((fpsCounterRef.current.frames * 1000) / elapsed);
              fpsCounterRef.current = { frames: 0, lastCheck: now };
            }

            setState((prev) => ({
              ...prev,
              frame: newUrl,
              frameCount: prev.frameCount + 1,
              latency,
              fps: currentFps || prev.fps,
              viaP2P: useP2P,
            }));
            return;
          }

          if (typeof event.data === "string") {
            const data = JSON.parse(event.data);
            if (data.type === "screen_frame" && data.data) {
              setState((prev) => ({
                ...prev,
                frame: `data:image/jpeg;base64,${data.data}`,
                frameCount: prev.frameCount + 1,
              }));
            } else if (data.type === "peer_connected") {
              setState((prev) => ({ ...prev, peerConnected: true }));
            } else if (data.type === "peer_disconnected") {
              setState((prev) => ({ ...prev, peerConnected: false }));
            } else if (data.type === "error" && data.message) {
              setState((prev) => ({ ...prev, error: data.message }));
            }
          }
        } catch (e) {
          console.debug("Screen frame parse issue:", e);
        }
      };

      ws.onopen = () => {
        setState((prev) => ({ ...prev, active: true, wsConnected: true, error: null, viaP2P: useP2P }));
        addLog("info", "web", `Screen WebSocket connected ${useP2P ? "(P2P direct)" : "(cloud relay)"}`);
      };

      ws.onerror = () => { addLog("error", "web", "Screen WebSocket error"); };
      ws.onclose = () => { cleanup(); addLog("info", "web", "Screen WebSocket closed"); };

      try {
        await new Promise<void>((resolve, reject) => {
          if (ws.readyState === WebSocket.OPEN) return resolve();
          const t = window.setTimeout(() => { ws.close(); reject(new Error("WebSocket connection timeout")); }, 10000);
          ws.addEventListener("open", () => { window.clearTimeout(t); resolve(); }, { once: true });
          ws.addEventListener("error", () => { window.clearTimeout(t); reject(new Error("WebSocket error")); }, { once: true });
        });
        retryCountRef.current = 0;
      } catch (err: any) {
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          addLog("warn", "web", `Screen WS failed, retrying (${retryCountRef.current}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, 1500 * retryCountRef.current));
          return start(options);
        }
        setState((prev) => ({ ...prev, error: err.message }));
        throw err;
      }

      // When using P2P, agent streams directly — no separate command needed
      if (!useP2P) {
        const commandType = testPattern ? "start_test_pattern" : "start_screen_stream";
        const payload = testPattern
          ? { session_id: sessionId, fps, quality, mode: "screen" }
          : { session_id: sessionId, fps, quality, scale, monitor_index: monitorIndex };

        const started = await sendCommand(commandType, payload, {
          awaitResult: true,
          timeoutMs: 15000,
        });

        if (!started.success) {
          const msg = typeof started.error === "string" ? started.error : "Failed to start screen stream";
          setState((prev) => ({ ...prev, error: msg }));
          addLog("error", "agent", msg);
          toast({ title: "Screen Error", description: msg, variant: "destructive" });
          cleanup();
          return false;
        }
      }

      addLog("info", "agent", `Screen stream started ${useP2P ? "(P2P)" : "(relay)"}`);
      toast({ title: `Screen Mirroring Started ${useP2P ? "(P2P)" : ""}`, description: `Streaming at up to ${fps} FPS` });
      return true;
    },
    [sendCommand, toast, cleanup, p2pStreaming]
  );

  const stop = useCallback(async () => {
    await sendCommand("stop_screen_stream", {});
    cleanup();
    toast({ title: "Screen Mirroring Stopped" });
  }, [sendCommand, cleanup, toast]);

  const updateSettings = useCallback(
    async (fps: number, quality: number, scale?: number) => {
      if (!state.active) return;
      await sendCommand("update_screen_settings", { fps, quality, scale });
      addLog("info", "web", `Updated screen settings: FPS=${fps}, Quality=${quality}${scale ? `, Scale=${scale}` : ""}`);
    },
    [state.active, sendCommand]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    state,
    start,
    stop,
    updateSettings,
  };
}
