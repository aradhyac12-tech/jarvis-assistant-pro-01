import { useState, useRef, useCallback, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { cn } from "@/lib/utils";

export default function MicCamera() {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");

  // Mic state
  const [micActive, setMicActive] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);

      toast({ title: "Camera Started", description: "Phone camera is now streaming to the web UI" });
    } catch (error) {
      console.error("Camera error:", error);
      toast({
        title: "Camera Error",
        description: "Could not access camera. Please grant permission.",
        variant: "destructive",
      });
    }
  }, [facingMode, toast]);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    toast({ title: "Camera Stopped" });
  }, [cameraStream, toast]);

  // Switch camera
  const switchCamera = useCallback(() => {
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
    if (cameraActive) {
      stopCamera();
      setTimeout(() => {
        startCamera();
      }, 300);
    }
  }, [cameraActive, facingMode, startCamera, stopCamera]);

  // Start microphone (relay audio to PC via WebRTC or command)
  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
        },
      });

      setAudioStream(stream);
      setMicActive(true);

      // Create audio context for visualization
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Visualize audio level
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(average / 255);
        if (micActive) {
          requestAnimationFrame(updateLevel);
        }
      };
      updateLevel();

      // Send command to PC to start audio receiver
      await sendCommand("start_audio_relay", { sampleRate: 44100 });

      toast({ title: "Microphone Started", description: "Audio is being relayed to PC speakers" });
    } catch (error) {
      console.error("Mic error:", error);
      toast({
        title: "Microphone Error",
        description: "Could not access microphone. Please grant permission.",
        variant: "destructive",
      });
    }
  }, [sendCommand, toast, micActive]);

  // Stop microphone
  const stopMic = useCallback(async () => {
    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
      setAudioStream(null);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setMicActive(false);
    setAudioLevel(0);

    await sendCommand("stop_audio_relay", {});
    toast({ title: "Microphone Stopped" });
  }, [audioStream, sendCommand, toast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
      if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [cameraStream, audioStream]);

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-2rem)]">
        <div className="space-y-4 animate-fade-in pr-4 pt-12 md:pt-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold neon-text">Mic & Camera</h1>
              <p className="text-muted-foreground text-sm">
                Stream your phone camera and mic to your PC
              </p>
            </div>
            <Badge variant="secondary" className="bg-neon-cyan/10 text-neon-cyan">
              <Smartphone className="h-3 w-3 mr-1" />
              Phone → PC
              <ArrowRight className="h-3 w-3 mx-1" />
              <Monitor className="h-3 w-3" />
            </Badge>
          </div>

          <Tabs defaultValue="camera" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="camera" className="text-sm">
                <Camera className="h-4 w-4 mr-2" />
                Camera
              </TabsTrigger>
              <TabsTrigger value="mic" className="text-sm">
                <Mic className="h-4 w-4 mr-2" />
                Microphone
              </TabsTrigger>
            </TabsList>

            {/* Camera Tab */}
            <TabsContent value="camera">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Video className="h-5 w-5 text-primary" />
                    Phone Camera Preview
                  </CardTitle>
                  <CardDescription>
                    Your phone camera streams here. Use for video calls or monitoring.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Video preview */}
                  <div className="relative aspect-video bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
                    {cameraActive ? (
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <VideoOff className="h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">Camera is off</p>
                        <p className="text-xs">Click Start to begin streaming</p>
                      </div>
                    )}

                    {cameraActive && (
                      <Badge className="absolute top-3 left-3 bg-destructive/80">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse mr-2" />
                        LIVE
                      </Badge>
                    )}
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-center gap-4">
                    {!cameraActive ? (
                      <Button onClick={startCamera} className="gradient-primary">
                        <Play className="h-4 w-4 mr-2" />
                        Start Camera
                      </Button>
                    ) : (
                      <>
                        <Button onClick={stopCamera} variant="destructive">
                          <Square className="h-4 w-4 mr-2" />
                          Stop
                        </Button>
                        <Button onClick={switchCamera} variant="secondary">
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Flip Camera
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Camera info */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
                    <div className="flex items-center gap-2">
                      <Label>Camera Mode</Label>
                      <Badge variant="outline">
                        {facingMode === "user" ? "Front" : "Back"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Mirror</span>
                      <Switch
                        checked={facingMode === "user"}
                        onCheckedChange={() => switchCamera()}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Microphone Tab */}
            <TabsContent value="mic">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Volume2 className="h-5 w-5 text-primary" />
                    Phone Microphone → PC Speakers
                  </CardTitle>
                  <CardDescription>
                    Your phone mic audio is relayed to your PC's speakers.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Audio visualizer */}
                  <div className="relative h-32 bg-secondary/30 rounded-xl border border-border/50 overflow-hidden">
                    <div className="absolute inset-0 flex items-center justify-center gap-1">
                      {Array.from({ length: 20 }).map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "w-2 rounded-full transition-all duration-75",
                            micActive ? "bg-primary" : "bg-muted"
                          )}
                          style={{
                            height: micActive
                              ? `${Math.max(8, audioLevel * 100 * Math.sin((i + Date.now() / 100) * 0.5))}px`
                              : "8px",
                          }}
                        />
                      ))}
                    </div>

                    {!micActive && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <MicOff className="h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">Microphone is off</p>
                      </div>
                    )}

                    {micActive && (
                      <Badge className="absolute top-3 left-3 bg-neon-green/80 text-background">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse mr-2" />
                        LIVE
                      </Badge>
                    )}
                  </div>

                  {/* Audio level meter */}
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

                  {/* Controls */}
                  <div className="flex items-center justify-center gap-4">
                    {!micActive ? (
                      <Button onClick={startMic} className="gradient-primary">
                        <Mic className="h-4 w-4 mr-2" />
                        Start Microphone
                      </Button>
                    ) : (
                      <Button onClick={stopMic} variant="destructive">
                        <Square className="h-4 w-4 mr-2" />
                        Stop Microphone
                      </Button>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm text-muted-foreground">
                      <strong>Note:</strong> Audio relay requires the PC agent to be running with audio support. 
                      The audio from your phone's microphone will be played through your PC's speakers.
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
