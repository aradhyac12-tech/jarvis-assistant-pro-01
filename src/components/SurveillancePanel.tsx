import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Download,
  Activity,
  Wifi,
  WifiOff,
  CheckCircle,
  XCircle,
  HardDrive,
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
import { DetailedDiagnostics } from "@/components/DetailedDiagnostics";

interface MotionEvent {
  id: string;
  timestamp: Date;
  confidence: number;
  screenshotUrl?: string;
  videoClipUrl?: string;
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

  // Quality settings
  const [streamQuality, setStreamQuality] = useState(50);
  const [streamFps, setStreamFps] = useState(2);
  const [recordOnMotion, setRecordOnMotion] = useState(true);
  const [recordDuration, setRecordDuration] = useState(10); // seconds

  // Diagnostics
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState({
    relayConnected: false,
    agentResponding: false,
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

  // Audio preview
  const [audioPreviewActive, setAudioPreviewActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const pollingRef = useRef<number | null>(null);
  const previousFrameRef = useRef<ImageData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sensitivityThreshold = { low: 30, medium: 15, high: 5 };

  const startSurveillance = useCallback(async () => {
    setIsStarting(true);
    try {
      // First verify agent is responsive with a ping
      const ping = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 8000 });
      if (!ping?.success) {
        toast({ title: "Agent not responding", description: "Start jarvis_agent.py on your PC", variant: "destructive" });
        setIsStarting(false);
        return;
      }

      setMonitoring(true);
      setDiagnostics(prev => ({ ...prev, relayConnected: true, agentResponding: true }));
      toast({ title: "Surveillance Active", description: "Motion detection started via screenshot polling" });

      // Use screenshot polling - more reliable than camera stream for surveillance
      pollingRef.current = window.setInterval(async () => {
        try {
          const shot = await sendCommand("take_screenshot", { quality: streamQuality, scale: 0.3 }, { awaitResult: true, timeoutMs: 8000 });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendCommand, toast, streamFps, streamQuality]);

  const stopSurveillance = useCallback(() => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setMonitoring(false);
    previousFrameRef.current = null;
    sendCommand("stop_camera_stream", {});
    setDiagnostics(prev => ({ ...prev, relayConnected: false }));
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

        for (let i = 0; i < currentFrame.data.length; i += 16) {
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

          // Buffer frame for recording
          if (isRecordingRef.current) {
            recordingBufferRef.current.push(base64Image);
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

  const downloadClip = useCallback((clip: RecordedClip) => {
    // Download the best frame (first frame with motion) as a JPEG
    if (clip.frames.length > 0) {
      const link = document.createElement("a");
      link.href = `data:image/jpeg;base64,${clip.frames[0]}`;
      link.download = `motion_${clip.startTime.toISOString().replace(/[:.]/g, "-")}.jpg`;
      link.click();
    }
  }, []);

  const triggerAlerts = useCallback(async (event: MotionEvent) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("🚨 Motion Detected!", {
        body: `Activity detected with ${event.confidence}% confidence at ${event.timestamp.toLocaleTimeString()}`,
        icon: "/favicon.ico",
      });
    } else if ("Notification" in window && Notification.permission !== "denied") {
      Notification.requestPermission();
    }

    toast({
      title: "🚨 Motion Detected!",
      description: `Confidence: ${event.confidence}% at ${event.timestamp.toLocaleTimeString()}`,
      variant: "destructive",
    });

    if (alarmEnabled) {
      await sendCommand("play_alarm", { type: sirenEnabled ? "siren" : "beep" });
    }

    if (autoCall) {
      await sendCommand("start_audio_relay", {
        session_id: crypto.randomUUID(),
        direction: callDirection === "pc_to_phone" ? "pc_to_phone" : "phone_to_pc",
        auto_call: true,
      });
    }
  }, [alarmEnabled, sirenEnabled, autoCall, callDirection, sendCommand, toast]);

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
    return currentMins >= startMins || currentMins <= endMins;
  }, [startTime, endTime]);

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
    const timer = window.setInterval(checkSchedule, 60000);
    return () => window.clearInterval(timer);
  }, [enabled, monitoring, isInSchedule, startSurveillance, stopSurveillance]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
      if (recordingTimerRef.current) {
        window.clearTimeout(recordingTimerRef.current);
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
          {isRecordingRef.current && (
            <Badge variant="outline" className="gap-1 border-destructive text-destructive">
              <Video className="h-3 w-3" />
              REC
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Motion detection with recording, alerts, alarms, and auto-call
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

        {/* Quality & Recording Settings */}
        <div className="rounded-lg border border-border/50 bg-secondary/10 overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-3 text-sm font-medium"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
          >
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              Quality & Recording Settings
            </div>
            {showDiagnostics ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showDiagnostics && (
            <div className="p-3 space-y-4 border-t border-border/50">
              {/* Quality Slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <Label>Stream Quality</Label>
                  <span className="text-muted-foreground">{streamQuality}%</span>
                </div>
                <Slider
                  value={[streamQuality]}
                  onValueChange={([v]) => setStreamQuality(v)}
                  min={10}
                  max={90}
                  step={10}
                  disabled={monitoring}
                />
              </div>

              {/* FPS */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <Label>Check Frequency</Label>
                  <span className="text-muted-foreground">{streamFps} fps</span>
                </div>
                <Slider
                  value={[streamFps]}
                  onValueChange={([v]) => setStreamFps(v)}
                  min={1}
                  max={5}
                  step={1}
                  disabled={monitoring}
                />
              </div>

              {/* Record on Motion */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-muted-foreground" />
                  <Label>Record on Motion</Label>
                </div>
                <Switch checked={recordOnMotion} onCheckedChange={setRecordOnMotion} />
              </div>

              {recordOnMotion && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <Label>Record Duration</Label>
                    <span className="text-muted-foreground">{recordDuration}s</span>
                  </div>
                  <Slider
                    value={[recordDuration]}
                    onValueChange={([v]) => setRecordDuration(v)}
                    min={5}
                    max={60}
                    step={5}
                  />
                </div>
              )}

              {/* Diagnostics Info */}
              <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-background/50 text-xs">
                <div className="flex items-center gap-2">
                  {diagnostics.relayConnected ? (
                    <Wifi className="h-3 w-3 text-primary" />
                  ) : (
                    <WifiOff className="h-3 w-3 text-destructive" />
                  )}
                  <span>Relay: {diagnostics.relayConnected ? "Connected" : "Disconnected"}</span>
                </div>
                <div className="flex items-center gap-2">
                  {diagnostics.agentResponding ? (
                    <CheckCircle className="h-3 w-3 text-primary" />
                  ) : (
                    <XCircle className="h-3 w-3 text-destructive" />
                  )}
                  <span>Agent: {diagnostics.agentResponding ? "Active" : "Inactive"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Camera className="h-3 w-3 text-muted-foreground" />
                  <span>Frames: {diagnostics.framesReceived}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Activity className="h-3 w-3 text-muted-foreground" />
                  <span>Detections: {diagnostics.motionDetections}</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3 text-muted-foreground" />
                  <span>Avg Conf: {diagnostics.avgConfidence}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <HardDrive className="h-3 w-3 text-muted-foreground" />
                  <span>Errors: {diagnostics.connectionErrors}</span>
                </div>
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

        {/* Audio Preview Toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
          <div className="flex items-center gap-2">
            {audioPreviewActive ? <Mic className="h-4 w-4 text-primary" /> : <MicOff className="h-4 w-4 text-muted-foreground" />}
            <Label>Audio Preview (Listen via PC Mic)</Label>
          </div>
          <Switch
            checked={audioPreviewActive}
            onCheckedChange={async (checked) => {
              setAudioPreviewActive(checked);
              if (checked && monitoring) {
                await sendCommand("start_audio_relay", {
                  session_id: crypto.randomUUID(),
                  direction: "pc_to_phone",
                });
                toast({ title: "Audio Preview Started", description: "Listening to PC microphone" });
              } else {
                await sendCommand("stop_audio_relay", {});
              }
            }}
          />
        </div>

        {/* Detailed Diagnostics */}
        <DetailedDiagnostics
          mode="pc-camera"
          isStreamActive={monitoring}
          currentFps={diagnostics.framesReceived > 0 ? streamFps : 0}
        />

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
            {isRecordingRef.current && (
              <Badge className="absolute top-2 right-2 bg-destructive animate-pulse">
                <Video className="h-3 w-3 mr-1" />
                REC
              </Badge>
            )}
          </div>
        )}

        {/* Recorded Clips */}
        {recordedClips.length > 0 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Video className="h-4 w-4 text-primary" />
              Recorded Clips ({recordedClips.length})
            </Label>
            <ScrollArea className="max-h-48">
              <div className="space-y-1">
                {recordedClips.map(clip => (
                  <div key={clip.id} className="flex items-center justify-between p-2 rounded bg-primary/10 border border-primary/20 text-sm">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">
                        {clip.startTime.toLocaleTimeString()} - {clip.endTime.toLocaleTimeString()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {clip.frames.length} frames • {clip.motionConfidence}% confidence
                      </span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => downloadClip(clip)}>
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Motion Events Log */}
        {motionEvents.length > 0 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Recent Motion Events ({motionEvents.length})
            </Label>
            <ScrollArea className="max-h-48">
              <div className="space-y-1">
                {motionEvents.slice(0, 10).map(event => (
                  <div key={event.id} className="flex items-center justify-between p-2 rounded bg-destructive/10 border border-destructive/20 text-sm">
                    <span className="text-muted-foreground">
                      {event.timestamp.toLocaleTimeString()} – {event.timestamp.toLocaleDateString()}
                    </span>
                    <Badge variant="destructive" className="text-xs">
                      {event.confidence}% confidence
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
