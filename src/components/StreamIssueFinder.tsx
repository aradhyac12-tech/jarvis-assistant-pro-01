import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Eye,
  ChevronDown,
  ChevronUp,
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
}

interface StreamIssueFinderProps {
  className?: string;
  streamType?: "camera" | "screen" | "all";
}

export function StreamIssueFinder({ className, streamType = "all" }: StreamIssueFinderProps) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();

  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<DiagnosticStep[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [rootCause, setRootCause] = useState<string | null>(null);

  const WS_BASE = getFunctionsWsBase();

  const updateStep = (id: string, update: Partial<DiagnosticStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...update } : s)));
  };

  const runDiagnostics = useCallback(async () => {
    if (!selectedDevice) return;

    setIsRunning(true);
    setRootCause(null);

    const initialSteps: DiagnosticStep[] = [
      { id: "config", name: "Configuration", description: "Check WebSocket URL configuration", status: "pending", message: "" },
      { id: "agent", name: "PC Agent", description: "Verify agent is online and responsive", status: "pending", message: "" },
      { id: "relay", name: "Relay Service", description: "Test camera-relay edge function", status: "pending", message: "" },
      { id: "ws_connect", name: "WebSocket Connect", description: "Test browser WebSocket connection", status: "pending", message: "" },
      { id: "agent_capture", name: "Agent Capture", description: "Check if agent can capture frames", status: "pending", message: "" },
      { id: "test_pattern", name: "Test Pattern", description: "Stream synthetic frames to isolate issues", status: "pending", message: "" },
      { id: "frame_delivery", name: "Frame Delivery", description: "Verify frames reach browser", status: "pending", message: "" },
    ];
    setSteps(initialSteps);

    // Step 1: Configuration
    updateStep("config", { status: "running", message: "Checking..." });
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
    updateStep("agent", { status: "running", message: "Pinging agent..." });
    if (!selectedDevice?.is_online) {
      updateStep("agent", {
        status: "error",
        message: "PC agent is offline",
        fix: "Start jarvis_agent.py on your PC",
      });
      setRootCause("PC agent is not running or offline");
      setIsRunning(false);
      return;
    }

    try {
      const pingResult = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 5000 });
      if (pingResult?.success) {
        updateStep("agent", { status: "success", message: "Agent responding" });
      } else {
        throw new Error("No response");
      }
    } catch {
      updateStep("agent", {
        status: "error",
        message: "Agent not responding to commands",
        fix: "Restart the Python agent and check logs",
      });
      setRootCause("PC agent is not responding to commands");
      setIsRunning(false);
      return;
    }

    // Step 3: Relay Service
    updateStep("relay", { status: "running", message: "Testing relay..." });
    try {
      const { data, error } = await supabase.functions.invoke("camera-relay", { method: "GET" });
      if (error) throw error;
      updateStep("relay", {
        status: "success",
        message: `Relay online - ${data?.activeSessions ?? 0} active sessions`,
      });
    } catch (err) {
      updateStep("relay", {
        status: "error",
        message: `Relay unreachable: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Check if camera-relay edge function is deployed",
      });
      setRootCause("Camera relay edge function is not responding");
      setIsRunning(false);
      return;
    }

    // Step 4: WebSocket Connect
    updateStep("ws_connect", { status: "running", message: "Testing WebSocket..." });
    const testSessionId = crypto.randomUUID();
    let wsConnected = false;
    try {
      const ws = new WebSocket(
        `${WS_BASE}/functions/v1/camera-relay?sessionId=${testSessionId}&type=pc&fps=30&quality=70&binary=true`
      );
      await new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(() => {
          ws.close();
          reject(new Error("Connection timeout"));
        }, 5000);
        ws.onopen = () => {
          window.clearTimeout(t);
          wsConnected = true;
          ws.close();
          resolve();
        };
        ws.onerror = () => {
          window.clearTimeout(t);
          reject(new Error("Connection failed"));
        };
      });
      updateStep("ws_connect", { status: "success", message: "WebSocket connection successful" });
    } catch (err) {
      updateStep("ws_connect", {
        status: "error",
        message: `WebSocket failed: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Check browser network/firewall settings",
      });
      setRootCause("Browser cannot connect to WebSocket relay");
      setIsRunning(false);
      return;
    }

    // Step 5: Agent Capture
    updateStep("agent_capture", { status: "running", message: "Checking capture stats..." });
    try {
      const statsResult = await sendCommand("get_streaming_stats", {}, { awaitResult: true, timeoutMs: 8000 });
      if (statsResult?.success && statsResult?.result) {
        const stats = statsResult.result as {
          camera?: { frame_count?: number; running?: boolean; last_error?: string };
          screen?: { frame_count?: number; running?: boolean; last_error?: string };
        };
        
        const cameraStats = stats.camera;
        const screenStats = stats.screen;
        
        if (cameraStats?.last_error || screenStats?.last_error) {
          const error = cameraStats?.last_error || screenStats?.last_error;
          updateStep("agent_capture", {
            status: "warning",
            message: `Agent has error: ${error}`,
            fix: "Check PC camera/screen capture hardware",
          });
        } else {
          updateStep("agent_capture", {
            status: "success",
            message: "No capture errors reported",
            details: `Camera: ${cameraStats?.frame_count ?? 0} frames, Screen: ${screenStats?.frame_count ?? 0} frames`,
          });
        }
      } else {
        updateStep("agent_capture", { status: "warning", message: "Could not fetch stats" });
      }
    } catch {
      updateStep("agent_capture", { status: "warning", message: "Stats fetch failed" });
    }

    // Step 6: Test Pattern
    updateStep("test_pattern", { status: "running", message: "Starting test pattern..." });
    const patternSessionId = crypto.randomUUID();
    let framesReceived = 0;

    try {
      const ws = new WebSocket(
        `${WS_BASE}/functions/v1/camera-relay?sessionId=${patternSessionId}&type=pc&fps=10&quality=70&binary=true`
      );
      ws.binaryType = "arraybuffer";

      await new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(() => reject(new Error("Timeout")), 5000);
        ws.onopen = () => { window.clearTimeout(t); resolve(); };
        ws.onerror = () => { window.clearTimeout(t); reject(new Error("WS error")); };
      });

      // Tell agent to start test pattern
      const started = await sendCommand(
        "start_test_pattern",
        { session_id: patternSessionId, fps: 10, quality: 70 },
        { awaitResult: true, timeoutMs: 10000 }
      );

      if (!started.success) {
        updateStep("test_pattern", {
          status: "warning",
          message: "Test pattern command not recognized (older agent?)",
          fix: "Update your Python agent to latest version",
        });
      } else {
        // Wait for frames
        await new Promise<void>((resolve) => {
          const frameTimeout = window.setTimeout(() => resolve(), 5000);
          ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer && event.data.byteLength > 100) {
              framesReceived++;
            }
            if (framesReceived >= 3) {
              window.clearTimeout(frameTimeout);
              resolve();
            }
          };
        });

        // Stop test pattern
        await sendCommand("stop_test_pattern", {});

        if (framesReceived > 0) {
          updateStep("test_pattern", {
            status: "success",
            message: `Received ${framesReceived} test frames!`,
          });
        } else {
          updateStep("test_pattern", {
            status: "error",
            message: "Test pattern sent but no frames received",
            fix: "Relay may be routing to wrong peer type",
          });
          setRootCause("Relay is not forwarding frames correctly (phone→pc role mismatch)");
        }
      }

      ws.close();
    } catch (err) {
      updateStep("test_pattern", {
        status: "warning",
        message: `Test pattern failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Step 7: Frame Delivery Summary
    updateStep("frame_delivery", { status: "running", message: "Analyzing..." });
    if (framesReceived > 0) {
      updateStep("frame_delivery", {
        status: "success",
        message: "Frames are being delivered correctly!",
        details: "The streaming pipeline is working. If you still see black screen, check real camera/screen capture.",
      });
      setRootCause(null);
    } else if (!rootCause) {
      updateStep("frame_delivery", {
        status: "error",
        message: "Frames not reaching browser",
        fix: "Check if agent is connecting as 'phone' type (sender)",
      });
      setRootCause("Agent may be connecting with wrong WebSocket type");
    }

    setIsRunning(false);
  }, [selectedDevice, sendCommand, WS_BASE]);

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
  const progress = steps.length > 0 ? (steps.filter((s) => s.status !== "pending" && s.status !== "running").length / steps.length) * 100 : 0;

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Stream Issue Finder</CardTitle>
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
          Deep diagnostic that pinpoints exactly where streaming fails
        </CardDescription>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <Button onClick={runDiagnostics} disabled={isRunning || !selectedDevice} className="w-full" size="sm">
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running Diagnostics...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Find Issues
              </>
            )}
          </Button>

          {steps.length > 0 && (
            <>
              <Progress value={progress} className="h-1" />

              {rootCause && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-destructive mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-destructive">Root Cause Found</p>
                      <p className="text-xs text-destructive/80">{rootCause}</p>
                    </div>
                  </div>
                </div>
              )}

              <ScrollArea className="h-[250px] pr-2">
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
        </CardContent>
      )}
    </Card>
  );
}
