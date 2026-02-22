import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Camera,
  Mic,
  MicOff,
  Video,
  VideoOff,
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
  Loader2,
  Settings,
  Gauge,
  Zap,
  ScreenShare,
  ScreenShareOff,
  Maximize2,
  PictureInPicture2,
  Shield,
} from "lucide-react";
import { StreamDisplayControls } from "@/components/StreamDisplayControls";
import { InlineDiagnostics } from "@/components/InlineDiagnostics";
import { DetailedDiagnostics } from "@/components/DetailedDiagnostics";
import { CameraTroubleshooter } from "@/components/CameraTroubleshooter";
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

export default function MicCamera() {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { session } = useDeviceSession();
  const { 
    inputDevices, 
    outputDevices, 
    selectedInput, 
    selectedOutput, 
    setSelectedInput, 
    setSelectedOutput,
    getInputStream,
    refreshDevices,
    loading: devicesLoading,
  } = useAudioDevices();

  // ==================== PHONE CAMERA STATE ====================
  const [phoneCameraActive, setPhoneCameraActive] = useState(false);
  const [phoneCameraStream, setPhoneCameraStream] = useState<MediaStream | null>(null);
  const phoneCameraRef = useRef<HTMLVideoElement>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");

  // Phone -> PC camera share (via relay)
  const [phoneCamShareActive, setPhoneCamShareActive] = useState(false);
  const [phoneCamShareSessionId, setPhoneCamShareSessionId] = useState<string>("");
  const phoneCamShareWsRef = useRef<WebSocket | null>(null);
  const phoneCamShareTimerRef = useRef<number | null>(null);
  const shareCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // PC -> (viewer) receive phone camera frames
  const [phoneCamViewActive, setPhoneCamViewActive] = useState(false);
  const [phoneCamRemoteFrame, setPhoneCamRemoteFrame] = useState<string | null>(null);
  const phoneCamViewWsRef = useRef<WebSocket | null>(null);

  // ==================== PC CAMERA STATE ====================
  const [pcCameraActive, setPcCameraActive] = useState(false);
  const [pcCameraFrame, setPcCameraFrame] = useState<string | null>(null);
  const [pcCameras, setPcCameras] = useState<Array<{ index: number; name: string }>>([]);
  const [selectedPcCamera, setSelectedPcCamera] = useState(0);
  const pcCameraWsRef = useRef<WebSocket | null>(null);
  const [pcCameraSessionId, setPcCameraSessionId] = useState<string | null>(null);
  const [pcCameraError, setPcCameraError] = useState<string | null>(null);
  const [screenMirrorError, setScreenMirrorError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ==================== CAMERA SETTINGS (real-time adjustable) ====================
  const [cameraFpsSetting, setCameraFpsSetting] = useState(30);
  const [cameraQualitySetting, setCameraQualitySetting] = useState(70);
  const [showCameraSettings, setShowCameraSettings] = useState(false);

  // ==================== AUDIO RELAY STATE ====================
  const [audioDirection, setAudioDirection] = useState<StreamDirection>("phone_to_pc");
  const [audioRelayActive, setAudioRelayActive] = useState(false);
  const [audioSessionId, setAudioSessionId] = useState<string | null>(null);
  const audioWsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [phoneMicStream, setPhoneMicStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // ==================== PC AUDIO TO PHONE ====================
  const [pcAudioActive, setPcAudioActive] = useState(false);
  const pcAudioRef = useRef<HTMLAudioElement | null>(null);
  const [useSystemAudio, setUseSystemAudio] = useState(false);

  // ==================== PHONE AS WEBCAM STATE ====================
  const [phoneWebcamActive, setPhoneWebcamActive] = useState(false);
  const [phoneWebcamSessionId, setPhoneWebcamSessionId] = useState<string>("");
  const [phoneWebcamStarting, setPhoneWebcamStarting] = useState(false);
  const phoneWebcamWsRef = useRef<WebSocket | null>(null);
  const phoneWebcamTimerRef = useRef<number | null>(null);

  // ==================== SCREEN MIRRORING STATE (WebSocket-based) ====================
  const [screenMirrorActive, setScreenMirrorActive] = useState(false);
  const [screenMirrorFrame, setScreenMirrorFrame] = useState<string | null>(null);
  const [screenMirrorFps, setScreenMirrorFps] = useState(30);
  const [screenMirrorQuality, setScreenMirrorQuality] = useState(70);
  const [screenMirrorSessionId, setScreenMirrorSessionId] = useState<string | null>(null);
  const screenMirrorWsRef = useRef<WebSocket | null>(null);
  const [screenMirrorLiveFps, setScreenMirrorLiveFps] = useState(0);
  const [screenMirrorLatency, setScreenMirrorLatency] = useState(0);
  const screenFpsCounterRef = useRef({ frames: 0, lastCheck: Date.now() });
  const screenFrameTimesRef = useRef<number[]>([]);
  const [showScreenSettings, setShowScreenSettings] = useState(false);

  const [showDebug, setShowDebug] = useState(false);
  const [debugStats, setDebugStats] = useState({
    audioWsConnected: false,
    audioPeerConnected: false,
    audioBytesSent: 0,
    cameraWsConnected: false,
    cameraPeerConnected: false,
    lastFrameTime: 0,
    frameCount: 0,
  });

  // Real-time FPS and latency tracking
  const [cameraFps, setCameraFps] = useState(0);
  const [cameraLatency, setCameraLatency] = useState(0);
  const fpsCounterRef = useRef({ frames: 0, lastCheck: Date.now() });
  const frameTimesRef = useRef<number[]>([]);

  // WebSocket streaming MUST use the functions subdomain; the PC agent connects there.
  // If the browser connects to a different host, you'll get "connected" with 0 frames forever.
  const WS_BASE = getFunctionsWsBase();
  const WS_URL = `${WS_BASE}/functions/v1/audio-relay`;
  const CAMERA_WS_URL = `${WS_BASE}/functions/v1/camera-relay`;

  const waitForWsOpen = useCallback((ws: WebSocket, timeoutMs = 10000, retryLabel = "WS") => {
    return new Promise<void>((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();

      const t = window.setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error(`${retryLabel} connection timeout`));
      }, timeoutMs);

      ws.addEventListener(
        "open",
        () => {
          window.clearTimeout(t);
          resolve();
        },
        { once: true }
      );

      ws.addEventListener(
        "error",
        () => {
          window.clearTimeout(t);
          reject(new Error(`${retryLabel} connection failed (possible 502)`));
        },
        { once: true }
      );
    });
  }, []);

  // Send FPS/Quality settings to agent in real-time
  const updateCameraSettings = useCallback(async (fps: number, quality: number) => {
    if (pcCameraActive && pcCameraSessionId) {
      try {
        await sendCommand("update_camera_settings", { fps, quality });
        addLog("info", "web", `Updated camera settings: FPS=${fps}, Quality=${quality}`);
      } catch (err) {
        addLog("warn", "web", `Failed to update camera settings: ${err}`);
      }
    }
  }, [pcCameraActive, pcCameraSessionId, sendCommand]);

  // ==================== PHONE CAMERA ====================
  const startPhoneCamera = useCallback(async (mode?: "user" | "environment") => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast({
          title: "Camera Error",
          description: "Camera API not available on this device/browser",
          variant: "destructive",
        });
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode ?? facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      setPhoneCameraStream(stream);
      if (phoneCameraRef.current) {
        phoneCameraRef.current.srcObject = stream;
        // Critical: explicit play() with muted to ensure video renders on mobile
        phoneCameraRef.current.muted = true;
        phoneCameraRef.current.setAttribute("playsinline", "true");
        phoneCameraRef.current.setAttribute("webkit-playsinline", "true");
        try {
          await phoneCameraRef.current.play();
        } catch {
          // Retry after brief delay for mobile browsers
          await new Promise(r => setTimeout(r, 100));
          try { await phoneCameraRef.current!.play(); } catch { /* ignore */ }
        }
      }
      setPhoneCameraActive(true);
      toast({ title: "Phone Camera Started", description: "Camera is streaming in the preview" });
    } catch (error) {
      console.error("Camera error:", error);
      const name = error instanceof Error ? error.name : "CameraError";
      const message = error instanceof Error ? error.message : String(error);

      const fix =
        name === "NotAllowedError"
          ? "Permission denied. Allow Camera access in browser/site settings."
          : name === "NotFoundError"
          ? "No camera found. Connect/enable a camera and try again."
          : name === "NotReadableError"
          ? "Camera is busy. Close other apps using the camera and retry."
          : "Check camera connection and permissions.";

      toast({
        title: "Camera Error",
        description: `${fix}${message ? ` (${name})` : ""}`,
        variant: "destructive",
      });
    }
  }, [facingMode, toast]);

  const stopPhoneCamera = useCallback(() => {
    if (phoneCameraStream) {
      phoneCameraStream.getTracks().forEach((track) => track.stop());
      setPhoneCameraStream(null);
    }
    if (phoneCameraRef.current) {
      phoneCameraRef.current.srcObject = null;
    }
    setPhoneCameraActive(false);
    toast({ title: "Phone Camera Stopped" });
  }, [phoneCameraStream, toast]);

  const switchPhoneCamera = useCallback(async () => {
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
    if (phoneCameraActive) {
      stopPhoneCamera();
      // IMPORTANT: restart must be in the same user gesture (no setTimeout),
      // otherwise mobile browsers may deny camera permissions.
      await startPhoneCamera(newMode);
    }
  }, [phoneCameraActive, facingMode, startPhoneCamera, stopPhoneCamera]);

  // ==================== PC CAMERA ====================
  const fetchPcCameras = useCallback(async () => {
    try {
      const result = await sendCommand("get_cameras", {}, { awaitResult: true, timeoutMs: 12000 });
      if (result && "result" in result && result.result?.cameras) {
        const cameras = result.result.cameras as Array<{ index: number; name: string }>;
        setPcCameras(cameras);
        addLog("info", "agent", `Found ${cameras.length} PC cameras`);
      }
    } catch (err) {
      addLog("error", "agent", `Failed to fetch PC cameras: ${err}`);
    }
  }, [sendCommand]);

  const startPcCamera = useCallback(async () => {
    try {
      setPcCameraError(null);
      const sessionId = crypto.randomUUID();
      setPcCameraSessionId(sessionId);
      addLog("info", "web", `Starting PC camera stream (session: ${sessionId.slice(0, 8)}...)`);

      // 1) Connect receiver FIRST (browser as type=pc)
      const ws = new WebSocket(
        `${CAMERA_WS_URL}?sessionId=${sessionId}&type=pc&fps=${cameraFpsSetting}&quality=${cameraQualitySetting}&binary=true&session_token=${session?.session_token || ''}`
      );
      pcCameraWsRef.current = ws;
      ws.binaryType = "arraybuffer";

      // Track current blob URL for cleanup
      let currentBlobUrl: string | null = null;

      ws.onmessage = async (event) => {
        const now = Date.now();

        try {
          let arrayBuffer: ArrayBuffer | null = null;

          // Handle ArrayBuffer directly
          if (event.data instanceof ArrayBuffer) {
            arrayBuffer = event.data;
          }
          // Handle Blob (browsers may deliver binary as Blob depending on server)
          else if (event.data instanceof Blob && event.data.size > 0) {
            arrayBuffer = await event.data.arrayBuffer();
          }

          if (arrayBuffer && arrayBuffer.byteLength > 100) {
            const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
            const newUrl = URL.createObjectURL(blob);

            // Clean up previous blob URL to prevent memory leaks
            if (currentBlobUrl) {
              URL.revokeObjectURL(currentBlobUrl);
            }
            currentBlobUrl = newUrl;

            setPcCameraFrame(newUrl);

            // Track frame times for latency calculation
            frameTimesRef.current.push(now);
            if (frameTimesRef.current.length > 10) {
              frameTimesRef.current.shift();
            }

            // Calculate latency from inter-frame gaps
            if (frameTimesRef.current.length >= 2) {
              const gaps = [];
              for (let i = 1; i < frameTimesRef.current.length; i++) {
                gaps.push(frameTimesRef.current[i] - frameTimesRef.current[i - 1]);
              }
              const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
              setCameraLatency(Math.round(avgGap));
            }

            // Update FPS counter
            fpsCounterRef.current.frames++;
            const elapsed = now - fpsCounterRef.current.lastCheck;
            if (elapsed >= 1000) {
              const fps = Math.round((fpsCounterRef.current.frames * 1000) / elapsed);
              setCameraFps(fps);
              fpsCounterRef.current = { frames: 0, lastCheck: now };
            }

            setDebugStats((prev) => ({
              ...prev,
              frameCount: prev.frameCount + 1,
              lastFrameTime: now,
            }));
            return;
          }

          // Handle JSON messages (legacy base64 frames + control messages)
          if (typeof event.data === "string") {
            const data = JSON.parse(event.data);
            if (data.type === "camera_frame" && data.data) {
              // Validate base64 data before setting
              if (typeof data.data === "string" && data.data.length > 0) {
                setPcCameraFrame(`data:image/jpeg;base64,${data.data}`);
                setDebugStats((prev) => ({
                  ...prev,
                  frameCount: prev.frameCount + 1,
                  lastFrameTime: Date.now(),
                }));
              }
            } else if (data.type === "peer_connected") {
              addLog("info", "agent", "PC camera peer connected");
            } else if (data.type === "peer_disconnected") {
              addLog("warn", "agent", "PC camera peer disconnected");
            }
            if (data.type === "error" && data.message) {
              setPcCameraError(data.message);
              addLog("error", "agent", `Camera relay error: ${data.message}`);
              toast({ title: "PC Camera Error", description: data.message, variant: "destructive" });
            }
          }
        } catch (e) {
          // Log parse errors for debugging
          console.debug("Camera frame parse issue:", e);
        }
      };

      ws.onopen = () => {
        setPcCameraActive(true);
        setPcCameraError(null);
        setDebugStats((prev) => ({ ...prev, cameraWsConnected: true }));
        addLog("info", "web", "Camera WebSocket connected");
      };

      ws.onerror = (err) => {
        addLog("error", "web", `Camera WebSocket error: ${err}`);
      };

      ws.onclose = () => {
        setPcCameraActive(false);
        // Clean up blob URL on close
        if (currentBlobUrl) {
          URL.revokeObjectURL(currentBlobUrl);
          currentBlobUrl = null;
        }
        setPcCameraFrame(null);
        setDebugStats((prev) => ({ ...prev, cameraWsConnected: false }));
        addLog("info", "web", "Camera WebSocket closed");
      };

      await waitForWsOpen(ws);

      // 2) Then tell PC agent to connect and start sending
      // Use fire-and-forget: don't block on result since the agent may be slow (high CPU).
      // The WS is already connected and will start receiving frames as soon as the agent streams.
      sendCommand(
        "start_camera_stream",
        {
          session_id: sessionId,
          camera_index: selectedPcCamera,
          fps: cameraFpsSetting,
          quality: cameraQualitySetting,
        },
        { awaitResult: false }
      ).then((result) => {
        if (!result.success) {
          addLog("warn", "agent", `Camera command queuing issue: ${result.error}`);
        } else {
          addLog("info", "agent", "Camera command sent to PC");
        }
      });

      toast({ title: "PC Camera Starting", description: "Waiting for PC to begin streaming..." });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      addLog("error", "web", `PC Camera error: ${errMsg}`);
      console.error("PC Camera error:", error);
      toast({ title: "PC Camera Error", description: "Unexpected error starting PC camera", variant: "destructive" });
    }
  }, [sendCommand, selectedPcCamera, cameraFpsSetting, cameraQualitySetting, CAMERA_WS_URL, toast, waitForWsOpen]);

  const stopPcCamera = useCallback(async () => {
    await sendCommand("stop_camera_stream", {});
    if (pcCameraWsRef.current) {
      pcCameraWsRef.current.close();
      pcCameraWsRef.current = null;
    }
    setPcCameraActive(false);
    setPcCameraFrame(null);
    setPcCameraSessionId(null);
    // Reset FPS and latency stats
    setCameraFps(0);
    setCameraLatency(0);
    fpsCounterRef.current = { frames: 0, lastCheck: Date.now() };
    frameTimesRef.current = [];
    setDebugStats((prev) => ({ ...prev, frameCount: 0, lastFrameTime: 0 }));
    toast({ title: "PC Camera Stopped" });
  }, [sendCommand, toast]);

  // ==================== AUDIO RELAY ====================
  const startAudioRelay = useCallback(async () => {
    try {
      const sessionId = crypto.randomUUID();
      setAudioSessionId(sessionId);
      addLog("info", "web", `Starting audio relay (direction: ${audioDirection})`);

      // Fire-and-forget: don't block on result since agent may be slow (high CPU)
      sendCommand(
        "start_audio_relay",
        {
          session_id: sessionId,
          direction: audioDirection,
          use_system_audio: useSystemAudio,
        },
        { awaitResult: false }
      ).then((result) => {
        if (!result.success) {
          addLog("warn", "agent", `Audio relay command queuing issue: ${result.error}`);
        } else {
          addLog("info", "agent", "Audio relay command sent to PC");
        }
      });

      // Connect WebSocket with binary support
      const ws = new WebSocket(`${WS_URL}?sessionId=${sessionId}&type=phone&direction=${audioDirection}&session_token=${session?.session_token || ''}`);
      audioWsRef.current = ws;
      ws.binaryType = "arraybuffer"; // Ensure we receive binary as ArrayBuffer

      ws.onopen = async () => {
        setAudioRelayActive(true);
        setDebugStats((prev) => ({ ...prev, audioWsConnected: true }));
        addLog("info", "web", "Audio WebSocket connected");

        // If phone is sending audio (phone_to_pc or bidirectional)
        if (audioDirection === "phone_to_pc" || audioDirection === "bidirectional") {
          try {
            // STANDARDIZED: 16kHz sample rate for better cross-platform compatibility
            const STANDARD_SAMPLE_RATE = 16000;
            
            // Use selected input device if available
            const audioConstraints: MediaTrackConstraints = {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: STANDARD_SAMPLE_RATE,
              channelCount: 1,
            };
            
            if (selectedInput) {
              audioConstraints.deviceId = { exact: selectedInput };
            }
            
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: audioConstraints,
            });

            setPhoneMicStream(stream);
            addLog("info", "web", `Phone microphone access granted (${STANDARD_SAMPLE_RATE}Hz) - Device: ${selectedInput || 'default'}`);

            // Create audio context at standardized sample rate
            const audioContext = new AudioContext({ sampleRate: STANDARD_SAMPLE_RATE });
            audioContextRef.current = audioContext;
            
            // Resume audio context if suspended (browser autoplay policy)
            if (audioContext.state === 'suspended') {
              await audioContext.resume();
              addLog("info", "web", "Audio context resumed");
            }

            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            source.connect(analyser);

            // Create processor to send audio (mono, 16kHz, Int16)
            const processor = audioContext.createScriptProcessor(2048, 1, 1);
            audioProcessorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (ws.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Check if there's actual audio data (not just silence)
                let hasAudio = false;
                for (let i = 0; i < inputData.length; i += 100) {
                  if (Math.abs(inputData[i]) > 0.001) {
                    hasAudio = true;
                    break;
                  }
                }
                
                // Convert Float32 to Int16
                const int16Array = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                  const s = Math.max(-1, Math.min(1, inputData[i]));
                  int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }

                try {
                  ws.send(int16Array.buffer);
                  setDebugStats((prev) => ({
                    ...prev,
                    audioBytesSent: prev.audioBytesSent + int16Array.byteLength,
                  }));
                } catch (sendErr) {
                  console.debug("Audio send error:", sendErr);
                }
              }

              // Update audio level visualization
              if (analyserRef.current) {
                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                analyserRef.current.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                setAudioLevel(average / 255);
              }
            };

            source.connect(processor);
            processor.connect(audioContext.destination);
            addLog("info", "web", "Audio processor initialized");
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            addLog("error", "web", `Mic access error: ${errMsg}`);
            console.error("Mic access error:", err);
          }
        }

        toast({ 
          title: "Audio Relay Started", 
          description: `Direction: ${audioDirection.replace(/_/g, " ")}` 
        });
      };

      // If phone is receiving audio (pc_to_phone or bidirectional)
      ws.onmessage = async (event) => {
        try {
          // Handle control messages (JSON string)
          if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data);
            if (msg.type === 'peer_connected') {
              addLog("info", "web", "Audio peer connected");
              setDebugStats((prev) => ({ ...prev, audioPeerConnected: true }));
            } else if (msg.type === 'peer_disconnected') {
              addLog("warn", "web", "Audio peer disconnected");
              setDebugStats((prev) => ({ ...prev, audioPeerConnected: false }));
            }
            return;
          }
          
          // Handle audio data for playback (ArrayBuffer or Blob)
          if (audioDirection === "pc_to_phone" || audioDirection === "bidirectional") {
            let audioData: ArrayBuffer | null = null;
            if (event.data instanceof ArrayBuffer) {
              audioData = event.data;
            } else if (event.data instanceof Blob) {
              audioData = await event.data.arrayBuffer();
            }
            if (audioData && audioData.byteLength > 2) {
              playReceivedAudio(audioData);
            }
          }
        } catch (e) {
          // Ignore parse errors for binary data
        }
      };

      ws.onerror = (err) => {
        addLog("error", "web", `Audio WebSocket error: ${err}`);
        toast({ title: "Audio Relay Error", variant: "destructive" });
      };

      ws.onclose = () => {
        setAudioRelayActive(false);
        setDebugStats((prev) => ({ ...prev, audioWsConnected: false }));
        addLog("info", "web", "Audio WebSocket closed");
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      addLog("error", "web", `Audio relay error: ${errMsg}`);
      console.error("Audio relay error:", error);
      toast({ title: "Audio Relay Error", variant: "destructive" });
    }
  }, [sendCommand, audioDirection, WS_URL, toast, selectedInput, useSystemAudio]);


  // Audio playback queue to prevent overlapping
  const audioPlaybackQueue = useRef<AudioBufferSourceNode[]>([]);
  const lastPlaybackTime = useRef<number>(0);

  const playReceivedAudio = async (data: ArrayBuffer | Blob) => {
    try {
      // STANDARDIZED: 16kHz sample rate to match Python agent
      const STANDARD_SAMPLE_RATE = 16000;
      
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: STANDARD_SAMPLE_RATE });
      }

      // Resume context if suspended
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const arrayBuffer = data instanceof Blob ? await data.arrayBuffer() : data;
      
      // Validate data size
      if (arrayBuffer.byteLength < 2) return;
      
      // Convert Int16 to Float32
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7fff);
      }

      // Use the context's actual sample rate (may differ from requested)
      const contextSampleRate = audioContextRef.current.sampleRate;
      const audioBuffer = audioContextRef.current.createBuffer(1, float32Array.length, contextSampleRate);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      
      // Schedule playback to prevent overlapping/gaps
      const currentTime = audioContextRef.current.currentTime;
      const startTime = Math.max(currentTime, lastPlaybackTime.current);
      source.start(startTime);
      lastPlaybackTime.current = startTime + audioBuffer.duration;
      
      // Clean up on end
      source.onended = () => {
        const idx = audioPlaybackQueue.current.indexOf(source);
        if (idx > -1) audioPlaybackQueue.current.splice(idx, 1);
      };
      audioPlaybackQueue.current.push(source);
    } catch (err) {
      console.debug("Audio playback error:", err);
    }
  };

  const stopAudioRelay = useCallback(async () => {
    await sendCommand("stop_audio_relay", {});

    if (phoneMicStream) {
      phoneMicStream.getTracks().forEach((track) => track.stop());
      setPhoneMicStream(null);
    }

    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (audioWsRef.current) {
      audioWsRef.current.close();
      audioWsRef.current = null;
    }

    analyserRef.current = null;
    setAudioRelayActive(false);
    setAudioSessionId(null);
    setAudioLevel(0);
    toast({ title: "Audio Relay Stopped" });
  }, [sendCommand, phoneMicStream, toast]);

  // ==================== SCREEN MIRRORING (WebSocket-based) ====================
  const startScreenMirror = useCallback(async () => {
    try {
      setScreenMirrorError(null);
      const sessionId = crypto.randomUUID();
      setScreenMirrorSessionId(sessionId);
      addLog("info", "web", `Starting screen mirroring via WebSocket (session: ${sessionId.slice(0, 8)}...)`);

      // 1) Connect receiver FIRST (browser as type=pc)
      const ws = new WebSocket(
        `${CAMERA_WS_URL}?sessionId=${sessionId}&type=pc&fps=${screenMirrorFps}&quality=${screenMirrorQuality}&binary=true&session_token=${session?.session_token || ''}`
      );
      screenMirrorWsRef.current = ws;
      ws.binaryType = "arraybuffer";

      // Track current blob URL for cleanup
      let currentBlobUrl: string | null = null;

      ws.onmessage = async (event) => {
        const now = Date.now();

        try {
          let arrayBuffer: ArrayBuffer | null = null;

          if (event.data instanceof ArrayBuffer) {
            arrayBuffer = event.data;
          } else if (event.data instanceof Blob && event.data.size > 0) {
            arrayBuffer = await event.data.arrayBuffer();
          }

          if (arrayBuffer && arrayBuffer.byteLength > 100) {
            const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
            const newUrl = URL.createObjectURL(blob);

            if (currentBlobUrl) {
              URL.revokeObjectURL(currentBlobUrl);
            }
            currentBlobUrl = newUrl;

            setScreenMirrorFrame(newUrl);

            // Track frame times for latency calculation
            screenFrameTimesRef.current.push(now);
            if (screenFrameTimesRef.current.length > 10) {
              screenFrameTimesRef.current.shift();
            }

            // Calculate latency from inter-frame gaps
            if (screenFrameTimesRef.current.length >= 2) {
              const gaps = [];
              for (let i = 1; i < screenFrameTimesRef.current.length; i++) {
                gaps.push(screenFrameTimesRef.current[i] - screenFrameTimesRef.current[i - 1]);
              }
              const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
              setScreenMirrorLatency(Math.round(avgGap));
            }

            // Update FPS counter
            screenFpsCounterRef.current.frames++;
            const elapsed = now - screenFpsCounterRef.current.lastCheck;
            if (elapsed >= 1000) {
              const fps = Math.round((screenFpsCounterRef.current.frames * 1000) / elapsed);
              setScreenMirrorLiveFps(fps);
              screenFpsCounterRef.current = { frames: 0, lastCheck: now };
            }
            return;
          }

          // Handle JSON messages (legacy base64 + control)
          if (typeof event.data === "string") {
            const data = JSON.parse(event.data);
            if (data.type === "screen_frame" && data.data) {
              setScreenMirrorFrame(`data:image/jpeg;base64,${data.data}`);
            } else if (data.type === "peer_connected") {
              addLog("info", "agent", "Screen mirror peer connected");
            } else if (data.type === "peer_disconnected") {
              addLog("warn", "agent", "Screen mirror peer disconnected");
            }
            if (data.type === "error" && data.message) {
              setScreenMirrorError(data.message);
              addLog("error", "agent", `Screen relay error: ${data.message}`);
              toast({ title: "Screen Mirror Error", description: data.message, variant: "destructive" });
            }
          }
        } catch (e) {
          console.debug("Screen frame parse issue:", e);
        }
      };

      ws.onopen = () => {
        setScreenMirrorActive(true);
        setScreenMirrorError(null);
        addLog("info", "web", "Screen mirror WebSocket connected");
      };

      ws.onerror = (err) => {
        addLog("error", "web", `Screen mirror WebSocket error: ${err}`);
      };

      ws.onclose = () => {
        setScreenMirrorActive(false);
        if (currentBlobUrl) {
          URL.revokeObjectURL(currentBlobUrl);
          currentBlobUrl = null;
        }
        setScreenMirrorFrame(null);
        setScreenMirrorLiveFps(0);
        setScreenMirrorLatency(0);
        screenFpsCounterRef.current = { frames: 0, lastCheck: Date.now() };
        screenFrameTimesRef.current = [];
        addLog("info", "web", "Screen mirror WebSocket closed");
      };

      await waitForWsOpen(ws);

      // 2) Fire-and-forget: don't block on result since agent may be slow (high CPU)
      sendCommand(
        "start_screen_stream",
        {
          session_id: sessionId,
          fps: screenMirrorFps,
          quality: screenMirrorQuality,
          scale: 0.5,
        },
        { awaitResult: false }
      ).then((result) => {
        if (!result.success) {
          addLog("warn", "agent", `Screen command queuing issue: ${result.error}`);
        } else {
          addLog("info", "agent", "Screen stream command sent to PC");
        }
      });

      toast({ title: "Screen Mirroring Starting", description: "Waiting for PC to begin streaming..." });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      addLog("error", "web", `Screen mirror error: ${errMsg}`);
      toast({ title: "Screen Mirror Error", variant: "destructive" });
    }
  }, [sendCommand, screenMirrorFps, screenMirrorQuality, CAMERA_WS_URL, toast, waitForWsOpen]);

  const stopScreenMirror = useCallback(async () => {
    if (screenMirrorWsRef.current) {
      screenMirrorWsRef.current.close();
      screenMirrorWsRef.current = null;
    }
    await sendCommand("stop_screen_stream", {});
    setScreenMirrorActive(false);
    setScreenMirrorFrame(null);
    setScreenMirrorSessionId(null);
    setScreenMirrorLiveFps(0);
    setScreenMirrorLatency(0);
    screenFpsCounterRef.current = { frames: 0, lastCheck: Date.now() };
    screenFrameTimesRef.current = [];
    toast({ title: "Screen Mirroring Stopped" });
  }, [sendCommand, toast]);

  // Send screen FPS/Quality settings to agent in real-time
  const updateScreenSettings = useCallback(async (fps: number, quality: number) => {
    if (screenMirrorActive && screenMirrorSessionId) {
      try {
        await sendCommand("update_screen_settings", { fps, quality });
        addLog("info", "web", `Updated screen settings: FPS=${fps}, Quality=${quality}`);
      } catch (err) {
        addLog("warn", "web", `Failed to update screen settings: ${err}`);
      }
    }
  }, [screenMirrorActive, screenMirrorSessionId, sendCommand]);

  // ==================== CLEANUP ====================
  useEffect(() => {
    fetchPcCameras();
  }, [fetchPcCameras]);

  useEffect(() => {
    return () => {
      if (phoneCameraStream) {
        phoneCameraStream.getTracks().forEach((track) => track.stop());
      }
      if (phoneMicStream) {
        phoneMicStream.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (pcCameraWsRef.current) {
        pcCameraWsRef.current.close();
      }
      if (audioWsRef.current) {
        audioWsRef.current.close();
      }
      if (phoneCamShareWsRef.current) {
        phoneCamShareWsRef.current.close();
      }
      if (phoneCamViewWsRef.current) {
        phoneCamViewWsRef.current.close();
      }
      if (phoneCamShareTimerRef.current) {
        window.clearInterval(phoneCamShareTimerRef.current);
      }
      if (screenMirrorWsRef.current) {
        screenMirrorWsRef.current.close();
      }
    };
  }, []);

  const DirectionIcon = audioDirection === "phone_to_pc" 
    ? ArrowRight 
    : audioDirection === "pc_to_phone" 
    ? ArrowLeft 
    : ArrowLeftRight;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center justify-between h-14 px-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <BackButton />
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <Camera className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-semibold text-sm">Mic & Camera</h1>
              <p className="text-xs text-muted-foreground">Audio & video streaming</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDebug(!showDebug)}
              className={showDebug ? "bg-primary/20" : ""}
            >
              Debug
            </Button>
            {selectedDevice && (
              <Badge
                variant="outline"
                className={cn(
                  "gap-1.5 text-xs",
                  selectedDevice.is_online ? "border-primary/50 text-primary" : "border-muted"
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", selectedDevice.is_online ? "bg-primary" : "bg-muted-foreground")} />
                {selectedDevice.is_online ? "Online" : "Offline"}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <ScrollArea className="h-[calc(100vh-3.5rem)]">
        <main className="max-w-4xl mx-auto p-4 space-y-4">
          {/* Debug Panel */}
          {showDebug && (
            <Card className="border-border/40">
              <CardContent className="p-3">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Camera FPS:</span>
                    <span className={cn(
                      "font-mono font-bold",
                      cameraFps >= 60 ? "text-primary" : cameraFps >= 30 ? "text-warning" : "text-destructive"
                    )}>{cameraFps}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Latency:</span>
                    <span className={cn(
                      "font-mono font-bold",
                      cameraLatency <= 50 ? "text-primary" : cameraLatency <= 100 ? "text-warning" : "text-destructive"
                    )}>{cameraLatency}ms</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Frames:</span>
                    <span className="font-mono">{debugStats.frameCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Audio:</span>
                    <span className="font-mono">{Math.round(audioLevel * 100)}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue={localStorage.getItem("mic_camera_tab") || "audio"} onValueChange={(v) => localStorage.setItem("mic_camera_tab", v)} className="w-full">
            <TabsList className="grid w-full grid-cols-5 mb-4">
              <TabsTrigger value="audio" className="text-sm">
                <Volume2 className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Audio</span>
              </TabsTrigger>
              <TabsTrigger value="phone-camera" className="text-sm">
                <Camera className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Phone</span>
              </TabsTrigger>
              <TabsTrigger value="pc-camera" className="text-sm">
                <Webcam className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">PC Cam</span>
              </TabsTrigger>
              <TabsTrigger value="screen-mirror" className="text-sm">
                <ScreenShare className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Screen</span>
              </TabsTrigger>
              <TabsTrigger value="surveillance" className="text-sm">
                <Shield className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Guard</span>
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
                  <CardDescription>
                    Stream audio between your phone and PC in real-time
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Direction selector */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
                    <Label>Stream Direction</Label>
                    <Select
                      value={audioDirection}
                      onValueChange={(v) => setAudioDirection(v as StreamDirection)}
                      disabled={audioRelayActive}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="phone_to_pc">
                          <div className="flex items-center gap-2">
                            <Smartphone className="h-4 w-4" />
                            <ArrowRight className="h-3 w-3" />
                            <Monitor className="h-4 w-4" />
                            <span>Phone → PC</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="pc_to_phone">
                          <div className="flex items-center gap-2">
                            <Monitor className="h-4 w-4" />
                            <ArrowRight className="h-3 w-3" />
                            <Smartphone className="h-4 w-4" />
                            <span>PC → Phone</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="bidirectional">
                          <div className="flex items-center gap-2">
                            <ArrowLeftRight className="h-4 w-4" />
                            <span>Both Ways</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Device Selectors */}
                  <div className="grid gap-3 md:grid-cols-2">
                    {/* Microphone selector */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm">
                        <Mic className="h-4 w-4" />
                        Phone Microphone
                      </Label>
                      <Select
                        value={selectedInput}
                        onValueChange={setSelectedInput}
                        disabled={audioRelayActive || devicesLoading}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={devicesLoading ? "Loading..." : "Select microphone"} />
                        </SelectTrigger>
                        <SelectContent>
                          {inputDevices.map((device) => (
                            <SelectItem key={device.deviceId} value={device.deviceId}>
                              {device.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Speaker selector */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm">
                        <Speaker className="h-4 w-4" />
                        Phone Speaker
                      </Label>
                      <Select
                        value={selectedOutput}
                        onValueChange={setSelectedOutput}
                        disabled={audioRelayActive || devicesLoading}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={devicesLoading ? "Loading..." : "Select speaker"} />
                        </SelectTrigger>
                        <SelectContent>
                          {outputDevices.map((device) => (
                            <SelectItem key={device.deviceId} value={device.deviceId}>
                              {device.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshDevices}
                    disabled={devicesLoading}
                    className="w-fit"
                  >
                    <RefreshCw className={cn("h-4 w-4 mr-2", devicesLoading && "animate-spin")} />
                    Refresh Devices
                  </Button>

                  {/* Audio visualizer */}
                  <div className="relative h-32 bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
                    <div className="absolute inset-0 flex items-center justify-center gap-1">
                      {Array.from({ length: 20 }).map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "w-2 rounded-full transition-all duration-75",
                            audioRelayActive ? "bg-primary" : "bg-muted"
                          )}
                          style={{
                            height: audioRelayActive
                              ? `${Math.max(8, audioLevel * 100 * Math.sin((i + Date.now() / 100) * 0.5))}px`
                              : "8px",
                          }}
                        />
                      ))}
                    </div>

                    {!audioRelayActive && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <MicOff className="h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">Audio relay is off</p>
                      </div>
                    )}

                    {audioRelayActive && (
                      <Badge className="absolute top-3 left-3 bg-neon-green/80 text-background">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse mr-2" />
                        STREAMING
                      </Badge>
                    )}
                  </div>

                  {/* Direction indicator */}
                  <div className="flex items-center justify-center gap-4 p-4 rounded-lg bg-secondary/10">
                    <div className={cn(
                      "flex flex-col items-center p-3 rounded-lg transition-colors",
                      (audioDirection === "phone_to_pc" || audioDirection === "bidirectional") && audioRelayActive
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground"
                    )}>
                      <Smartphone className="h-8 w-8 mb-1" />
                      <span className="text-xs">Phone Mic</span>
                    </div>

                    <DirectionIcon className={cn(
                      "h-8 w-8",
                      audioRelayActive ? "text-primary animate-pulse" : "text-muted-foreground"
                    )} />

                    <div className={cn(
                      "flex flex-col items-center p-3 rounded-lg transition-colors",
                      (audioDirection === "pc_to_phone" || audioDirection === "bidirectional") && audioRelayActive
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground"
                    )}>
                      <Speaker className="h-8 w-8 mb-1" />
                      <span className="text-xs">PC Speakers</span>
                    </div>
                  </div>

                  {/* Audio level */}
                  {audioRelayActive && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Audio Level</span>
                        <span>{Math.round(audioLevel * 100)}%</span>
                      </div>
                      <div className="h-3 bg-secondary/50 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full transition-all duration-75 rounded-full",
                            audioLevel > 0.7 ? "bg-destructive" : audioLevel > 0.4 ? "bg-neon-orange" : "bg-neon-green"
                          )}
                          style={{ width: `${audioLevel * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Controls */}
                  <div className="flex items-center justify-center gap-4">
                    {!audioRelayActive ? (
                      <Button onClick={startAudioRelay} className="gradient-primary">
                        <Mic className="h-4 w-4 mr-2" />
                        Start Audio Relay
                      </Button>
                    ) : (
                      <Button onClick={stopAudioRelay} variant="destructive">
                        <Square className="h-4 w-4 mr-2" />
                        Stop Audio Relay
                      </Button>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm text-muted-foreground">
                      <strong>Note:</strong> The PC agent must be running with audio support (pyaudio, websockets).
                      {audioDirection === "phone_to_pc" && " Phone microphone audio will play through PC speakers."}
                      {audioDirection === "pc_to_phone" && " PC microphone audio will play on your phone."}
                      {audioDirection === "bidirectional" && " Audio flows both ways for voice chat."}
                    </p>
                  </div>

                  {/* Inline Diagnostics */}
                  <InlineDiagnostics type="audio" />
                  <DetailedDiagnostics
                    mode="audio"
                    isStreamActive={audioRelayActive}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== PHONE CAMERA TAB ==================== */}
            <TabsContent value="phone-camera">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Video className="h-5 w-5 text-primary" />
                    Phone Camera
                  </CardTitle>
                  <CardDescription>
                    Preview locally and (optionally) share to your PC via the relay session ID
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative aspect-video bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
                    {phoneCameraActive ? (
                      <video
                        ref={phoneCameraRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <VideoOff className="h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">Camera is off</p>
                        <p className="text-xs">Click Start to begin</p>
                      </div>
                    )}

                    {phoneCameraActive && (
                      <Badge className="absolute top-3 left-3 bg-destructive/80">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse mr-2" />
                        LIVE
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-center gap-4">
                    {!phoneCameraActive ? (
                      <Button onClick={() => void startPhoneCamera()} className="gradient-primary">
                        <Play className="h-4 w-4 mr-2" />
                        Start Camera
                      </Button>
                    ) : (
                      <>
                        <Button onClick={stopPhoneCamera} variant="destructive">
                          <Square className="h-4 w-4 mr-2" />
                          Stop
                        </Button>
                        <Button onClick={() => void switchPhoneCamera()} variant="secondary">
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Flip
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
                    <div className="flex items-center gap-2">
                      <Label>Camera</Label>
                      <Badge variant="outline">{facingMode === "user" ? "Front" : "Back"}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Front Camera</span>
                      <Switch checked={facingMode === "user"} onCheckedChange={() => void switchPhoneCamera()} />
                    </div>
                  </div>

                  {/* Camera Troubleshooter Panel */}
                  <CameraTroubleshooter
                    facingMode={facingMode}
                    onCameraReady={(stream) => {
                      // If camera was tested successfully, use that stream
                      setPhoneCameraStream(stream);
                      if (phoneCameraRef.current) {
                        phoneCameraRef.current.srcObject = stream;
                        phoneCameraRef.current.play().catch(() => {});
                      }
                      setPhoneCameraActive(true);
                      toast({ title: "Camera Ready", description: "Camera started from troubleshooter" });
                    }}
                  />

                  {/* Share session */}
                  <div className="grid gap-3 rounded-lg border border-border/50 bg-secondary/10 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Phone → PC Share</p>
                        <p className="text-xs text-muted-foreground">
                          Start on your phone, then paste the same Session ID on your PC to view.
                        </p>
                      </div>
                      <Badge variant="outline">{phoneCamShareActive ? "Sharing" : "Idle"}</Badge>
                    </div>

                    <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                      <Input
                        value={phoneCamShareSessionId}
                        onChange={(e) => setPhoneCamShareSessionId(e.target.value)}
                        placeholder="Session ID (leave empty to auto-generate)"
                        disabled={phoneCamShareActive}
                      />
                      <Button
                        variant="secondary"
                        disabled={!phoneCameraActive || phoneCamShareActive}
                        onClick={async () => {
                          if (!phoneCameraActive) {
                            toast({
                              title: "Start phone camera first",
                              description: "You need a live phone camera preview before sharing.",
                              variant: "destructive",
                            });
                            return;
                          }

                          const sessionId = phoneCamShareSessionId?.trim() || crypto.randomUUID();
                          setPhoneCamShareSessionId(sessionId);

                          // Use higher FPS for smoother sharing
                          const ws = new WebSocket(`${CAMERA_WS_URL}?sessionId=${sessionId}&type=phone&fps=30&quality=70&session_token=${session?.session_token || ''}`);
                          phoneCamShareWsRef.current = ws;

                          ws.onopen = () => {
                            setPhoneCamShareActive(true);
                            toast({ title: "Sharing started", description: `Session: ${sessionId}` });

                            if (!shareCanvasRef.current) {
                              shareCanvasRef.current = document.createElement("canvas");
                            }

                            // push ~30 fps for smoother streaming
                            phoneCamShareTimerRef.current = window.setInterval(() => {
                              const v = phoneCameraRef.current;
                              if (!v || v.readyState < 2) return;

                              const canvas = shareCanvasRef.current!;
                              const w = v.videoWidth || 640;
                              const h = v.videoHeight || 480;
                              canvas.width = w;
                              canvas.height = h;

                              const ctx = canvas.getContext("2d");
                              if (!ctx) return;
                              ctx.drawImage(v, 0, 0, w, h);

                              // Send as binary for better performance
                              canvas.toBlob((blob) => {
                                if (blob && ws.readyState === WebSocket.OPEN) {
                                  blob.arrayBuffer().then((buffer) => {
                                    ws.send(buffer);
                                  });
                                }
                              }, "image/jpeg", 0.7);
                            }, 33); // ~30fps
                          };

                          ws.onclose = () => {
                            setPhoneCamShareActive(false);
                            if (phoneCamShareTimerRef.current) {
                              window.clearInterval(phoneCamShareTimerRef.current);
                              phoneCamShareTimerRef.current = null;
                            }
                          };

                          ws.onerror = () => {
                            toast({ title: "Share error", description: "Failed to connect to relay", variant: "destructive" });
                          };
                        }}
                      >
                        Start Share
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={!phoneCamShareActive}
                        onClick={() => {
                          if (phoneCamShareTimerRef.current) {
                            window.clearInterval(phoneCamShareTimerRef.current);
                            phoneCamShareTimerRef.current = null;
                          }
                          phoneCamShareWsRef.current?.close();
                          phoneCamShareWsRef.current = null;
                          setPhoneCamShareActive(false);
                        }}
                      >
                        Stop Share
                      </Button>
                    </div>

                    {/* View remote phone cam (for PC browser) */}
                    <div className="grid gap-2 pt-2 border-t border-border/40">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">View Phone Camera (PC)</p>
                        <Badge variant="outline">{phoneCamViewActive ? "Connected" : "Disconnected"}</Badge>
                      </div>

                      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                        <Input
                          value={phoneCamShareSessionId}
                          onChange={(e) => setPhoneCamShareSessionId(e.target.value)}
                          placeholder="Paste Session ID from your phone"
                        />
                        <Button
                          variant="secondary"
                          disabled={phoneCamViewActive || !phoneCamShareSessionId.trim()}
                          onClick={() => {
                            const sessionId = phoneCamShareSessionId.trim();
                            // Use higher FPS and binary mode for smoother viewing
                            const ws = new WebSocket(`${CAMERA_WS_URL}?sessionId=${sessionId}&type=pc&fps=60&quality=70&binary=true&session_token=${session?.session_token || ''}`);
                            ws.binaryType = "arraybuffer"; // Enable binary reception
                            phoneCamViewWsRef.current = ws;

                            ws.onopen = () => {
                              setPhoneCamViewActive(true);
                              toast({ title: "Connected", description: "Waiting for frames…" });
                            };

                            ws.onmessage = (event) => {
                              try {
                                // Handle binary frames (JPEG bytes)
                                if (event.data instanceof ArrayBuffer) {
                                  const blob = new Blob([event.data], { type: "image/jpeg" });
                                  const url = URL.createObjectURL(blob);
                                  // Clean up previous blob URL
                                  setPhoneCamRemoteFrame((prev) => {
                                    if (prev && prev.startsWith("blob:")) {
                                      URL.revokeObjectURL(prev);
                                    }
                                    return url;
                                  });
                                  return;
                                }
                                
                                // Handle JSON messages (legacy base64 + control)
                                const data = JSON.parse(event.data);
                                if (data.type === "camera_frame" && data.data) {
                                  setPhoneCamRemoteFrame(`data:image/jpeg;base64,${data.data}`);
                                }
                                if (data.type === "error" && data.message) {
                                  toast({ title: "Relay error", description: data.message, variant: "destructive" });
                                }
                              } catch {
                                // ignore parse errors
                              }
                            };

                            ws.onclose = () => {
                              setPhoneCamViewActive(false);
                            };

                            ws.onerror = () => {
                              toast({ title: "Connect error", description: "Failed to connect to relay", variant: "destructive" });
                            };
                          }}
                        >
                          Connect
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!phoneCamViewActive}
                          onClick={() => {
                            phoneCamViewWsRef.current?.close();
                            phoneCamViewWsRef.current = null;
                            setPhoneCamViewActive(false);
                            setPhoneCamRemoteFrame(null);
                          }}
                        >
                          Disconnect
                        </Button>
                      </div>

                      <div className="relative aspect-video bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
                        {phoneCamViewActive && phoneCamRemoteFrame ? (
                          <img src={phoneCamRemoteFrame} alt="Phone camera stream" className="w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                            <Smartphone className="h-12 w-12 mb-2 opacity-50" />
                            <p className="text-sm">No phone stream</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Inline Diagnostics */}
                  <InlineDiagnostics type="phone-camera" />
                  <DetailedDiagnostics
                    mode="phone-camera"
                    isStreamActive={phoneCameraActive}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== PC CAMERA TAB ==================== */}
            <TabsContent value="pc-camera">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Webcam className="h-5 w-5 text-primary" />
                    PC Camera → Phone
                  </CardTitle>
                  <CardDescription>
                    Stream your PC webcam to view on your phone
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Camera selector */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
                    <Label>Select PC Camera</Label>
                    <Select
                      value={selectedPcCamera.toString()}
                      onValueChange={(v) => setSelectedPcCamera(parseInt(v))}
                      disabled={pcCameraActive}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select camera" />
                      </SelectTrigger>
                      <SelectContent>
                        {pcCameras.length > 0 ? (
                          pcCameras.map((cam) => (
                            <SelectItem key={cam.index} value={cam.index.toString()}>
                              {cam.name}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="0">Camera 0</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Real-time Settings Panel */}
                  <div className="rounded-lg border border-border/50 bg-secondary/10 overflow-hidden">
                    <button
                      onClick={() => setShowCameraSettings(!showCameraSettings)}
                      className="w-full flex items-center justify-between p-3 hover:bg-secondary/20 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Settings className="h-4 w-4 text-primary" />
                        <span className="font-medium text-sm">Stream Settings</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {cameraFpsSetting} FPS
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {cameraQualitySetting}% Quality
                        </Badge>
                        <Zap className={cn(
                          "h-4 w-4 transition-transform",
                          showCameraSettings ? "rotate-180" : ""
                        )} />
                      </div>
                    </button>
                    
                    {showCameraSettings && (
                      <div className="p-4 pt-0 space-y-4 border-t border-border/30">
                        {/* FPS Slider */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm flex items-center gap-2">
                              <Gauge className="h-4 w-4" />
                              Target FPS
                            </Label>
                            <span className="font-mono text-sm font-bold text-primary">{cameraFpsSetting}</span>
                          </div>
                          <Slider
                            value={[cameraFpsSetting]}
                            onValueChange={([v]) => setCameraFpsSetting(v)}
                            onValueCommit={([v]) => {
                              setCameraFpsSetting(v);
                              updateCameraSettings(v, cameraQualitySetting);
                            }}
                            min={5}
                            max={90}
                            step={5}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>5 FPS (Low)</span>
                            <span>30 (Smooth)</span>
                            <span>90 (Ultra)</span>
                          </div>
                        </div>

                        {/* Quality Slider */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm flex items-center gap-2">
                              <Video className="h-4 w-4" />
                              JPEG Quality
                            </Label>
                            <span className="font-mono text-sm font-bold text-primary">{cameraQualitySetting}%</span>
                          </div>
                          <Slider
                            value={[cameraQualitySetting]}
                            onValueChange={([v]) => setCameraQualitySetting(v)}
                            onValueCommit={([v]) => {
                              setCameraQualitySetting(v);
                              updateCameraSettings(cameraFpsSetting, v);
                            }}
                            min={10}
                            max={100}
                            step={5}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>10% (Fast)</span>
                            <span>50% (Balanced)</span>
                            <span>100% (Best)</span>
                          </div>
                        </div>

                        {/* Presets */}
                        <div className="flex flex-wrap gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCameraFpsSetting(15);
                              setCameraQualitySetting(50);
                              updateCameraSettings(15, 50);
                            }}
                          >
                            🐢 Low Bandwidth
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCameraFpsSetting(30);
                              setCameraQualitySetting(70);
                              updateCameraSettings(30, 70);
                            }}
                          >
                            ⚖️ Balanced
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCameraFpsSetting(60);
                              setCameraQualitySetting(85);
                              updateCameraSettings(60, 85);
                            }}
                          >
                            🚀 High Quality
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCameraFpsSetting(90);
                              setCameraQualitySetting(100);
                              updateCameraSettings(90, 100);
                            }}
                          >
                            ⚡ Ultra
                          </Button>
                        </div>

                        <p className="text-xs text-muted-foreground pt-1">
                          <strong>Tip:</strong> Changes apply instantly without restarting the stream.
                          Higher FPS = smoother but more bandwidth. Higher quality = sharper but larger frames.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* PC Camera preview with display controls */}
                  <StreamDisplayControls
                    frame={pcCameraFrame}
                    isActive={pcCameraActive}
                    fps={cameraFps}
                    latency={cameraLatency}
                    title="PC Camera"
                    error={pcCameraError}
                  />

                  {/* Controls */}
                  <div className="flex items-center justify-center gap-4">
                    {!pcCameraActive ? (
                      <Button onClick={startPcCamera} className="gradient-primary">
                        <Play className="h-4 w-4 mr-2" />
                        Start PC Camera
                      </Button>
                    ) : (
                      <Button onClick={stopPcCamera} variant="destructive">
                        <Square className="h-4 w-4 mr-2" />
                        Stop PC Camera
                      </Button>
                    )}
                    <Button onClick={fetchPcCameras} variant="outline" size="icon">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Info */}
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm text-muted-foreground">
                      <strong>Note:</strong> PC camera streams here on your phone. 
                      The camera app does NOT open on the PC screen - it only shows on your phone.
                      Requires the PC agent with OpenCV (opencv-python) installed.
                    </p>
                  </div>

                  {/* Inline Diagnostics */}
                  <InlineDiagnostics type="pc-camera" />
                  <DetailedDiagnostics
                    mode="pc-camera"
                    currentFps={cameraFps}
                    currentLatency={cameraLatency}
                    currentQuality={cameraQualitySetting}
                    isStreamActive={pcCameraActive}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== SCREEN MIRRORING TAB ==================== */}
            <TabsContent value="screen-mirror">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ScreenShare className="h-5 w-5 text-primary" />
                    Screen Mirroring
                  </CardTitle>
                  <CardDescription>
                    View your PC screen on your phone in real-time via WebSocket relay (up to 90 FPS)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Real-time Settings Panel */}
                  <div className="rounded-lg border border-border/50 bg-secondary/10 overflow-hidden">
                    <button
                      onClick={() => setShowScreenSettings(!showScreenSettings)}
                      className="w-full flex items-center justify-between p-3 hover:bg-secondary/20 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Settings className="h-4 w-4 text-primary" />
                        <span className="font-medium text-sm">Stream Settings</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {screenMirrorFps} FPS
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {screenMirrorQuality}% Quality
                        </Badge>
                        <Zap className={cn(
                          "h-4 w-4 transition-transform",
                          showScreenSettings ? "rotate-180" : ""
                        )} />
                      </div>
                    </button>
                    
                    {showScreenSettings && (
                      <div className="p-4 pt-0 space-y-4 border-t border-border/30">
                        {/* FPS Slider */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm flex items-center gap-2">
                              <Gauge className="h-4 w-4" />
                              Target FPS
                            </Label>
                            <span className="font-mono text-sm font-bold text-primary">{screenMirrorFps}</span>
                          </div>
                          <Slider
                            value={[screenMirrorFps]}
                            onValueChange={([v]) => setScreenMirrorFps(v)}
                            onValueCommit={([v]) => {
                              setScreenMirrorFps(v);
                              updateScreenSettings(v, screenMirrorQuality);
                            }}
                            min={5}
                            max={90}
                            step={5}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>5 FPS (Low)</span>
                            <span>30 (Smooth)</span>
                            <span>90 (Ultra)</span>
                          </div>
                        </div>

                        {/* Quality Slider */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm flex items-center gap-2">
                              <Monitor className="h-4 w-4" />
                              JPEG Quality
                            </Label>
                            <span className="font-mono text-sm font-bold text-primary">{screenMirrorQuality}%</span>
                          </div>
                          <Slider
                            value={[screenMirrorQuality]}
                            onValueChange={([v]) => setScreenMirrorQuality(v)}
                            onValueCommit={([v]) => {
                              setScreenMirrorQuality(v);
                              updateScreenSettings(screenMirrorFps, v);
                            }}
                            min={10}
                            max={100}
                            step={5}
                            className="w-full"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>10% (Fast)</span>
                            <span>50% (Balanced)</span>
                            <span>100% (Best)</span>
                          </div>
                        </div>

                        {/* Presets */}
                        <div className="flex flex-wrap gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setScreenMirrorFps(15);
                              setScreenMirrorQuality(50);
                              updateScreenSettings(15, 50);
                            }}
                          >
                            🐢 Low Bandwidth
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setScreenMirrorFps(30);
                              setScreenMirrorQuality(70);
                              updateScreenSettings(30, 70);
                            }}
                          >
                            ⚖️ Balanced
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setScreenMirrorFps(60);
                              setScreenMirrorQuality(85);
                              updateScreenSettings(60, 85);
                            }}
                          >
                            🚀 High Quality
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setScreenMirrorFps(90);
                              setScreenMirrorQuality(100);
                              updateScreenSettings(90, 100);
                            }}
                          >
                            ⚡ Ultra
                          </Button>
                        </div>

                        <p className="text-xs text-muted-foreground pt-1">
                          <strong>Tip:</strong> Changes apply instantly without restarting the stream.
                          Higher FPS = smoother but more bandwidth. Higher quality = sharper but larger frames.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Screen Preview with display controls */}
                  <StreamDisplayControls
                    frame={screenMirrorFrame}
                    isActive={screenMirrorActive}
                    fps={screenMirrorLiveFps}
                    latency={screenMirrorLatency}
                    title="Screen Mirror"
                    error={screenMirrorError}
                  />

                  {/* Controls */}
                  <div className="flex items-center justify-center gap-4">
                    {!screenMirrorActive ? (
                      <Button onClick={startScreenMirror} className="gradient-primary">
                        <ScreenShare className="h-4 w-4 mr-2" />
                        Start Screen Mirror
                      </Button>
                    ) : (
                      <Button onClick={stopScreenMirror} variant="destructive">
                        <ScreenShareOff className="h-4 w-4 mr-2" />
                        Stop Screen Mirror
                      </Button>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm text-muted-foreground">
                      <strong>WebSocket Relay:</strong> High-performance screen mirroring via binary WebSocket.
                      Supports up to 90 FPS. PC agent streams screen frames through the camera-relay edge function.
                    </p>
                  </div>

                  {/* Inline Diagnostics */}
                  <InlineDiagnostics type="screen" />
                  <DetailedDiagnostics
                    mode="screen-mirror"
                    currentFps={screenMirrorLiveFps}
                    currentLatency={screenMirrorLatency}
                    currentQuality={screenMirrorQuality}
                    isStreamActive={screenMirrorActive}
                  />
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
