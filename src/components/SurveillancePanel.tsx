import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
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
  Settings,
  ChevronDown,
  ChevronUp,
  Video,
  Mic,
  MicOff,
  Zap,
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

interface RecordedClip {
  id: string;
  startTime: Date;
  endTime: Date;
  frames: string[]; // base64 frames
  motionConfidence: number;
}

export function SurveillancePanel({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  // Persisted Settings
  const [enabled, setEnabled] = useState(() => localStorage.getItem("surveillance_enabled") === "true");
  const [startTime, setStartTime] = useState(() => localStorage.getItem("surveillance_start") || "22:00");
  const [endTime, setEndTime] = useState(() => localStorage.getItem("surveillance_end") || "06:00");
  const [sensitivity, setSensitivity] = useState<"low" | "medium" | "high">(() => 
    (localStorage.getItem("surveillance_sensitivity") as "low" | "medium" | "high") || "medium"
  );
  const [alarmEnabled, setAlarmEnabled] = useState(() => localStorage.getItem("surveillance_alarm") === "true");
  const [sirenEnabled, setSirenEnabled] = useState(() => localStorage.getItem("surveillance_siren") === "true");
  const [autoCall, setAutoCall] = useState(() => localStorage.getItem("surveillance_autocall") === "true");
  const [recordOnMotion, setRecordOnMotion] = useState(() => localStorage.getItem("surveillance_record") !== "false");
  const [micEnabled, setMicEnabled] = useState(() => localStorage.getItem("surveillance_mic") === "true");

  // Runtime State
  const [monitoring, setMonitoring] = useState(false);
  const [motionEvents, setMotionEvents] = useState<MotionEvent[]>([]);
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  
  // Quality settings
  const [streamQuality, setStreamQuality] = useState(50);
  const [streamFps, setStreamFps] = useState(2);
  const [recordDuration, setRecordDuration] = useState(10); // seconds

  // Diagnostics
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState({
    framesReceived: 0,
    lastFrameTime: 0,
    motionDetections: 0,
    avgConfidence: 0,
    connectionErrors: 0,
  });

  // Recording state
  const [recordedClips, setRecordedClips] = useState<RecordedClip[]>([]);
  const recordingBufferRef = useRef<string[]>([]);
  const isRecordingRef = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);

  const pollingRef = useRef<number | null>(null);
  const previousFrameRef = useRef<ImageData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sensitivityThreshold = { low: 30, medium: 15, high: 5 };

  // Persistence Effects
  useEffect(() => localStorage.setItem("surveillance_enabled", String(enabled)), [enabled]);
  useEffect(() => localStorage.setItem("surveillance_start", startTime), [startTime]);
  useEffect(() => localStorage.setItem("surveillance_end", endTime), [endTime]);
  useEffect(() => localStorage.setItem("surveillance_sensitivity", sensitivity), [sensitivity]);
  useEffect(() => localStorage.setItem("surveillance_alarm", String(alarmEnabled)), [alarmEnabled]);
  useEffect(() => localStorage.setItem("surveillance_siren", String(sirenEnabled)), [sirenEnabled]);
  useEffect(() => localStorage.setItem("surveillance_autocall", String(autoCall)), [autoCall]);
  useEffect(() => localStorage.setItem("surveillance_record", String(recordOnMotion)), [recordOnMotion]);
  useEffect(() => localStorage.setItem("surveillance_mic", String(micEnabled)), [micEnabled]);

  const startSurveillance = useCallback(async () => {
    setIsStarting(true);
    try {
      // First verify agent is responsive with a ping
      const ping = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 5000 });
      if (!ping?.success) {
        toast({ title: "Agent not responding", description: "Start jarvis_agent.py on your PC", variant: "destructive" });
        setIsStarting(false);
        return;
      }

      setMonitoring(true);
      toast({ title: "Surveillance Active", description: "Motion detection & Camera monitoring started" });

      if (micEnabled) {
        sendCommand("start_audio_relay", { 
          session_id: crypto.randomUUID(), 
          direction: "pc_to_phone" 
        });
      }

      // Use camera polling
      pollingRef.current = window.setInterval(async () => {
        try {
          const shot = await sendCommand("take_camera_snapshot", { quality: streamQuality, camera_index: 0 }, { awaitResult: true, timeoutMs: 8000 });
          
          if (shot.success && (shot as any).result?.image) {
            const imageData = (shot as any).result.image;
            setLastFrame(`data:image/jpeg;base64,${imageData}`);
            setDiagnostics(prev => ({ ...prev, framesReceived: prev.framesReceived + 1, lastFrameTime: Date.now() }));
            detectMotion(imageData);
          }
        } catch {
          setDiagnostics(prev => ({ ...prev, connectionErrors: prev.connectionErrors + 1 }));
        }
      }, Math.max(1000, Math.round(1000 / streamFps)));
    } catch (err) {
      setDiagnostics(prev => ({ ...prev, connectionErrors: prev.connectionErrors + 1 }));
      toast({ title: "Surveillance error", description: err instanceof Error ? err.message : "Failed to start", variant: "destructive" });
    }
    setIsStarting(false);
  }, [sendCommand, toast, streamFps, streamQuality, micEnabled]);

  const stopSurveillance = useCallback(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setMonitoring(false);
    previousFrameRef.current = null;
    
    // Stop audio relay if it was running
    if (micEnabled) {
      sendCommand("stop_audio_relay", {});
    }
    
    toast({ title: "Surveillance Stopped" });
  }, [sendCommand, toast, micEnabled]);

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

        for (let i = 0; i < currentFrame.data.length; i += 16) { // Optimize: sample every 4th pixel
          const rDiff = Math.abs(currentFrame.data[i] - prev.data[i]);
          const gDiff = Math.abs(currentFrame.data[i + 1] - prev.data[i + 1]);
          const bDiff = Math.abs(currentFrame.data[i + 2] - prev.data[i + 2]);
          if (rDiff + gDiff + bDiff > threshold * 3) {
            diffPixels++;
          }
        }

        const changePercent = (diffPixels / (totalPixels / 4)) * 100;

        if (changePercent > 2) {
          const event: MotionEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            confidence: Math.min(100, Math.round(changePercent * 5)),
            screenshotUrl: `data:image/jpeg;base64,${base64Image}`,
          };

          setMotionEvents(prev => [event, ...prev].slice(0, 50));
          setDiagnostics(prev => ({
            ...prev,
            motionDetections: prev.motionDetections + 1,
            avgConfidence: Math.round(((prev.avgConfidence * prev.motionDetections) + event.confidence) / (prev.motionDetections + 1)),
          }));

          // Start recording clip on motion
          if (recordOnMotion && !isRecordingRef.current) {
            startRecordingClip(event.confidence);
          }

          triggerAlerts(event);
        }
      }

      // Always buffer latest frame for recording context
      if (isRecordingRef.current) {
        recordingBufferRef.current.push(base64Image);
        if (recordingBufferRef.current.length > 100) {
          recordingBufferRef.current = recordingBufferRef.current.slice(-100);
        }
      }

      previousFrameRef.current = currentFrame;
    };
    img.src = `data:image/jpeg;base64,${base64Image}`;
  }, [sensitivity, recordOnMotion]);

  const startRecordingClip = useCallback((confidence: number) => {
    isRecordingRef.current = true;
    recordingBufferRef.current = [];
    const startTime = new Date();

    recordingTimerRef.current = window.setTimeout(() => {
      isRecordingRef.current = false;
      const clip: RecordedClip = {
        id: crypto.randomUUID(),
        startTime,
        endTime: new Date(),
        frames: [...recordingBufferRef.current],
        motionConfidence: confidence,
      };
      setRecordedClips(prev => [clip, ...prev].slice(0, 20));
      recordingBufferRef.current = [];
      toast({ title: "Motion Clip Saved", description: `${clip.frames.length} frames recorded` });
    }, recordDuration * 1000);
  }, [recordDuration, toast]);

  const triggerAlerts = useCallback(async (event: MotionEvent) => {
    if (alarmEnabled) {
      await sendCommand("play_alarm", { type: sirenEnabled ? "siren" : "beep" });
    }

    if (autoCall) {
      await sendCommand("start_audio_relay", {
        session_id: crypto.randomUUID(),
        direction: "pc_to_phone",
        auto_call: true,
      });
    }
  }, [alarmEnabled, sirenEnabled, autoCall, sendCommand]);

  // Auto-start on load if previously enabled
  useEffect(() => {
    if (enabled && !monitoring && !isStarting) {
      const now = new Date();
      const currentMins = now.getHours() * 60 + now.getMinutes();
      const [startH, startM] = startTime.split(":").map(Number);
      const [endH, endM] = endTime.split(":").map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;

      const inSchedule = startMins <= endMins 
        ? currentMins >= startMins && currentMins <= endMins
        : currentMins >= startMins || currentMins <= endMins;

      if (inSchedule) {
        startSurveillance();
      }
    }
  }, []); // Run once on mount

  return (
    <Card className={cn("glass-dark border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Surveillance Guard
          {monitoring && (
            <Badge variant="destructive" className="ml-auto gap-1 animate-pulse">
              <Eye className="h-3 w-3" />
              LIVE
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Camera monitoring with motion detection & auto-alarms
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-secondary/50 to-secondary/30 border border-border/50">
          <div className="space-y-1">
            <Label className="text-base">Guard Mode</Label>
            <p className="text-xs text-muted-foreground">
              {monitoring ? "System active & monitoring" : "System disabled"}
            </p>
          </div>
          <Switch 
            checked={enabled} 
            onCheckedChange={(checked) => {
              setEnabled(checked);
              if (checked) startSurveillance();
              else stopSurveillance();
            }} 
          />
        </div>

        {/* Live Preview */}
        {lastFrame ? (
          <div className="relative aspect-video rounded-lg overflow-hidden bg-black border border-border/50 group">
            <img src={lastFrame} alt="Live View" className="w-full h-full object-contain" />
            <div className="absolute top-2 right-2 flex gap-1">
              <Badge variant="secondary" className="bg-black/50 backdrop-blur">
                CAM 1
              </Badge>
              {micEnabled && (
                <Badge variant="secondary" className="bg-emerald-500/80 text-white backdrop-blur">
                  <Mic className="w-3 h-3 mr-1" /> ON
                </Badge>
              )}
            </div>
            {/* Motion Indicators */}
            {motionEvents.length > 0 && (
              <div className="absolute bottom-2 left-2 right-2">
                <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
                  {motionEvents.slice(0, 5).map(e => (
                    <div key={e.id} className="h-8 w-12 bg-black/50 rounded border border-red-500/50 shrink-0 relative">
                      <div className="absolute bottom-0 left-0 h-1 bg-red-500" style={{ width: `${e.confidence}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="aspect-video rounded-lg bg-secondary/20 border border-dashed border-border/50 flex items-center justify-center text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <Video className="w-8 h-8 opacity-50" />
              <span className="text-xs">No Signal</span>
            </div>
          </div>
        )}

        {/* Settings Accordion */}
        <div className="rounded-lg border border-border/50 bg-secondary/10 overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-secondary/20 transition-colors"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
          >
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              Configuration
            </div>
            {showDiagnostics ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showDiagnostics && (
            <div className="p-3 space-y-4 border-t border-border/50 animate-in slide-in-from-top-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Start Time</Label>
                  <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="h-8" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">End Time</Label>
                  <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="h-8" />
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mic className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-xs">Listen (Audio)</Label>
                  </div>
                  <Switch checked={micEnabled} onCheckedChange={setMicEnabled} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-xs">Play PC Alarm</Label>
                  </div>
                  <Switch checked={alarmEnabled} onCheckedChange={setAlarmEnabled} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-xs">Auto-Call Me</Label>
                  </div>
                  <Switch checked={autoCall} onCheckedChange={setAutoCall} />
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-xs">
                  <Label>Sensitivity</Label>
                  <span className="text-muted-foreground capitalize">{sensitivity}</span>
                </div>
                <div className="flex gap-1">
                  {(["low", "medium", "high"] as const).map((s) => (
                    <Button
                      key={s}
                      variant={sensitivity === s ? "default" : "outline"}
                      size="sm"
                      className="flex-1 h-7 text-xs capitalize"
                      onClick={() => setSensitivity(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}