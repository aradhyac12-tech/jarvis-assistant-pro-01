import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, Eye, Bell, Volume2, Phone, Camera, Play, Square, Loader2,
  Settings, ChevronDown, ChevronUp, Video, Mic, MicOff, Zap, Siren,
  AlertTriangle, Gauge, Stethoscope, PersonStanding, Download, Film, Trash2, X, Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useToast } from "@/hooks/use-toast";
import { addLog } from "@/components/IssueLog";
import { getFunctionsWsBase } from "@/lib/relay";
import { InlineDiagnostics } from "@/components/InlineDiagnostics";
import { PoseDetectionOverlay } from "@/components/PoseDetectionOverlay";
import { useAppNotifications } from "@/hooks/useAppNotifications";

interface MotionEvent {
  id: string;
  timestamp: Date;
  confidence: number;
}

interface SurveillanceClip {
  id: string;
  timestamp: Date;
  thumbnail: string;
  frames: Blob[];
  duration: number;
  trigger: "motion" | "human" | "manual";
}

export function SurveillancePanel({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const { toast } = useToast();
  const { notifyHumanDetected } = useAppNotifications();

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
  const [survFps, setSurvFps] = useState(() => parseInt(localStorage.getItem("surveillance_fps") || "30"));
  const [survQuality, setSurvQuality] = useState(() => parseInt(localStorage.getItem("surveillance_quality") || "65"));

  // Runtime State
  const [monitoring, setMonitoring] = useState(() => localStorage.getItem("surveillance_monitoring") === "true");
  const [motionEvents, setMotionEvents] = useState<MotionEvent[]>([]);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [liveFps, setLiveFps] = useState(0);
  const [streamLatency, setStreamLatency] = useState(0);
  const [sirenActive, setSirenActive] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [humanPresent, setHumanPresent] = useState(false);
  const [survTab, setSurvTab] = useState<"live" | "clips">("live");
  const [clipFilter, setClipFilter] = useState<"all" | "human" | "motion">("all");
  const [expandedClip, setExpandedClip] = useState<string | null>(null);

  // Single notification guard per session — no spamming
  const humanNotifiedRef = useRef(false);

  // Clip recording state
  const [clips, setClips] = useState<SurveillanceClip[]>(() => {
    try {
      const saved = localStorage.getItem("surveillance_clips_meta");
      if (saved) {
        const parsed = JSON.parse(saved) as Array<Omit<SurveillanceClip, "frames" | "timestamp"> & { timestamp: string }>;
        // Auto-delete clips older than 15 days
        const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000;
        return parsed
          .filter(c => new Date(c.timestamp).getTime() > cutoff)
          .map(c => ({ ...c, timestamp: new Date(c.timestamp), frames: [] }));
      }
    } catch {}
    return [];
  });
  const [isRecording, setIsRecording] = useState(false);
  const recordingFramesRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number>(0);
  const clipThumbnailRef = useRef<string>("");

  // Audio call refs
  const audioWsRef = useRef<WebSocket | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Refs for streaming
  const wsRef = useRef<WebSocket | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const fpsCounterRef = useRef({ frames: 0, lastCheck: Date.now() });
  const frameTimesRef = useRef<number[]>([]);
  const previousFrameRef = useRef<ImageData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sensitivityThreshold = { low: 30, medium: 15, high: 5 };

  // Persist clips metadata (without frame blobs) + auto-delete after 15 days
  useEffect(() => {
    try {
      const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000;
      const validClips = clips.filter(c => c.timestamp.getTime() > cutoff);
      const meta = validClips.map(c => ({
        id: c.id,
        timestamp: c.timestamp.toISOString(),
        thumbnail: c.thumbnail,
        duration: c.duration,
        trigger: c.trigger,
      }));
      localStorage.setItem("surveillance_clips_meta", JSON.stringify(meta.slice(0, 50)));
    } catch {}
  }, [clips]);

  // Auto-record while activity continues — extends recording as long as detections keep coming
  const autoRecordTimeoutRef = useRef<number | null>(null);
  const recordingTriggerRef = useRef<"motion" | "human">("motion");
  
  const triggerAutoClip = useCallback((trigger: "motion" | "human") => {
    // If already recording, extend the timeout (keep recording while activity persists)
    if (isRecording && autoRecordTimeoutRef.current) {
      // Upgrade trigger if human detected during motion clip
      if (trigger === "human") recordingTriggerRef.current = "human";
      // Extend: reset the "no activity" stop timer to 3s from now
      clearTimeout(autoRecordTimeoutRef.current);
      autoRecordTimeoutRef.current = window.setTimeout(() => {
        // No new activity for 3s — finalize clip
        finalizeClip();
      }, 3000);
      return;
    }
    
    // Start a new recording
    setIsRecording(true);
    recordingFramesRef.current = [];
    recordingStartRef.current = Date.now();
    clipThumbnailRef.current = currentFrame || "";
    recordingTriggerRef.current = trigger;
    addLog("info", "web", `Auto-clip recording started (${trigger})`);

    // Set initial "no activity" stop timer — if no more detections within 3s, stop
    autoRecordTimeoutRef.current = window.setTimeout(() => {
      finalizeClip();
    }, 3000);
  }, [isRecording, currentFrame]);
  
  const finalizeClip = useCallback(() => {
    setIsRecording(false);
    const duration = Math.round((Date.now() - recordingStartRef.current) / 1000);
    if (duration < 1) { autoRecordTimeoutRef.current = null; return; } // Skip tiny clips
    
    const clip: SurveillanceClip = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      thumbnail: clipThumbnailRef.current,
      frames: [...recordingFramesRef.current],
      duration,
      trigger: recordingTriggerRef.current,
    };
    setClips(prev => [clip, ...prev].slice(0, 50));
    recordingFramesRef.current = [];
    autoRecordTimeoutRef.current = null;

    sendCommand("save_surveillance_clip", {
      clip_id: clip.id,
      timestamp: clip.timestamp.toISOString(),
      duration: clip.duration,
      trigger: clip.trigger,
      image_data: clipThumbnailRef.current,
    }, { awaitResult: false });

    addLog("info", "web", `Auto-clip saved: ${duration}s (${recordingTriggerRef.current})`);
  }, [sendCommand]);

  // Download clip snapshot
  const downloadClip = useCallback((clip: SurveillanceClip) => {
    if (clip.thumbnail) {
      const link = document.createElement("a");
      link.href = clip.thumbnail;
      link.download = `surveillance_${clip.timestamp.toISOString().replace(/[:.]/g, "-")}.jpg`;
      link.click();
    }
  }, []);

  const deleteClip = useCallback((clipId: string) => {
    setClips(prev => prev.filter(c => c.id !== clipId));
    // Tell agent to delete from PC too
    sendCommand("delete_surveillance_clip", { clip_id: clipId }, { awaitResult: false });
  }, [sendCommand]);

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
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    fpsCounterRef.current = { frames: 0, lastCheck: Date.now() };
  }, []);

  const detectMotion = useCallback((base64OrBlob: string) => {
    const img = new Image();
    img.onload = () => {
      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      const canvas = canvasRef.current;
      const targetW = Math.min(img.width, 320);
      const targetH = Math.round((img.height / img.width) * targetW);
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const frame = ctx.getImageData(0, 0, targetW, targetH);

      if (previousFrameRef.current && previousFrameRef.current.width === frame.width && previousFrameRef.current.height === frame.height) {
        const prev = previousFrameRef.current;
        let diffPixels = 0;
        const step = 4;
        const totalSampled = Math.floor(frame.data.length / (4 * step));
        const threshold = sensitivityThreshold[sensitivity];
        for (let i = 0; i < frame.data.length; i += 4 * step) {
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
          triggerAutoClip("motion");
        }
      }
      previousFrameRef.current = frame;
    };
    img.src = base64OrBlob;
  }, [sensitivity]);

  const triggerAlerts = useCallback(async (event: MotionEvent) => {
    // No spam — only alert once per monitoring session
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
      await sendCommand("play_alarm", { type: "siren", action: "stop" });
      setSirenActive(false);
      toast({ title: "Siren Stopped" });
    } else {
      setSirenActive(true);
      await sendCommand("set_volume", { level: 100 }, { awaitResult: true, timeoutMs: 3000 });
      await sendCommand("play_alarm", { type: "siren", action: "start" });
      toast({ title: "🚨 SIREN ACTIVATED", description: "Max volume + siren on PC" });
    }
  }, [sendCommand, toast, sirenActive]);

  const toggleCall = useCallback(async () => {
    if (callActive) {
      if (audioWsRef.current) { try { audioWsRef.current.close(); } catch {} audioWsRef.current = null; }
      if (audioStreamRef.current) { audioStreamRef.current.getTracks().forEach(t => t.stop()); audioStreamRef.current = null; }
      if (audioContextRef.current) { try { audioContextRef.current.close(); } catch {} audioContextRef.current = null; }
      setCallActive(false);
      toast({ title: "Call Ended" });
      return;
    }

    if (!session?.session_token) {
      toast({ title: "Not Paired", description: "Connect to your PC first", variant: "destructive" });
      return;
    }

    try {
      const callSessionId = crypto.randomUUID();
      const WS_BASE = getFunctionsWsBase();
      const wsUrl = `${WS_BASE}/functions/v1/audio-relay?sessionId=${callSessionId}&type=phone&direction=bidirectional&session_token=${session.session_token}`;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      audioStreamRef.current = stream;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 8000);
        ws.onopen = () => { clearTimeout(t); resolve(); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("ws error")); };
      });

      audioWsRef.current = ws;

      // Keepalive ping every 30s
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);

      const ac = new AudioContext();
      audioContextRef.current = ac;
      if (ac.state === "suspended") await ac.resume();
      
      const nativeRate = ac.sampleRate;
      const TARGET_RATE = 16000;

      const source = ac.createMediaStreamSource(stream);
      const processor = ac.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(ac.destination);

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const samples = e.inputBuffer.getChannelData(0);
        
        // Resample from native rate to 16kHz before sending
        const ratio = TARGET_RATE / nativeRate;
        const outputLength = Math.round(samples.length * ratio);
        const resampled = new Float32Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
          const srcIdx = i / ratio;
          const floor = Math.floor(srcIdx);
          const ceil = Math.min(floor + 1, samples.length - 1);
          const frac = srcIdx - floor;
          resampled[i] = samples[floor] * (1 - frac) + samples[ceil] * frac;
        }
        
        const pcm16 = new Int16Array(resampled.length);
        for (let i = 0; i < resampled.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(resampled[i] * 32767)));
        }
        ws.send(pcm16.buffer);
      };

      // Playback scheduling state
      let playbackTime = 0;

      ws.onmessage = async (event) => {
        if (typeof event.data === "string") {
          // Handle control messages (pong, peer_connected, etc.)
          return;
        }
        if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
          try {
            if (ac.state === "suspended") await ac.resume();
            const pcm16Data = new Int16Array(event.data);
            const float32 = new Float32Array(pcm16Data.length);
            for (let i = 0; i < pcm16Data.length; i++) float32[i] = pcm16Data[i] / 32768;
            
            // Resample from 16kHz to native rate for smooth playback
            const playRatio = nativeRate / TARGET_RATE;
            const outputLen = Math.round(float32.length * playRatio);
            const buffer = ac.createBuffer(1, outputLen, nativeRate);
            const out = buffer.getChannelData(0);
            for (let i = 0; i < outputLen; i++) {
              const srcIdx = i / playRatio;
              const floor = Math.floor(srcIdx);
              const ceil = Math.min(floor + 1, float32.length - 1);
              const frac = srcIdx - floor;
              out[i] = float32[floor] * (1 - frac) + float32[ceil] * frac;
            }
            
            const bufferSource = ac.createBufferSource();
            bufferSource.buffer = buffer;
            const gain = ac.createGain();
            gain.gain.value = 1.5;
            bufferSource.connect(gain);
            gain.connect(ac.destination);
            const now = ac.currentTime;
            const startAt = Math.max(now + 0.01, playbackTime);
            bufferSource.start(startAt);
            playbackTime = startAt + buffer.duration;
          } catch {}
        }
      };

      ws.onclose = () => { clearInterval(pingInterval); audioWsRef.current = null; setCallActive(false); };

      // Tell agent to start with system audio enabled for hearing PC sounds
      sendCommand("start_audio_relay", {
        session_id: callSessionId,
        direction: "bidirectional",
        use_system_audio: true,
      }, { awaitResult: false });

      setCallActive(true);
      toast({ title: "📞 Call Started", description: "Bidirectional audio active" });
    } catch (err) {
      toast({ title: "Call Failed", description: err instanceof Error ? err.message : "Could not start call", variant: "destructive" });
      if (audioStreamRef.current) { audioStreamRef.current.getTracks().forEach(t => t.stop()); audioStreamRef.current = null; }
    }
  }, [sendCommand, toast, callActive, session]);

  const startSurveillance = useCallback(async () => {
    setIsStarting(true);
    humanNotifiedRef.current = false; // Reset notification guard for new session
    try {
      if (!session?.session_token) {
        toast({ title: "Not Paired", description: "Connect to your PC first", variant: "destructive" });
        setIsStarting(false);
        return;
      }

      const sessionId = crypto.randomUUID();
      const WS_BASE = getFunctionsWsBase();
      const wsUrl = `${WS_BASE}/functions/v1/camera-relay?sessionId=${sessionId}&type=pc&fps=${survFps}&quality=${survQuality}&binary=true&session_token=${session.session_token}`;

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

            // Capture frames for clip recording (every 3rd frame)
            if (recordingFramesRef.current && fpsCounterRef.current.frames % 3 === 0 && isRecording) {
              recordingFramesRef.current.push(blob);
            }

            frameTimesRef.current.push(now);
            if (frameTimesRef.current.length > 10) frameTimesRef.current.shift();
            if (frameTimesRef.current.length >= 2) {
              const gaps = [];
              for (let i = 1; i < frameTimesRef.current.length; i++) gaps.push(frameTimesRef.current[i] - frameTimesRef.current[i - 1]);
              setStreamLatency(Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));
            }

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
        } catch {}
      };

      ws.onclose = () => {
        if (monitoring) addLog("warn", "web", "Surveillance WS closed unexpectedly");
        cleanupWs();
        setMonitoring(false);
      };

      sendCommand("start_camera_stream", {
        session_id: sessionId,
        camera_index: 0,
        fps: survFps,
        quality: survQuality,
      }, { awaitResult: false }).then((result) => {
        if (!result.success) addLog("warn", "agent", `Surveillance camera issue: ${result.error}`);
        else addLog("info", "agent", "Surveillance camera command sent to PC");
      });

      if (micEnabled) {
        sendCommand("start_audio_relay", {
          session_id: crypto.randomUUID(),
          direction: "pc_to_phone",
        }, { awaitResult: false });
      }

      setMonitoring(true);
      toast({ title: "Surveillance Active", description: `Live camera + pose detection at ${survFps} FPS` });
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
    humanNotifiedRef.current = false;
    toast({ title: "Surveillance Stopped" });
  }, [sendCommand, toast, micEnabled, cleanupWs]);

  // Auto-resume
  const autoResumedRef = useRef(false);
  useEffect(() => {
    if (monitoring && !wsRef.current && !autoResumedRef.current && session?.session_token) {
      autoResumedRef.current = true;
      startSurveillance();
    }
  }, [monitoring, session?.session_token]);

  // Cleanup on unmount
  useEffect(() => () => {
    cleanupWs();
    if (audioWsRef.current) { try { audioWsRef.current.close(); } catch {} }
    if (audioStreamRef.current) { audioStreamRef.current.getTracks().forEach(t => t.stop()); }
    if (audioContextRef.current) { try { audioContextRef.current.close(); } catch {} }
  }, [cleanupWs]);

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
        <CardDescription>
          Camera monitoring with pose detection & auto-recording • {survFps} FPS
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Start / Stop */}
        <div className="flex gap-2">
          {!monitoring ? (
            <Button onClick={startSurveillance} disabled={isStarting} className="flex-1 h-12 gradient-primary">
              {isStarting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Play className="h-5 w-5 mr-2" />}
              {isStarting ? "Connecting..." : "Start Surveillance"}
            </Button>
          ) : (
            <Button onClick={stopSurveillance} variant="destructive" className="flex-1 h-12">
              <Square className="h-5 w-5 mr-2" />
              Stop Surveillance
            </Button>
          )}
        </div>

        {/* Siren + Call */}
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

        {/* Subtabs: Live / Clips */}
        <Tabs value={survTab} onValueChange={(v) => setSurvTab(v as "live" | "clips")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="live" className="gap-1">
              <Eye className="h-3.5 w-3.5" /> Live
              {monitoring && <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />}
            </TabsTrigger>
            <TabsTrigger value="clips" className="gap-1">
              <Film className="h-3.5 w-3.5" /> Clips
              {clips.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] h-4 min-w-[16px] p-0 flex items-center justify-center">
                  {clips.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ===== LIVE TAB ===== */}
          <TabsContent value="live" className="mt-3 space-y-3">
            {/* Live Video Preview */}
            {currentFrame ? (
              <div className="relative aspect-video rounded-lg overflow-hidden bg-black border border-border/50">
                <img src={currentFrame} alt="Live View" className="w-full h-full object-contain" />
                <PoseDetectionOverlay
                  frameUrl={currentFrame}
                  enabled={monitoring}
                  onHumanDetected={(lm, conf) => {
                    if (!humanNotifiedRef.current) {
                      humanNotifiedRef.current = true;
                      const confPct = Math.round(conf * 100);
                      setHumanPresent(true);
                      addLog("warn", "web", `Human detected (${confPct}% confidence)`);
                      toast({ title: "🧍 Human Detected!", description: `Confidence: ${confPct}%` });
                      notifyHumanDetected(confPct);
                      triggerAutoClip("human");
                    }
                  }}
                />
                <div className="absolute top-2 right-2 flex gap-1">
                  <Badge variant="secondary" className="bg-black/50 backdrop-blur text-xs font-mono">
                    {liveFps} FPS
                  </Badge>
                  {streamLatency > 0 && (
                    <Badge variant="secondary" className={cn(
                      "bg-black/50 backdrop-blur text-xs font-mono",
                      streamLatency > 100 ? "text-destructive" : "text-primary"
                    )}>
                      {streamLatency}ms
                    </Badge>
                  )}
                  <Badge variant="secondary" className="bg-primary/60 text-primary-foreground backdrop-blur text-[10px]">
                    <PersonStanding className="w-3 h-3 mr-1" /> Pose
                  </Badge>
                  {micEnabled && (
                    <Badge variant="secondary" className="bg-primary/60 text-primary-foreground backdrop-blur">
                      <Mic className="w-3 h-3 mr-1" /> ON
                    </Badge>
                  )}
                  {isRecording && (
                    <Badge variant="destructive" className="animate-pulse text-[10px]">
                      ● REC
                    </Badge>
                  )}
                </div>
                {motionEvents.length > 0 && (
                  <div className="absolute bottom-2 left-2 right-2">
                    <div className="flex gap-1 overflow-x-auto pb-1">
                      {motionEvents.slice(0, 8).map(e => (
                        <div key={e.id} className="h-6 w-10 bg-black/50 rounded border border-destructive/50 shrink-0 relative">
                          <div className="absolute bottom-0 left-0 h-1 bg-destructive rounded-b" style={{ width: `${e.confidence}%` }} />
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
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs flex items-center gap-1"><Gauge className="h-3 w-3" /> Target FPS</Label>
                        <span className="font-mono text-xs font-bold text-primary">{survFps}</span>
                      </div>
                      <Slider value={[survFps]} onValueChange={([v]) => setSurvFps(v)} min={5} max={60} step={5} className="w-full" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs flex items-center gap-1"><Video className="h-3 w-3" /> JPEG Quality</Label>
                        <span className="font-mono text-xs font-bold text-primary">{survQuality}%</span>
                      </div>
                      <Slider value={[survQuality]} onValueChange={([v]) => setSurvQuality(v)} min={10} max={100} step={5} className="w-full" />
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
                      <div className="flex items-center gap-2"><Mic className="h-4 w-4 text-muted-foreground" /><Label className="text-xs">Listen (Audio)</Label></div>
                      <Switch checked={micEnabled} onCheckedChange={setMicEnabled} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Bell className="h-4 w-4 text-muted-foreground" /><Label className="text-xs">Play PC Alarm</Label></div>
                      <Switch checked={alarmEnabled} onCheckedChange={setAlarmEnabled} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><Label className="text-xs">Auto-Call Me</Label></div>
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
                        <Button key={s} variant={sensitivity === s ? "default" : "outline"} size="sm" className="flex-1 h-7 text-xs capitalize" onClick={() => setSensitivity(s)}>
                          {s}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <InlineDiagnostics type="pc-camera" className="mt-2" />
          </TabsContent>

          {/* ===== CLIPS GALLERY TAB ===== */}
          <TabsContent value="clips" className="mt-3 space-y-3">
            {/* Filter bar */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {(["all", "human", "motion"] as const).map(f => (
                  <Button
                    key={f}
                    variant={clipFilter === f ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs capitalize"
                    onClick={() => setClipFilter(f)}
                  >
                    {f === "human" && <PersonStanding className="h-3 w-3 mr-1" />}
                    {f === "motion" && <Zap className="h-3 w-3 mr-1" />}
                    {f}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Auto-deletes 15d</span>
                {clips.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => { setClips([]); setExpandedClip(null); }}>
                    <Trash2 className="h-3 w-3 mr-1" /> Clear All
                  </Button>
                )}
              </div>
            </div>

            {/* Expanded clip preview */}
            {expandedClip && (() => {
              const clip = clips.find(c => c.id === expandedClip);
              if (!clip) return null;
              return (
                <div className="relative rounded-lg overflow-hidden border border-border/50 bg-black">
                  {clip.thumbnail ? (
                    <img src={clip.thumbnail} alt="Clip preview" className="w-full h-auto" />
                  ) : (
                    <div className="aspect-video flex items-center justify-center text-muted-foreground">
                      <Film className="h-8 w-8 opacity-50" />
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-8 w-8 bg-background/70"
                    onClick={() => setExpandedClip(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-background/90 to-transparent p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={clip.trigger === "human" ? "destructive" : "secondary"} className="text-xs">
                          {clip.trigger}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{clip.duration}s</span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => downloadClip(clip)}>
                          <Download className="h-3 w-3 mr-1" /> Save
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => { deleteClip(clip.id); setExpandedClip(null); }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {clip.timestamp.toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Clips grid */}
            {(() => {
              const filtered = clipFilter === "all" ? clips : clips.filter(c => c.trigger === clipFilter);
              if (filtered.length === 0) {
                return (
                  <div className="text-center py-8">
                    <Film className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                    <p className="text-muted-foreground text-sm">
                      {clips.length === 0 ? "No clips yet" : `No ${clipFilter} clips`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Clips auto-record while motion or humans are detected
                    </p>
                  </div>
                );
              }
              return (
                <ScrollArea className="h-[400px]">
                  <div className="grid grid-cols-2 gap-2 pr-2">
                    {filtered.map(clip => (
                      <div
                        key={clip.id}
                        className={cn(
                          "relative rounded-lg overflow-hidden border cursor-pointer transition-all group",
                          expandedClip === clip.id
                            ? "border-primary ring-1 ring-primary/50"
                            : "border-border/30 hover:border-border/60"
                        )}
                        onClick={() => setExpandedClip(expandedClip === clip.id ? null : clip.id)}
                      >
                        {clip.thumbnail ? (
                          <img src={clip.thumbnail} alt="Clip" className="w-full aspect-video object-cover" />
                        ) : (
                          <div className="w-full aspect-video bg-secondary/30 flex items-center justify-center">
                            <Film className="h-6 w-6 text-muted-foreground opacity-50" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
                        <div className="absolute bottom-0 inset-x-0 p-1.5">
                          <div className="flex items-center justify-between">
                            <Badge
                              variant={clip.trigger === "human" ? "destructive" : "secondary"}
                              className="text-[9px] px-1 py-0"
                            >
                              {clip.trigger}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground font-mono">{clip.duration}s</span>
                          </div>
                          <p className="text-[9px] text-muted-foreground mt-0.5 truncate">
                            {clip.timestamp.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        {/* Quick actions on hover */}
                        <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 bg-background/60"
                            onClick={(e) => { e.stopPropagation(); downloadClip(clip); }}
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 bg-background/60 text-destructive"
                            onClick={(e) => { e.stopPropagation(); deleteClip(clip.id); if (expandedClip === clip.id) setExpandedClip(null); }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              );
            })()}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
