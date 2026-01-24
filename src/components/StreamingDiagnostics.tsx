import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Wifi,
  WifiOff,
  RefreshCw,
  Play,
  Loader2,
  Camera,
  Mic,
  Monitor,
  Smartphone,
  Zap,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface DiagnosticResult {
  name: string;
  status: "pending" | "running" | "success" | "warning" | "error";
  message: string;
  details?: string;
  fix?: string;
}

interface StreamingStats {
  camera?: {
    frame_count: number;
    bytes_sent: number;
    fps: number;
    last_error: string | null;
    running: boolean;
  };
  audio?: {
    bytes_sent: number;
    bytes_received: number;
    running: boolean;
    send_rate_kbps: number;
    recv_rate_kbps: number;
  };
}

interface StreamingDiagnosticsProps {
  className?: string;
  onClose?: () => void;
}

export function StreamingDiagnostics({ className, onClose }: StreamingDiagnosticsProps) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [agentStats, setAgentStats] = useState<StreamingStats | null>(null);

  const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? "";
  
  const updateResult = (name: string, update: Partial<DiagnosticResult>) => {
    setResults(prev => prev.map(r => r.name === name ? { ...r, ...update } : r));
  };

  const runDiagnostics = useCallback(async () => {
    if (!selectedDevice) return;
    
    setIsRunning(true);
    setResults([
      { name: "Project Config", status: "pending", message: "Checking..." },
      { name: "Camera Relay", status: "pending", message: "Checking..." },
      { name: "Audio Relay", status: "pending", message: "Checking..." },
      { name: "PC Agent Connection", status: "pending", message: "Checking..." },
      { name: "Camera Streaming", status: "pending", message: "Checking..." },
      { name: "Audio Streaming", status: "pending", message: "Checking..." },
    ]);

    // Test 1: Project Config
    updateResult("Project Config", { status: "running" });
    if (!projectRef) {
      updateResult("Project Config", { 
        status: "error", 
        message: "VITE_SUPABASE_PROJECT_ID not set",
        fix: "Ensure .env file contains VITE_SUPABASE_PROJECT_ID"
      });
    } else {
      updateResult("Project Config", { 
        status: "success", 
        message: `Project ID: ${projectRef.slice(0, 8)}...`,
        details: `Full ID: ${projectRef}`
      });
    }

    // Test 2: Camera Relay health
    updateResult("Camera Relay", { status: "running" });
    try {
      const { data, error } = await supabase.functions.invoke("camera-relay", {
        method: "GET",
      });
      if (error) throw error;
      updateResult("Camera Relay", { 
        status: "success", 
        message: `Online - ${data?.activeSessions ?? 0} active sessions`,
        details: JSON.stringify(data, null, 2)
      });
    } catch (err) {
      updateResult("Camera Relay", { 
        status: "error", 
        message: `Relay unreachable: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Ensure camera-relay edge function is deployed"
      });
    }

    // Test 3: Audio Relay health
    updateResult("Audio Relay", { status: "running" });
    try {
      const { data, error } = await supabase.functions.invoke("audio-relay", {
        method: "GET",
      });
      if (error) throw error;
      updateResult("Audio Relay", { 
        status: "success", 
        message: `Online - ${data?.activeSessions ?? 0} active sessions`,
        details: JSON.stringify(data, null, 2)
      });
    } catch (err) {
      updateResult("Audio Relay", { 
        status: "error", 
        message: `Relay unreachable: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Ensure audio-relay edge function is deployed"
      });
    }

    // Test 4: PC Agent Connection
    updateResult("PC Agent Connection", { status: "running" });
    if (!selectedDevice?.is_online) {
      updateResult("PC Agent Connection", { 
        status: "error", 
        message: "PC agent is offline",
        fix: "Start jarvis_agent.py on your PC"
      });
    } else {
      try {
        const pingResult = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 5000 });
        if (pingResult?.success) {
          updateResult("PC Agent Connection", { 
            status: "success", 
            message: "PC agent responding",
            details: `Response time: fast`
          });
        } else {
          throw new Error("No response from agent");
        }
      } catch (err) {
        updateResult("PC Agent Connection", { 
          status: "warning", 
          message: "Agent slow or unresponsive",
          fix: "Check Python agent logs for errors"
        });
      }
    }

    // Test 5: Camera Streaming stats from agent
    updateResult("Camera Streaming", { status: "running" });
    try {
      const statsResult = await sendCommand("get_streaming_stats", {}, { awaitResult: true, timeoutMs: 8000 });
      if (statsResult?.success && statsResult?.result) {
        const stats = statsResult.result as StreamingStats;
        setAgentStats(stats);
        
        if (stats.camera) {
          if (stats.camera.running) {
            if (stats.camera.frame_count > 0) {
              updateResult("Camera Streaming", { 
                status: "success", 
                message: `Active - ${stats.camera.frame_count} frames sent, ${stats.camera.fps} FPS`,
                details: `Bytes sent: ${(stats.camera.bytes_sent / 1024).toFixed(1)} KB`
              });
            } else {
              updateResult("Camera Streaming", { 
                status: "warning", 
                message: "Running but 0 frames sent",
                fix: stats.camera.last_error || "Check camera access on PC"
              });
            }
          } else {
            updateResult("Camera Streaming", { 
              status: "warning", 
              message: "Camera not currently streaming",
              details: stats.camera.last_error || undefined
            });
          }
        } else {
          updateResult("Camera Streaming", { 
            status: "warning", 
            message: "No camera stats available"
          });
        }
        
        // Test 6: Audio Streaming stats
        if (stats.audio) {
          if (stats.audio.running) {
            updateResult("Audio Streaming", { 
              status: "success", 
              message: `Active - ${stats.audio.send_rate_kbps} kbps out, ${stats.audio.recv_rate_kbps} kbps in`,
              details: `Sent: ${(stats.audio.bytes_sent / 1024).toFixed(1)} KB, Received: ${(stats.audio.bytes_received / 1024).toFixed(1)} KB`
            });
          } else {
            updateResult("Audio Streaming", { 
              status: "warning", 
              message: "Audio relay not currently active"
            });
          }
        } else {
          updateResult("Audio Streaming", { 
            status: "warning", 
            message: "No audio stats available"
          });
        }
      } else {
        updateResult("Camera Streaming", { 
          status: "warning", 
          message: "Could not fetch streaming stats"
        });
        updateResult("Audio Streaming", { 
          status: "warning", 
          message: "Could not fetch streaming stats"
        });
      }
    } catch (err) {
      updateResult("Camera Streaming", { 
        status: "error", 
        message: `Stats fetch failed: ${err instanceof Error ? err.message : String(err)}`
      });
      updateResult("Audio Streaming", { 
        status: "error", 
        message: `Stats fetch failed`
      });
    }

    setIsRunning(false);
  }, [selectedDevice, sendCommand, projectRef]);

  const getStatusIcon = (status: DiagnosticResult["status"]) => {
    switch (status) {
      case "pending": return <div className="w-4 h-4 rounded-full bg-muted" />;
      case "running": return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case "success": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "warning": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "error": return <XCircle className="w-4 h-4 text-destructive" />;
    }
  };

  const getStatusColor = (status: DiagnosticResult["status"]) => {
    switch (status) {
      case "success": return "border-green-500/30 bg-green-500/5";
      case "warning": return "border-yellow-500/30 bg-yellow-500/5";
      case "error": return "border-destructive/30 bg-destructive/5";
      default: return "border-border/50";
    }
  };

  const successCount = results.filter(r => r.status === "success").length;
  const warningCount = results.filter(r => r.status === "warning").length;
  const errorCount = results.filter(r => r.status === "error").length;

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Streaming Diagnostics</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {results.length > 0 && (
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
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          One-click test for relay connectivity, peer roles, and data transfer
        </CardDescription>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <Button
            onClick={runDiagnostics}
            disabled={isRunning || !selectedDevice}
            className="w-full"
            size="sm"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running Tests...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Run Diagnostics
              </>
            )}
          </Button>

          {results.length > 0 && (
            <ScrollArea className="h-[280px] pr-2">
              <div className="space-y-2">
                {results.map((result, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "p-3 rounded-lg border transition-colors",
                      getStatusColor(result.status)
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {getStatusIcon(result.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{result.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {result.message}
                        </p>
                        {result.details && (
                          <p className="text-xs text-muted-foreground/70 mt-1 font-mono truncate">
                            {result.details}
                          </p>
                        )}
                        {result.fix && (
                          <div className="flex items-start gap-1.5 mt-2 p-2 bg-primary/5 rounded border border-primary/20">
                            <Zap className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                            <span className="text-xs text-primary">{result.fix}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Quick Tips */}
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>Black screen?</strong> Ensure PC agent is sending frames (check frame count).</p>
                <p><strong>No audio?</strong> Verify sample rate matches (16kHz recommended).</p>
                <p><strong>High latency?</strong> Lower FPS/quality in camera settings.</p>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
