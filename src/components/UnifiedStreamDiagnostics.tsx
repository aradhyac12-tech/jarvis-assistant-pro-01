import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Play,
  Zap,
  Camera,
  Monitor,
  Wifi,
  Server,
  Mic,
  Smartphone,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Settings2,
  Volume2,
} from "lucide-react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionsWsBase } from "@/lib/relay";
import { cn } from "@/lib/utils";

interface DiagnosticStep {
  id: string;
  name: string;
  description: string;
  status: "pending" | "running" | "success" | "warning" | "error";
  message: string;
  fix?: string;
  details?: string;
  duration?: number;
}

interface StreamStats {
  camera?: {
    frame_count: number;
    bytes_sent: number;
    fps: number;
    fps_actual?: number;
    last_error: string | null;
    running: boolean;
    quality: number;
    target_fps: number;
  };
  audio?: {
    bytes_sent: number;
    bytes_received: number;
    running: boolean;
    send_rate_kbps: number;
    recv_rate_kbps: number;
    sample_rate: number;
  };
  screen?: {
    frame_count: number;
    bytes_sent: number;
    fps_actual?: number;
    fps?: number;
    last_error: string | null;
    running: boolean;
    quality: number;
    target_fps: number;
  };
  phone_webcam?: {
    frame_count?: number;
    running?: boolean;
    last_error?: string | null;
  } | null;
}

type StreamType = "all" | "camera" | "screen" | "audio" | "phone_webcam";

interface UnifiedStreamDiagnosticsProps {
  className?: string;
  defaultTab?: StreamType;
}

