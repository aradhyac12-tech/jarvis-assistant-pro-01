import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Camera,
  RefreshCw,
  Shield,
  Smartphone,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DiagnosticResult {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error" | "warning";
  errorName?: string;
  message?: string;
  fix?: string;
}

interface CameraTroubleshooterProps {
  onCameraReady?: (stream: MediaStream) => void;
  facingMode?: "user" | "environment";
  className?: string;
}

export function CameraTroubleshooter({
  onCameraReady,
  facingMode = "user",
  className,
}: CameraTroubleshooterProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [lastError, setLastError] = useState<{ name: string; message: string } | null>(null);

  const updateResult = useCallback((id: string, update: Partial<DiagnosticResult>) => {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...update } : r)));
  }, []);

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setLastError(null);

    const diagnostics: DiagnosticResult[] = [
      { id: "api", name: "Camera API Available", status: "pending" },
      { id: "permission", name: "Camera Permission", status: "pending" },
      { id: "access", name: "Camera Access", status: "pending" },
      { id: "stream", name: "Video Stream", status: "pending" },
    ];
    setResults(diagnostics);

    // Step 1: Check API availability
    updateResult("api", { status: "running" });
    if (!navigator.mediaDevices?.getUserMedia) {
      updateResult("api", {
        status: "error",
        errorName: "NotSupportedError",
        message: "Camera API not available",
        fix: "Use HTTPS or a modern browser (Chrome, Safari, Firefox)",
      });
      setIsRunning(false);
      return;
    }
    updateResult("api", { status: "success", message: "getUserMedia supported" });

    // Step 2: Check permission state
    updateResult("permission", { status: "running" });
    try {
      if (navigator.permissions?.query) {
        const permStatus = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (permStatus.state === "denied") {
          updateResult("permission", {
            status: "error",
            errorName: "NotAllowedError",
            message: "Permission denied",
            fix: "Reset camera permission in browser settings → Site Settings → Camera",
          });
          setIsRunning(false);
          return;
        } else if (permStatus.state === "prompt") {
          updateResult("permission", { status: "warning", message: "Permission will be requested" });
        } else {
          updateResult("permission", { status: "success", message: "Permission granted" });
        }
      } else {
        updateResult("permission", { status: "warning", message: "Cannot query permission state" });
      }
    } catch {
      updateResult("permission", { status: "warning", message: "Permission query not supported" });
    }

    // Step 3: Try to access camera
    updateResult("access", { status: "running" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      updateResult("permission", { status: "success", message: "Permission granted" });
      updateResult("access", { status: "success", message: "Camera accessible" });

      // Step 4: Check stream quality
      updateResult("stream", { status: "running" });
      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings();
        const resolution = `${settings.width || "?"}x${settings.height || "?"}`;
        const label = track.label || "Unknown camera";
        updateResult("stream", {
          status: "success",
          message: `${resolution} • ${label.substring(0, 30)}`,
        });

        // Success! Provide stream to parent
        if (onCameraReady) {
          onCameraReady(stream);
        } else {
          // Stop stream if no handler
          stream.getTracks().forEach((t) => t.stop());
        }
      } else {
        updateResult("stream", { status: "error", message: "No video track found" });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "UnknownError";
      const message = error instanceof Error ? error.message : String(error);
      setLastError({ name, message });

      // Map error to specific diagnostic
      switch (name) {
        case "NotAllowedError":
          updateResult("permission", {
            status: "error",
            errorName: name,
            message: "Access denied by user or policy",
            fix: "Tap 'Allow' when prompted, or reset in Site Settings → Camera",
          });
          updateResult("access", { status: "error", message: "Blocked" });
          break;

        case "NotFoundError":
          updateResult("access", {
            status: "error",
            errorName: name,
            message: "No camera found",
            fix: "Connect a camera or enable the built-in camera in device settings",
          });
          break;

        case "NotReadableError":
          updateResult("access", {
            status: "error",
            errorName: name,
            message: "Camera in use or hardware error",
            fix: "Close other apps using the camera (Zoom, Teams, etc.) and retry",
          });
          break;

        case "OverconstrainedError":
          updateResult("access", {
            status: "error",
            errorName: name,
            message: "Camera doesn't support requested settings",
            fix: "Try switching between front/back camera",
          });
          break;

        case "SecurityError":
          updateResult("access", {
            status: "error",
            errorName: name,
            message: "Security policy blocked camera",
            fix: "Ensure the page is served over HTTPS",
          });
          break;

        default:
          updateResult("access", {
            status: "error",
            errorName: name,
            message: message || "Unknown error",
            fix: "Try restarting the browser or device",
          });
      }

      updateResult("stream", { status: "error", message: "Cannot stream" });
    }

    setIsRunning(false);
  }, [facingMode, onCameraReady, updateResult]);

  const retryWithSettings = useCallback(() => {
    // Open browser settings (best effort)
    if (navigator.userAgent.includes("Android")) {
      window.open("intent://settings#Intent;scheme=android-settings;end", "_blank");
    } else if (navigator.userAgent.includes("iPhone") || navigator.userAgent.includes("iPad")) {
      // iOS doesn't allow opening settings directly
      alert("Go to Settings → Safari → Camera to allow access");
    } else {
      // Desktop: show instructions
      alert("Click the camera icon in the address bar or go to Site Settings → Camera");
    }
  }, []);

  const getStatusIcon = (status: DiagnosticResult["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case "error":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      default:
        return <div className="h-4 w-4 rounded-full border-2 border-muted" />;
    }
  };

  const hasErrors = results.some((r) => r.status === "error");
  const allSuccess = results.length > 0 && results.every((r) => r.status === "success");

  return (
    <Card className={cn("border-border/50 bg-card/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="h-5 w-5" />
          Camera Troubleshooter
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Run Diagnostics Button */}
        <Button
          onClick={runDiagnostics}
          disabled={isRunning}
          className="w-full"
          variant={allSuccess ? "outline" : "default"}
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Running Diagnostics...
            </>
          ) : (
            <>
              <Shield className="h-4 w-4 mr-2" />
              {results.length === 0 ? "Run Camera Check" : "Run Again"}
            </>
          )}
        </Button>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((result) => (
              <div
                key={result.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg text-sm",
                  result.status === "success" && "bg-primary/5",
                  result.status === "error" && "bg-destructive/10",
                  result.status === "warning" && "bg-warning/10",
                  result.status === "running" && "bg-primary/5"
                )}
              >
                {getStatusIcon(result.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{result.name}</span>
                    {result.errorName && (
                      <Badge variant="outline" className="text-xs font-mono">
                        {result.errorName}
                      </Badge>
                    )}
                  </div>
                  {result.message && (
                    <p className="text-muted-foreground text-xs mt-0.5">{result.message}</p>
                  )}
                  {result.fix && (
                    <p className="text-primary text-xs mt-1 flex items-start gap-1">
                      <span>💡</span>
                      <span>{result.fix}</span>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error Summary & Quick Actions */}
        {lastError && hasErrors && (
          <div className="border-t border-border/50 pt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <XCircle className="h-4 w-4 text-destructive" />
              <span className="font-medium">Error: </span>
              <code className="text-xs bg-destructive/10 px-1.5 py-0.5 rounded font-mono">
                {lastError.name}
              </code>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={runDiagnostics} disabled={isRunning}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry Camera
              </Button>
              <Button size="sm" variant="outline" onClick={retryWithSettings}>
                <Settings className="h-3.5 w-3.5 mr-1.5" />
                Open Settings
              </Button>
              {lastError.name === "NotReadableError" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    alert(
                      "Close these apps and retry:\n• Zoom\n• Microsoft Teams\n• Google Meet\n• FaceTime\n• Other camera apps"
                    );
                  }}
                >
                  <Smartphone className="h-3.5 w-3.5 mr-1.5" />
                  Check Other Apps
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Success State */}
        {allSuccess && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 text-primary text-sm">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">Camera ready! You can start streaming.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
