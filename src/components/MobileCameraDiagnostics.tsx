import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Camera,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Smartphone,
  Wifi,
  Image,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFunctionsWsBase } from "@/lib/relay";
import { addLog } from "@/components/IssueLog";

interface DiagnosticStep {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error" | "warning";
  message?: string;
  fix?: string;
}

export function MobileCameraDiagnostics({ className }: { className?: string }) {
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<DiagnosticStep[]>([
    { id: "cam_permission", name: "Camera Permission", status: "pending" },
    { id: "cam_access", name: "Camera Access", status: "pending" },
    { id: "video_stream", name: "Video Stream", status: "pending" },
    { id: "frame_capture", name: "Frame Capture", status: "pending" },
    { id: "relay_connection", name: "Relay Connection", status: "pending" },
  ]);
  const [progress, setProgress] = useState(0);
  const [previewFrame, setPreviewFrame] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const updateStep = useCallback((id: string, update: Partial<DiagnosticStep>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...update } : s));
  }, []);

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setProgress(0);
    setPreviewFrame(null);
    
    // Reset all steps
    setSteps(prev => prev.map(s => ({ ...s, status: "pending", message: undefined, fix: undefined })));

    const WS_BASE = getFunctionsWsBase();
    const stepCount = 5;
    let currentStep = 0;
    let testStream: MediaStream | null = null;

    try {
      // Step 1: Check camera permission
      currentStep++;
      setProgress((currentStep / stepCount) * 100);
      updateStep("cam_permission", { status: "running" });
      addLog("info", "web", "Checking camera permission...");

      try {
        const permissionStatus = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (permissionStatus.state === "granted") {
          updateStep("cam_permission", { status: "success", message: "Camera access granted" });
        } else if (permissionStatus.state === "prompt") {
          updateStep("cam_permission", { 
            status: "warning", 
            message: "Permission not yet granted",
            fix: "Click 'Allow' when prompted for camera access"
          });
        } else {
          updateStep("cam_permission", { 
            status: "error", 
            message: "Camera access denied",
            fix: "Go to browser settings → Site Settings → Camera → Allow this site"
          });
        }
      } catch (e) {
        updateStep("cam_permission", { 
          status: "warning", 
          message: "Could not query permission",
          fix: "Permission query not supported - will test access directly"
        });
      }

      // Step 2: Test camera access
      currentStep++;
      setProgress((currentStep / stepCount) * 100);
      updateStep("cam_access", { status: "running" });
      addLog("info", "web", "Testing camera access...");

      try {
        testStream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });

        const videoTrack = testStream.getVideoTracks()[0];
        if (videoTrack) {
          const settings = videoTrack.getSettings();
          updateStep("cam_access", { 
            status: "success", 
            message: `Camera: ${videoTrack.label || "Default"} (${settings.width}x${settings.height})`
          });
        } else {
          updateStep("cam_access", { 
            status: "error", 
            message: "No video track available",
            fix: "Check if camera is being used by another app"
          });
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        updateStep("cam_access", { 
          status: "error", 
          message: `Access failed: ${err}`,
          fix: err.includes("NotAllowed") 
            ? "Grant camera permission in browser settings"
            : err.includes("NotFound")
            ? "No camera detected - check camera connection"
            : err.includes("NotReadable")
            ? "Camera is in use by another app - close it and retry"
            : "Restart browser and try again"
        });
        setIsRunning(false);
        return;
      }

      // Step 3: Test video stream
      currentStep++;
      setProgress((currentStep / stepCount) * 100);
      updateStep("video_stream", { status: "running" });
      addLog("info", "web", "Testing video stream...");

      try {
        // Create a hidden video element to test stream
        const video = document.createElement("video");
        video.srcObject = testStream;
        video.muted = true;
        video.playsInline = true;
        videoRef.current = video;

        await video.play();
        
        // Wait a bit for video to stabilize
        await new Promise(resolve => setTimeout(resolve, 500));

        if (video.videoWidth > 0 && video.videoHeight > 0) {
          updateStep("video_stream", { 
            status: "success", 
            message: `Stream active: ${video.videoWidth}x${video.videoHeight}`
          });
        } else {
          updateStep("video_stream", { 
            status: "error", 
            message: "Video dimensions are 0",
            fix: "Camera may be returning black frames - check physical camera"
          });
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        updateStep("video_stream", { 
          status: "error", 
          message: `Stream error: ${err}`,
          fix: "Try refreshing the page or restarting the browser"
        });
      }

      // Step 4: Test frame capture
      currentStep++;
      setProgress((currentStep / stepCount) * 100);
      updateStep("frame_capture", { status: "running" });
      addLog("info", "web", "Testing frame capture...");

      try {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) {
          throw new Error("Video not available");
        }

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        
        if (!ctx) {
          throw new Error("Could not get canvas context");
        }

        ctx.drawImage(video, 0, 0);
        
        // Check if frame is not all black
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        let nonBlackPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 10 || pixels[i + 1] > 10 || pixels[i + 2] > 10) {
            nonBlackPixels++;
          }
        }
        
        const percentNonBlack = (nonBlackPixels / (pixels.length / 4)) * 100;
        
        if (percentNonBlack < 5) {
          updateStep("frame_capture", { 
            status: "warning", 
            message: "Frame is mostly black",
            fix: "Camera may need time to adjust - ensure lens is not covered"
          });
        } else {
          // Save preview frame
          const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
          setPreviewFrame(dataUrl);
          updateStep("frame_capture", { 
            status: "success", 
            message: `Frame captured successfully (${Math.round(percentNonBlack)}% content)`
          });
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        updateStep("frame_capture", { 
          status: "error", 
          message: `Capture failed: ${err}`,
          fix: "Browser may be blocking canvas access - check privacy settings"
        });
      }

      // Step 5: Test relay connection
      currentStep++;
      setProgress((currentStep / stepCount) * 100);
      updateStep("relay_connection", { status: "running" });
      addLog("info", "web", "Testing relay connection...");

      try {
        const testSessionId = `cam-diag-${Date.now()}`;
        const ws = new WebSocket(
          `${WS_BASE}/functions/v1/camera-relay?sessionId=${testSessionId}&type=phone&fps=10&quality=70`
        );

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error("Connection timeout"));
          }, 5000);

          ws.onopen = () => {
            clearTimeout(timeout);
            // Send a test frame
            if (previewFrame) {
              const b64 = previewFrame.split(",")[1];
              ws.send(JSON.stringify({ type: "camera_frame", data: b64 }));
            }
            setTimeout(() => {
              ws.close();
              resolve();
            }, 500);
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket error"));
          };
        });

        updateStep("relay_connection", { status: "success", message: "Camera relay connected and working" });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        updateStep("relay_connection", { 
          status: "error", 
          message: `Connection failed: ${err}`,
          fix: "Check internet connection. Edge function may be cold-starting - retry in a few seconds."
        });
      }

    } finally {
      // Cleanup
      if (testStream) {
        testStream.getTracks().forEach(t => t.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current = null;
      }
    }

    setProgress(100);
    setIsRunning(false);
    addLog("info", "web", "Mobile camera diagnostics complete");
  }, [updateStep, previewFrame]);

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
          <Smartphone className="h-5 w-5 text-primary" />
          Mobile Camera Diagnostics
        </CardTitle>
        <CardDescription>
          Test and diagnose issues with your phone's camera streaming
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

        {/* Preview frame */}
        {previewFrame && (
          <div className="relative aspect-video rounded-lg border border-border/50 overflow-hidden">
            <img src={previewFrame} alt="Camera preview" className="w-full h-full object-cover" />
            <Badge className="absolute top-2 left-2 bg-primary/80">
              <Image className="h-3 w-3 mr-1" />
              Test Frame
            </Badge>
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
                {overallStatus === "success" && "Camera is working correctly!"}
                {overallStatus === "error" && "Camera issues detected"}
                {overallStatus === "warning" && "Camera working with warnings"}
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
              {overallStatus === "pending" ? "Run Camera Diagnostics" : "Run Again"}
            </>
          )}
        </Button>

        {/* Quick tips */}
        <div className="p-3 rounded-lg bg-secondary/20 text-xs text-muted-foreground">
          <p className="font-medium mb-1">Black Screen Fixes:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Ensure camera permission is granted in browser settings</li>
            <li>Close other apps using the camera (video calls, etc.)</li>
            <li>Try switching between front and back camera</li>
            <li>Restart the browser if camera was recently used elsewhere</li>
            <li>On iOS Safari, ensure "Motion & Orientation Access" is enabled</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
