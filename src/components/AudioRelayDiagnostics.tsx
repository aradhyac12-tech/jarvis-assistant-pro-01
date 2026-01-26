import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Mic,
  Speaker,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFunctionsWsBase } from "@/lib/relay";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { addLog } from "@/components/IssueLog";

interface DiagnosticStep {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error" | "warning";
  message?: string;
  fix?: string;
}

export function AudioRelayDiagnostics({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<DiagnosticStep[]>([
    { id: "mic_permission", name: "Microphone Permission", status: "pending" },
    { id: "mic_capture", name: "Microphone Capture", status: "pending" },
    { id: "ws_connect", name: "WebSocket Connection", status: "pending" },
    { id: "agent_audio", name: "PC Agent Audio Support", status: "pending" },
    { id: "playback", name: "Audio Playback Test", status: "pending" },
  ]);
  const [progress, setProgress] = useState(0);

  const updateStep = useCallback((id: string, update: Partial<DiagnosticStep>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...update } : s));
  }, []);

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setProgress(0);
    
    // Reset all steps
    setSteps(prev => prev.map(s => ({ ...s, status: "pending", message: undefined, fix: undefined })));

    const WS_BASE = getFunctionsWsBase();
    const stepCount = 5;
    let currentStep = 0;

    // Step 1: Check microphone permission
    currentStep++;
    setProgress((currentStep / stepCount) * 100);
    updateStep("mic_permission", { status: "running" });
    addLog("info", "web", "Checking microphone permission...");

    try {
      const permissionStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (permissionStatus.state === "granted") {
        updateStep("mic_permission", { status: "success", message: "Microphone access granted" });
      } else if (permissionStatus.state === "prompt") {
        updateStep("mic_permission", { 
          status: "warning", 
          message: "Permission not yet granted",
          fix: "Click 'Allow' when prompted for microphone access"
        });
      } else {
        updateStep("mic_permission", { 
          status: "error", 
          message: "Microphone access denied",
          fix: "Go to browser settings → Site Settings → Microphone → Allow this site"
        });
      }
    } catch (e) {
      updateStep("mic_permission", { 
        status: "warning", 
        message: "Could not query permission",
        fix: "Try starting the audio relay - browser will prompt for permission"
      });
    }

    // Step 2: Test microphone capture
    currentStep++;
    setProgress((currentStep / stepCount) * 100);
    updateStep("mic_capture", { status: "running" });
    addLog("info", "web", "Testing microphone capture...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000 
        } 
      });
      
      // Check if we get audio data
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      source.connect(analyser);
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
      
      // Clean up
      stream.getTracks().forEach(t => t.stop());
      audioContext.close();
      
      updateStep("mic_capture", { status: "success", message: "Microphone capture working" });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      updateStep("mic_capture", { 
        status: "error", 
        message: `Capture failed: ${err}`,
        fix: err.includes("NotAllowed") 
          ? "Grant microphone permission in browser settings"
          : err.includes("NotFound")
          ? "No microphone detected - connect a microphone"
          : "Check if another app is using the microphone"
      });
    }

    // Step 3: Test WebSocket connection
    currentStep++;
    setProgress((currentStep / stepCount) * 100);
    updateStep("ws_connect", { status: "running" });
    addLog("info", "web", "Testing WebSocket connection to audio-relay...");

    try {
      const testSessionId = `diag-${Date.now()}`;
      const ws = new WebSocket(
        `${WS_BASE}/functions/v1/audio-relay?sessionId=${testSessionId}&type=phone&direction=phone_to_pc`
      );

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Connection timeout"));
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve();
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket error"));
        };
      });

      updateStep("ws_connect", { status: "success", message: "Audio relay WebSocket connected" });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      updateStep("ws_connect", { 
        status: "error", 
        message: `Connection failed: ${err}`,
        fix: "Check your internet connection. The edge function may be cold-starting - try again."
      });
    }

    // Step 4: Check PC agent audio support
    currentStep++;
    setProgress((currentStep / stepCount) * 100);
    updateStep("agent_audio", { status: "running" });
    addLog("info", "web", "Checking PC agent audio support...");

    try {
      const result = await sendCommand("check_audio_support", {}, { 
        awaitResult: true, 
        timeoutMs: 10000 
      });

      if (result.success && result.result) {
        const audioInfo = result.result as { 
          has_pyaudio?: boolean; 
          has_websockets?: boolean;
          error?: string;
        };
        
        if (audioInfo.has_pyaudio && audioInfo.has_websockets) {
          updateStep("agent_audio", { 
            status: "success", 
            message: "PC agent has audio support (pyaudio + websockets)" 
          });
        } else {
          const missing = [];
          if (!audioInfo.has_pyaudio) missing.push("pyaudio");
          if (!audioInfo.has_websockets) missing.push("websockets");
          updateStep("agent_audio", { 
            status: "error", 
            message: `Missing: ${missing.join(", ")}`,
            fix: `Install missing packages: pip install ${missing.join(" ")}`
          });
        }
      } else {
        updateStep("agent_audio", { 
          status: "warning", 
          message: "Agent did not respond or command not supported",
          fix: "Ensure PC agent is running and updated to latest version"
        });
      }
    } catch (e) {
      updateStep("agent_audio", { 
        status: "warning", 
        message: "Could not check agent audio support",
        fix: "Make sure the PC agent is running and connected"
      });
    }

    // Step 5: Audio playback test
    currentStep++;
    setProgress((currentStep / stepCount) * 100);
    updateStep("playback", { status: "running" });
    addLog("info", "web", "Testing audio playback...");

    try {
      const audioContext = new AudioContext();
      
      // Create a short test tone
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 440; // A4 note
      gainNode.gain.value = 0.1; // Low volume
      
      oscillator.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      oscillator.stop();
      
      audioContext.close();
      
      updateStep("playback", { status: "success", message: "Audio playback working" });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      updateStep("playback", { 
        status: "error", 
        message: `Playback failed: ${err}`,
        fix: "Check your speaker/headphone connection and system volume"
      });
    }

    setProgress(100);
    setIsRunning(false);
    addLog("info", "web", "Audio diagnostics complete");
  }, [sendCommand, updateStep]);

  const getStatusIcon = (status: DiagnosticStep["status"]) => {
    switch (status) {
      case "success": return <CheckCircle2 className="h-5 w-5 text-primary" />;
      case "error": return <XCircle className="h-5 w-5 text-destructive" />;
      case "warning": return <AlertTriangle className="h-5 w-5 text-warning" />;
      case "running": return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      default: return <div className="h-5 w-5 rounded-full border-2 border-muted" />;
    }
  };

  const overallStatus = steps.every(s => s.status === "success") 
    ? "success" 
    : steps.some(s => s.status === "error") 
    ? "error" 
    : steps.some(s => s.status === "warning")
    ? "warning"
    : "pending";

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-primary" />
          Audio Relay Diagnostics
        </CardTitle>
        <CardDescription>
          Test and diagnose issues with audio streaming between phone and PC
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        {isRunning && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              Running diagnostics... {Math.round(progress)}%
            </p>
          </div>
        )}

        {/* Diagnostic steps */}
        <div className="space-y-3">
          {steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                step.status === "success" && "bg-primary/5 border-primary/20",
                step.status === "error" && "bg-destructive/5 border-destructive/20",
                step.status === "warning" && "bg-warning/5 border-warning/20",
                step.status === "running" && "bg-primary/5 border-primary/30",
                step.status === "pending" && "bg-secondary/20 border-border/50"
              )}
            >
              {getStatusIcon(step.status)}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{step.name}</p>
                {step.message && (
                  <p className={cn(
                    "text-xs mt-0.5",
                    step.status === "error" ? "text-destructive" :
                    step.status === "warning" ? "text-warning" :
                    "text-muted-foreground"
                  )}>
                    {step.message}
                  </p>
                )}
                {step.fix && (
                  <p className="text-xs mt-1 text-primary font-medium">
                    💡 {step.fix}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        {!isRunning && overallStatus !== "pending" && (
          <div className={cn(
            "p-3 rounded-lg border",
            overallStatus === "success" && "bg-primary/10 border-primary/30",
            overallStatus === "error" && "bg-destructive/10 border-destructive/30",
            overallStatus === "warning" && "bg-warning/10 border-warning/30"
          )}>
            <div className="flex items-center gap-2">
              {overallStatus === "success" && <CheckCircle2 className="h-5 w-5 text-primary" />}
              {overallStatus === "error" && <XCircle className="h-5 w-5 text-destructive" />}
              {overallStatus === "warning" && <AlertTriangle className="h-5 w-5 text-warning" />}
              <span className="font-medium text-sm">
                {overallStatus === "success" && "All audio systems working!"}
                {overallStatus === "error" && "Some issues need attention"}
                {overallStatus === "warning" && "Minor issues detected"}
              </span>
            </div>
          </div>
        )}

        {/* Run button */}
        <Button
          onClick={runDiagnostics}
          disabled={isRunning}
          className="w-full"
          variant={overallStatus === "success" ? "outline" : "default"}
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running Diagnostics...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              {overallStatus === "pending" ? "Run Audio Diagnostics" : "Run Again"}
            </>
          )}
        </Button>

        {/* Quick tips */}
        <div className="p-3 rounded-lg bg-secondary/20 text-xs text-muted-foreground">
          <p className="font-medium mb-1">Common Issues:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>PC agent needs <code className="bg-secondary px-1 rounded">pyaudio</code> and <code className="bg-secondary px-1 rounded">websockets</code> packages</li>
            <li>On Windows, pyaudio may need Microsoft Visual C++ Build Tools</li>
            <li>Check browser console for WebSocket errors</li>
            <li>Ensure no other app is using the microphone exclusively</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
