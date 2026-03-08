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
  ScanFace, Crosshair, RotateCw, Search, History, Clock, ShieldCheck, ShieldAlert, MapPin, Navigation, Radio,
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
import { useSurveillanceEvents, type SurveillanceEvent } from "@/hooks/useSurveillanceEvents";
import { useAutoPresence } from "@/hooks/useAutoPresence";

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
  const { events: dbEvents, saveEvent, deleteEvent: deleteDbEvent, clearEvents, fetchEvents, loading: eventsLoading } = useSurveillanceEvents();
  const autoPresence = useAutoPresence();

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
  const [autoAudioCapture, setAutoAudioCapture] = useState(() => localStorage.getItem("surveillance_auto_audio") === "true");
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
  const [survTab, setSurvTab] = useState<"live" | "clips" | "train" | "history">("live");
  const [clipFilter, setClipFilter] = useState<"all" | "human" | "motion">("all");
  const [expandedClip, setExpandedClip] = useState<string | null>(null);

  // Identity & auto-siren
  const [identityPrompt, setIdentityPrompt] = useState(false);
  const [detectedSnapshot, setDetectedSnapshot] = useState<string | null>(null);
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [autoSirenOnDetect, setAutoSirenOnDetect] = useState(() => localStorage.getItem("surveillance_auto_siren") === "true");

  // ML Recognition state
  const [recognitionEnabled, setRecognitionEnabled] = useState(() => localStorage.getItem("surveillance_ml_recognition") === "true");
  const [lastRecognitionResult, setLastRecognitionResult] = useState<{
    recognized: boolean;
    label: string | null;
    confidence: number;
    face_detected: boolean;
  } | null>(null);
  const [modelBuilt, setModelBuilt] = useState(false);
  const [buildingModel, setBuildingModel] = useState(false);
  const recognitionCooldownRef = useRef(false);

  // Live recognition test
  const [liveTestRunning, setLiveTestRunning] = useState(false);
  const [liveTestResult, setLiveTestResult] = useState<{
    recognized: boolean;
    label: string | null;
    confidence: number;
    face_detected: boolean;
    snapshot?: string;
  } | null>(null);

  // Continuous background recognition (30s interval during surveillance)
  const [continuousRecognition, setContinuousRecognition] = useState(() => 
    localStorage.getItem("surveillance_continuous_recognition") === "true"
  );
  const continuousRecRef = useRef<number | null>(null);
  const continuousRecEnabledRef = useRef(continuousRecognition);

  // Training state
  const [trainingMode, setTrainingMode] = useState<"face" | "posture" | "both">("both");
  const [trainingActive, setTrainingActive] = useState(false);
  const [trainingPreview, setTrainingPreview] = useState<string | null>(null);
  const [trainingFrameCount, setTrainingFrameCount] = useState(0);
  const [trainingStatus, setTrainingStatus] = useState<Record<string, number>>({});

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

  // Surveillance auto-audio capture refs
  const survAudioWsRef = useRef<WebSocket | null>(null);
  const survAudioContextRef = useRef<AudioContext | null>(null);
  const survAudioActiveRef = useRef(false);
  const survAudioStopTimerRef = useRef<number | null>(null);
  const survAudioSessionIdRef = useRef<string | null>(null);

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
  useEffect(() => localStorage.setItem("surveillance_auto_siren", String(autoSirenOnDetect)), [autoSirenOnDetect]);
  useEffect(() => localStorage.setItem("surveillance_ml_recognition", String(recognitionEnabled)), [recognitionEnabled]);
  useEffect(() => localStorage.setItem("surveillance_continuous_recognition", String(continuousRecognition)), [continuousRecognition]);
  useEffect(() => localStorage.setItem("surveillance_auto_audio", String(autoAudioCapture)), [autoAudioCapture]);
  useEffect(() => { continuousRecEnabledRef.current = continuousRecognition; }, [continuousRecognition]);

  // Check if model exists on mount
  useEffect(() => {
    if (recognitionEnabled) {
      sendCommand("get_recognition_status", {}, { awaitResult: true, timeoutMs: 5000 }).then((res) => {
        if (res.success && "result" in res) {
          const s = res.result as any;
          setModelBuilt((s.total_embeddings || 0) > 0);
        }
      });
    }
  }, [recognitionEnabled]);

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

  // Auto audio capture: start PC mic recording on motion, stop after 5s inactivity
  const startSurvAudioCapture = useCallback(async () => {
    if (survAudioActiveRef.current || !session?.session_token || !autoAudioCapture) return;

    const audioSessionId = crypto.randomUUID();
    survAudioSessionIdRef.current = audioSessionId;

    try {
      // Tell PC agent to start capturing audio
      await sendCommand("start_audio_relay", {
        session_id: audioSessionId,
        direction: "pc_to_phone",
        use_system_audio: false, // Use mic, not system audio
        surveillance_mode: true,
      }, { awaitResult: false });

      // Connect WS to receive and record the audio
      const WS_BASE = getFunctionsWsBase();
      const wsUrl = `${WS_BASE}/functions/v1/audio-relay?sessionId=${audioSessionId}&type=phone&direction=pc_to_phone&session_token=${session.session_token}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 8000);
        ws.onopen = () => { clearTimeout(t); resolve(); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("ws error")); };
      });

      survAudioWsRef.current = ws;
      survAudioActiveRef.current = true;

      // Set up audio playback context so we can hear what's happening
      const ac = new AudioContext();
      survAudioContextRef.current = ac;
      if (ac.state === "suspended") await ac.resume();

      const TARGET_RATE = 16000;
      let playbackTime = 0;

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
          try {
            if (ac.state === "suspended") await ac.resume();
            const pcm16Data = new Int16Array(event.data);
            const float32 = new Float32Array(pcm16Data.length);
            for (let i = 0; i < pcm16Data.length; i++) float32[i] = pcm16Data[i] / 32768;

            const playRatio = ac.sampleRate / TARGET_RATE;
            const outputLen = Math.round(float32.length * playRatio);
            const buffer = ac.createBuffer(1, outputLen, ac.sampleRate);
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
            bufferSource.connect(ac.destination);
            const now = ac.currentTime;
            const startAt = Math.max(now + 0.01, playbackTime);
            bufferSource.start(startAt);
            playbackTime = startAt + buffer.duration;
          } catch {}
        }
      };

      ws.onclose = () => {
        survAudioActiveRef.current = false;
        survAudioWsRef.current = null;
      };

      // Ping keepalive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
        } else clearInterval(pingInterval);
      }, 30000);

      addLog("info", "web", "🎤 Surveillance audio capture started (motion triggered)");

      // Save event
      saveEvent({
        event_type: "motion",
        confidence: 80,
        metadata: { audio_capture: true, session_id: audioSessionId },
      });

    } catch (err) {
      addLog("warn", "web", `Surveillance audio capture failed: ${err}`);
      survAudioActiveRef.current = false;
    }
  }, [session?.session_token, autoAudioCapture, sendCommand, saveEvent]);

  const stopSurvAudioCapture = useCallback(() => {
    if (!survAudioActiveRef.current) return;
    if (survAudioWsRef.current) { try { survAudioWsRef.current.close(); } catch {} survAudioWsRef.current = null; }
    if (survAudioContextRef.current) { try { survAudioContextRef.current.close(); } catch {} survAudioContextRef.current = null; }
    if (survAudioSessionIdRef.current) {
      sendCommand("stop_audio_relay", { session_id: survAudioSessionIdRef.current }, { awaitResult: false });
      survAudioSessionIdRef.current = null;
    }
    survAudioActiveRef.current = false;
    addLog("info", "web", "🎤 Surveillance audio capture stopped (no motion)");
  }, [sendCommand]);

  // Extend or start audio capture on motion
  const triggerSurvAudioOnMotion = useCallback(() => {
    if (!autoAudioCapture || !monitoring) return;

    // Clear any pending stop timer
    if (survAudioStopTimerRef.current) {
      clearTimeout(survAudioStopTimerRef.current);
      survAudioStopTimerRef.current = null;
    }

    // Start if not already running
    if (!survAudioActiveRef.current) {
      startSurvAudioCapture();
    }

    // Auto-stop after 10s of no motion
    survAudioStopTimerRef.current = window.setTimeout(() => {
      stopSurvAudioCapture();
      survAudioStopTimerRef.current = null;
    }, 10000);
  }, [autoAudioCapture, monitoring, startSurvAudioCapture, stopSurvAudioCapture]);

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
    // Trigger audio capture on motion
    triggerSurvAudioOnMotion();
  }, [alarmEnabled, sirenEnabled, autoCall, sendCommand, triggerSurvAudioOnMotion]);

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

      // Log call end in surveillance history
      saveEvent({
        event_type: "call_ended",
        confidence: 100,
        metadata: { ended_by: "user" },
      });
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

      // Log call start in surveillance history
      saveEvent({
        event_type: "call_started",
        confidence: 100,
        metadata: { session_id: callSessionId, direction: "bidirectional" },
      });
    } catch (err) {
      toast({ title: "Call Failed", description: err instanceof Error ? err.message : "Could not start call", variant: "destructive" });
      if (audioStreamRef.current) { audioStreamRef.current.getTracks().forEach(t => t.stop()); audioStreamRef.current = null; }
    }
  }, [sendCommand, toast, callActive, session, saveEvent]);

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
    stopSurvAudioCapture(); // Stop motion-triggered audio
    if (survAudioStopTimerRef.current) { clearTimeout(survAudioStopTimerRef.current); survAudioStopTimerRef.current = null; }
    cleanupWs();
    setMonitoring(false);
    setCurrentFrame(null);
    previousFrameRef.current = null;
    setLiveFps(0);
    humanNotifiedRef.current = false;
    toast({ title: "Surveillance Stopped" });
  }, [sendCommand, toast, micEnabled, cleanupWs, stopSurvAudioCapture]);

  // Auto-presence: wire up callbacks to auto-start/stop surveillance
  useEffect(() => {
    autoPresence.setOnAway(() => {
      if (!monitoring && session?.session_token) {
        addLog("info", "web", "Auto-presence triggered: starting surveillance (away mode)");
        // Force auto-siren ON when owner is away — intruders get siren automatically
        setAutoSirenOnDetect(true);
        setOwnerConfirmed(false);
        humanNotifiedRef.current = false;
        startSurveillance();
      } else if (monitoring) {
        // Already monitoring — just arm the siren
        setAutoSirenOnDetect(true);
        setOwnerConfirmed(false);
        humanNotifiedRef.current = false;
        addLog("info", "web", "Auto-presence: away mode — auto-siren armed");
      }
    });
    autoPresence.setOnHome(() => {
      // Stop siren immediately if active
      if (sirenActive) {
        setSirenActive(false);
        sendCommand("play_alarm", { type: "siren", action: "stop" });
        addLog("info", "web", "Auto-presence: owner home — siren auto-stopped");
      }
      setOwnerConfirmed(true);
      setIdentityPrompt(false);
      setHumanPresent(false);
      if (monitoring) {
        addLog("info", "web", "Auto-presence triggered: stopping surveillance (home)");
        stopSurveillance();
      }
    });
  }, [monitoring, session?.session_token, startSurveillance, stopSurveillance, autoPresence, sirenActive, sendCommand]);

  // Auto-resume
  const autoResumedRef = useRef(false);
  useEffect(() => {
    if (monitoring && !wsRef.current && !autoResumedRef.current && session?.session_token) {
      autoResumedRef.current = true;
      startSurveillance();
    }
  }, [monitoring, session?.session_token]);

  // Continuous background face recognition every 30s during surveillance
  useEffect(() => {
    if (monitoring && continuousRecognition && recognitionEnabled && modelBuilt) {
      continuousRecRef.current = window.setInterval(async () => {
        if (!continuousRecEnabledRef.current) return;
        try {
          const recResult = await sendCommand("recognize_face", { camera_index: 0 }, { awaitResult: true, timeoutMs: 10000 });
          if (recResult.success && "result" in recResult) {
            const r = recResult.result as any;
            setLastRecognitionResult({
              recognized: r.recognized || false,
              label: r.label || null,
              confidence: r.confidence || 0,
              face_detected: r.face_detected || false,
            });
            // Auto-dismiss siren if owner recognized
            if (r.recognized && r.label === "owner" && sirenActive) {
              setSirenActive(false);
              await sendCommand("play_alarm", { type: "siren", action: "stop" });
              setOwnerConfirmed(true);
              toast({ title: "✅ Owner recognized — siren auto-dismissed", description: `ML confidence: ${r.confidence}%` });
              addLog("info", "web", `Background ML recognized owner (${r.confidence}%) — siren stopped`);
            }
          }
        } catch {
          // Silently fail — retry on next interval
        }
      }, 30000);

      return () => {
        if (continuousRecRef.current) {
          clearInterval(continuousRecRef.current);
          continuousRecRef.current = null;
        }
      };
    } else {
      if (continuousRecRef.current) {
        clearInterval(continuousRecRef.current);
        continuousRecRef.current = null;
      }
    }
  }, [monitoring, continuousRecognition, recognitionEnabled, modelBuilt, sirenActive, sendCommand, toast]);

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
          {autoPresence.enabled && (
            <Badge variant={autoPresence.presenceStatus === "home" ? "default" : autoPresence.presenceStatus === "away" ? "destructive" : "secondary"} className="text-[10px] gap-1">
              {autoPresence.presenceStatus === "home" ? "🏠 Home" : autoPresence.presenceStatus === "away" ? "🔒 Away" : "⏳ Auto"}
            </Badge>
          )}
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
        <Tabs value={survTab} onValueChange={(v) => setSurvTab(v as "live" | "clips" | "train" | "history")}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="live" className="gap-1 text-xs">
              <Eye className="h-3.5 w-3.5" /> Live
              {monitoring && <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />}
            </TabsTrigger>
            <TabsTrigger value="clips" className="gap-1 text-xs">
              <Film className="h-3.5 w-3.5" /> Clips
              {clips.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] h-4 min-w-[16px] p-0 flex items-center justify-center">
                  {clips.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1 text-xs">
              <History className="h-3.5 w-3.5" /> Events
              {dbEvents.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] h-4 min-w-[16px] p-0 flex items-center justify-center">
                  {dbEvents.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="train" className="gap-1 text-xs">
              <ScanFace className="h-3.5 w-3.5" /> Train
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
                  onHumanDetected={async (lm, conf) => {
                    if (!humanNotifiedRef.current) {
                      humanNotifiedRef.current = true;
                      const confPct = Math.round(conf * 100);
                      setHumanPresent(true);
                      triggerAutoClip("human");

                      // Capture screenshot blob for DB storage
                      let screenshotBlob: Blob | null = null;
                      if (currentFrame && currentFrame.startsWith("blob:")) {
                        try {
                          const resp = await fetch(currentFrame);
                          screenshotBlob = await resp.blob();
                        } catch {}
                      }

                      // ML Recognition — ask PC agent to identify the person
                      if (recognitionEnabled && modelBuilt && !recognitionCooldownRef.current) {
                        recognitionCooldownRef.current = true;
                        setTimeout(() => { recognitionCooldownRef.current = false; }, 10000);
                        
                        const recResult = await sendCommand("recognize_face", { camera_index: 0 }, { awaitResult: true, timeoutMs: 8000 });
                        if (recResult.success && "result" in recResult) {
                          const r = recResult.result as any;
                          setLastRecognitionResult({
                            recognized: r.recognized || false,
                            label: r.label || null,
                            confidence: r.confidence || 0,
                            face_detected: r.face_detected || false,
                          });
                          
                          if (r.recognized && r.label === "owner") {
                            setOwnerConfirmed(true);
                            toast({ title: "✅ Owner Recognized", description: `ML confidence: ${r.confidence}%` });
                            addLog("info", "web", `ML recognized owner (confidence: ${r.confidence}%)`);
                            // Save owner-recognized event
                            saveEvent({
                              event_type: "owner_recognized",
                              confidence: confPct,
                              recognized: true,
                              recognized_label: "owner",
                              recognition_confidence: r.confidence,
                              screenshot_blob: screenshotBlob,
                              metadata: { face_detected: true, distance: r.distance },
                            });
                            return; // Don't trigger siren
                          } else {
                            addLog("warn", "web", `ML: Unknown person (distance: ${r.distance})`);
                            // Save intruder event
                            saveEvent({
                              event_type: "intruder",
                              confidence: confPct,
                              recognized: false,
                              recognized_label: null,
                              recognition_confidence: r.confidence || 0,
                              screenshot_blob: screenshotBlob,
                              metadata: { face_detected: r.face_detected, distance: r.distance },
                            });
                          }
                        }
                      } else {
                        // No ML — save as human detection
                        saveEvent({
                          event_type: "human",
                          confidence: confPct,
                          screenshot_blob: screenshotBlob,
                        });
                      }

                      notifyHumanDetected(confPct);
                      
                      // Auto-siren: activate if enabled OR if auto-presence is in away mode
                      const shouldSiren = (autoSirenOnDetect || autoPresence.presenceStatus === "away") && !ownerConfirmed;
                      if (shouldSiren) {
                        setSirenActive(true);
                        sendCommand("set_volume", { level: 100 }, { awaitResult: false });
                        sendCommand("play_alarm", { type: "siren", action: "start" });
                        toast({ title: "🚨 INTRUDER DETECTED!", description: `Confidence: ${confPct}% — Siren activated`, variant: "destructive" });
                        addLog("warn", "web", `🚨 Intruder siren triggered (away mode, confidence: ${confPct}%)`);
                      } else {
                        toast({ title: "🧍 Human Detected!", description: `Confidence: ${confPct}%` });
                      }
                      
                      // Show identity prompt
                      setDetectedSnapshot(currentFrame);
                      setIdentityPrompt(true);
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
                  {recognitionEnabled && modelBuilt && (
                    <Badge variant="secondary" className={cn(
                      "backdrop-blur text-[10px]",
                      lastRecognitionResult?.recognized ? "bg-green-600/80 text-white" : "bg-orange-600/80 text-white"
                    )}>
                      <ScanFace className="w-3 h-3 mr-1" />
                      {lastRecognitionResult?.recognized
                        ? `${lastRecognitionResult.label} ${lastRecognitionResult.confidence}%`
                        : "ML Active"}
                    </Badge>
                  )}
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
                {/* Identity Prompt Overlay */}
                {identityPrompt && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-card rounded-xl p-4 border border-border/50 shadow-xl max-w-[280px] text-center space-y-3">
                      <p className="text-sm font-semibold">👤 Person Detected!</p>
                      <p className="text-xs text-muted-foreground">Is this you or an intruder?</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" size="sm" className="h-10 text-xs"
                          onClick={() => {
                            setIdentityPrompt(false);
                            setOwnerConfirmed(true);
                            if (sirenActive) {
                              sendCommand("play_alarm", { type: "siren", action: "stop" });
                              setSirenActive(false);
                            }
                            toast({ title: "✅ Identified as owner" });
                          }}>
                          👤 It's Me
                        </Button>
                        <Button variant="destructive" size="sm" className="h-10 text-xs"
                          onClick={() => {
                            setIdentityPrompt(false);
                            if (!sirenActive) {
                              setSirenActive(true);
                              sendCommand("set_volume", { level: 100 }, { awaitResult: false });
                              sendCommand("play_alarm", { type: "siren", action: "start" });
                            }
                            toast({ title: "🚨 INTRUDER! Siren activated" });
                          }}>
                          🚨 Intruder!
                        </Button>
                      </div>
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
                      <div className="flex items-center gap-2"><Volume2 className="h-4 w-4 text-muted-foreground" /><Label className="text-xs">Auto Audio on Motion</Label></div>
                      <Switch checked={autoAudioCapture} onCheckedChange={setAutoAudioCapture} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Bell className="h-4 w-4 text-muted-foreground" /><Label className="text-xs">Play PC Alarm</Label></div>
                      <Switch checked={alarmEnabled} onCheckedChange={setAlarmEnabled} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Siren className="h-4 w-4 text-destructive" /><Label className="text-xs">Auto-Siren on Human</Label></div>
                      <Switch checked={autoSirenOnDetect} onCheckedChange={setAutoSirenOnDetect} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><Label className="text-xs">Auto-Call Me</Label></div>
                      <Switch checked={autoCall} onCheckedChange={setAutoCall} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><ScanFace className="h-4 w-4 text-primary" /><Label className="text-xs">ML Face Recognition</Label></div>
                      <Switch checked={recognitionEnabled} onCheckedChange={setRecognitionEnabled} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Eye className="h-4 w-4 text-primary" /><Label className="text-xs">Continuous Recognition (30s)</Label></div>
                      <Switch checked={continuousRecognition} onCheckedChange={setContinuousRecognition} />
                    </div>

                    {/* Auto-Presence Section */}
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-primary" />
                          <Label className="text-xs font-medium">Auto-Presence Mode</Label>
                        </div>
                        <Switch checked={autoPresence.enabled} onCheckedChange={autoPresence.setEnabled} />
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Auto-enables surveillance when you leave and disables it when you return.
                      </p>
                      {autoPresence.enabled && (
                        <>
                          {/* Status Badge */}
                          <div className="flex items-center gap-2">
                            <Badge variant={autoPresence.presenceStatus === "home" ? "default" : autoPresence.presenceStatus === "away" ? "destructive" : "secondary"} className="text-[10px]">
                              {autoPresence.presenceStatus === "home" ? "🏠 Home" : autoPresence.presenceStatus === "away" ? "🔒 Away" : "⏳ Detecting..."}
                            </Badge>
                            {autoPresence.currentDistance !== null && (autoPresence.presenceMode === "geofence" || autoPresence.presenceMode === "both") && (
                              <Badge variant="outline" className="text-[10px] gap-1">
                                <Navigation className="h-2.5 w-2.5" />
                                {autoPresence.currentDistance >= 1000
                                  ? `${(autoPresence.currentDistance / 1000).toFixed(1)}km`
                                  : `${autoPresence.currentDistance}m`}
                              </Badge>
                            )}
                          </div>

                          {/* Detection Mode */}
                          <div className="space-y-1.5">
                            <Label className="text-[10px]">Detection Method</Label>
                            <div className="flex gap-1">
                              {([
                                { mode: "device" as const, label: "Device", icon: Radio },
                                { mode: "geofence" as const, label: "Geofence", icon: MapPin },
                                { mode: "both" as const, label: "Both", icon: ShieldCheck },
                              ]).map(({ mode, label, icon: Icon }) => (
                                <Button
                                  key={mode}
                                  variant={autoPresence.presenceMode === mode ? "default" : "outline"}
                                  size="sm"
                                  className="flex-1 h-7 text-[10px] gap-1"
                                  onClick={() => autoPresence.setPresenceMode(mode)}
                                >
                                  <Icon className="h-3 w-3" />
                                  {label}
                                </Button>
                              ))}
                            </div>
                          </div>

                          {/* Geofence Config */}
                          {(autoPresence.presenceMode === "geofence" || autoPresence.presenceMode === "both") && (
                            <div className="rounded-md border border-border/30 bg-secondary/10 p-2.5 space-y-2.5">
                              <div className="flex items-center gap-1.5 text-[10px] font-medium">
                                <MapPin className="h-3 w-3 text-primary" />
                                Geofence Settings
                              </div>

                              {/* Set Home Location */}
                              <Button
                                variant={autoPresence.homeConfigured ? "outline" : "default"}
                                size="sm"
                                className="w-full h-7 text-[10px] gap-1"
                                onClick={autoPresence.setCurrentAsHome}
                                disabled={autoPresence.settingHome || autoPresence.geoPermission === "denied"}
                              >
                                {autoPresence.settingHome ? (
                                  <><Loader2 className="h-3 w-3 animate-spin" /> Getting location...</>
                                ) : autoPresence.homeConfigured ? (
                                  <><MapPin className="h-3 w-3" /> Update Home Location</>
                                ) : (
                                  <><Crosshair className="h-3 w-3" /> Set Current Location as Home</>
                                )}
                              </Button>

                              {autoPresence.geoPermission === "denied" && (
                                <p className="text-[10px] text-destructive">Location permission denied. Enable it in browser settings.</p>
                              )}

                              {autoPresence.homeConfigured && (
                                <>
                                  <p className="text-[9px] text-muted-foreground font-mono">
                                    📍 {autoPresence.homeLat?.toFixed(5)}, {autoPresence.homeLng?.toFixed(5)}
                                  </p>

                                  {/* Radius Slider */}
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <Label className="text-[10px]">Radius</Label>
                                      <span className="font-mono text-[10px] text-primary">{autoPresence.homeRadius}m</span>
                                    </div>
                                    <Slider
                                      value={[autoPresence.homeRadius]}
                                      onValueChange={([v]) => autoPresence.setHomeRadius(v)}
                                      min={50}
                                      max={2000}
                                      step={50}
                                      className="w-full"
                                    />
                                  </div>

                                  {/* Geo Poll Interval */}
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <Label className="text-[10px]">Check Interval</Label>
                                      <span className="font-mono text-[10px] text-primary">{autoPresence.geoPollInterval / 1000}s</span>
                                    </div>
                                    <Slider
                                      value={[autoPresence.geoPollInterval / 1000]}
                                      onValueChange={([v]) => autoPresence.setGeoPollInterval(v * 1000)}
                                      min={10}
                                      max={120}
                                      step={5}
                                      className="w-full"
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          {/* Grace Period */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label className="text-[10px]">Grace Period</Label>
                              <span className="font-mono text-[10px] text-primary">{autoPresence.awayDelay / 1000}s</span>
                            </div>
                            <Slider
                              value={[autoPresence.awayDelay / 1000]}
                              onValueChange={([v]) => autoPresence.setAwayDelay(v * 1000)}
                              min={15}
                              max={300}
                              step={15}
                              className="w-full"
                            />
                          </div>
                        </>
                      )}
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

          {/* ===== EVENTS HISTORY TAB ===== */}
          <TabsContent value="history" className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium flex items-center gap-2">
                <History className="h-4 w-4 text-primary" /> Detection History
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => fetchEvents()}
                  disabled={eventsLoading}
                >
                  <RotateCw className={cn("h-3 w-3 mr-1", eventsLoading && "animate-spin")} /> Refresh
                </Button>
                {dbEvents.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive"
                    onClick={clearEvents}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Clear
                  </Button>
                )}
              </div>
            </div>

            {eventsLoading ? (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : dbEvents.length === 0 ? (
              <div className="text-center py-8">
                <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-muted-foreground text-sm">No events recorded yet</p>
                <p className="text-xs text-muted-foreground mt-1">Events are saved when surveillance detects motion or people</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2 pr-2">
                  {dbEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className={cn(
                        "rounded-lg border p-3 space-y-2 transition-colors",
                        ev.event_type === "intruder" ? "border-destructive/50 bg-destructive/5" :
                        ev.event_type === "owner_recognized" ? "border-primary/50 bg-primary/5" :
                        (ev.event_type === "call_started" || ev.event_type === "call_ended") ? "border-green-500/30 bg-green-500/5" :
                        "border-border/50 bg-secondary/10"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {ev.event_type === "intruder" && <ShieldAlert className="h-4 w-4 text-destructive" />}
                          {ev.event_type === "owner_recognized" && <ShieldCheck className="h-4 w-4 text-primary" />}
                          {ev.event_type === "human" && <PersonStanding className="h-4 w-4 text-amber-500" />}
                          {ev.event_type === "motion" && <Zap className="h-4 w-4 text-muted-foreground" />}
                          {ev.event_type === "call_started" && <Phone className="h-4 w-4 text-green-500" />}
                          {ev.event_type === "call_ended" && <Phone className="h-4 w-4 text-muted-foreground" />}
                          <div>
                            <p className="text-sm font-medium capitalize">
                              {ev.event_type === "owner_recognized" ? "Owner Verified ✅" :
                               ev.event_type === "intruder" ? "🚨 Intruder!" :
                               ev.event_type === "human" ? "Person Detected" :
                               ev.event_type === "call_started" ? "📞 Call Started" :
                               ev.event_type === "call_ended" ? "📞 Call Ended" :
                               "Motion Detected"}
                            </p>
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(ev.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge
                            variant={ev.event_type === "intruder" ? "destructive" : ev.event_type === "owner_recognized" ? "default" : "secondary"}
                            className="text-[10px]"
                          >
                            {(ev.event_type === "call_started" || ev.event_type === "call_ended") ? "call" : `${ev.confidence}%`}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive"
                            onClick={() => deleteDbEvent(ev.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {ev.recognized_label && (
                        <div className="flex items-center gap-2 text-xs">
                          <ScanFace className="h-3 w-3" />
                          <span>ML: <strong className="capitalize">{ev.recognized_label}</strong> ({ev.recognition_confidence}%)</span>
                        </div>
                      )}

                      {ev.screenshot_url && (
                        <div className="relative aspect-video rounded overflow-hidden bg-black border border-border/30">
                          <img
                            src={ev.screenshot_url}
                            alt="Detection screenshot"
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* ===== TRAINING TAB ===== */}
          <TabsContent value="train" className="mt-3 space-y-4">
            <div className="text-center space-y-2">
              <ScanFace className="h-10 w-10 text-primary mx-auto" />
              <p className="text-sm font-semibold">Face & Posture Training</p>
              <p className="text-xs text-muted-foreground">
                Train the system to recognize you vs intruders using your PC camera
              </p>
            </div>

            {/* Training Mode */}
            <div className="space-y-2">
              <Label className="text-xs">Training Mode</Label>
              <div className="flex gap-1">
                {(["face", "posture", "both"] as const).map((m) => (
                  <Button
                    key={m}
                    variant={trainingMode === m ? "default" : "outline"}
                    size="sm"
                    className="flex-1 h-8 text-xs capitalize"
                    onClick={() => setTrainingMode(m)}
                  >
                    {m === "face" && <ScanFace className="h-3 w-3 mr-1" />}
                    {m === "posture" && <PersonStanding className="h-3 w-3 mr-1" />}
                    {m === "both" && <Crosshair className="h-3 w-3 mr-1" />}
                    {m}
                  </Button>
                ))}
              </div>
            </div>

            {/* Preview */}
            {trainingPreview && (
              <div className="relative aspect-video rounded-lg overflow-hidden bg-black border border-border/50">
                <img src={`data:image/jpeg;base64,${trainingPreview}`} alt="Training frame" className="w-full h-full object-contain" />
                <Badge className="absolute top-2 right-2 bg-primary/80 text-[10px]">
                  Frame #{trainingFrameCount}
                </Badge>
              </div>
            )}

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-12 text-sm gap-2"
                disabled={trainingActive}
                onClick={async () => {
                  const result = await sendCommand("capture_training_frame", {
                    label: "owner",
                    mode: trainingMode,
                  }, { awaitResult: true, timeoutMs: 10000 });
                  if (result.success && "result" in result && result.result) {
                    const r = result.result as any;
                    if (r.image) {
                      setTrainingPreview(r.image);
                      setTrainingFrameCount(prev => prev + 1);
                      toast({ title: "📸 Frame captured", description: `${r.mode} frame saved` });
                    }
                  } else {
                    toast({ title: "Capture failed", variant: "destructive" });
                  }
                }}
              >
                <Camera className="h-4 w-4" />
                Single Shot
              </Button>
              <Button
                variant={trainingActive ? "destructive" : "default"}
                className="h-12 text-sm gap-2"
                onClick={async () => {
                  if (trainingActive) {
                    setTrainingActive(false);
                    return;
                  }
                  setTrainingActive(true);
                  setTrainingFrameCount(0);
                  // Fire-and-forget: just start the training session on the agent
                  const result = await sendCommand("start_face_training", {
                    label: "owner",
                    mode: trainingMode,
                    num_frames: 20,
                    interval_ms: 500,
                  }, { awaitResult: true, timeoutMs: 25000 });
                  if (result.success) {
                    toast({ title: "🎯 Training started", description: "Capturing 20 frames over 10s — look around naturally" });
                    // Poll agent for real progress
                    let staleCount = 0;
                    let lastCount = 0;
                    const poll = setInterval(async () => {
                      try {
                        const status = await sendCommand("get_training_status", {}, { awaitResult: true, timeoutMs: 5000 });
                        if (status.success && "result" in status) {
                          const s = status.result as any;
                          const currentCount = s.labels?.owner || 0;
                          setTrainingFrameCount(currentCount);
                          setTrainingStatus(s.labels || {});
                          if (currentCount === lastCount) staleCount++;
                          else staleCount = 0;
                          lastCount = currentCount;
                          // Done when we have enough frames or agent stopped
                          if (currentCount >= 20 || staleCount >= 6) {
                            clearInterval(poll);
                            setTrainingActive(false);
                            toast({ title: "✅ Training complete", description: `${currentCount} frames captured` });
                          }
                        }
                      } catch {}
                    }, 1000);
                  } else {
                    setTrainingActive(false);
                    const errorMsg = result && "error" in result ? String(result.error) : "Could not start training. Make sure your PC camera is available.";
                    toast({ title: "Training failed", description: errorMsg, variant: "destructive" });
                  }
                }}
              >
                {trainingActive ? (
                  <><Square className="h-4 w-4" /> Stop</>
                ) : (
                  <><Play className="h-4 w-4" /> Auto Train (20 frames)</>
                )}
              </Button>
            </div>

            {trainingActive && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Capturing...</span>
                  <span>{trainingFrameCount}/20</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${(trainingFrameCount / 20) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Training Data Status */}
            <div className="rounded-lg border border-border/50 bg-secondary/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Training Data</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={async () => {
                    const status = await sendCommand("get_training_status", {}, { awaitResult: true, timeoutMs: 5000 });
                    if (status.success && "result" in status) {
                      const s = status.result as any;
                      setTrainingStatus(s.labels || {});
                    }
                  }}
                >
                  <RotateCw className="h-3 w-3 mr-1" /> Refresh
                </Button>
              </div>
              {Object.keys(trainingStatus).length > 0 ? (
                <div className="space-y-1">
                  {Object.entries(trainingStatus).map(([label, count]) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <span className="capitalize">{label}</span>
                      <Badge variant="secondary" className="text-[10px]">{count} frames</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">No training data yet. Capture some frames above.</p>
              )}
              {Object.keys(trainingStatus).length > 0 && (
                <div className="space-y-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-9 text-xs w-full gap-2"
                    disabled={buildingModel}
                    onClick={async () => {
                      setBuildingModel(true);
                      const result = await sendCommand("build_face_model", { label: "owner" }, { awaitResult: true, timeoutMs: 30000 });
                      setBuildingModel(false);
                      if (result.success && "result" in result) {
                        const r = result.result as any;
                        if (r.success) {
                          setModelBuilt(true);
                          toast({ title: "✅ Face model built!", description: `${r.embeddings_count} embeddings from ${r.processed} frames` });
                        } else {
                          toast({ title: "Build failed", description: r.error, variant: "destructive" });
                        }
                      }
                    }}
                  >
                    {buildingModel ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    {buildingModel ? "Building ML Model..." : "🧠 Build Recognition Model"}
                  </Button>
                  {modelBuilt && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-center text-green-500">✓ Model active — ML recognition ready</p>
                      
                      {/* Live Recognition Test Button */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 text-xs w-full gap-2 border-primary/50"
                        disabled={liveTestRunning}
                        onClick={async () => {
                          setLiveTestRunning(true);
                          setLiveTestResult(null);
                          try {
                            const result = await sendCommand("recognize_face", { camera_index: 0, include_snapshot: true }, { awaitResult: true, timeoutMs: 12000 });
                            if (result.success && "result" in result) {
                              const r = result.result as any;
                              setLiveTestResult({
                                recognized: r.recognized || false,
                                label: r.label || null,
                                confidence: r.confidence || 0,
                                face_detected: r.face_detected || false,
                                snapshot: r.snapshot || null,
                              });
                            } else {
                              toast({ title: "Recognition failed", description: "Could not capture frame", variant: "destructive" });
                            }
                          } catch (err) {
                            toast({ title: "Recognition error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
                          }
                          setLiveTestRunning(false);
                        }}
                      >
                        {liveTestRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                        {liveTestRunning ? "Recognizing..." : "🔍 Live Recognition Test"}
                      </Button>

                      {/* Live Test Result */}
                      {liveTestResult && (
                        <div className={cn(
                          "rounded-lg border p-3 space-y-2",
                          liveTestResult.recognized 
                            ? "border-green-500/50 bg-green-500/5" 
                            : "border-destructive/50 bg-destructive/5"
                        )}>
                          {liveTestResult.snapshot && (
                            <div className="aspect-video rounded overflow-hidden bg-black">
                              <img 
                                src={`data:image/jpeg;base64,${liveTestResult.snapshot}`} 
                                alt="Recognition snapshot" 
                                className="w-full h-full object-contain" 
                              />
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <ScanFace className={cn("h-5 w-5", liveTestResult.recognized ? "text-green-500" : "text-destructive")} />
                              <div>
                                <p className="text-sm font-semibold">
                                  {liveTestResult.recognized 
                                    ? `✅ ${liveTestResult.label || "Known"} recognized` 
                                    : liveTestResult.face_detected 
                                      ? "⚠️ Unknown person" 
                                      : "❌ No face detected"}
                                </p>
                                {liveTestResult.face_detected && (
                                  <p className="text-[10px] text-muted-foreground">
                                    Confidence: {liveTestResult.confidence}%
                                  </p>
                                )}
                              </div>
                            </div>
                            <Badge variant={liveTestResult.recognized ? "default" : "destructive"} className="text-xs">
                              {liveTestResult.confidence}%
                            </Badge>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive w-full"
                    onClick={async () => {
                      await sendCommand("clear_training_data", {}, { awaitResult: false });
                      setTrainingStatus({});
                      setTrainingPreview(null);
                      setTrainingFrameCount(0);
                      setModelBuilt(false);
                      setLiveTestResult(null);
                      toast({ title: "Training data cleared" });
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Clear All Training Data
                  </Button>
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                <strong>How it works:</strong> Face training captures your face from multiple angles.
                Posture training captures your standing/sitting posture which is unique to each person.
                Combined mode uses both for maximum accuracy. Look around naturally during auto-training
                to capture different angles. Enable <strong>Continuous Recognition</strong> in settings to 
                auto-check identity every 30s and auto-dismiss sirens when you're recognized.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