export function UnifiedStreamDiagnostics({ className, defaultTab = "all" }: UnifiedStreamDiagnosticsProps) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();

  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<DiagnosticStep[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [rootCause, setRootCause] = useState<string | null>(null);
  const [agentStats, setAgentStats] = useState<StreamStats | null>(null);
  const [activeTab, setActiveTab] = useState<StreamType>(defaultTab);
  const wsRef = useRef<WebSocket | null>(null);

  const WS_BASE = getFunctionsWsBase();
  const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? "";

  const updateStep = (id: string, update: Partial<DiagnosticStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...update } : s)));
  };

  const addStep = (step: DiagnosticStep) => {
    setSteps((prev) => [...prev, step]);
  };

  const runCoreDiagnostics = useCallback(async (): Promise<boolean> => {
    // Step 1: Configuration
    addStep({ id: "config", name: "Configuration", description: "Check WebSocket URL", status: "running", message: "Checking..." });
    
    const wsBase = getFunctionsWsBase();
    if (!wsBase || !wsBase.includes("functions.supabase.co")) {
      updateStep("config", {
        status: "warning",
        message: "Non-standard WebSocket URL",
        details: wsBase,
        fix: "Ensure VITE_SUPABASE_PROJECT_ID is set correctly",
      });
    } else {
      updateStep("config", { status: "success", message: `Using: ${wsBase.slice(0, 40)}...` });
    }

    // Step 2: PC Agent
    addStep({ id: "agent", name: "PC Agent", description: "Check agent online", status: "running", message: "Checking..." });
    
    if (!selectedDevice?.is_online) {
      updateStep("agent", {
        status: "error",
        message: "PC agent is offline",
        fix: "Run jarvis_agent.py on your PC",
      });
      setRootCause("PC agent is not running");
      return false;
    }

    try {
      const startTime = Date.now();
      const pingResult = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 5000 });
      const duration = Date.now() - startTime;
      
      if (pingResult?.success) {
        updateStep("agent", { 
          status: "success", 
          message: `Agent responding (${duration}ms)`,
          duration 
        });
      } else {
        throw new Error("No response");
      }
    } catch {
      updateStep("agent", {
        status: "error",
        message: "Agent not responding",
        fix: "Restart the Python agent",
      });
      setRootCause("PC agent is not responding to commands");
      return false;
    }

    return true;
  }, [selectedDevice, sendCommand]);

  const testCameraRelay = useCallback(async (): Promise<boolean> => {
    addStep({ id: "camera_relay", name: "Camera Relay", description: "Test edge function", status: "running", message: "Testing..." });
    
    try {
      const { data, error } = await supabase.functions.invoke("camera-relay", { method: "GET" });
      if (error) throw error;
      updateStep("camera_relay", {
        status: "success",
        message: `Online - ${data?.activeSessions ?? 0} active sessions`,
      });
      return true;
    } catch (err) {
      updateStep("camera_relay", {
        status: "error",
        message: `Unreachable: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Check if camera-relay edge function is deployed",
      });
      return false;
    }
  }, []);

  const testAudioRelay = useCallback(async (): Promise<boolean> => {
    addStep({ id: "audio_relay", name: "Audio Relay", description: "Test edge function", status: "running", message: "Testing..." });
    
    try {
      const { data, error } = await supabase.functions.invoke("audio-relay", { method: "GET" });
      if (error) throw error;
      updateStep("audio_relay", {
        status: "success",
        message: `Online - ${data?.activeSessions ?? 0} active sessions`,
      });
      return true;
    } catch (err) {
      updateStep("audio_relay", {
        status: "error",
        message: `Unreachable: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Check if audio-relay edge function is deployed",
      });
      return false;
    }
  }, []);

  const testWebSocketConnection = useCallback(async (relayType: "camera" | "audio"): Promise<boolean> => {
    const stepId = `ws_${relayType}`;
    addStep({ id: stepId, name: `WebSocket (${relayType})`, description: "Test browser connection", status: "running", message: "Connecting..." });
    
    const testSessionId = crypto.randomUUID();
    const wsUrl = relayType === "camera" 
      ? `${WS_BASE}/functions/v1/camera-relay?sessionId=${testSessionId}&type=pc&fps=10&quality=70&binary=true`
      : `${WS_BASE}/functions/v1/audio-relay?sessionId=${testSessionId}&type=pc&direction=phone_to_pc`;

    try {
      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(() => {
          ws.close();
          reject(new Error("Connection timeout"));
        }, 5000);
        ws.onopen = () => {
          window.clearTimeout(t);
          ws.close();
          resolve();
        };
        ws.onerror = () => {
          window.clearTimeout(t);
          reject(new Error("Connection failed"));
        };
      });
      updateStep(stepId, { status: "success", message: "WebSocket connected successfully" });
      return true;
    } catch (err) {
      updateStep(stepId, {
        status: "error",
        message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Check browser network/firewall settings",
      });
      return false;
    }
  }, [WS_BASE]);

  const testTestPattern = useCallback(async (): Promise<{ success: boolean; framesReceived: number }> => {
    addStep({ id: "test_pattern", name: "Test Pattern", description: "Stream synthetic frames", status: "running", message: "Starting..." });
    
    const patternSessionId = crypto.randomUUID();
    let framesReceived = 0;
    let peerConnected = false;

    try {
      // Connect as receiver FIRST
      const ws = new WebSocket(
        `${WS_BASE}/functions/v1/camera-relay?sessionId=${patternSessionId}&type=pc&fps=10&quality=70&binary=true`
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(() => reject(new Error("Timeout")), 5000);
        ws.onopen = () => { window.clearTimeout(t); resolve(); };
        ws.onerror = () => { window.clearTimeout(t); reject(new Error("WS error")); };
      });

      updateStep("test_pattern", { status: "running", message: "WebSocket connected, starting agent..." });

      // Set up message handler BEFORE sending command
      const framePromise = new Promise<void>((resolve) => {
        const frameTimeout = window.setTimeout(() => resolve(), 8000); // Longer timeout
        
        ws.onmessage = (event) => {
          // Handle JSON messages (peer_connected, etc.)
          if (typeof event.data === "string") {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === "peer_connected") {
                peerConnected = true;
                updateStep("test_pattern", { status: "running", message: "Agent connected, waiting for frames..." });
              }
            } catch {
              // Ignore parse errors
            }
            return;
          }
          
          // Handle binary frames
          if (event.data instanceof ArrayBuffer && event.data.byteLength > 100) {
            framesReceived++;
            if (framesReceived === 1) {
              updateStep("test_pattern", { status: "running", message: `Receiving frames... (${framesReceived})` });
            }
            if (framesReceived >= 5) {
              window.clearTimeout(frameTimeout);
              resolve();
            }
          }
        };
      });

      // Tell agent to start test pattern with the SAME session ID
      const started = await sendCommand(
        "start_test_pattern",
        { session_id: patternSessionId, fps: 10, quality: 70 },
        { awaitResult: true, timeoutMs: 15000 }
      );

      if (!started.success) {
        updateStep("test_pattern", {
          status: "warning",
          message: "Test pattern command failed",
          details: started.error as string || "Agent may not support this command",
          fix: "Update your Python agent to latest version",
        });
        ws.close();
        return { success: false, framesReceived: 0 };
      }

      // Wait for frames
      await framePromise;

      // Stop test pattern
      await sendCommand("stop_test_pattern", {});
      ws.close();

      if (framesReceived > 0) {
        updateStep("test_pattern", {
          status: "success",
          message: `Received ${framesReceived} test frames!`,
          details: peerConnected ? "Peer connection confirmed" : "Frames received without explicit peer notification",
        });
        return { success: true, framesReceived };
      } else if (peerConnected) {
        updateStep("test_pattern", {
          status: "warning",
          message: "Agent connected but no frames received",
          fix: "Agent may have issue generating frames (check PIL/OpenCV)",
        });
        return { success: false, framesReceived: 0 };
      } else {
        updateStep("test_pattern", {
          status: "error",
          message: "No frames received",
          fix: "Check agent logs for connection errors",
        });
        return { success: false, framesReceived: 0 };
      }
    } catch (err) {
      updateStep("test_pattern", {
        status: "error",
        message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { success: false, framesReceived: 0 };
    }
  }, [WS_BASE, sendCommand]);

  const testStreamingStats = useCallback(async (): Promise<StreamStats | null> => {
    addStep({ id: "stats", name: "Streaming Stats", description: "Get agent streaming status", status: "running", message: "Fetching..." });
    
    try {
      const statsResult = await sendCommand("get_streaming_stats", {}, { awaitResult: true, timeoutMs: 8000 });
      
      if (statsResult?.success && statsResult?.result) {
        const stats = statsResult.result as StreamStats;
        setAgentStats(stats);
        
        const issues: string[] = [];
        
        if (stats.camera?.last_error) {
          issues.push(`Camera: ${stats.camera.last_error}`);
        }
        if (stats.screen?.last_error) {
          issues.push(`Screen: ${stats.screen.last_error}`);
        }
        
        if (issues.length > 0) {
          updateStep("stats", {
            status: "warning",
            message: "Issues detected",
            details: issues.join("; "),
            fix: "Check hardware access on PC",
          });
        } else {
          const summary: string[] = [];
          if (stats.camera?.running) summary.push(`Camera: ${stats.camera.frame_count} frames`);
          if (stats.screen?.running) summary.push(`Screen: ${stats.screen.frame_count} frames`);
          if (stats.audio?.running) summary.push("Audio: Active");
          
          updateStep("stats", {
            status: "success",
            message: summary.length > 0 ? summary.join(", ") : "No active streams",
            details: `Camera FPS: ${stats.camera?.fps || 0}, Screen FPS: ${stats.screen?.fps_actual || 0}`,
          });
        }
        
        return stats;
      } else {
        updateStep("stats", { status: "warning", message: "Could not fetch stats" });
        return null;
      }
    } catch {
      updateStep("stats", { status: "warning", message: "Stats fetch failed" });
      return null;
    }
  }, [sendCommand]);

  const runCameraDiagnostics = useCallback(async () => {
    addStep({ id: "camera_check", name: "Camera Hardware", description: "Check camera availability", status: "running", message: "Checking..." });
    
    try {
      const result = await sendCommand("get_cameras", {}, { awaitResult: true, timeoutMs: 8000 });
      
      if (result?.success && result?.result?.cameras) {
        const cameras = result.result.cameras as { index: number; name: string; width: number; height: number }[];
        
        if (cameras.length === 0) {
          updateStep("camera_check", {
            status: "error",
            message: "No cameras found on PC",
            fix: "Connect a webcam or enable the built-in camera",
          });
          setRootCause("No camera hardware available on PC");
        } else {
          updateStep("camera_check", {
            status: "success",
            message: `Found ${cameras.length} camera(s)`,
            details: cameras.map(c => `${c.name} (${c.width}x${c.height})`).join(", "),
          });
        }
      } else {
        updateStep("camera_check", {
          status: "warning",
          message: "Could not enumerate cameras",
          fix: "OpenCV may not be installed on the agent",
        });
      }
    } catch {
      updateStep("camera_check", { status: "warning", message: "Camera check failed" });
    }
  }, [sendCommand]);

  const runScreenDiagnostics = useCallback(async () => {
    addStep({ id: "screen_check", name: "Screen Capture", description: "Check monitor availability", status: "running", message: "Checking..." });
    
    try {
      const result = await sendCommand("get_monitors", {}, { awaitResult: true, timeoutMs: 5000 });
      
      if (result?.success && result?.result?.monitors) {
        const monitors = result.result.monitors as { index: number; name: string; width: number; height: number }[];
        
        updateStep("screen_check", {
          status: "success",
          message: `Found ${monitors.length} monitor(s)`,
          details: monitors.map(m => `${m.name} (${m.width}x${m.height})`).join(", "),
        });
      } else {
        updateStep("screen_check", {
          status: "warning",
          message: "Could not enumerate monitors",
          fix: "mss library may not be installed on the agent",
        });
      }
    } catch {
      updateStep("screen_check", { status: "warning", message: "Monitor check failed" });
    }
  }, [sendCommand]);

  const runAllDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setSteps([]);
    setRootCause(null);
    setAgentStats(null);

    // Core checks
    const coreOk = await runCoreDiagnostics();
    if (!coreOk) {
      setIsRunning(false);
      return;
    }

    // Relay checks in parallel
    const [cameraRelayOk, audioRelayOk] = await Promise.all([
      testCameraRelay(),
      testAudioRelay(),
    ]);

    // WebSocket checks in parallel
    await Promise.all([
      cameraRelayOk && testWebSocketConnection("camera"),
      audioRelayOk && testWebSocketConnection("audio"),
    ]);

    // Get streaming stats
    await testStreamingStats();

    // Hardware checks
    await Promise.all([
      runCameraDiagnostics(),
      runScreenDiagnostics(),
    ]);

    // Test pattern (most comprehensive test)
    const { success, framesReceived } = await testTestPattern();
    
    // Final verdict
    addStep({ 
      id: "verdict", 
      name: "Verdict", 
      description: "Final diagnosis", 
      status: "running", 
      message: "Analyzing..." 
    });
    
    if (framesReceived > 0) {
      updateStep("verdict", {
        status: "success",
        message: "Streaming pipeline is working!",
        details: "Test frames successfully delivered from agent to browser.",
      });
      setRootCause(null);
    } else if (!rootCause) {
      updateStep("verdict", {
        status: "error",
        message: "Frames not reaching browser",
        fix: "Check agent logs for errors during test pattern streaming",
      });
      setRootCause("Frames not being delivered through relay");
    } else {
      updateStep("verdict", {
        status: "error",
        message: rootCause,
      });
    }

    setIsRunning(false);
  }, [
    runCoreDiagnostics,
    testCameraRelay,
    testAudioRelay,
    testWebSocketConnection,
    testStreamingStats,
    runCameraDiagnostics,
    runScreenDiagnostics,
    testTestPattern,
    rootCause,
  ]);

  const runCameraOnlyDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setSteps([]);
    setRootCause(null);

    const coreOk = await runCoreDiagnostics();
    if (!coreOk) { setIsRunning(false); return; }

    await testCameraRelay();
    await testWebSocketConnection("camera");
    await runCameraDiagnostics();
    await testTestPattern();

    setIsRunning(false);
  }, [runCoreDiagnostics, testCameraRelay, testWebSocketConnection, runCameraDiagnostics, testTestPattern]);

  const runScreenOnlyDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setSteps([]);
    setRootCause(null);

    const coreOk = await runCoreDiagnostics();
    if (!coreOk) { setIsRunning(false); return; }

    await testCameraRelay(); // Screen uses camera-relay
    await testWebSocketConnection("camera");
    await runScreenDiagnostics();
    await testTestPattern();

    setIsRunning(false);
  }, [runCoreDiagnostics, testCameraRelay, testWebSocketConnection, runScreenDiagnostics, testTestPattern]);

  const runAudioOnlyDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setSteps([]);
    setRootCause(null);

    const coreOk = await runCoreDiagnostics();
    if (!coreOk) { setIsRunning(false); return; }

    await testAudioRelay();
    await testWebSocketConnection("audio");
    await testStreamingStats();

    setIsRunning(false);
  }, [runCoreDiagnostics, testAudioRelay, testWebSocketConnection, testStreamingStats]);

  const runDiagnostics = useCallback(async () => {
    switch (activeTab) {
      case "camera":
        await runCameraOnlyDiagnostics();
        break;
      case "screen":
        await runScreenOnlyDiagnostics();
        break;
      case "audio":
        await runAudioOnlyDiagnostics();
        break;
      default:
        await runAllDiagnostics();
    }
  }, [activeTab, runAllDiagnostics, runCameraOnlyDiagnostics, runScreenOnlyDiagnostics, runAudioOnlyDiagnostics]);

  const getStatusIcon = (status: DiagnosticStep["status"]) => {
    switch (status) {
      case "pending": return <div className="w-4 h-4 rounded-full bg-muted" />;
      case "running": return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case "success": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "warning": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "error": return <XCircle className="w-4 h-4 text-destructive" />;
    }
  };

  const getStatusColor = (status: DiagnosticStep["status"]) => {
    switch (status) {
      case "success": return "border-green-500/30 bg-green-500/5";
      case "warning": return "border-yellow-500/30 bg-yellow-500/5";
      case "error": return "border-destructive/30 bg-destructive/5";
      default: return "border-border/50";
    }
  };

  const successCount = steps.filter((s) => s.status === "success").length;
  const errorCount = steps.filter((s) => s.status === "error").length;
  const warningCount = steps.filter((s) => s.status === "warning").length;
  const progress = steps.length > 0 
    ? (steps.filter((s) => s.status !== "pending" && s.status !== "running").length / steps.length) * 100 
    : 0;

  const getTabIcon = (tab: StreamType) => {
    switch (tab) {
      case "camera": return <Camera className="w-4 h-4" />;
      case "screen": return <Monitor className="w-4 h-4" />;
      case "audio": return <Volume2 className="w-4 h-4" />;
      case "phone_webcam": return <Smartphone className="w-4 h-4" />;
      default: return <Activity className="w-4 h-4" />;
    }
  };

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Unified Stream Diagnostics</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {steps.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                {successCount > 0 && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
                    {successCount} OK
                  </Badge>
                )}
                {warningCount > 0 && (
                  <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">
                    {warningCount} Warn
                  </Badge>
                )}
                {errorCount > 0 && (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                    {errorCount} Error
                  </Badge>
                )}
              </div>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          Comprehensive diagnostics for camera, screen, audio & phone webcam streaming
        </CardDescription>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as StreamType)}>
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="all" className="gap-1 text-xs">
                <Activity className="w-3 h-3" />
                All
              </TabsTrigger>
              <TabsTrigger value="camera" className="gap-1 text-xs">
                <Camera className="w-3 h-3" />
                Camera
              </TabsTrigger>
              <TabsTrigger value="screen" className="gap-1 text-xs">
                <Monitor className="w-3 h-3" />
                Screen
              </TabsTrigger>
              <TabsTrigger value="audio" className="gap-1 text-xs">
                <Volume2 className="w-3 h-3" />
                Audio
              </TabsTrigger>
              <TabsTrigger value="phone_webcam" className="gap-1 text-xs">
                <Smartphone className="w-3 h-3" />
                Phone
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button onClick={runDiagnostics} disabled={isRunning || !selectedDevice} className="w-full" size="sm">
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running Diagnostics...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Run {activeTab === "all" ? "Full" : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Diagnostics
              </>
            )}
          </Button>

          {steps.length > 0 && (
            <>
              <Progress value={progress} className="h-1" />

              {rootCause && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-destructive">Root Cause Found</p>
                      <p className="text-xs text-destructive/80">{rootCause}</p>
                    </div>
                  </div>
                </div>
              )}

              <ScrollArea className="h-[300px] pr-2">
                <div className="space-y-2">
                  {steps.map((step) => (
                    <div
                      key={step.id}
                      className={cn("p-3 rounded-lg border transition-colors", getStatusColor(step.status))}
                    >
                      <div className="flex items-start gap-2">
                        {getStatusIcon(step.status)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{step.name}</span>
                            {step.duration && (
                              <span className="text-xs text-muted-foreground">({step.duration}ms)</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{step.message || step.description}</p>
                          {step.details && (
                            <p className="text-xs text-muted-foreground/70 mt-1 font-mono truncate">{step.details}</p>
                          )}
                          {step.fix && (
                            <div className="flex items-start gap-1.5 mt-2 p-2 bg-primary/5 rounded border border-primary/20">
                              <Zap className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                              <span className="text-xs text-primary">{step.fix}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}

          {/* Agent Stats Display */}
          {agentStats && (
            <div className="p-3 bg-muted/30 rounded-lg space-y-2">
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Settings2 className="w-3 h-3" />
                Live Agent Stats
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 bg-background/50 rounded">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <Camera className="w-3 h-3" />
                    Camera
                  </div>
                  <div className={agentStats.camera?.running ? "text-green-500" : "text-muted-foreground"}>
                    {agentStats.camera?.running ? `${agentStats.camera.frame_count} frames` : "Stopped"}
                  </div>
                  {agentStats.camera?.last_error && (
                    <div className="text-destructive text-[10px] truncate">{agentStats.camera.last_error}</div>
                  )}
                </div>
                <div className="p-2 bg-background/50 rounded">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <Monitor className="w-3 h-3" />
                    Screen
                  </div>
                  <div className={agentStats.screen?.running ? "text-green-500" : "text-muted-foreground"}>
                    {agentStats.screen?.running ? `${agentStats.screen.frame_count} frames` : "Stopped"}
                  </div>
                  {agentStats.screen?.last_error && (
                    <div className="text-destructive text-[10px] truncate">{agentStats.screen.last_error}</div>
                  )}
                </div>
                <div className="p-2 bg-background/50 rounded">
                  <div className="flex items-center gap-1 text-muted-foreground mb-1">
                    <Mic className="w-3 h-3" />
                    Audio
                  </div>
                  <div className={agentStats.audio?.running ? "text-green-500" : "text-muted-foreground"}>
                    {agentStats.audio?.running 
                      ? `${agentStats.audio.send_rate_kbps}/${agentStats.audio.recv_rate_kbps} kbps`
                      : "Stopped"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
