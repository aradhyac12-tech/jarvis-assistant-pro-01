import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFunctionsWsBase } from "@/lib/relay";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { addLog } from "@/components/IssueLog";

interface DiagStep {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error" | "warning";
  message?: string;
  fix?: string;
}

type DiagType = "audio" | "screen" | "pc-camera" | "phone-camera";

export function InlineDiagnostics({ 
  type, 
  className 
}: { 
  type: DiagType; 
  className?: string;
}) {
  const { sendCommand } = useDeviceCommands();
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<DiagStep[]>([]);

  const WS_BASE = getFunctionsWsBase();

  const updateStep = useCallback((id: string, update: Partial<DiagStep>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...update } : s));
  }, []);

  const runAudioDiagnostics = useCallback(async () => {
    const diagSteps: DiagStep[] = [
      { id: "mic_perm", name: "Mic Permission", status: "pending" },
      { id: "ws_conn", name: "Relay Connection", status: "pending" },
      { id: "agent", name: "PC Agent Audio", status: "pending" },
    ];
    setSteps(diagSteps);
    setIsRunning(true);

    // Check mic permission
    updateStep("mic_perm", { status: "running" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      updateStep("mic_perm", { status: "success", message: "Granted" });
    } catch {
      updateStep("mic_perm", { status: "error", message: "Denied", fix: "Allow mic in browser settings" });
    }

    // Check WS connection
    updateStep("ws_conn", { status: "running" });
    try {
      const ws = new WebSocket(`${WS_BASE}/functions/v1/audio-relay?sessionId=diag-${Date.now()}&type=phone&direction=phone_to_pc`);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 5000);
        ws.onopen = () => { clearTimeout(t); ws.close(); resolve(); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("Error")); };
      });
      updateStep("ws_conn", { status: "success", message: "Connected" });
    } catch (e) {
      updateStep("ws_conn", { status: "error", message: e instanceof Error ? e.message : "Failed", fix: "Check internet" });
    }

    // Check agent audio support
    updateStep("agent", { status: "running" });
    try {
      const result = await sendCommand("check_audio_support", {}, { awaitResult: true, timeoutMs: 8000 });
      if (result.success && result.result) {
        const info = result.result as { has_pyaudio?: boolean; has_websockets?: boolean };
        if (info.has_pyaudio && info.has_websockets) {
          updateStep("agent", { status: "success", message: "pyaudio + websockets OK" });
        } else {
          updateStep("agent", { status: "error", message: "Missing packages", fix: "pip install pyaudio websockets" });
        }
      } else {
        updateStep("agent", { status: "warning", message: "Agent not responding" });
      }
    } catch {
      updateStep("agent", { status: "warning", message: "Could not check agent" });
    }

    setIsRunning(false);
  }, [WS_BASE, sendCommand, updateStep]);

  const runScreenDiagnostics = useCallback(async () => {
    const diagSteps: DiagStep[] = [
      { id: "ws_conn", name: "Relay Connection", status: "pending" },
      { id: "agent", name: "PC Agent Screen", status: "pending" },
    ];
    setSteps(diagSteps);
    setIsRunning(true);

    // Check WS connection
    updateStep("ws_conn", { status: "running" });
    try {
      const ws = new WebSocket(`${WS_BASE}/functions/v1/camera-relay?sessionId=diag-${Date.now()}&type=pc&fps=10&quality=50`);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 5000);
        ws.onopen = () => { clearTimeout(t); ws.close(); resolve(); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("Error")); };
      });
      updateStep("ws_conn", { status: "success", message: "Connected" });
    } catch (e) {
      updateStep("ws_conn", { status: "error", message: e instanceof Error ? e.message : "Failed" });
    }

    // Check agent screen support
    updateStep("agent", { status: "running" });
    try {
      const result = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result.success) {
        updateStep("agent", { status: "success", message: "Agent responding" });
      } else {
        updateStep("agent", { status: "error", message: "Not responding", fix: "Restart PC agent" });
      }
    } catch {
      updateStep("agent", { status: "warning", message: "Could not reach agent" });
    }

    setIsRunning(false);
  }, [WS_BASE, sendCommand, updateStep]);

  const runPcCameraDiagnostics = useCallback(async () => {
    const diagSteps: DiagStep[] = [
      { id: "ws_conn", name: "Relay Connection", status: "pending" },
      { id: "agent", name: "PC Agent Camera", status: "pending" },
      { id: "cameras", name: "Camera Detection", status: "pending" },
    ];
    setSteps(diagSteps);
    setIsRunning(true);

    // Check WS connection
    updateStep("ws_conn", { status: "running" });
    try {
      const ws = new WebSocket(`${WS_BASE}/functions/v1/camera-relay?sessionId=diag-${Date.now()}&type=pc&fps=10&quality=50`);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 5000);
        ws.onopen = () => { clearTimeout(t); ws.close(); resolve(); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("Error")); };
      });
      updateStep("ws_conn", { status: "success", message: "Connected" });
    } catch (e) {
      updateStep("ws_conn", { status: "error", message: e instanceof Error ? e.message : "Failed" });
    }

    // Check agent
    updateStep("agent", { status: "running" });
    try {
      const result = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result.success) {
        updateStep("agent", { status: "success", message: "Agent responding" });
      } else {
        updateStep("agent", { status: "error", message: "Not responding" });
      }
    } catch {
      updateStep("agent", { status: "warning", message: "Could not reach agent" });
    }

    // Check cameras
    updateStep("cameras", { status: "running" });
    try {
      const result = await sendCommand("list_cameras", {}, { awaitResult: true, timeoutMs: 8000 });
      if (result.success && result.result) {
        const cameras = result.result as Array<{ index: number; name: string }>;
        if (cameras.length > 0) {
          updateStep("cameras", { status: "success", message: `Found ${cameras.length} camera(s)` });
        } else {
          updateStep("cameras", { status: "warning", message: "No cameras found", fix: "Connect a webcam to your PC" });
        }
      } else {
        updateStep("cameras", { status: "warning", message: "Could not list cameras" });
      }
    } catch {
      updateStep("cameras", { status: "warning", message: "Camera detection failed" });
    }

    setIsRunning(false);
  }, [WS_BASE, sendCommand, updateStep]);

  const runPhoneCameraDiagnostics = useCallback(async () => {
    const diagSteps: DiagStep[] = [
      { id: "cam_perm", name: "Camera Permission", status: "pending" },
      { id: "cam_access", name: "Camera Access", status: "pending" },
      { id: "ws_conn", name: "Relay Connection", status: "pending" },
    ];
    setSteps(diagSteps);
    setIsRunning(true);

    // Check camera permission
    updateStep("cam_perm", { status: "running" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      stream.getTracks().forEach(t => t.stop());
      updateStep("cam_perm", { status: "success", message: "Granted" });
      updateStep("cam_access", { status: "success", message: `${settings.width}x${settings.height}` });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      updateStep("cam_perm", { 
        status: "error", 
        message: "Denied", 
        fix: err.includes("NotAllowed") ? "Allow camera in settings" : "Check camera connection" 
      });
      updateStep("cam_access", { status: "error", message: "Cannot access" });
    }

    // Check WS connection
    updateStep("ws_conn", { status: "running" });
    try {
      const ws = new WebSocket(`${WS_BASE}/functions/v1/camera-relay?sessionId=diag-${Date.now()}&type=phone&fps=10&quality=50`);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, 5000);
        ws.onopen = () => { clearTimeout(t); ws.close(); resolve(); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("Error")); };
      });
      updateStep("ws_conn", { status: "success", message: "Connected" });
    } catch (e) {
      updateStep("ws_conn", { status: "error", message: e instanceof Error ? e.message : "Failed" });
    }

    setIsRunning(false);
    addLog("info", "web", `${type} diagnostics complete`);
  }, [WS_BASE, type, updateStep]);

  const runDiagnostics = useCallback(() => {
    switch (type) {
      case "audio": return runAudioDiagnostics();
      case "screen": return runScreenDiagnostics();
      case "pc-camera": return runPcCameraDiagnostics();
      case "phone-camera": return runPhoneCameraDiagnostics();
    }
  }, [type, runAudioDiagnostics, runScreenDiagnostics, runPcCameraDiagnostics, runPhoneCameraDiagnostics]);

  const getStatusIcon = (status: DiagStep["status"]) => {
    switch (status) {
      case "success": return <CheckCircle2 className="h-3.5 w-3.5 text-primary" />;
      case "error": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "warning": return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
      case "running": return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
      default: return <div className="h-3.5 w-3.5 rounded-full border border-muted" />;
    }
  };

  const overallStatus = steps.length === 0 
    ? "pending" 
    : steps.every(s => s.status === "success") 
    ? "success" 
    : steps.some(s => s.status === "error") 
    ? "error" 
    : steps.some(s => s.status === "warning")
    ? "warning"
    : "pending";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="w-full justify-between h-9 px-3 bg-secondary/30 hover:bg-secondary/50"
        >
          <div className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            <span className="text-sm">Diagnostics</span>
          </div>
          <div className="flex items-center gap-2">
            {steps.length > 0 && (
              <Badge 
                variant="outline" 
                className={cn(
                  "text-xs px-1.5 py-0",
                  overallStatus === "success" && "border-primary text-primary",
                  overallStatus === "error" && "border-destructive text-destructive",
                  overallStatus === "warning" && "border-warning text-warning"
                )}
              >
                {overallStatus === "success" ? "OK" : overallStatus === "error" ? "Issues" : overallStatus === "warning" ? "Warnings" : "..."}
              </Badge>
            )}
            <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="rounded-lg border border-border/50 bg-secondary/10 p-3 space-y-3">
          {/* Run button */}
          <Button
            onClick={runDiagnostics}
            disabled={isRunning}
            size="sm"
            className="w-full"
            variant={overallStatus === "success" ? "outline" : "default"}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Stethoscope className="h-4 w-4 mr-2" />
                {steps.length === 0 ? "Run Diagnostics" : "Run Again"}
              </>
            )}
          </Button>

          {/* Results */}
          {steps.length > 0 && (
            <div className="space-y-2">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-md text-xs",
                    step.status === "success" && "bg-primary/5",
                    step.status === "error" && "bg-destructive/5",
                    step.status === "warning" && "bg-warning/5",
                    step.status === "running" && "bg-primary/5"
                  )}
                >
                  {getStatusIcon(step.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{step.name}</span>
                      {step.message && (
                        <span className="text-muted-foreground">{step.message}</span>
                      )}
                    </div>
                    {step.fix && (
                      <p className="text-primary mt-0.5">💡 {step.fix}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
