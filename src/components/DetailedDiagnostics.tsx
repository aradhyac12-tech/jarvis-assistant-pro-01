import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  Activity,
  Wifi,
  Server,
  Mic,
  Camera,
  Monitor,
  Smartphone,
  Gauge,
  Zap,
  Eye,
  Volume2,
  ImageOff,
  Timer,
  Signal,
  HardDrive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFunctionsWsBase } from "@/lib/relay";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { supabase } from "@/integrations/supabase/client";
import { addLog } from "@/components/IssueLog";

interface DiagIssue {
  id: string;
  category: "connectivity" | "quality" | "performance" | "hardware" | "config";
  severity: "info" | "warning" | "error" | "success";
  title: string;
  message: string;
  fix?: string;
  details?: string;
}

type DiagMode = "audio" | "phone-camera" | "pc-camera" | "screen-mirror";

const CATEGORY_ICONS: Record<DiagIssue["category"], React.ReactNode> = {
  connectivity: <Wifi className="h-3.5 w-3.5" />,
  quality: <Eye className="h-3.5 w-3.5" />,
  performance: <Gauge className="h-3.5 w-3.5" />,
  hardware: <HardDrive className="h-3.5 w-3.5" />,
  config: <Server className="h-3.5 w-3.5" />,
};

const MODE_LABELS: Record<DiagMode, string> = {
  "audio": "Audio Relay",
  "phone-camera": "Phone Camera",
  "pc-camera": "PC Camera",
  "screen-mirror": "Screen Mirror",
};

