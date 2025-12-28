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

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const WS_URL = SUPABASE_URL?.replace("https://", "wss://") + "/functions/v1/audio-relay";

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
    const result = await sendCommand("get_cameras", {});
    if (result && "result" in result && result.result?.cameras) {
      const cameras = result.result.cameras as Array<{ index: number; name: string }>;
      setPcCameras(cameras);
    }
  }, [sendCommand]);

  const startPcCamera = useCallback(async () => {
    try {
      const sessionId = crypto.randomUUID();
      setPcCameraSessionId(sessionId);

      // Tell PC to start camera stream
      await sendCommand("start_camera_stream", {
        session_id: sessionId,
        camera_index: selectedPcCamera,
      });

      // Connect to WebSocket to receive frames
      const ws = new WebSocket(`${WS_URL}?sessionId=${sessionId}&type=phone&direction=pc_to_phone`);
      pcCameraWsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "camera_frame" && data.data) {
            setPcCameraFrame(`data:image/jpeg;base64,${data.data}`);
          }
        } catch {
          // Binary data, ignore
        }
      };

      ws.onopen = () => {
        setPcCameraActive(true);
        toast({ title: "PC Camera Started", description: "PC webcam is streaming to your phone" });
      };

      ws.onerror = () => {
        toast({ title: "PC Camera Error", variant: "destructive" });
      };

      ws.onclose = () => {
        setPcCameraActive(false);
        setPcCameraFrame(null);
      };
    } catch (error) {
      console.error("PC Camera error:", error);
      toast({ title: "PC Camera Error", variant: "destructive" });
    }
  }, [sendCommand, selectedPcCamera, WS_URL, toast]);

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

      // Tell PC to start audio relay
      await sendCommand("start_audio_relay", {
        session_id: sessionId,
        direction: audioDirection,
      });

      // Connect WebSocket
      const ws = new WebSocket(`${WS_URL}?sessionId=${sessionId}&type=phone&direction=${audioDirection}`);
      audioWsRef.current = ws;

      ws.onopen = async () => {
        setAudioRelayActive(true);

        // If phone is sending audio (phone_to_pc or bidirectional)
        if (audioDirection === "phone_to_pc" || audioDirection === "bidirectional") {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100,
              },
            });

            setPhoneMicStream(stream);

            // Create audio context for processing
            const audioContext = new AudioContext({ sampleRate: 44100 });
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            source.connect(analyser);

            // Create processor to send audio
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
            // Play received audio
            playReceivedAudio(event.data);
          }
        }
      };

      ws.onerror = () => {
        toast({ title: "Audio Relay Error", variant: "destructive" });
      };

      ws.onclose = () => {
        setAudioRelayActive(false);
      };
    } catch (error) {
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
            {selectedDevice && (
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                {selectedDevice.name}
              </Badge>
            )}
          </div>

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
                    Phone Camera Preview
                  </CardTitle>
                  <CardDescription>
                    View your phone camera here (visible on this device)
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
                      <Badge variant="outline">
                        {facingMode === "user" ? "Front" : "Back"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Front Camera</span>
                      <Switch
                        checked={facingMode === "user"}
                        onCheckedChange={() => switchPhoneCamera()}
                      />
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
