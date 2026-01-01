import { useState, useRef, useCallback, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { cn } from "@/lib/utils";
import { addLog } from "@/components/IssueLog";

type StreamDirection = "phone_to_pc" | "pc_to_phone" | "bidirectional";

export default function MicCamera() {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();

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

  // Derive the Edge Functions WebSocket domain from the configured backend project id
  const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? "";

  const WS_URL = `wss://${projectRef}.functions.supabase.co/functions/v1/audio-relay`;
  const CAMERA_WS_URL = `wss://${projectRef}.functions.supabase.co/functions/v1/camera-relay`;

  // ==================== PHONE CAMERA ====================
  const startPhoneCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      setPhoneCameraStream(stream);
      if (phoneCameraRef.current) {
        phoneCameraRef.current.srcObject = stream;
      }
      setPhoneCameraActive(true);
      toast({ title: "Phone Camera Started", description: "Camera is streaming in the preview" });
    } catch (error) {
      console.error("Camera error:", error);
      toast({
        title: "Camera Error",
        description: "Could not access camera. Please grant permission.",
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

  const switchPhoneCamera = useCallback(() => {
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
    if (phoneCameraActive) {
      stopPhoneCamera();
      setTimeout(() => startPhoneCamera(), 300);
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
      const sessionId = crypto.randomUUID();
      setPcCameraSessionId(sessionId);
      addLog("info", "web", `Starting PC camera stream (session: ${sessionId.slice(0, 8)}...)`);

      // Tell PC to start camera stream (wait for an explicit OK so we can surface camera-open errors)
      const started = await sendCommand(
        "start_camera_stream",
        {
          session_id: sessionId,
          camera_index: selectedPcCamera,
        },
        { awaitResult: true, timeoutMs: 20000 }
      );

      if (!started.success) {
        const msg = typeof started.error === "string" ? started.error : "PC failed to start camera";
        // Log the error from the agent to the IssueLog
        addLog("error", "agent", `Camera open failed: ${msg}`);
        toast({ title: "PC Camera Error", description: msg, variant: "destructive" });
        setPcCameraSessionId(null);
        return;
      }

      addLog("info", "agent", "PC camera opened successfully");

      // Connect to dedicated camera-relay WebSocket (phone receives frames)
      const ws = new WebSocket(`${CAMERA_WS_URL}?sessionId=${sessionId}&type=phone&fps=10&quality=60`);
      pcCameraWsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "camera_frame" && data.data) {
            setPcCameraFrame(`data:image/jpeg;base64,${data.data}`);
            setDebugStats((prev) => ({
              ...prev,
              frameCount: prev.frameCount + 1,
              lastFrameTime: Date.now(),
            }));
          }
          if (data.type === "error" && data.message) {
            addLog("error", "agent", `Camera relay error: ${data.message}`);
            toast({ title: "PC Camera Error", description: data.message, variant: "destructive" });
          }
        } catch {
          // ignore parse errors for binary data
        }
      };

      ws.onopen = () => {
        setPcCameraActive(true);
        setDebugStats((prev) => ({ ...prev, cameraWsConnected: true }));
        addLog("info", "web", "Camera WebSocket connected");
        toast({ title: "PC Camera Started", description: "PC webcam is streaming to your phone" });
      };

      ws.onerror = (err) => {
        addLog("error", "web", `Camera WebSocket error: ${err}`);
        toast({ title: "PC Camera Error", description: "WebSocket error", variant: "destructive" });
      };

      ws.onclose = () => {
        setPcCameraActive(false);
        setPcCameraFrame(null);
        setDebugStats((prev) => ({ ...prev, cameraWsConnected: false }));
        addLog("info", "web", "Camera WebSocket closed");
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      addLog("error", "web", `PC Camera error: ${errMsg}`);
      console.error("PC Camera error:", error);
      toast({ title: "PC Camera Error", description: "Unexpected error starting PC camera", variant: "destructive" });
    }
  }, [sendCommand, selectedPcCamera, CAMERA_WS_URL, toast]);

  const stopPcCamera = useCallback(async () => {
    await sendCommand("stop_camera_stream", {});
    if (pcCameraWsRef.current) {
      pcCameraWsRef.current.close();
      pcCameraWsRef.current = null;
    }
    setPcCameraActive(false);
    setPcCameraFrame(null);
    setPcCameraSessionId(null);
    toast({ title: "PC Camera Stopped" });
  }, [sendCommand, toast]);

  // ==================== AUDIO RELAY ====================
  const startAudioRelay = useCallback(async () => {
    try {
      const sessionId = crypto.randomUUID();
      setAudioSessionId(sessionId);
      addLog("info", "web", `Starting audio relay (direction: ${audioDirection})`);

      // Tell PC to start audio relay
      const started = await sendCommand("start_audio_relay", {
        session_id: sessionId,
        direction: audioDirection,
      }, { awaitResult: true, timeoutMs: 10000 });

      if (!started.success) {
        const msg = typeof started.error === "string" ? started.error : "PC failed to start audio relay";
        addLog("error", "agent", `Audio relay failed: ${msg}`);
        toast({ title: "Audio Relay Error", description: msg, variant: "destructive" });
        return;
      }

      addLog("info", "agent", "PC audio relay started");

      // Connect WebSocket
      const ws = new WebSocket(`${WS_URL}?sessionId=${sessionId}&type=phone&direction=${audioDirection}`);
      audioWsRef.current = ws;

      ws.onopen = async () => {
        setAudioRelayActive(true);
        setDebugStats((prev) => ({ ...prev, audioWsConnected: true }));
        addLog("info", "web", "Audio WebSocket connected");

        // If phone is sending audio (phone_to_pc or bidirectional)
        if (audioDirection === "phone_to_pc" || audioDirection === "bidirectional") {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100,
                channelCount: 1,
              },
            });

            setPhoneMicStream(stream);
            addLog("info", "web", "Phone microphone access granted");

            // Create audio context for processing
            const audioContext = new AudioContext({ sampleRate: 44100 });
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            source.connect(analyser);

            // Create processor to send audio (mono, 44100Hz, Int16)
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            audioProcessorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (ws.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Convert Float32 to Int16
                const int16Array = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                  const s = Math.max(-1, Math.min(1, inputData[i]));
                  int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }

                ws.send(int16Array.buffer);
                setDebugStats((prev) => ({
                  ...prev,
                  audioBytesSent: prev.audioBytesSent + int16Array.byteLength,
                }));
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
      ws.onmessage = (event) => {
        if (audioDirection === "pc_to_phone" || audioDirection === "bidirectional") {
          if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
            playReceivedAudio(event.data);
          }
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
  }, [sendCommand, audioDirection, WS_URL, toast]);

  const playReceivedAudio = async (data: ArrayBuffer | Blob) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 44100 });
      }

      const arrayBuffer = data instanceof Blob ? await data.arrayBuffer() : data;
      
      // Convert Int16 to Float32
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7fff);
      }

      const audioBuffer = audioContextRef.current.createBuffer(1, float32Array.length, 44100);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.start();
    } catch (err) {
      console.error("Audio playback error:", err);
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
    };
  }, []);

  const DirectionIcon = audioDirection === "phone_to_pc" 
    ? ArrowRight 
    : audioDirection === "pc_to_phone" 
    ? ArrowLeft 
    : ArrowLeftRight;

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-2rem)]">
        <div className="space-y-4 animate-fade-in pr-4 pt-12 md:pt-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold neon-text">Mic & Camera</h1>
              <p className="text-muted-foreground text-sm">
                Bidirectional audio & video streaming between phone and PC
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDebug(!showDebug)}
                className={showDebug ? "bg-primary/20" : ""}
              >
                Debug
              </Button>
              {selectedDevice && (
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  {selectedDevice.name}
                </Badge>
              )}
            </div>
          </div>

          {/* Debug Panel */}
          {showDebug && (
            <Card className="glass-dark border-border/50 p-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Audio WS:</span>{" "}
                  <Badge variant={audioWsRef.current ? "default" : "secondary"} className="text-xs">
                    {audioWsRef.current ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Camera WS:</span>{" "}
                  <Badge variant={pcCameraWsRef.current ? "default" : "secondary"} className="text-xs">
                    {pcCameraWsRef.current ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Audio Level:</span>{" "}
                  <span className="font-mono">{Math.round(audioLevel * 100)}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Session:</span>{" "}
                  <span className="font-mono">{audioSessionId?.slice(0, 8) || "—"}</span>
                </div>
              </div>
            </Card>
          )}

          <Tabs defaultValue="audio" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="audio" className="text-sm">
                <Volume2 className="h-4 w-4 mr-2" />
                Audio
              </TabsTrigger>
              <TabsTrigger value="phone-camera" className="text-sm">
                <Smartphone className="h-4 w-4 mr-2" />
                Phone Cam
              </TabsTrigger>
              <TabsTrigger value="pc-camera" className="text-sm">
                <Webcam className="h-4 w-4 mr-2" />
                PC Cam
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
                      <Button onClick={startPhoneCamera} className="gradient-primary">
                        <Play className="h-4 w-4 mr-2" />
                        Start Camera
                      </Button>
                    ) : (
                      <>
                        <Button onClick={stopPhoneCamera} variant="destructive">
                          <Square className="h-4 w-4 mr-2" />
                          Stop
                        </Button>
                        <Button onClick={switchPhoneCamera} variant="secondary">
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
                      <Switch checked={facingMode === "user"} onCheckedChange={() => switchPhoneCamera()} />
                    </div>
                  </div>

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

                          const ws = new WebSocket(`${CAMERA_WS_URL}?sessionId=${sessionId}&type=phone&fps=10&quality=60`);
                          phoneCamShareWsRef.current = ws;

                          ws.onopen = () => {
                            setPhoneCamShareActive(true);
                            toast({ title: "Sharing started", description: `Session: ${sessionId}` });

                            if (!shareCanvasRef.current) {
                              shareCanvasRef.current = document.createElement("canvas");
                            }

                            // push ~10 fps
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

                              const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
                              const b64 = dataUrl.split(",")[1] || "";

                              if (ws.readyState === WebSocket.OPEN) {
                                ws.send(
                                  JSON.stringify({
                                    type: "camera_frame",
                                    data: b64,
                                    width: w,
                                    height: h,
                                  })
                                );
                              }
                            }, 100);
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
                            const ws = new WebSocket(`${CAMERA_WS_URL}?sessionId=${sessionId}&type=pc&fps=10&quality=60`);
                            phoneCamViewWsRef.current = ws;

                            ws.onopen = () => {
                              setPhoneCamViewActive(true);
                              toast({ title: "Connected", description: "Waiting for frames…" });
                            };

                            ws.onmessage = (event) => {
                              try {
                                const data = JSON.parse(event.data);
                                if (data.type === "camera_frame" && data.data) {
                                  setPhoneCamRemoteFrame(`data:image/jpeg;base64,${data.data}`);
                                }
                                if (data.type === "error" && data.message) {
                                  toast({ title: "Relay error", description: data.message, variant: "destructive" });
                                }
                              } catch {
                                // ignore
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
                            <p className="text-xs">Connect from your PC with a Session ID</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
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

                  {/* PC Camera preview */}
                  <div className="relative aspect-video bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
                    {pcCameraActive && pcCameraFrame ? (
                      <img
                        src={pcCameraFrame}
                        alt="PC Camera"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <Webcam className="h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">PC Camera is off</p>
                        <p className="text-xs">Click Start to stream PC webcam</p>
                      </div>
                    )}

                    {pcCameraActive && (
                      <Badge className="absolute top-3 left-3 bg-neon-cyan/80 text-background">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse mr-2" />
                        PC → PHONE
                      </Badge>
                    )}
                  </div>

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
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </DashboardLayout>
  );
}
