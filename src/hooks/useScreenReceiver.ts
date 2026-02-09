import { useState, useRef, useCallback, useEffect } from "react";
import { getFunctionsWsBase } from "@/lib/relay";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
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
  });

  const wsRef = useRef<WebSocket | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const fpsCounterRef = useRef({ frames: 0, lastCheck: Date.now() });
  const frameTimesRef = useRef<number[]>([]);

  const WS_BASE = getFunctionsWsBase();
  const CAMERA_WS_URL = `${WS_BASE}/functions/v1/camera-relay`;

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
      addLog("info", "web", `Starting screen receiver (session: ${sessionId.slice(0, 8)}...)`);

      // 1) Connect receiver FIRST with session_token for authentication
      const ws = new WebSocket(
        `${CAMERA_WS_URL}?sessionId=${sessionId}&type=pc&fps=${fps}&quality=${quality}&binary=true&session_token=${session.session_token}`
      );
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

            if (currentBlobUrlRef.current) {
              URL.revokeObjectURL(currentBlobUrlRef.current);
            }
            currentBlobUrlRef.current = newUrl;

            // Track latency
            frameTimesRef.current.push(now);
            if (frameTimesRef.current.length > 10) {
              frameTimesRef.current.shift();
            }
            let latency = 0;
            if (frameTimesRef.current.length >= 2) {
              const gaps: number[] = [];
              for (let i = 1; i < frameTimesRef.current.length; i++) {
                gaps.push(frameTimesRef.current[i] - frameTimesRef.current[i - 1]);
              }
              latency = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
            }

            // Track FPS
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
            }));
            return;
          }

          // Handle JSON messages
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
              addLog("info", "agent", "Screen peer connected");
            } else if (data.type === "peer_disconnected") {
              setState((prev) => ({ ...prev, peerConnected: false }));
              addLog("warn", "agent", "Screen peer disconnected");
            } else if (data.type === "error" && data.message) {
              setState((prev) => ({ ...prev, error: data.message }));
              addLog("error", "agent", `Screen relay error: ${data.message}`);
            }
          }
        } catch (e) {
          console.debug("Screen frame parse issue:", e);
        }
      };

      ws.onopen = () => {
        setState((prev) => ({ ...prev, active: true, wsConnected: true, error: null }));
        addLog("info", "web", "Screen WebSocket connected");
      };

      ws.onerror = () => {
        addLog("error", "web", "Screen WebSocket error");
      };

      ws.onclose = () => {
        cleanup();
        addLog("info", "web", "Screen WebSocket closed");
      };

      // Wait for WS to open
      await new Promise<void>((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) return resolve();
        const t = window.setTimeout(() => {
          ws.close();
          reject(new Error("WebSocket connection timeout"));
        }, 8000);
        ws.addEventListener("open", () => { window.clearTimeout(t); resolve(); }, { once: true });
        ws.addEventListener("error", () => { window.clearTimeout(t); reject(new Error("WebSocket error")); }, { once: true });
      }).catch((err) => {
        setState((prev) => ({ ...prev, error: err.message }));
        throw err;
      });

      // 2) Tell PC agent to start sending
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

      addLog("info", "agent", testPattern ? "Test pattern (screen) started" : "PC screen stream started");
      toast({ title: testPattern ? "Test Pattern Started" : "Screen Mirroring Started", description: `Streaming at up to ${fps} FPS` });
      return true;
    },
    [CAMERA_WS_URL, sendCommand, toast, cleanup]
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
