import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Camera,
  Mic,
  MicOff,
  Video,
  Volume2,
  Play,
  Square,
  RefreshCw,
  Monitor,
  Smartphone,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Speaker,
  Webcam,
  Settings,
  Gauge,
  Zap,
  ScreenShare,
  ScreenShareOff,
  Shield,
  Headphones,
} from "lucide-react";
import { StreamDisplayControls } from "@/components/StreamDisplayControls";
import { InlineDiagnostics } from "@/components/InlineDiagnostics";
import { DetailedDiagnostics } from "@/components/DetailedDiagnostics";
import { SurveillancePanel } from "@/components/SurveillancePanel";
import { BackButton } from "@/components/BackButton";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import { cn } from "@/lib/utils";
import { addLog } from "@/components/IssueLog";
import { getFunctionsWsBase } from "@/lib/relay";

type StreamDirection = "phone_to_pc" | "pc_to_phone" | "bidirectional";

// ==================== Settings Persistence ====================
function loadSetting<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function saveSetting(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ==================== Stream Settings Panel ====================
function StreamSettingsPanel({
  fps, quality, onFpsChange, onQualityChange, onApply, label,
}: {
  fps: number; quality: number;
  onFpsChange: (v: number) => void;
  onQualityChange: (v: number) => void;
  onApply: (fps: number, quality: number) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/50 bg-secondary/10 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 hover:bg-secondary/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{fps} FPS</Badge>
          <Badge variant="outline" className="text-xs">{quality}%</Badge>
          <Zap className={cn("h-4 w-4 transition-transform", open ? "rotate-180" : "")} />
        </div>
      </button>
      {open && (
        <div className="p-4 pt-0 space-y-4 border-t border-border/30">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-2"><Gauge className="h-4 w-4" />Target FPS</Label>
              <span className="font-mono text-sm font-bold text-primary">{fps}</span>
            </div>
            <Slider
              value={[fps]}
              onValueChange={([v]) => onFpsChange(v)}
              onValueCommit={([v]) => { onFpsChange(v); onApply(v, quality); }}
              min={5} max={90} step={5}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>5 (Low)</span><span>30 (Smooth)</span><span>90 (Ultra)</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm flex items-center gap-2"><Video className="h-4 w-4" />JPEG Quality</Label>
              <span className="font-mono text-sm font-bold text-primary">{quality}%</span>
            </div>
            <Slider
              value={[quality]}
              onValueChange={([v]) => onQualityChange(v)}
              onValueCommit={([v]) => { onQualityChange(v); onApply(fps, v); }}
              min={10} max={100} step={5}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>10% (Fast)</span><span>50% (Balanced)</span><span>100% (Best)</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {[
              { label: "🐢 Low", fps: 15, q: 50 },
              { label: "⚖️ Balanced", fps: 30, q: 70 },
              { label: "🚀 High", fps: 60, q: 85 },
              { label: "⚡ Ultra", fps: 90, q: 100 },
            ].map(p => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => { onFpsChange(p.fps); onQualityChange(p.q); onApply(p.fps, p.q); }}>
                {p.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground pt-1">
            <strong>Tip:</strong> Changes apply instantly without restarting the stream.
          </p>
        </div>
      )}
    </div>
  );
}

// ==================== MAIN COMPONENT ====================
export default function MicCamera() {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { session } = useDeviceSession();
  const {
    inputDevices, outputDevices, selectedInput, selectedOutput,
    setSelectedInput, setSelectedOutput, refreshDevices, loading: devicesLoading,
  } = useAudioDevices();

  // ========== Tab persistence ==========
  const [activeTab, setActiveTab] = useState(() => loadSetting("mic_camera_tab", "audio"));
  const handleTabChange = (v: string) => { setActiveTab(v); saveSetting("mic_camera_tab", v); };

  // ========== WebSocket base ==========
  const WS_BASE = getFunctionsWsBase();
  const AUDIO_WS_URL = `${WS_BASE}/functions/v1/audio-relay`;
  const CAMERA_WS_URL = `${WS_BASE}/functions/v1/camera-relay`;

  // ========== PC CAMERA state ==========
  const [pcCamActive, setPcCamActive] = useState(false);
  const [pcCamFrame, setPcCamFrame] = useState<string | null>(null);
  const [pcCamError, setPcCamError] = useState<string | null>(null);
  const [pcCameras, setPcCameras] = useState<Array<{ index: number; name: string }>>([]);
  const [selectedPcCam, setSelectedPcCam] = useState(0);
  const [camFps, setCamFps] = useState(() => loadSetting("cam_fps", 30));
  const [camQuality, setCamQuality] = useState(() => loadSetting("cam_quality", 70));
  const [liveCamFps, setLiveCamFps] = useState(0);
  const [camLatency, setCamLatency] = useState(0);
  const pcCamWsRef = useRef<WebSocket | null>(null);
  const pcCamSessionRef = useRef<string | null>(null);
  const camFpsCounter = useRef({ frames: 0, lastCheck: Date.now() });
  const camFrameTimes = useRef<number[]>([]);
  const camBlobUrl = useRef<string | null>(null);

  // ========== SCREEN MIRROR state ==========
  const [screenActive, setScreenActive] = useState(false);
  const [screenFrame, setScreenFrame] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [screenFps, setScreenFps] = useState(() => loadSetting("screen_fps", 30));
  const [screenQuality, setScreenQuality] = useState(() => loadSetting("screen_quality", 70));
  const [liveScreenFps, setLiveScreenFps] = useState(0);
  const [screenLatency, setScreenLatency] = useState(0);
  const screenWsRef = useRef<WebSocket | null>(null);
  const screenSessionRef = useRef<string | null>(null);
  const screenFpsCounter = useRef({ frames: 0, lastCheck: Date.now() });
  const screenFrameTimes = useRef<number[]>([]);
  const screenBlobUrl = useRef<string | null>(null);

  // ========== AUDIO RELAY state ==========
  const [audioDirection, setAudioDirection] = useState<StreamDirection>(() => loadSetting("audio_direction", "phone_to_pc"));
  const [audioActive, setAudioActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [systemAudio, setSystemAudio] = useState(() => loadSetting("system_audio", false));
  const audioWsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackTimeRef = useRef(0);

  // ========== Debug ==========
  const [showDebug, setShowDebug] = useState(false);

  // Persist settings
  useEffect(() => { saveSetting("cam_fps", camFps); }, [camFps]);
  useEffect(() => { saveSetting("cam_quality", camQuality); }, [camQuality]);
  useEffect(() => { saveSetting("screen_fps", screenFps); }, [screenFps]);
  useEffect(() => { saveSetting("screen_quality", screenQuality); }, [screenQuality]);
  useEffect(() => { saveSetting("audio_direction", audioDirection); }, [audioDirection]);
  useEffect(() => { saveSetting("system_audio", systemAudio); }, [systemAudio]);

  // ==================== HELPERS ====================
  const processFrames = useCallback((
    event: MessageEvent,
    setFrame: (url: string) => void,
    blobUrlRef: React.MutableRefObject<string | null>,
    fpsCounter: React.MutableRefObject<{ frames: number; lastCheck: number }>,
    frameTimes: React.MutableRefObject<number[]>,
    setFps: (v: number) => void,
    setLatency: (v: number) => void,
  ) => {
    const now = Date.now();
    
    const processArrayBuffer = (ab: ArrayBuffer) => {
      if (ab.byteLength < 100) return;
      const blob = new Blob([ab], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;
      setFrame(url);

      frameTimes.current.push(now);
      if (frameTimes.current.length > 10) frameTimes.current.shift();
      if (frameTimes.current.length >= 2) {
        const gaps = [];
        for (let i = 1; i < frameTimes.current.length; i++) gaps.push(frameTimes.current[i] - frameTimes.current[i - 1]);
        setLatency(Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));
      }
      fpsCounter.current.frames++;
      const elapsed = now - fpsCounter.current.lastCheck;
      if (elapsed >= 1000) {
        setFps(Math.round((fpsCounter.current.frames * 1000) / elapsed));
        fpsCounter.current = { frames: 0, lastCheck: now };
      }
    };

    if (event.data instanceof ArrayBuffer) {
      processArrayBuffer(event.data);
    } else if (event.data instanceof Blob && event.data.size > 100) {
      event.data.arrayBuffer().then(processArrayBuffer);
    } else if (typeof event.data === "string") {
      try {
        const data = JSON.parse(event.data);
        if ((data.type === "camera_frame" || data.type === "screen_frame") && data.data) {
          setFrame(`data:image/jpeg;base64,${data.data}`);
        }
        if (data.type === "peer_connected") addLog("info", "agent", "Peer connected");
        if (data.type === "peer_disconnected") addLog("warn", "agent", "Peer disconnected");
      } catch {}
    }
  }, []);

  const waitForWsOpen = useCallback((ws: WebSocket, timeoutMs = 10000) => {
    return new Promise<void>((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();
      const t = window.setTimeout(() => { ws.close(); reject(new Error("WS timeout")); }, timeoutMs);
      ws.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(t); reject(new Error("WS error")); }, { once: true });
    });
  }, []);

  // ==================== PC CAMERA ====================
  const fetchPcCameras = useCallback(async () => {
    try {
      const result = await sendCommand("get_cameras", {}, { awaitResult: true, timeoutMs: 12000 });
      if (result && "result" in result && result.result?.cameras) {
        setPcCameras(result.result.cameras as Array<{ index: number; name: string }>);
      }
    } catch {}
  }, [sendCommand]);

  useEffect(() => { fetchPcCameras(); }, [fetchPcCameras]);

  // Prevent rapid-fire camera starts (agent crash prevention)
  const camStartLockRef = useRef(false);
  const screenStartLockRef = useRef(false);

  const startPcCamera = useCallback(async () => {
    if (camStartLockRef.current) {
      toast({ title: "Please wait...", description: "Camera is still starting" });
      return;
    }
    camStartLockRef.current = true;
    try {
      setPcCamError(null);
      
      // Stop any existing stream first to prevent agent overload
      if (pcCamWsRef.current) {
        pcCamWsRef.current.close();
        pcCamWsRef.current = null;
        sendCommand("stop_camera_stream", {});
        await new Promise(r => setTimeout(r, 500));
      }

      const sessionId = crypto.randomUUID();
      pcCamSessionRef.current = sessionId;

      const ws = new WebSocket(
        `${CAMERA_WS_URL}?sessionId=${sessionId}&type=pc&fps=${camFps}&quality=${camQuality}&binary=true&session_token=${session?.session_token || ''}`
      );
      pcCamWsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onmessage = (event) => processFrames(event, setPcCamFrame, camBlobUrl, camFpsCounter, camFrameTimes, setLiveCamFps, setCamLatency);
      ws.onopen = () => { setPcCamActive(true); setPcCamError(null); addLog("info", "web", "Camera WS connected"); };
      ws.onerror = () => addLog("error", "web", "Camera WS error");
      ws.onclose = () => {
        setPcCamActive(false);
        if (camBlobUrl.current) { URL.revokeObjectURL(camBlobUrl.current); camBlobUrl.current = null; }
        setPcCamFrame(null); setLiveCamFps(0); setCamLatency(0);
      };

      await waitForWsOpen(ws);

      sendCommand("start_camera_stream", {
        session_id: sessionId, camera_index: selectedPcCam, fps: camFps, quality: camQuality,
      }, { awaitResult: false });

      toast({ title: "PC Camera Starting" });
    } catch (err) {
      setPcCamError(err instanceof Error ? err.message : String(err));
      toast({ title: "Camera Error", variant: "destructive" });
    } finally {
      // Release lock after delay to prevent rapid re-clicks
      setTimeout(() => { camStartLockRef.current = false; }, 2000);
    }
  }, [sendCommand, selectedPcCam, camFps, camQuality, CAMERA_WS_URL, session, toast, waitForWsOpen, processFrames]);

  const stopPcCamera = useCallback(async () => {
    sendCommand("stop_camera_stream", {});
    pcCamWsRef.current?.close();
    pcCamWsRef.current = null;
    setPcCamActive(false); setPcCamFrame(null); setLiveCamFps(0); setCamLatency(0);
    toast({ title: "Camera Stopped" });
  }, [sendCommand, toast]);

  const updateCamSettings = useCallback(async (fps: number, quality: number) => {
    if (pcCamActive) sendCommand("update_camera_settings", { fps, quality });
  }, [pcCamActive, sendCommand]);

  // ==================== SCREEN MIRROR ====================
  const startScreen = useCallback(async () => {
    if (screenStartLockRef.current) {
      toast({ title: "Please wait...", description: "Screen mirror is still starting" });
      return;
    }
    screenStartLockRef.current = true;
    try {
      setScreenError(null);
      
      // Stop any existing stream first
      if (screenWsRef.current) {
        screenWsRef.current.close();
        screenWsRef.current = null;
        sendCommand("stop_screen_stream", {});
        await new Promise(r => setTimeout(r, 500));
      }

      const sessionId = crypto.randomUUID();
      screenSessionRef.current = sessionId;

      const ws = new WebSocket(
        `${CAMERA_WS_URL}?sessionId=${sessionId}&type=pc&fps=${screenFps}&quality=${screenQuality}&binary=true&session_token=${session?.session_token || ''}`
      );
      screenWsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onmessage = (event) => processFrames(event, setScreenFrame, screenBlobUrl, screenFpsCounter, screenFrameTimes, setLiveScreenFps, setScreenLatency);
      ws.onopen = () => { setScreenActive(true); setScreenError(null); addLog("info", "web", "Screen WS connected"); };
      ws.onerror = () => addLog("error", "web", "Screen WS error");
      ws.onclose = () => {
        setScreenActive(false);
        if (screenBlobUrl.current) { URL.revokeObjectURL(screenBlobUrl.current); screenBlobUrl.current = null; }
        setScreenFrame(null); setLiveScreenFps(0); setScreenLatency(0);
      };

      await waitForWsOpen(ws);

      sendCommand("start_screen_stream", {
        session_id: sessionId, fps: screenFps, quality: screenQuality, scale: 0.5,
      }, { awaitResult: false });

      toast({ title: "Screen Mirror Starting" });
    } catch (err) {
      setScreenError(err instanceof Error ? err.message : String(err));
      toast({ title: "Screen Error", variant: "destructive" });
    } finally {
      setTimeout(() => { screenStartLockRef.current = false; }, 2000);
    }
  }, [sendCommand, screenFps, screenQuality, CAMERA_WS_URL, session, toast, waitForWsOpen, processFrames]);

  const stopScreen = useCallback(async () => {
    screenWsRef.current?.close();
    screenWsRef.current = null;
    sendCommand("stop_screen_stream", {});
    setScreenActive(false); setScreenFrame(null); setLiveScreenFps(0); setScreenLatency(0);
    toast({ title: "Screen Mirror Stopped" });
  }, [sendCommand, toast]);

  const updateScreenSettings = useCallback(async (fps: number, quality: number) => {
    if (screenActive) sendCommand("update_screen_settings", { fps, quality });
  }, [screenActive, sendCommand]);

  // ==================== AUDIO RELAY ====================
  const playReceivedAudio = useCallback((data: ArrayBuffer) => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();

      if (data.byteLength < 4) return;

      const int16 = new Int16Array(data);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
      }

      // Use native sample rate for smooth playback
      const sampleRate = audioCtxRef.current.sampleRate;
      
      // The agent sends at 16kHz, we need to resample to the context's native rate
      const AGENT_SAMPLE_RATE = 16000;
      const ratio = sampleRate / AGENT_SAMPLE_RATE;
      const outputLength = Math.round(float32.length * ratio);
      
      const audioBuffer = audioCtxRef.current.createBuffer(1, outputLength, sampleRate);
      const outputChannel = audioBuffer.getChannelData(0);
      
      // Linear interpolation resampling
      for (let i = 0; i < outputLength; i++) {
        const srcIndex = i / ratio;
        const srcIndexFloor = Math.floor(srcIndex);
        const srcIndexCeil = Math.min(srcIndexFloor + 1, float32.length - 1);
        const frac = srcIndex - srcIndexFloor;
        outputChannel[i] = float32[srcIndexFloor] * (1 - frac) + float32[srcIndexCeil] * frac;
      }

      const source = audioCtxRef.current.createBufferSource();
      source.buffer = audioBuffer;
      
      // Add gain node for volume control
      const gainNode = audioCtxRef.current.createGain();
      gainNode.gain.value = 1.5; // Boost volume slightly
      source.connect(gainNode);
      gainNode.connect(audioCtxRef.current.destination);

      const currentTime = audioCtxRef.current.currentTime;
      const startTime = Math.max(currentTime + 0.01, playbackTimeRef.current);
      source.start(startTime);
      playbackTimeRef.current = startTime + audioBuffer.duration;
    } catch (err) {
      console.debug("Audio playback error:", err);
    }
  }, []);

  const startAudioRelay = useCallback(async () => {
    try {
      const sessionId = crypto.randomUUID();
      addLog("info", "web", `Starting audio relay (${audioDirection})`);

      sendCommand("start_audio_relay", {
        session_id: sessionId,
        direction: audioDirection,
        use_system_audio: systemAudio,
      }, { awaitResult: false });

      const ws = new WebSocket(
        `${AUDIO_WS_URL}?sessionId=${sessionId}&type=phone&direction=${audioDirection}&session_token=${session?.session_token || ''}`
      );
      audioWsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = async () => {
        setAudioActive(true);
        addLog("info", "web", "Audio WS connected");

        // If sending audio from phone
        if (audioDirection === "phone_to_pc" || audioDirection === "bidirectional") {
          try {
            const constraints: MediaTrackConstraints = {
              echoCancellation: true, noiseSuppression: true, autoGainControl: true,
              sampleRate: 16000, channelCount: 1,
            };
            if (selectedInput) constraints.deviceId = { exact: selectedInput };

            const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
            micStreamRef.current = stream;

            const ctx = new AudioContext({ sampleRate: 16000 });
            audioCtxRef.current = ctx;
            if (ctx.state === "suspended") await ctx.resume();

            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            source.connect(analyser);

            const processor = ctx.createScriptProcessor(2048, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
              }
              try { ws.send(int16.buffer); } catch {}

              if (analyserRef.current) {
                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                analyserRef.current.getByteFrequencyData(dataArray);
                setAudioLevel(dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255);
              }
            };

            source.connect(processor);
            processor.connect(ctx.destination);
          } catch (err) {
            addLog("error", "web", `Mic error: ${err}`);
          }
        }

        // If receiving audio, create a fresh AudioContext at native rate
        if (audioDirection === "pc_to_phone" || audioDirection === "bidirectional") {
          if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
            audioCtxRef.current = new AudioContext();
          }
          playbackTimeRef.current = 0;
        }

        toast({ title: "Audio Relay Started", description: audioDirection.replace(/_/g, " ") });
      };

      ws.onmessage = async (event) => {
        try {
          if (typeof event.data === "string") {
            const msg = JSON.parse(event.data);
            if (msg.type === "peer_connected") addLog("info", "web", "Audio peer connected");
            if (msg.type === "peer_disconnected") addLog("warn", "web", "Audio peer disconnected");
            return;
          }
          if (audioDirection === "pc_to_phone" || audioDirection === "bidirectional") {
            let ab: ArrayBuffer | null = null;
            if (event.data instanceof ArrayBuffer) ab = event.data;
            else if (event.data instanceof Blob) ab = await event.data.arrayBuffer();
            if (ab && ab.byteLength > 2) playReceivedAudio(ab);
          }
        } catch {}
      };

      ws.onerror = () => { addLog("error", "web", "Audio WS error"); toast({ title: "Audio Error", variant: "destructive" }); };
      ws.onclose = () => { setAudioActive(false); setAudioLevel(0); addLog("info", "web", "Audio WS closed"); };
    } catch (err) {
      addLog("error", "web", `Audio relay error: ${err}`);
      toast({ title: "Audio Error", variant: "destructive" });
    }
  }, [sendCommand, audioDirection, AUDIO_WS_URL, session, toast, selectedInput, systemAudio, playReceivedAudio]);

  const stopAudioRelay = useCallback(async () => {
    sendCommand("stop_audio_relay", {});
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    audioWsRef.current?.close();
    audioWsRef.current = null;
    setAudioActive(false); setAudioLevel(0);
    toast({ title: "Audio Relay Stopped" });
  }, [sendCommand, toast]);

  // ==================== CLEANUP ====================
  useEffect(() => {
    return () => {
      pcCamWsRef.current?.close();
      screenWsRef.current?.close();
      audioWsRef.current?.close();
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      processorRef.current?.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close();
      if (camBlobUrl.current) URL.revokeObjectURL(camBlobUrl.current);
      if (screenBlobUrl.current) URL.revokeObjectURL(screenBlobUrl.current);
    };
  }, []);

  const DirectionIcon = audioDirection === "phone_to_pc" ? ArrowRight : audioDirection === "pc_to_phone" ? ArrowLeft : ArrowLeftRight;

  // ==================== RENDER ====================
  return (
    <div className="min-h-screen bg-black text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/10 bg-black/90 backdrop-blur-xl safe-area-top">
        <div className="flex items-center justify-between h-12 px-3">
          <div className="flex items-center gap-2">
            <BackButton />
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Camera className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm">Mic & Camera</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowDebug(!showDebug)} className={cn("h-8 text-xs", showDebug ? "bg-primary/20" : "")}>
              Debug
            </Button>
            {selectedDevice && (
              <Badge variant="outline" className={cn("gap-1 text-[10px]", selectedDevice.is_online ? "border-primary/50 text-primary" : "border-muted")}>
                <span className={cn("w-1.5 h-1.5 rounded-full", selectedDevice.is_online ? "bg-primary" : "bg-muted-foreground")} />
                {selectedDevice.is_online ? "Online" : "Offline"}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <ScrollArea className="h-[calc(100vh-3rem)]">
        <main className="p-3 space-y-3 pb-6">
          {showDebug && (
            <Card className="border-border/40">
              <CardContent className="p-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>Cam FPS: <span className="font-mono font-bold text-primary">{liveCamFps}</span></div>
                  <div>Cam Latency: <span className="font-mono font-bold">{camLatency}ms</span></div>
                  <div>Screen FPS: <span className="font-mono font-bold text-primary">{liveScreenFps}</span></div>
                  <div>Audio: <span className="font-mono font-bold">{Math.round(audioLevel * 100)}%</span></div>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-3 h-10">
              <TabsTrigger value="audio" className="text-xs gap-1">
                <Volume2 className="h-3.5 w-3.5" />Audio
              </TabsTrigger>
              <TabsTrigger value="pc-camera" className="text-xs gap-1">
                <Webcam className="h-3.5 w-3.5" />Cam
              </TabsTrigger>
              <TabsTrigger value="screen-mirror" className="text-xs gap-1">
                <ScreenShare className="h-3.5 w-3.5" />Screen
              </TabsTrigger>
              <TabsTrigger value="surveillance" className="text-xs gap-1">
                <Shield className="h-3.5 w-3.5" />Guard
              </TabsTrigger>
            </TabsList>

            {/* ==================== AUDIO TAB ==================== */}
            <TabsContent value="audio">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <DirectionIcon className="h-5 w-5 text-primary" />
                    Audio Relay
                  </CardTitle>
                  <CardDescription>Stream audio between phone and PC in real-time</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Direction */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
                    <Label>Stream Direction</Label>
                    <Select value={audioDirection} onValueChange={(v) => setAudioDirection(v as StreamDirection)} disabled={audioActive}>
                      <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="phone_to_pc">
                          <div className="flex items-center gap-2"><Smartphone className="h-4 w-4" /><ArrowRight className="h-3 w-3" /><Monitor className="h-4 w-4" /><span>Phone → PC</span></div>
                        </SelectItem>
                        <SelectItem value="pc_to_phone">
                          <div className="flex items-center gap-2"><Monitor className="h-4 w-4" /><ArrowRight className="h-3 w-3" /><Smartphone className="h-4 w-4" /><span>PC → Phone</span></div>
                        </SelectItem>
                        <SelectItem value="bidirectional">
                          <div className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /><span>Both Ways</span></div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* System Audio Toggle */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
                    <div className="flex items-center gap-2">
                      <Headphones className="h-4 w-4 text-muted-foreground" />
                      <Label>Share PC System Sound</Label>
                    </div>
                    <Button
                      variant={systemAudio ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSystemAudio(!systemAudio)}
                      disabled={audioActive}
                    >
                      {systemAudio ? "On" : "Off"}
                    </Button>
                  </div>

                  {/* Device Selectors */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm"><Mic className="h-4 w-4" />Phone Microphone</Label>
                      <Select value={selectedInput} onValueChange={setSelectedInput} disabled={audioActive || devicesLoading}>
                        <SelectTrigger><SelectValue placeholder={devicesLoading ? "Loading..." : "Select microphone"} /></SelectTrigger>
                        <SelectContent>
                          {inputDevices.map(d => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm"><Speaker className="h-4 w-4" />Phone Speaker</Label>
                      <Select value={selectedOutput} onValueChange={setSelectedOutput} disabled={audioActive || devicesLoading}>
                        <SelectTrigger><SelectValue placeholder={devicesLoading ? "Loading..." : "Select speaker"} /></SelectTrigger>
                        <SelectContent>
                          {outputDevices.map(d => <SelectItem key={d.deviceId} value={d.deviceId}>{d.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button variant="outline" size="sm" onClick={refreshDevices} disabled={devicesLoading} className="w-fit">
                    <RefreshCw className={cn("h-4 w-4 mr-2", devicesLoading && "animate-spin")} />Refresh Devices
                  </Button>

                  {/* Audio Visualizer */}
                  <div className="relative h-32 bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
                    <div className="absolute inset-0 flex items-center justify-center gap-1">
                      {Array.from({ length: 20 }).map((_, i) => (
                        <div
                          key={i}
                          className={cn("w-2 rounded-full transition-all duration-75", audioActive ? "bg-primary" : "bg-muted")}
                          style={{ height: audioActive ? `${Math.max(8, audioLevel * 100 * Math.sin((i + Date.now() / 100) * 0.5))}px` : "8px" }}
                        />
                      ))}
                    </div>
                    {!audioActive && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <MicOff className="h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">Audio relay is off</p>
                      </div>
                    )}
                    {audioActive && (
                      <Badge className="absolute top-3 left-3 bg-neon-green/80 text-background">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse mr-2" />STREAMING
                      </Badge>
                    )}
                  </div>

                  {/* Direction indicator */}
                  <div className="flex items-center justify-center gap-4 p-4 rounded-lg bg-secondary/10">
                    <div className={cn("flex flex-col items-center p-3 rounded-lg transition-colors",
                      (audioDirection !== "pc_to_phone") && audioActive ? "bg-primary/20 text-primary" : "text-muted-foreground"
                    )}>
                      <Smartphone className="h-8 w-8 mb-1" /><span className="text-xs">Phone Mic</span>
                    </div>
                    <DirectionIcon className={cn("h-8 w-8", audioActive ? "text-primary animate-pulse" : "text-muted-foreground")} />
                    <div className={cn("flex flex-col items-center p-3 rounded-lg transition-colors",
                      (audioDirection !== "phone_to_pc") && audioActive ? "bg-primary/20 text-primary" : "text-muted-foreground"
                    )}>
                      <Speaker className="h-8 w-8 mb-1" /><span className="text-xs">PC {systemAudio ? "System" : "Speakers"}</span>
                    </div>
                  </div>

                  {/* Audio Level */}
                  {audioActive && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Audio Level</span>
                        <span>{Math.round(audioLevel * 100)}%</span>
                      </div>
                      <div className="h-3 bg-secondary/50 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full transition-all duration-75 rounded-full",
                            audioLevel > 0.7 ? "bg-destructive" : audioLevel > 0.4 ? "bg-neon-orange" : "bg-neon-green"
                          )}
                          style={{ width: `${audioLevel * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Controls */}
                  <div className="flex items-center justify-center gap-4">
                    {!audioActive ? (
                      <Button onClick={startAudioRelay} className="gradient-primary">
                        <Mic className="h-4 w-4 mr-2" />Start Audio Relay
                      </Button>
                    ) : (
                      <Button onClick={stopAudioRelay} variant="destructive">
                        <Square className="h-4 w-4 mr-2" />Stop Audio Relay
                      </Button>
                    )}
                  </div>

                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm text-muted-foreground">
                      <strong>Note:</strong> PC agent must be running with audio support.
                      {systemAudio && " System sound sharing captures all PC audio output."}
                      {audioDirection === "bidirectional" && " Audio flows both ways for voice chat."}
                    </p>
                  </div>

                  <InlineDiagnostics type="audio" />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== PC CAMERA TAB ==================== */}
            <TabsContent value="pc-camera">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Webcam className="h-5 w-5 text-primary" />PC Camera → Phone
                  </CardTitle>
                  <CardDescription>Stream your PC webcam to view on your phone</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
                    <Label>Select PC Camera</Label>
                    <Select value={selectedPcCam.toString()} onValueChange={(v) => setSelectedPcCam(parseInt(v))} disabled={pcCamActive}>
                      <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select camera" /></SelectTrigger>
                      <SelectContent>
                        {pcCameras.length > 0
                          ? pcCameras.map(c => <SelectItem key={c.index} value={c.index.toString()}>{c.name}</SelectItem>)
                          : <SelectItem value="0">Camera 0</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>

                  <StreamSettingsPanel
                    fps={camFps} quality={camQuality}
                    onFpsChange={setCamFps} onQualityChange={setCamQuality}
                    onApply={updateCamSettings} label="Camera Settings"
                  />

                  <StreamDisplayControls
                    frame={pcCamFrame} isActive={pcCamActive}
                    fps={liveCamFps} latency={camLatency}
                    title="PC Camera" error={pcCamError}
                    streamId="pc-camera" streamType="camera"
                  />

                  <div className="flex items-center justify-center gap-4">
                    {!pcCamActive ? (
                      <Button onClick={startPcCamera} className="gradient-primary"><Play className="h-4 w-4 mr-2" />Start PC Camera</Button>
                    ) : (
                      <Button onClick={stopPcCamera} variant="destructive"><Square className="h-4 w-4 mr-2" />Stop PC Camera</Button>
                    )}
                    <Button onClick={fetchPcCameras} variant="outline" size="icon"><RefreshCw className="h-4 w-4" /></Button>
                  </div>

                  <InlineDiagnostics type="pc-camera" />
                  <DetailedDiagnostics mode="pc-camera" currentFps={liveCamFps} currentLatency={camLatency} currentQuality={camQuality} isStreamActive={pcCamActive} />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== SCREEN MIRROR TAB ==================== */}
            <TabsContent value="screen-mirror">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ScreenShare className="h-5 w-5 text-primary" />Screen Mirroring
                  </CardTitle>
                  <CardDescription>View your PC screen on your phone in real-time</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <StreamSettingsPanel
                    fps={screenFps} quality={screenQuality}
                    onFpsChange={setScreenFps} onQualityChange={setScreenQuality}
                    onApply={updateScreenSettings} label="Screen Settings"
                  />

                  <StreamDisplayControls
                    frame={screenFrame} isActive={screenActive}
                    fps={liveScreenFps} latency={screenLatency}
                    title="Screen Mirror" error={screenError}
                    streamId="screen-mirror" streamType="screen"
                  />

                  <div className="flex items-center justify-center gap-4">
                    {!screenActive ? (
                      <Button onClick={startScreen} className="gradient-primary"><ScreenShare className="h-4 w-4 mr-2" />Start Screen Mirror</Button>
                    ) : (
                      <Button onClick={stopScreen} variant="destructive"><ScreenShareOff className="h-4 w-4 mr-2" />Stop Screen Mirror</Button>
                    )}
                  </div>

                  <InlineDiagnostics type="screen" />
                  <DetailedDiagnostics mode="screen-mirror" currentFps={liveScreenFps} currentLatency={screenLatency} currentQuality={screenQuality} isStreamActive={screenActive} />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== SURVEILLANCE TAB ==================== */}
            <TabsContent value="surveillance">
              <SurveillancePanel />
            </TabsContent>
          </Tabs>
        </main>
      </ScrollArea>
    </div>
  );
}