export function DetailedDiagnostics({
  mode,
  className,
  currentFps,
  currentLatency,
  currentQuality,
  isStreamActive,
}: {
  mode: DiagMode;
  className?: string;
  currentFps?: number;
  currentLatency?: number;
  currentQuality?: number;
  isStreamActive?: boolean;
}) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [autoFixLog, setAutoFixLog] = useState<string[]>([]);
  const [issues, setIssues] = useState<DiagIssue[]>([]);

  const WS_BASE = getFunctionsWsBase();

  const addIssue = useCallback((issue: DiagIssue) => {
    setIssues(prev => [...prev, issue]);
  }, []);

  const runCommonChecks = useCallback(async () => {
    // 1. Config check
    const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? "";
    if (!projectRef) {
      addIssue({
        id: "config_missing",
        category: "config",
        severity: "error",
        title: "Missing Project Configuration",
        message: "VITE_SUPABASE_PROJECT_ID is not set",
        fix: "Ensure your .env file contains the correct project ID",
      });
    } else {
      addIssue({
        id: "config_ok",
        category: "config",
        severity: "success",
        title: "Project Config Valid",
        message: `Project: ${projectRef.slice(0, 8)}...`,
      });
    }

    // 2. WebSocket URL check
    const wsBase = getFunctionsWsBase();
    if (!wsBase.includes("functions.supabase.co")) {
      addIssue({
        id: "ws_url_warn",
        category: "config",
        severity: "warning",
        title: "Non-Standard WebSocket URL",
        message: `Using: ${wsBase}`,
        fix: "WebSocket should use the functions subdomain for reliable streaming",
      });
    }

    // 3. Device online check
    if (!selectedDevice?.is_online) {
      addIssue({
        id: "device_offline",
        category: "connectivity",
        severity: "error",
        title: "PC Agent Offline",
        message: "Your PC agent is not connected",
        fix: "Start jarvis_agent.py on your PC and ensure it's paired",
      });
      return false;
    }

    // 4. Agent ping
    try {
      const start = Date.now();
      const pingResult = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 5000 });
      const pingTime = Date.now() - start;
      
      if (pingResult?.success) {
        addIssue({
          id: "agent_ping",
          category: "connectivity",
          severity: pingTime > 3000 ? "warning" : "success",
          title: "PC Agent Responsive",
          message: `Response time: ${pingTime}ms`,
          fix: pingTime > 3000 ? "Agent is slow to respond. Check CPU load on PC." : undefined,
        });
      } else {
        addIssue({
          id: "agent_ping",
          category: "connectivity",
          severity: "error",
          title: "Agent Not Responding",
          message: "Ping command failed",
          fix: "Restart the Python agent on your PC",
        });
        return false;
      }
    } catch {
      addIssue({
        id: "agent_ping",
        category: "connectivity",
        severity: "error",
        title: "Agent Unreachable",
        message: "Could not reach PC agent",
        fix: "Restart the agent and check network connectivity",
      });
      return false;
    }

    // 5. Relay health
    const relayEndpoint = mode === "audio" ? "audio-relay" : "camera-relay";
    try {
      const { data, error } = await supabase.functions.invoke(relayEndpoint, { method: "GET" });
      if (error) throw error;
      addIssue({
        id: "relay_health",
        category: "connectivity",
        severity: "success",
        title: "Relay Service Online",
        message: `${data?.activeSessions ?? 0} active sessions`,
      });
    } catch (err) {
      addIssue({
        id: "relay_health",
        category: "connectivity",
        severity: "error",
        title: "Relay Service Unavailable",
        message: err instanceof Error ? err.message : "Connection failed",
        fix: `Check if ${relayEndpoint} edge function is deployed`,
      });
      return false;
    }

    // 6. WebSocket connection test
    try {
      const testUrl = mode === "audio"
        ? `${WS_BASE}/functions/v1/audio-relay?sessionId=diag-${Date.now()}&type=phone&direction=phone_to_pc`
        : `${WS_BASE}/functions/v1/camera-relay?sessionId=diag-${Date.now()}&type=pc&fps=10&quality=50&binary=true`;
      
      const ws = new WebSocket(testUrl);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { ws.close(); reject(new Error("Timeout (5s)")); }, 5000);
        ws.onopen = () => { clearTimeout(t); ws.close(); resolve(); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("Connection refused")); };
      });
      addIssue({
        id: "ws_test",
        category: "connectivity",
        severity: "success",
        title: "WebSocket Connection OK",
        message: "Browser can connect to relay",
      });
    } catch (e) {
      addIssue({
        id: "ws_test",
        category: "connectivity",
        severity: "error",
        title: "WebSocket Connection Failed",
        message: e instanceof Error ? e.message : "Failed",
        fix: "Check firewall/network settings. Try a different network.",
      });
    }

    return true;
  }, [addIssue, sendCommand, selectedDevice, WS_BASE, mode]);

  const runQualityChecks = useCallback(() => {
    // Live quality analysis based on current metrics
    if (isStreamActive) {
      // FPS analysis
      if (currentFps !== undefined) {
        if (currentFps === 0) {
          addIssue({
            id: "fps_zero",
            category: "performance",
            severity: "error",
            title: "No Frames Received",
            message: "FPS is 0 — no data arriving",
            fix: "The stream may have disconnected. Stop and restart the stream.",
          });
        } else if (currentFps < 10) {
          addIssue({
            id: "fps_low",
            category: "performance",
            severity: "warning",
            title: "Very Low FPS",
            message: `Current: ${currentFps} FPS`,
            fix: "Lower the JPEG quality to reduce frame size. Check PC CPU usage. Try 'Low Bandwidth' preset.",
            details: "Low FPS is usually caused by: large frame sizes exceeding relay limits (400KB cap), slow PC capture, or network congestion.",
          });
        } else if (currentFps < 25) {
          addIssue({
            id: "fps_medium",
            category: "performance",
            severity: "info",
            title: "Moderate FPS",
            message: `Current: ${currentFps} FPS — acceptable but could be smoother`,
            fix: "Try the 'Balanced' preset (30 FPS, 70% quality) for better results.",
          });
        } else {
          addIssue({
            id: "fps_good",
            category: "performance",
            severity: "success",
            title: "Good FPS",
            message: `Current: ${currentFps} FPS`,
          });
        }
      }

      // Latency analysis
      if (currentLatency !== undefined) {
        if (currentLatency > 500) {
          addIssue({
            id: "latency_high",
            category: "performance",
            severity: "error",
            title: "Very High Latency",
            message: `${currentLatency}ms between frames`,
            fix: "Reduce quality/FPS settings. The relay or network is overloaded. Try 15 FPS with 50% quality.",
            details: "High latency means frames take too long to travel from PC → relay → phone. This is typically a bandwidth bottleneck.",
          });
        } else if (currentLatency > 200) {
          addIssue({
            id: "latency_medium",
            category: "performance",
            severity: "warning",
            title: "Elevated Latency",
            message: `${currentLatency}ms — noticeable delay`,
            fix: "Lower quality to reduce frame size. Each frame must stay under 400KB for the relay.",
          });
        } else if (currentLatency > 0) {
          addIssue({
            id: "latency_ok",
            category: "performance",
            severity: "success",
            title: "Low Latency",
            message: `${currentLatency}ms — good responsiveness`,
          });
        }
      }

      // Quality setting analysis
      if (currentQuality !== undefined) {
        if (currentQuality > 85) {
          addIssue({
            id: "quality_too_high",
            category: "quality",
            severity: "warning",
            title: "Quality Setting Very High",
            message: `JPEG quality at ${currentQuality}% — frames may exceed 400KB relay limit`,
            fix: "The PC agent auto-downgrades quality when frames exceed 400KB. If quality isn't changing, it's because the agent is already at the cap. Try 70% for best balance.",
            details: "The relay has a 400KB per-frame limit. At high quality, frames are large and the agent automatically steps down quality presets (ultra→high→medium→low) to stay under the limit. This is why your slider changes may not visually improve quality.",
          });
        } else if (currentQuality < 30) {
          addIssue({
            id: "quality_low",
            category: "quality",
            severity: "info",
            title: "Low Quality Setting",
            message: `JPEG quality at ${currentQuality}% — image will be blurry`,
            fix: "Increase quality to 50-70% for better clarity. Only use low quality on very slow connections.",
          });
        }
      }
    } else {
      addIssue({
        id: "stream_inactive",
        category: "performance",
        severity: "info",
        title: "Stream Not Active",
        message: "Start the stream first to get real-time quality metrics",
      });
    }
  }, [isStreamActive, currentFps, currentLatency, currentQuality, addIssue]);

  const runAudioSpecificChecks = useCallback(async () => {
    // Mic permission
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      stream.getTracks().forEach(t => t.stop());
      addIssue({
        id: "mic_perm",
        category: "hardware",
        severity: "success",
        title: "Microphone Access Granted",
        message: `${settings.sampleRate ?? "Unknown"}Hz, ${settings.channelCount ?? 1}ch`,
      });
    } catch (e) {
      const err = e instanceof Error ? e.name : "Unknown";
      addIssue({
        id: "mic_perm",
        category: "hardware",
        severity: "error",
        title: "Microphone Access Denied",
        message: err,
        fix: err === "NotAllowedError"
          ? "Grant microphone permission in browser settings"
          : "Check that a microphone is connected and not in use by another app",
      });
    }

    // Agent audio support
    try {
      const result = await sendCommand("check_audio_support", {}, { awaitResult: true, timeoutMs: 8000 });
      if (result.success && result.result) {
        const info = result.result as { has_pyaudio?: boolean; has_websockets?: boolean };
        if (info.has_pyaudio && info.has_websockets) {
          addIssue({
            id: "agent_audio",
            category: "hardware",
            severity: "success",
            title: "PC Audio Support OK",
            message: "pyaudio + websockets installed",
          });
        } else {
          const missing = [!info.has_pyaudio && "pyaudio", !info.has_websockets && "websockets"].filter(Boolean);
          addIssue({
            id: "agent_audio",
            category: "hardware",
            severity: "error",
            title: "Missing Audio Packages",
            message: `Missing: ${missing.join(", ")}`,
            fix: `Run: pip install ${missing.join(" ")}`,
          });
        }
      }
    } catch {
      addIssue({
        id: "agent_audio",
        category: "hardware",
        severity: "warning",
        title: "Could Not Verify Audio Support",
        message: "Agent didn't respond to audio check",
      });
    }

    // Audio quality issues
    addIssue({
      id: "audio_sample_rate",
      category: "quality",
      severity: "info",
      title: "Audio Format: 16kHz PCM",
      message: "Both phone and PC use standardized 16kHz mono Int16 format",
      details: "If audio sounds distorted, ensure both sides use the same sample rate. The browser requests 16kHz but may get a different rate depending on hardware.",
    });
  }, [sendCommand, addIssue]);

  const runPhoneCameraChecks = useCallback(async () => {
    // Camera permission
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      stream.getTracks().forEach(t => t.stop());
      addIssue({
        id: "cam_perm",
        category: "hardware",
        severity: "success",
        title: "Camera Access Granted",
        message: `${settings.width}×${settings.height} @ ${settings.frameRate?.toFixed(0) ?? "?"}fps`,
      });
    } catch (e) {
      const err = e instanceof Error ? e.name : "Unknown";
      addIssue({
        id: "cam_perm",
        category: "hardware",
        severity: "error",
        title: "Camera Access Denied",
        message: err,
        fix: err === "NotAllowedError"
          ? "Grant camera permission in browser/app settings"
          : err === "NotReadableError"
          ? "Camera is in use by another app. Close it and retry."
          : "Check camera hardware connection",
      });
    }

    // Check available cameras
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === "videoinput");
      addIssue({
        id: "cam_count",
        category: "hardware",
        severity: cameras.length > 0 ? "success" : "warning",
        title: `${cameras.length} Camera(s) Found`,
        message: cameras.map(c => c.label || "Unnamed").join(", "),
      });
    } catch {
      addIssue({
        id: "cam_count",
        category: "hardware",
        severity: "warning",
        title: "Could Not Enumerate Cameras",
        message: "Browser may not support device enumeration",
      });
    }
  }, [addIssue]);

  const runPcCameraChecks = useCallback(async () => {
    // List PC cameras
    try {
      const result = await sendCommand("get_cameras", {}, { awaitResult: true, timeoutMs: 12000 });
      if (result.success && result.result) {
        const cameras = (result.result as { cameras?: Array<{ index: number; name: string }> })?.cameras;
        if (cameras && cameras.length > 0) {
          addIssue({
            id: "pc_cameras",
            category: "hardware",
            severity: "success",
            title: `${cameras.length} PC Camera(s) Detected`,
            message: cameras.map(c => c.name).join(", "),
          });
        } else {
          addIssue({
            id: "pc_cameras",
            category: "hardware",
            severity: "error",
            title: "No PC Cameras Found",
            message: "OpenCV could not detect any cameras",
            fix: "Connect a webcam to your PC. Ensure opencv-python is installed: pip install opencv-python",
          });
        }
      }
    } catch {
      addIssue({
        id: "pc_cameras",
        category: "hardware",
        severity: "warning",
        title: "Camera Detection Failed",
        message: "Agent didn't respond to camera list request",
      });
    }

    // Streaming stats
    try {
      const statsResult = await sendCommand("get_streaming_stats", {}, { awaitResult: true, timeoutMs: 8000 });
      if (statsResult?.success && statsResult?.result) {
        const stats = statsResult.result as {
          camera?: { frame_count?: number; running?: boolean; last_error?: string; fps?: number; bytes_sent?: number };
        };
        if (stats.camera) {
          if (stats.camera.last_error) {
            addIssue({
              id: "cam_agent_error",
              category: "quality",
              severity: "error",
              title: "Agent Camera Error",
              message: stats.camera.last_error,
              fix: "Check if the camera is being used by another application",
            });
          }
          if (stats.camera.running && stats.camera.frame_count === 0) {
            addIssue({
              id: "cam_no_frames",
              category: "quality",
              severity: "error",
              title: "Camera Running But No Frames",
              message: "Agent reports camera is running but 0 frames sent",
              fix: "Camera may be blocked or producing blank frames. Try a different camera index.",
            });
          }
          if (stats.camera.bytes_sent && stats.camera.frame_count) {
            const avgFrameSize = stats.camera.bytes_sent / stats.camera.frame_count;
            if (avgFrameSize > 350000) {
              addIssue({
                id: "cam_frame_size",
                category: "quality",
                severity: "warning",
                title: "Large Frame Size",
                message: `Average: ${(avgFrameSize / 1024).toFixed(0)}KB per frame`,
                fix: "Frames near the 400KB relay limit. Agent auto-downgrades quality. Lower your quality setting to avoid dropped frames.",
                details: "The relay caps frames at 400KB. When exceeded, the agent steps down quality presets automatically. This is why changing quality in the UI may not visually improve the image — the agent overrides it to stay under the cap.",
              });
            }
          }
        }
      }
    } catch {
      addIssue({
        id: "cam_stats",
        category: "performance",
        severity: "info",
        title: "Streaming Stats Unavailable",
        message: "Could not fetch agent stats (agent may not support this command)",
      });
    }
  }, [sendCommand, addIssue]);

  const runScreenMirrorChecks = useCallback(async () => {
    // Screen streaming stats
    try {
      const statsResult = await sendCommand("get_streaming_stats", {}, { awaitResult: true, timeoutMs: 8000 });
      if (statsResult?.success && statsResult?.result) {
        const stats = statsResult.result as {
          screen?: { frame_count?: number; running?: boolean; last_error?: string; fps?: number; bytes_sent?: number; resolution?: string };
        };
        if (stats.screen) {
          if (stats.screen.last_error) {
            addIssue({
              id: "screen_error",
              category: "quality",
              severity: "error",
              title: "Screen Capture Error",
              message: stats.screen.last_error,
              fix: "Check if screen capture permissions are granted on PC",
            });
          }
          if (stats.screen.resolution) {
            addIssue({
              id: "screen_res",
              category: "quality",
              severity: "info",
              title: "Capture Resolution",
              message: stats.screen.resolution,
              details: "The agent captures at 50% scale by default to keep frame sizes manageable. Increase scale for sharper output (at the cost of bandwidth).",
            });
          }
          if (stats.screen.bytes_sent && stats.screen.frame_count) {
            const avgSize = stats.screen.bytes_sent / stats.screen.frame_count;
            addIssue({
              id: "screen_frame_size",
              category: "quality",
              severity: avgSize > 350000 ? "warning" : "success",
              title: "Avg Frame Size",
              message: `${(avgSize / 1024).toFixed(0)}KB`,
              fix: avgSize > 350000 ? "Frames near 400KB cap. Lower quality or scale." : undefined,
            });
          }
        } else {
          addIssue({
            id: "screen_no_stats",
            category: "performance",
            severity: "info",
            title: "No Screen Stats",
            message: "Screen streaming stats not available from agent",
          });
        }
      }
    } catch {
      addIssue({
        id: "screen_stats",
        category: "performance",
        severity: "info",
        title: "Stats Unavailable",
        message: "Could not retrieve streaming stats from agent",
      });
    }

    // Quality explanation
    addIssue({
      id: "quality_explanation",
      category: "quality",
      severity: "info",
      title: "Why Quality Settings May Not Change Visually",
      message: "The agent has adaptive quality management",
      fix: "The PC agent caps each frame at 400KB. If your quality setting produces larger frames, the agent automatically reduces quality to fit. To see sharper output: lower the FPS (fewer frames = more bandwidth per frame) or reduce capture scale.",
      details: "Quality presets: Ultra (95%, full scale) → High (80%, 0.8x) → Medium (60%, 0.6x) → Low (40%, 0.5x). The agent cycles down until frames fit under the relay's 400KB limit.",
    });
  }, [sendCommand, addIssue]);

  const runDiagnostics = useCallback(async () => {
    setIssues([]);
    setIsRunning(true);
    setAutoFixLog([]);

    const agentOk = await runCommonChecks();
    runQualityChecks();

    if (agentOk) {
      switch (mode) {
        case "audio":
          await runAudioSpecificChecks();
          break;
        case "phone-camera":
          await runPhoneCameraChecks();
          break;
        case "pc-camera":
          await runPcCameraChecks();
          break;
        case "screen-mirror":
          await runScreenMirrorChecks();
          break;
      }
    }

    setIsRunning(false);
    addLog("info", "web", `${MODE_LABELS[mode]} diagnostics complete`);
  }, [mode, runCommonChecks, runQualityChecks, runAudioSpecificChecks, runPhoneCameraChecks, runPcCameraChecks, runScreenMirrorChecks]);

  // ============== AUTO-FIX ENGINE ==============
  const autoFixIssues = useCallback(async () => {
    const errors = issues.filter(i => i.severity === "error" || i.severity === "warning");
    if (errors.length === 0) return;

    setIsAutoFixing(true);
    const log: string[] = [];

    for (const issue of errors) {
      log.push(`🔍 Analyzing: ${issue.title}`);
      setAutoFixLog([...log]);

      try {
        // Agent offline - try ping to wake it up
        if (issue.id === "device_offline" || issue.id === "agent_ping") {
          log.push("↻ Attempting to reach agent with ping...");
          setAutoFixLog([...log]);
          try {
            const ping = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 8000 });
            if (ping?.success) {
              log.push("✅ Agent is now responding!");
            } else {
              log.push("❌ Agent still unreachable. Please start jarvis_agent.py on your PC.");
            }
          } catch {
            log.push("❌ Agent unreachable. Ensure the Python agent is running.");
          }
        }

        // WebSocket connection failed
        else if (issue.id === "ws_test") {
          log.push("↻ Retrying WebSocket connection...");
          setAutoFixLog([...log]);
          const WS_BASE_LOCAL = getFunctionsWsBase();
          const testUrl = mode === "audio"
            ? `${WS_BASE_LOCAL}/functions/v1/audio-relay?sessionId=autofix-${Date.now()}&type=phone&direction=phone_to_pc`
            : `${WS_BASE_LOCAL}/functions/v1/camera-relay?sessionId=autofix-${Date.now()}&type=pc&fps=10&quality=50&binary=true`;
          try {
            const ws = new WebSocket(testUrl);
            await new Promise<void>((resolve, reject) => {
              const t = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 8000);
              ws.onopen = () => { clearTimeout(t); ws.close(); resolve(); };
              ws.onerror = () => { clearTimeout(t); reject(new Error("Refused")); };
            });
            log.push("✅ WebSocket connection succeeded on retry!");
          } catch {
            log.push("⚠️ WebSocket still failing. This may be a network/firewall issue.");
            log.push("💡 Try: Switch to mobile data, or use the Capacitor APK which bypasses mixed-content restrictions.");
          }
        }

        // Relay unavailable
        else if (issue.id === "relay_health") {
          log.push("↻ Checking relay health again...");
          setAutoFixLog([...log]);
          const relayEndpoint = mode === "audio" ? "audio-relay" : "camera-relay";
          try {
            const { error } = await supabase.functions.invoke(relayEndpoint, { method: "GET" });
            if (!error) {
              log.push("✅ Relay is now online!");
            } else {
              log.push("❌ Relay still down. The backend function may need redeployment.");
            }
          } catch {
            log.push("❌ Cannot reach relay service.");
          }
        }

        // FPS issues
        else if (issue.id === "fps_zero" || issue.id === "fps_low") {
          log.push("↻ Attempting to restart stream with lower quality...");
          setAutoFixLog([...log]);
          try {
            await sendCommand("update_camera_settings", { fps: 15, quality: 40 }, { awaitResult: true, timeoutMs: 5000 });
            log.push("✅ Sent lower quality settings (15fps, 40% quality) to agent.");
          } catch {
            log.push("⚠️ Could not update settings. Try stopping and restarting the stream.");
          }
        }

        // Quality too high
        else if (issue.id === "quality_too_high" || issue.id === "cam_frame_size") {
          log.push("↻ Reducing quality to avoid 400KB frame cap...");
          setAutoFixLog([...log]);
          try {
            await sendCommand("update_camera_settings", { quality: 50 }, { awaitResult: true, timeoutMs: 5000 });
            log.push("✅ Quality reduced to 50%.");
          } catch {
            log.push("⚠️ Could not send quality update.");
          }
        }

        // High latency
        else if (issue.id === "latency_high" || issue.id === "latency_medium") {
          log.push("↻ Reducing FPS to improve latency...");
          setAutoFixLog([...log]);
          try {
            await sendCommand("update_camera_settings", { fps: 10, quality: 50 }, { awaitResult: true, timeoutMs: 5000 });
            log.push("✅ Reduced to 10fps, 50% quality for better latency.");
          } catch {
            log.push("⚠️ Could not apply fix.");
          }
        }

        // Mic permission
        else if (issue.id === "mic_perm" && issue.severity === "error") {
          log.push("💡 Microphone access denied. You need to grant permission in your browser/app settings.");
          log.push("📱 On mobile: Settings → Site Settings → Microphone → Allow");
        }

        // Camera permission
        else if (issue.id === "cam_perm" && issue.severity === "error") {
          log.push("💡 Camera access denied. Grant permission in browser/app settings.");
          log.push("📱 On mobile: Settings → Site Settings → Camera → Allow");
        }

        // Missing packages
        else if (issue.id === "agent_audio" && issue.severity === "error") {
          log.push("💡 Missing Python packages on PC. Run on your PC terminal:");
          log.push("   pip install pyaudio websockets");
        }

        // Generic with fix text
        else if (issue.fix) {
          log.push(`💡 Suggested fix: ${issue.fix}`);
        } else {
          log.push("ℹ️ No automatic fix available for this issue.");
        }
      } catch (err) {
        log.push(`❌ Auto-fix error: ${err instanceof Error ? err.message : String(err)}`);
      }

      setAutoFixLog([...log]);
    }

    log.push("");
    log.push("🔄 Re-running diagnostics to verify fixes...");
    setAutoFixLog([...log]);
    
    // Re-run diagnostics after fixes
    setIssues([]);
    const agentOk2 = await runCommonChecks();
    runQualityChecks();
    if (agentOk2) {
      switch (mode) {
        case "audio": await runAudioSpecificChecks(); break;
        case "phone-camera": await runPhoneCameraChecks(); break;
        case "pc-camera": await runPcCameraChecks(); break;
        case "screen-mirror": await runScreenMirrorChecks(); break;
      }
    }

    log.push("✅ Auto-fix complete.");
    setAutoFixLog([...log]);
    setIsAutoFixing(false);
  }, [issues, sendCommand, mode, runCommonChecks, runQualityChecks, runAudioSpecificChecks, runPhoneCameraChecks, runPcCameraChecks, runScreenMirrorChecks]);

  const errorCount = issues.filter(i => i.severity === "error").length;
  const warnCount = issues.filter(i => i.severity === "warning").length;
  const successCount = issues.filter(i => i.severity === "success").length;

  const getSeverityIcon = (severity: DiagIssue["severity"]) => {
    switch (severity) {
      case "success": return <CheckCircle2 className="h-3.5 w-3.5 text-primary" />;
      case "error": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "warning": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
      case "info": return <Signal className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const getSeverityBg = (severity: DiagIssue["severity"]) => {
    switch (severity) {
      case "success": return "bg-primary/5 border-primary/20";
      case "error": return "bg-destructive/5 border-destructive/20";
      case "warning": return "bg-yellow-500/5 border-yellow-500/20";
      case "info": return "bg-muted/30 border-border/30";
    }
  };

  // Group issues by category
  const groupedIssues = issues.reduce<Record<string, DiagIssue[]>>((acc, issue) => {
    if (!acc[issue.category]) acc[issue.category] = [];
    acc[issue.category].push(issue);
    return acc;
  }, {});

  const categoryLabels: Record<string, string> = {
    connectivity: "Connectivity",
    quality: "Quality & Resolution",
    performance: "Performance & FPS",
    hardware: "Hardware & Permissions",
    config: "Configuration",
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between h-10 px-3 bg-secondary/30 hover:bg-secondary/50"
        >
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Detailed Diagnostics</span>
          </div>
          <div className="flex items-center gap-2">
            {issues.length > 0 && (
              <div className="flex items-center gap-1">
                {errorCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-destructive text-destructive">
                    {errorCount} err
                  </Badge>
                )}
                {warnCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-yellow-500 text-yellow-500">
                    {warnCount} warn
                  </Badge>
                )}
                {errorCount === 0 && warnCount === 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary text-primary">
                    All OK
                  </Badge>
                )}
              </div>
            )}
            <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="rounded-lg border border-border/50 bg-secondary/10 p-3 space-y-3">
          <Button
            onClick={runDiagnostics}
            disabled={isRunning}
            size="sm"
            className="w-full"
            variant={issues.length > 0 && errorCount === 0 ? "outline" : "default"}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing {MODE_LABELS[mode]}...
              </>
            ) : (
              <>
                <Activity className="h-4 w-4 mr-2" />
                {issues.length === 0 ? `Diagnose ${MODE_LABELS[mode]}` : "Run Again"}
              </>
            )}
          </Button>

          {/* Auto-Fix Button */}
          {issues.length > 0 && (errorCount > 0 || warnCount > 0) && (
            <Button
              onClick={autoFixIssues}
              disabled={isAutoFixing || isRunning}
              size="sm"
              className="w-full"
              variant="outline"
            >
              {isAutoFixing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Auto-Fixing Issues...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Auto-Fix {errorCount + warnCount} Issue{errorCount + warnCount > 1 ? "s" : ""}
                </>
              )}
            </Button>
          )}

          {/* Auto-Fix Log */}
          {autoFixLog.length > 0 && (
            <div className="p-2.5 rounded-md border border-border/50 bg-muted/20 text-xs font-mono space-y-0.5 max-h-48 overflow-y-auto">
              {autoFixLog.map((line, i) => (
                <p key={i} className={cn(
                  "text-muted-foreground",
                  line.startsWith("✅") && "text-primary",
                  line.startsWith("❌") && "text-destructive",
                )}>{line}</p>
              ))}
            </div>
          )}

          {issues.length > 0 && (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-4">
                {Object.entries(groupedIssues).map(([category, categoryIssues]) => (
                  <div key={category} className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {CATEGORY_ICONS[category as DiagIssue["category"]]}
                      {categoryLabels[category] ?? category}
                    </div>
                    {categoryIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className={cn(
                          "p-2.5 rounded-md border text-xs space-y-1",
                          getSeverityBg(issue.severity)
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {getSeverityIcon(issue.severity)}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{issue.title}</div>
                            <p className="text-muted-foreground">{issue.message}</p>
                            {issue.details && (
                              <p className="text-muted-foreground/70 mt-1 text-[11px] leading-relaxed">
                                {issue.details}
                              </p>
                            )}
                            {issue.fix && (
                              <div className="flex items-start gap-1.5 mt-1.5 p-1.5 bg-primary/5 rounded border border-primary/20">
                                <Zap className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                                <span className="text-primary">{issue.fix}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Quick tips */}
          {issues.length === 0 && !isRunning && (
            <div className="p-2.5 bg-muted/20 rounded-md text-xs text-muted-foreground space-y-1">
              <p><strong>What this checks:</strong></p>
              <p>• Connectivity: relay, WebSocket, agent ping time</p>
              <p>• Quality: frame size limits, quality auto-downgrade</p>
              <p>• Performance: FPS, latency, bandwidth issues</p>
              <p>• Hardware: permissions, device detection</p>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}