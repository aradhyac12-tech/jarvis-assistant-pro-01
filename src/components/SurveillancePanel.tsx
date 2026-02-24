import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Shield,
  Eye,
  Bell,
  Volume2,
  Phone,
  Camera,
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
  Siren,
  AlertTriangle,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useToast } from "@/hooks/use-toast";
import { addLog } from "@/components/IssueLog";
import { getFunctionsWsBase } from "@/lib/relay";

interface MotionEvent {
  id: string;
  timestamp: Date;
  confidence: number;
}

export function SurveillancePanel({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const { toast } = useToast();

  // Persisted Settings
  const [startTime, setStartTime] = useState(() => localStorage.getItem("surveillance_start") || "22:00");
  const [endTime, setEndTime] = useState(() => localStorage.getItem("surveillance_end") || "06:00");
  const [sensitivity, setSensitivity] = useState<"low" | "medium" | "high">(() =>
    (localStorage.getItem("surveillance_sensitivity") as "low" | "medium" | "high") || "medium"
  );
  const [alarmEnabled, setAlarmEnabled] = useState(() => localStorage.getItem("surveillance_alarm") === "true");
  const [sirenEnabled, setSirenEnabled] = useState(() => localStorage.getItem("surveillance_siren") === "true");
  const [autoCall, setAutoCall] = useState(() => localStorage.getItem("surveillance_autocall") === "true");
  const [micEnabled, setMicEnabled] = useState(() => localStorage.getItem("surveillance_mic") === "true");
  const [survFps, setSurvFps] = useState(() => parseInt(localStorage.getItem("surveillance_fps") || "15"));
  const [survQuality, setSurvQuality] = useState(() => parseInt(localStorage.getItem("surveillance_quality") || "50"));

  // Runtime State
  const [monitoring, setMonitoring] = useState(() => localStorage.getItem("surveillance_monitoring") === "true");
  const [motionEvents, setMotionEvents] = useState<MotionEvent[]>([]);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [liveFps, setLiveFps] = useState(0);
  const [sirenActive, setSirenActive] = useState(false);
  const [callActive, setCallActive] = useState(false);

  // Refs for streaming
  const wsRef = useRef<WebSocket | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const fpsCounterRef = useRef({ frames: 0, lastCheck: Date.now() });
  const previousFrameRef = useRef<ImageData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sensitivityThreshold = { low: 30, medium: 15, high: 5 };

  // Persistence Effects
  useEffect(() => localStorage.setItem("surveillance_start", startTime), [startTime]);
  useEffect(() => localStorage.setItem("surveillance_end", endTime), [endTime]);
  useEffect(() => localStorage.setItem("surveillance_sensitivity", sensitivity), [sensitivity]);
  useEffect(() => localStorage.setItem("surveillance_alarm", String(alarmEnabled)), [alarmEnabled]);
  useEffect(() => localStorage.setItem("surveillance_siren", String(sirenEnabled)), [sirenEnabled]);
  useEffect(() => localStorage.setItem("surveillance_autocall", String(autoCall)), [autoCall]);
  useEffect(() => localStorage.setItem("surveillance_mic", String(micEnabled)), [micEnabled]);
  useEffect(() => localStorage.setItem("surveillance_fps", String(survFps)), [survFps]);
  useEffect(() => localStorage.setItem("surveillance_quality", String(survQuality)), [survQuality]);
  useEffect(() => localStorage.setItem("surveillance_monitoring", String(monitoring)), [monitoring]);

  const cleanupWs = useCallback(() => {
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* */ }
      wsRef.current = null;
    }
    fpsCounterRef.current = { frames: 0, lastCheck: Date.now() };
  }, []);

  const detectMotion = useCallback((base64OrBlob: string) => {
    const img = new Image();
    img.onload = () => {
      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      const canvas = canvasRef.current;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (previousFrameRef.current) {
        const prev = previousFrameRef.current;
        let diffPixels = 0;
        const totalSampled = frame.data.length / 16;
        const threshold = sensitivityThreshold[sensitivity];
        for (let i = 0; i < frame.data.length; i += 16) {
          const d = Math.abs(frame.data[i] - prev.data[i]) +
                    Math.abs(frame.data[i+1] - prev.data[i+1]) +
                    Math.abs(frame.data[i+2] - prev.data[i+2]);
          if (d > threshold * 3) diffPixels++;
        }
        const changePercent = (diffPixels / totalSampled) * 100;
        if (changePercent > 2) {
          const event: MotionEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            confidence: Math.min(100, Math.round(changePercent * 5)),
          };
          setMotionEvents(prev => [event, ...prev].slice(0, 50));
          triggerAlerts(event);
        }
      }
      previousFrameRef.current = frame;
    };
    img.src = base64OrBlob;
  }, [sensitivity]);

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

  const toggleSiren = useCallback(async () => {
    if (sirenActive) {
      // Stop siren
      await sendCommand("play_alarm", { type: "siren", action: "stop" });
      setSirenActive(false);
      toast({ title: "Siren Stopped" });
    } else {
      // Start siren - set volume to max first
      setSirenActive(true);
      await sendCommand("set_volume", { level: 100 }, { awaitResult: true, timeoutMs: 3000 });
      await sendCommand("play_alarm", { type: "siren", action: "start" });
      toast({ title: "🚨 SIREN ACTIVATED", description: "Max volume + siren on PC" });
    }
  }, [sendCommand, toast, sirenActive]);

  const toggleCall = useCallback(async () => {
    if (callActive) {
      // Stop call (stop audio relay)
      await sendCommand("stop_audio_relay", {});
      setCallActive(false);
      toast({ title: "Call Ended" });
    } else {
      // Start call via audio relay (bidirectional)
      const sessionId = crypto.randomUUID();
      await sendCommand("start_audio_relay", {
        session_id: sessionId,
        direction: "bidirectional",
      });
      setCallActive(true);
      toast({ title: "📞 Call Started", description: "Bidirectional audio via relay" });
    }
  }, [sendCommand, toast, callActive]);

  const startSurveillance = useCallback(async () => {
    setIsStarting(true);
    try {
      if (!session?.session_token) {
        toast({ title: "Not Paired", description: "Connect to your PC first", variant: "destructive" });
        setIsStarting(false);
        return;
      }

      const sessionId = crypto.randomUUID();
      const WS_BASE = getFunctionsWsBase();
      const wsUrl = `${WS_BASE}/functions/v1/camera-relay?sessionId=${sessionId}&type=pc&fps=${survFps}&quality=${survQuality}&binary=true&session_token=${session.session_token}`;

      // Connect WebSocket with retry
      let ws: WebSocket | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        try {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => { ws!.close(); reject(new Error("timeout")); }, 10000);
            ws!.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
            ws!.addEventListener("error", () => { clearTimeout(t); reject(new Error("ws error")); }, { once: true });
          });
          break;
        } catch {
          addLog("warn", "web", `Surveillance WS attempt ${attempt + 1} failed, retrying...`);
          if (attempt === 2) {
            toast({ title: "Connection Failed", description: "Could not connect to relay. Try again.", variant: "destructive" });
            setIsStarting(false);
            return;
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setIsStarting(false);
        return;
      }

      wsRef.current = ws;

      ws.onmessage = async (event) => {
        const now = Date.now();
        try {
          let arrayBuffer: ArrayBuffer | null = null;
          if (event.data instanceof ArrayBuffer) arrayBuffer = event.data;
          else if (event.data instanceof Blob && event.data.size > 0) arrayBuffer = await event.data.arrayBuffer();

          if (arrayBuffer && arrayBuffer.byteLength > 100) {
            const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
            const newUrl = URL.createObjectURL(blob);
            if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
            currentBlobUrlRef.current = newUrl;
            setCurrentFrame(newUrl);

            fpsCounterRef.current.frames++;
            const elapsed = now - fpsCounterRef.current.lastCheck;
            if (elapsed >= 1000) {
              setLiveFps(Math.round((fpsCounterRef.current.frames * 1000) / elapsed));
              fpsCounterRef.current = { frames: 0, lastCheck: now };
            }

            if (fpsCounterRef.current.frames % 3 === 0) {
              detectMotion(newUrl);
            }
            return;
          }

          if (typeof event.data === "string") {
            const data = JSON.parse(event.data);
            if (data.type === "camera_frame" && data.data) {
              const src = `data:image/jpeg;base64,${data.data}`;
              setCurrentFrame(src);
              detectMotion(src);
            }
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        if (monitoring) {
          addLog("warn", "web", "Surveillance WS closed unexpectedly");
        }
        cleanupWs();
        setMonitoring(false);
      };

      // Fire-and-forget: don't block on result since agent may be slow
      sendCommand("start_camera_stream", {
        session_id: sessionId,
        camera_index: 0,
        fps: survFps,
        quality: survQuality,
      }, { awaitResult: false }).then((result) => {
        if (!result.success) {
          addLog("warn", "agent", `Surveillance camera command queuing issue: ${result.error}`);
        } else {
          addLog("info", "agent", "Surveillance camera command sent to PC");
        }
      });

      // Start audio if enabled
      if (micEnabled) {
        sendCommand("start_audio_relay", {
          session_id: crypto.randomUUID(),
          direction: "pc_to_phone",
        }, { awaitResult: false });
      }

      setMonitoring(true);
      toast({ title: "Surveillance Active", description: `Live camera + motion detection at ${survFps} FPS` });
    } catch (err) {
      toast({ title: "Surveillance error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    }
    setIsStarting(false);
  }, [sendCommand, toast, session, micEnabled, cleanupWs, detectMotion, monitoring, survFps, survQuality]);

  const stopSurveillance = useCallback(() => {
    sendCommand("stop_camera_stream", {});
    if (micEnabled) sendCommand("stop_audio_relay", {});
    cleanupWs();
    setMonitoring(false);
    setCurrentFrame(null);
    previousFrameRef.current = null;
    setLiveFps(0);
    toast({ title: "Surveillance Stopped" });
  }, [sendCommand, toast, micEnabled, cleanupWs]);

  // Cleanup on unmount
  useEffect(() => () => { cleanupWs(); }, [cleanupWs]);

  return (
    <Card className={cn("glass-dark border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Surveillance Guard
          {monitoring && (
            <Badge variant="destructive" className="ml-auto gap-1 animate-pulse">
              <Eye className="h-3 w-3" /> LIVE
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Continuous camera monitoring with motion detection</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Start / Stop Button */}
        <div className="flex gap-2">
          {!monitoring ? (
            <Button
              onClick={startSurveillance}
              disabled={isStarting}
              className="flex-1 h-12 gradient-primary"
            >
              {isStarting ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <Play className="h-5 w-5 mr-2" />
              )}
              {isStarting ? "Connecting..." : "Start Surveillance"}
            </Button>
          ) : (
            <Button
              onClick={stopSurveillance}
              variant="destructive"
              className="flex-1 h-12"
            >
              <Square className="h-5 w-5 mr-2" />
              Stop Surveillance
            </Button>
          )}
        </div>

        {/* Siren Toggle */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={sirenActive ? "default" : "destructive"}
            className={cn("h-12 text-sm font-bold gap-2", sirenActive && "bg-destructive animate-pulse")}
            onClick={toggleSiren}
          >
            <AlertTriangle className="h-5 w-5" />
            {sirenActive ? "🔇 Stop Siren" : "🚨 Start Siren"}
          </Button>
          <Button
            variant={callActive ? "default" : "outline"}
            className={cn("h-12 text-sm font-bold gap-2", callActive && "bg-primary animate-pulse")}
            onClick={toggleCall}
          >
            <Phone className="h-5 w-5" />
            {callActive ? "End Call" : "📞 Start Call"}
          </Button>
        </div>

        {/* Live Video Preview */}
        {currentFrame ? (
          <div className="relative aspect-video rounded-lg overflow-hidden bg-black border border-border/50">
            <img src={currentFrame} alt="Live View" className="w-full h-full object-contain" />
            <div className="absolute top-2 right-2 flex gap-1">
              <Badge variant="secondary" className="bg-black/50 backdrop-blur text-xs">
                {liveFps} FPS
              </Badge>
              {micEnabled && (
                <Badge variant="secondary" className="bg-emerald-500/80 text-white backdrop-blur">
                  <Mic className="w-3 h-3 mr-1" /> ON
                </Badge>
              )}
            </div>
            {motionEvents.length > 0 && (
              <div className="absolute bottom-2 left-2 right-2">
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {motionEvents.slice(0, 8).map(e => (
                    <div key={e.id} className="h-6 w-10 bg-black/50 rounded border border-red-500/50 shrink-0 relative">
                      <div className="absolute bottom-0 left-0 h-1 bg-red-500 rounded-b" style={{ width: `${e.confidence}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="aspect-video rounded-lg bg-secondary/20 border border-dashed border-border/50 flex items-center justify-center text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              {isStarting ? <Loader2 className="w-8 h-8 animate-spin" /> : <Video className="w-8 h-8 opacity-50" />}
              <span className="text-xs">{isStarting ? "Connecting..." : "No Signal"}</span>
            </div>
          </div>
        )}

        {/* Quick Stats */}
        {motionEvents.length > 0 && (
          <div className="text-xs text-muted-foreground flex justify-between px-1">
            <span>{motionEvents.length} motion events</span>
            <span>Last: {motionEvents[0]?.timestamp.toLocaleTimeString()}</span>
          </div>
        )}

        {/* Config Accordion */}
        <div className="rounded-lg border border-border/50 bg-secondary/10 overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-secondary/20 transition-colors"
            onClick={() => setShowConfig(!showConfig)}
          >
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              Configuration
            </div>
            {showConfig ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showConfig && (
            <div className="p-3 space-y-4 border-t border-border/50 animate-in slide-in-from-top-2">
              {/* FPS/Quality Settings */}
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1">
                      <Gauge className="h-3 w-3" /> Target FPS
                    </Label>
                    <span className="font-mono text-xs font-bold text-primary">{survFps}</span>
                  </div>
                  <Slider
                    value={[survFps]}
                    onValueChange={([v]) => setSurvFps(v)}
                    min={5}
                    max={60}
                    step={5}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1">
                      <Video className="h-3 w-3" /> JPEG Quality
                    </Label>
                    <span className="font-mono text-xs font-bold text-primary">{survQuality}%</span>
                  </div>
                  <Slider
                    value={[survQuality]}
                    onValueChange={([v]) => setSurvQuality(v)}
                    min={10}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                </div>
              </div>

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
