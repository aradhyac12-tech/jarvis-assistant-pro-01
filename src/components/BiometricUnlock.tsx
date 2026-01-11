import { useState, useRef, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Camera,
  Fingerprint,
  Key,
  Loader2,
  CheckCircle,
  XCircle,
  RefreshCw,
  User,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface BiometricUnlockProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlockSuccess: () => void;
  correctPin?: string;
}

export function BiometricUnlock({
  open,
  onOpenChange,
  onUnlockSuccess,
  correctPin = "1212",
}: BiometricUnlockProps) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockMethod, setUnlockMethod] = useState<"pin" | "face">("pin");
  
  // Face recognition state
  const [cameraActive, setCameraActive] = useState(false);
  const [faceStatus, setFaceStatus] = useState<"idle" | "scanning" | "success" | "failed">("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  // Start camera for face unlock
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
      setFaceStatus("scanning");
    } catch (error) {
      console.error("Camera error:", error);
      toast({
        title: "Camera Access Denied",
        description: "Please grant camera permission for face unlock",
        variant: "destructive",
      });
    }
  }, [toast]);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setFaceStatus("idle");
  }, []);

  // Capture face and send to PC for verification
  const captureAndVerify = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0);
    const imageData = canvas.toDataURL("image/jpeg", 0.8);
    const base64 = imageData.split(",")[1];
    
    setCapturedImage(imageData);
    setFaceStatus("scanning");

    try {
      // Send face image to PC agent for verification
      const result = await sendCommand(
        "verify_face",
        { image: base64 },
        { awaitResult: true, timeoutMs: 15000 }
      );

      const resultData = "result" in result ? result.result : null;
      const verified = resultData && typeof resultData === "object" && "verified" in resultData && resultData.verified;

      if (result.success && verified) {
        setFaceStatus("success");
        toast({ title: "Face Verified", description: "Unlocking PC..." });
        
        // Trigger actual unlock
        await performUnlock();
      } else {
        setFaceStatus("failed");
        const message = resultData && typeof resultData === "object" && "message" in resultData 
          ? String(resultData.message) 
          : "Try again or use PIN";
        toast({
          title: "Face Not Recognized",
          description: message,
          variant: "destructive",
        });
      }
    } catch (error) {
      setFaceStatus("failed");
      toast({
        title: "Verification Failed",
        description: "Could not verify face. Try PIN unlock.",
        variant: "destructive",
      });
    }
  }, [sendCommand, toast]);

  // Perform the actual unlock
  const performUnlock = async () => {
    setIsUnlocking(true);
    
    const res = await sendCommand("unlock", { pin: correctPin }, { awaitResult: true, timeoutMs: 10000 });

    if (res.success) {
      toast({ title: "PC Unlocked", description: "Unlock completed successfully" });
      onUnlockSuccess();
      onOpenChange(false);
    } else {
      toast({
        title: "Unlock Failed",
        description: typeof (res as any).error === "string" ? (res as any).error : "Check the PC lock screen",
        variant: "destructive",
      });
    }
    
    setIsUnlocking(false);
  };

  // Handle PIN unlock
  const handlePinUnlock = async () => {
    if (pinInput !== correctPin) {
      setPinError(true);
      setPinInput("");
      return;
    }

    setPinError(false);
    await performUnlock();
  };

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      stopCamera();
      setPinInput("");
      setPinError(false);
      setFaceStatus("idle");
      setCapturedImage(null);
    }
  }, [open, stopCamera]);

  // Auto-start camera when face tab is selected
  useEffect(() => {
    if (open && unlockMethod === "face" && !cameraActive) {
      startCamera();
    } else if (unlockMethod !== "face" && cameraActive) {
      stopCamera();
    }
  }, [open, unlockMethod, cameraActive, startCamera, stopCamera]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md glass-dark">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Smart Unlock
          </DialogTitle>
          <DialogDescription>
            Unlock your PC using PIN or Face Recognition
          </DialogDescription>
        </DialogHeader>

        <Tabs value={unlockMethod} onValueChange={(v) => setUnlockMethod(v as "pin" | "face")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pin" className="gap-2">
              <Key className="h-4 w-4" />
              PIN Code
            </TabsTrigger>
            <TabsTrigger value="face" className="gap-2">
              <Camera className="h-4 w-4" />
              Face Unlock
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pin" className="mt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pin">Enter PIN</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="Enter unlock PIN"
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value.replace(/\D/g, ""));
                    setPinError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handlePinUnlock();
                  }}
                  className={cn(pinError && "border-destructive")}
                />
                {pinError && (
                  <p className="text-sm text-destructive">Incorrect PIN. Try again.</p>
                )}
              </div>

              <Button
                onClick={handlePinUnlock}
                disabled={!pinInput || isUnlocking}
                className="w-full gradient-primary"
              >
                {isUnlocking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Unlocking...
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4 mr-2" />
                    Unlock with PIN
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="face" className="mt-4">
            <div className="space-y-4">
              {/* Camera preview */}
              <div className="relative aspect-video bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
                {cameraActive ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    
                    {/* Face detection overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div
                        className={cn(
                          "w-48 h-48 rounded-full border-4 transition-colors",
                          faceStatus === "scanning" && "border-primary animate-pulse",
                          faceStatus === "success" && "border-neon-green",
                          faceStatus === "failed" && "border-destructive"
                        )}
                      />
                    </div>

                    {/* Status badge */}
                    <Badge
                      className={cn(
                        "absolute top-3 left-3",
                        faceStatus === "scanning" && "bg-primary",
                        faceStatus === "success" && "bg-neon-green",
                        faceStatus === "failed" && "bg-destructive"
                      )}
                    >
                      {faceStatus === "scanning" && (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Scanning...
                        </>
                      )}
                      {faceStatus === "success" && (
                        <>
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Verified
                        </>
                      )}
                      {faceStatus === "failed" && (
                        <>
                          <XCircle className="h-3 w-3 mr-1" />
                          Not Recognized
                        </>
                      )}
                    </Badge>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                    <User className="h-12 w-12 mb-2 opacity-50" />
                    <p className="text-sm">Camera starting...</p>
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3">
                <Button
                  onClick={captureAndVerify}
                  disabled={!cameraActive || faceStatus === "scanning" || isUnlocking}
                  className="gradient-primary"
                >
                  {faceStatus === "scanning" || isUnlocking ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {isUnlocking ? "Unlocking..." : "Verifying..."}
                    </>
                  ) : (
                    <>
                      <Fingerprint className="h-4 w-4 mr-2" />
                      Verify Face
                    </>
                  )}
                </Button>
                
                {faceStatus === "failed" && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFaceStatus("scanning");
                      setCapturedImage(null);
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                )}
              </div>

              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-xs text-muted-foreground">
                  <strong>Note:</strong> Face unlock requires the PC agent with face recognition
                  (face_recognition, opencv-python) installed. Position your face within the circle.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
