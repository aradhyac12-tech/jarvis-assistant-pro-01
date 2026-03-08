import { useState, useRef, useCallback, useEffect } from "react";
import { getFunctionsWsBase } from "@/lib/relay";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useP2PStreaming } from "@/hooks/useP2PStreaming";
import { useToast } from "@/hooks/use-toast";
import { addLog } from "@/components/IssueLog";

export interface CameraReceiverState {
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

export interface CameraReceiverOptions {
  fps?: number;
  quality?: number;
  cameraIndex?: number;
  testPattern?: boolean;
}

export function useCameraReceiver() {
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const p2pStreaming = useP2PStreaming();
  const { toast } = useToast();

  const [state, setState] = useState<CameraReceiverState>({
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
    async (options: CameraReceiverOptions = {}) => {
      const { fps = 30, quality = 70, cameraIndex = 0, testPattern = false } = options;

      // Check for session token
      if (!session?.session_token) {
        const errorMsg = "Not paired. Please connect your PC first.";
        setState((prev) => ({ ...prev, error: errorMsg }));
        toast({ title: "Camera Error", description: errorMsg, variant: "destructive" });
        return false;
      }

      cleanup();

      const sessionId = crypto.randomUUID();
      setState((prev) => ({ ...prev, sessionId, error: null }));

      // Use P2P streaming if available for direct connection
      const useP2P = p2pStreaming.isP2P && !testPattern;
      const wsUrl = p2pStreaming.getCameraUrl(sessionId, { fps, quality, cameraIndex });

      addLog("info", "web", `Camera connecting via ${useP2P ? "P2P" : "cloud relay"}...`);

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

            if (currentBlobUrlRef.current) {
              URL.revokeObjectURL(currentBlobUrlRef.current);
            }
            currentBlobUrlRef.current = newUrl;

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
            if (data.type === "camera_frame" && data.data) {
              setState((prev) => ({
                ...prev,
                frame: `data:image/jpeg;base64,${data.data}`,
                frameCount: prev.frameCount + 1,
              }));
            } else if (data.type === "peer_connected") {
              setState((prev) => ({ ...prev, peerConnected: true }));
              addLog("info", "agent", "Camera peer connected");
            } else if (data.type === "peer_disconnected") {
              setState((prev) => ({ ...prev, peerConnected: false }));
              addLog("warn", "agent", "Camera peer disconnected");
            } else if (data.type === "error" && data.message) {
              setState((prev) => ({ ...prev, error: data.message }));
              addLog("error", "agent", `Camera relay error: ${data.message}`);
            }
          }
        } catch (e) {
          console.debug("Camera frame parse issue:", e);
        }
      };

      ws.onopen = () => {
        setState((prev) => ({ ...prev, active: true, wsConnected: true, error: null, viaP2P: useP2P }));
        addLog("info", "web", `Camera WebSocket connected ${useP2P ? "(P2P direct)" : "(cloud relay)"}`);
      };

      ws.onerror = () => {
        addLog("error", "web", "Camera WebSocket error");
      };

      ws.onclose = () => {
        cleanup();
        addLog("info", "web", "Camera WebSocket closed");
      };

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

      // When using P2P, the agent streams directly — no need for separate command
      if (!useP2P) {
        const commandType = testPattern ? "start_test_pattern" : "start_camera_stream";
        const payload = testPattern
          ? { session_id: sessionId, fps, quality }
          : { session_id: sessionId, camera_index: cameraIndex, fps, quality };

        const started = await sendCommand(commandType, payload, {
          awaitResult: true,
          timeoutMs: 20000,
        });

        if (!started.success) {
          const msg = typeof started.error === "string" ? started.error : "PC failed to start camera";
          setState((prev) => ({ ...prev, error: msg }));
          addLog("error", "agent", `Camera open failed: ${msg}`);
          toast({ title: "Camera Error", description: msg, variant: "destructive" });
          cleanup();
          return false;
        }
      }

      addLog("info", "agent", testPattern ? "Test pattern started" : `PC camera opened ${useP2P ? "(P2P)" : "(relay)"}`);
      toast({ title: testPattern ? "Test Pattern Started" : `Camera Started ${useP2P ? "(P2P)" : ""}` });
      return true;
    },
    [sendCommand, toast, cleanup, p2pStreaming]
  );

  const stop = useCallback(async () => {
    await sendCommand("stop_camera_stream", {});
    cleanup();
    toast({ title: "Camera Stopped" });
  }, [sendCommand, cleanup, toast]);

  const updateSettings = useCallback(
    async (fps: number, quality: number) => {
      if (!state.active) return;
      await sendCommand("update_camera_settings", { fps, quality });
      addLog("info", "web", `Updated camera settings: FPS=${fps}, Quality=${quality}`);
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
