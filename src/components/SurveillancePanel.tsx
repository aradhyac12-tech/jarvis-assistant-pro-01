import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield,
  Eye,
  Bell,
  Volume2,
  Phone,
  Clock,
  Camera,
  AlertTriangle,
  Play,
  Square,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";

interface MotionEvent {
  id: string;
  timestamp: Date;
  confidence: number;
  screenshotUrl?: string;
}

export function SurveillancePanel({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [startTime, setStartTime] = useState("22:00");
  const [endTime, setEndTime] = useState("06:00");
  const [sensitivity, setSensitivity] = useState<"low" | "medium" | "high">("medium");
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [sirenEnabled, setSirenEnabled] = useState(false);
  const [autoCall, setAutoCall] = useState(false);
  const [callDirection, setCallDirection] = useState<"pc_to_phone" | "phone_to_pc">("pc_to_phone");
  const [motionEvents, setMotionEvents] = useState<MotionEvent[]>([]);
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const pollingRef = useRef<number | null>(null);
  const previousFrameRef = useRef<ImageData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sensitivityThreshold = { low: 30, medium: 15, high: 5 };

  const startSurveillance = useCallback(async () => {
    setIsStarting(true);
    try {
      // Tell PC agent to start sending camera frames for motion detection
      const res = await sendCommand("start_camera_stream", {
        session_id: crypto.randomUUID(),
        camera_index: 0,
        fps: 2, // Low FPS for surveillance (saves bandwidth)
        quality: 50,
        mode: "surveillance",
      }, { awaitResult: true, timeoutMs: 20000 });

      if (res.success) {
        setMonitoring(true);
        toast({ title: "Surveillance Active", description: "Motion detection started" });
        
        // Start polling for motion via screenshots
        pollingRef.current = window.setInterval(async () => {
          try {
            const shot = await sendCommand("take_screenshot", { quality: 40, scale: 0.3 }, { awaitResult: true, timeoutMs: 5000 });
            if (shot.success && (shot as any).result?.image) {
              const imageData = (shot as any).result.image;
              setLastFrame(`data:image/jpeg;base64,${imageData}`);
              detectMotion(imageData);
            }
          } catch {
            // ignore polling errors
          }
        }, 3000); // Check every 3 seconds
      } else {
        toast({ title: "Failed to start surveillance", variant: "destructive" });
      }
    } catch {
      toast({ title: "Surveillance error", variant: "destructive" });
    }
    setIsStarting(false);
  }, [sendCommand, toast]);

  const stopSurveillance = useCallback(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setMonitoring(false);
    previousFrameRef.current = null;
    sendCommand("stop_camera_stream", {});
    toast({ title: "Surveillance Stopped" });
  }, [sendCommand, toast]);

  const detectMotion = useCallback((base64Image: string) => {
    const img = new Image();
    img.onload = () => {
      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
      }
      const canvas = canvasRef.current;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (previousFrameRef.current) {
        const prev = previousFrameRef.current;
        let diffPixels = 0;
        const totalPixels = currentFrame.data.length / 4;
        const threshold = sensitivityThreshold[sensitivity];

        for (let i = 0; i < currentFrame.data.length; i += 16) { // Sample every 4th pixel for perf
          const rDiff = Math.abs(currentFrame.data[i] - prev.data[i]);
          const gDiff = Math.abs(currentFrame.data[i + 1] - prev.data[i + 1]);
          const bDiff = Math.abs(currentFrame.data[i + 2] - prev.data[i + 2]);
          if (rDiff + gDiff + bDiff > threshold * 3) {
            diffPixels++;
          }
        }

        const changePercent = (diffPixels / (totalPixels / 4)) * 100;

        if (changePercent > 2) { // More than 2% pixels changed
          const event: MotionEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            confidence: Math.min(100, Math.round(changePercent * 5)),
            screenshotUrl: `data:image/jpeg;base64,${base64Image}`,
          };
          
          setMotionEvents(prev => [event, ...prev].slice(0, 50));
          
          // Trigger alerts
          triggerAlerts(event);
        }
      }

      previousFrameRef.current = currentFrame;
    };
    img.src = `data:image/jpeg;base64,${base64Image}`;
  }, [sensitivity]);

  const triggerAlerts = useCallback(async (event: MotionEvent) => {
    // Browser notification
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("🚨 Motion Detected!", {
        body: `Activity detected with ${event.confidence}% confidence`,
        icon: "/favicon.ico",
      });
    } else if ("Notification" in window && Notification.permission !== "denied") {
      Notification.requestPermission();
    }

    toast({
      title: "🚨 Motion Detected!",
      description: `Confidence: ${event.confidence}%`,
      variant: "destructive",
    });

    if (alarmEnabled) {
      // Play alarm sound via PC
      await sendCommand("play_alarm", { type: sirenEnabled ? "siren" : "beep" });
    }

    if (autoCall) {
      // Trigger audio relay call
      await sendCommand("start_audio_relay", {
        session_id: crypto.randomUUID(),
        direction: callDirection === "pc_to_phone" ? "pc_to_phone" : "phone_to_pc",
        auto_call: true,
      });
    }
  }, [alarmEnabled, sirenEnabled, autoCall, callDirection, sendCommand, toast]);

  // Check if current time is within surveillance window
  const isInSchedule = useCallback(() => {
    const now = new Date();
    const hours = now.getHours();
    const mins = now.getMinutes();
    const currentMins = hours * 60 + mins;
    
    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;

    if (startMins <= endMins) {
      return currentMins >= startMins && currentMins <= endMins;
    }
    // Overnight schedule (e.g., 22:00 - 06:00)
    return currentMins >= startMins || currentMins <= endMins;
  }, [startTime, endTime]);

  // Auto-start/stop based on schedule
  useEffect(() => {
    if (!enabled) return;
    
    const checkSchedule = () => {
      const inSchedule = isInSchedule();
      if (inSchedule && !monitoring) {
        startSurveillance();
      } else if (!inSchedule && monitoring) {
        stopSurveillance();
      }
    };

    checkSchedule();
    const timer = window.setInterval(checkSchedule, 60000); // Check every minute
    return () => window.clearInterval(timer);
  }, [enabled, monitoring, isInSchedule, startSurveillance, stopSurveillance]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, []);

  return (
    <Card className={cn("glass-dark border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Surveillance
          {monitoring && (
            <Badge variant="destructive" className="ml-auto gap-1 animate-pulse">
              <Eye className="h-3 w-3" />
              MONITORING
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Motion detection with alerts, alarms, and auto-call
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Schedule */}
        <div className="grid gap-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <Label>Scheduled Monitoring</Label>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {enabled && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-secondary/10">
              <div className="space-y-1">
                <Label className="text-xs">Start Time</Label>
                <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End Time</Label>
                <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* Sensitivity */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
          <Label>Sensitivity</Label>
          <Select value={sensitivity} onValueChange={(v) => setSensitivity(v as any)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Alert Options */}
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <Label>Alarm Sound</Label>
            </div>
            <Switch checked={alarmEnabled} onCheckedChange={setAlarmEnabled} />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <Label>Siren Mode</Label>
            </div>
            <Switch checked={sirenEnabled} onCheckedChange={setSirenEnabled} />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <Label>Auto-Call on Motion</Label>
            </div>
            <Switch checked={autoCall} onCheckedChange={setAutoCall} />
          </div>

          {autoCall && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/10">
              <Label className="text-sm">Call Direction</Label>
              <Select value={callDirection} onValueChange={(v) => setCallDirection(v as any)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pc_to_phone">PC → Phone</SelectItem>
                  <SelectItem value="phone_to_pc">Phone → PC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Manual Controls */}
        <div className="flex items-center justify-center gap-3">
          {!monitoring ? (
            <Button
              onClick={startSurveillance}
              disabled={isStarting}
              className="gradient-primary"
            >
              {isStarting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Start Now
            </Button>
          ) : (
            <Button onClick={stopSurveillance} variant="destructive">
              <Square className="h-4 w-4 mr-2" />
              Stop Surveillance
            </Button>
          )}
        </div>

        {/* Live Preview */}
        {lastFrame && monitoring && (
          <div className="relative aspect-video bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
            <img src={lastFrame} alt="Surveillance feed" className="w-full h-full object-cover" />
            <Badge className="absolute top-2 left-2 bg-destructive/80">
              <Camera className="h-3 w-3 mr-1" />
              LIVE
            </Badge>
          </div>
        )}

        {/* Motion Events Log */}
        {motionEvents.length > 0 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Recent Motion Events ({motionEvents.length})
            </Label>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {motionEvents.slice(0, 10).map(event => (
                <div key={event.id} className="flex items-center justify-between p-2 rounded bg-destructive/10 border border-destructive/20 text-sm">
                  <span className="text-muted-foreground">
                    {event.timestamp.toLocaleTimeString()}
                  </span>
                  <Badge variant="destructive" className="text-xs">
                    {event.confidence}% confidence
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
