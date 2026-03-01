import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Camera, Video, Play, Square, RefreshCw, Settings, Gauge,
  Smartphone, Monitor, ArrowRight, Wifi, WifiOff, CheckCircle2,
  XCircle, AlertTriangle, Loader2, Maximize2, FlipHorizontal,
  Zap, Eye,
} from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { cn } from "@/lib/utils";
import { getFunctionsWsBase } from "@/lib/relay";

// Settings persistence
function loadSetting<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveSetting(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }

type DiagCheck = { id: string; label: string; status: "pass" | "fail" | "warn" | "checking"; detail?: string };

export default function Webcam() {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { session } = useDeviceSession();
  
  // Camera state
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [mirrored, setMirrored] = useState(() => loadSetting("webcam_mirrored", false));

  useEffect(() => saveSetting("webcam_mirrored", mirrored), [mirrored]);
  
  // Quality settings
  const [fps, setFps] = useState(() => loadSetting("webcam_fps", 30));
  const [quality, setQuality] = useState(() => loadSetting("webcam_quality", 70));
  const [resolution, setResolution] = useState(() => loadSetting("webcam_resolution", "720p"));
  
  // Stream stats
  const [liveFps, setLiveFps] = useState(0);
  const [sentFrames, setSentFrames] = useState(0);
  const [pcConnected, setPcConnected] = useState(false);
  
  // Diagnostics
  const [diagChecks, setDiagChecks] = useState<DiagCheck[]>([]);
  const [showDiag, setShowDiag] = useState(false);
  const [diagRunning, setDiagRunning] = useState(false);
  
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sendIntervalRef = useRef<number | null>(null);
  const fpsCounterRef = useRef({ frames: 0, lastCheck: Date.now() });

  const WS_BASE = getFunctionsWsBase();
  const isConnected = selectedDevice?.is_online || false;

  // Persist settings
  useEffect(() => { saveSetting("webcam_fps", fps); }, [fps]);
  useEffect(() => { saveSetting("webcam_quality", quality); }, [quality]);
  useEffect(() => { saveSetting("webcam_resolution", resolution); }, [resolution]);

  // Get available cameras
  const refreshCameras = useCallback(async () => {
    try {
      // Request permission first
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(t => t.stop());
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === "videoinput");
      setCameras(videoDevices);
      if (videoDevices.length > 0 && !selectedCamera) {
        setSelectedCamera(videoDevices[0].deviceId);
      }
    } catch (err) {
      toast({ title: "Camera Access Denied", description: "Please allow camera access in your browser/app settings.", variant: "destructive" });
    }
  }, [selectedCamera, toast]);

  useEffect(() => { refreshCameras(); }, []);

  const getResolutionConstraints = useCallback(() => {
    switch (resolution) {
      case "480p": return { width: { ideal: 640 }, height: { ideal: 480 } };
      case "720p": return { width: { ideal: 1280 }, height: { ideal: 720 } };
      case "1080p": return { width: { ideal: 1920 }, height: { ideal: 1080 } };
      default: return { width: { ideal: 1280 }, height: { ideal: 720 } };
    }
  }, [resolution]);

  // Start webcam streaming
  const startStreaming = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          ...getResolutionConstraints(),
          frameRate: { ideal: fps, max: 60 },
          ...(selectedCamera ? { deviceId: { exact: selectedCamera } } : { facingMode }),
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Connect WebSocket to relay
      const sessionId = crypto.randomUUID();
      const ws = new WebSocket(
        `${WS_BASE}/functions/v1/camera-relay?sessionId=${sessionId}&type=phone&fps=${fps}&quality=${quality}&binary=true&session_token=${session?.session_token || ""}`
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setIsStreaming(true);
        setPcConnected(false);
        toast({ title: "Webcam Streaming", description: "Waiting for PC to connect..." });

        // Tell PC agent to receive phone camera as virtual webcam
        sendCommand("start_phone_webcam", {
          session_id: sessionId,
          fps,
          quality,
          resolution,
        }, { awaitResult: false });

        // Start sending frames
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const sendFrame = () => {
          if (ws.readyState !== WebSocket.OPEN || !video.videoWidth) return;
          
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          
          if (mirrored) {
            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
            ctx.restore();
          } else {
            ctx.drawImage(video, 0, 0);
          }

          canvas.toBlob(
            (blob) => {
              if (blob && ws.readyState === WebSocket.OPEN) {
                blob.arrayBuffer().then(ab => {
                  try { ws.send(ab); } catch {}
                });
                
                fpsCounterRef.current.frames++;
                const now = Date.now();
                const elapsed = now - fpsCounterRef.current.lastCheck;
                if (elapsed >= 1000) {
                  setLiveFps(Math.round((fpsCounterRef.current.frames * 1000) / elapsed));
                  fpsCounterRef.current = { frames: 0, lastCheck: now };
                }
                setSentFrames(prev => prev + 1);
              }
            },
            "image/jpeg",
            quality / 100
          );
        };

        sendIntervalRef.current = window.setInterval(sendFrame, 1000 / fps);
      };

      ws.onmessage = (e) => {
        try {
          if (typeof e.data === "string") {
            const msg = JSON.parse(e.data);
            if (msg.type === "peer_connected") { setPcConnected(true); toast({ title: "PC Connected", description: "Your phone camera is now a virtual webcam!" }); }
            if (msg.type === "peer_disconnected") { setPcConnected(false); }
          }
        } catch {}
      };

      ws.onerror = () => toast({ title: "Connection Error", variant: "destructive" });
      ws.onclose = () => { setIsStreaming(false); setPcConnected(false); };

    } catch (err) {
      toast({ title: "Camera Error", description: err instanceof Error ? err.message : "Failed to access camera", variant: "destructive" });
    }
  }, [fps, quality, resolution, selectedCamera, facingMode, mirrored, session, WS_BASE, sendCommand, toast, getResolutionConstraints]);

  const stopStreaming = useCallback(() => {
    if (sendIntervalRef.current) { clearInterval(sendIntervalRef.current); sendIntervalRef.current = null; }
    wsRef.current?.close(); wsRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    sendCommand("stop_phone_webcam", {});
    setIsStreaming(false); setPcConnected(false); setLiveFps(0); setSentFrames(0);
    toast({ title: "Webcam Stopped" });
  }, [sendCommand, toast]);

  // Switch camera
  const switchCamera = useCallback(() => {
    const newFacing = facingMode === "user" ? "environment" : "user";
    setFacingMode(newFacing);
    if (isStreaming) {
      stopStreaming();
      setTimeout(() => startStreaming(), 500);
    }
  }, [facingMode, isStreaming, stopStreaming, startStreaming]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (sendIntervalRef.current) clearInterval(sendIntervalRef.current);
      wsRef.current?.close();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Run diagnostics
  const runDiagnostics = useCallback(async () => {
    setDiagRunning(true);
    setShowDiag(true);
    const checks: DiagCheck[] = [];

    // 1. Camera access
    checks.push({ id: "camera", label: "Camera Access", status: "checking" });
    setDiagChecks([...checks]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      stream.getTracks().forEach(t => t.stop());
      checks[checks.length - 1] = { id: "camera", label: "Camera Access", status: "pass", detail: `${settings.width}x${settings.height} @ ${settings.frameRate}fps` };
    } catch {
      checks[checks.length - 1] = { id: "camera", label: "Camera Access", status: "fail", detail: "Permission denied or no camera found" };
    }
    setDiagChecks([...checks]);

    // 2. Device online
    checks.push({ id: "device", label: "PC Agent Online", status: selectedDevice?.is_online ? "pass" : "fail", detail: selectedDevice?.is_online ? `Device: ${selectedDevice.name}` : "No PC agent detected" });
    setDiagChecks([...checks]);

    // 3. WebSocket relay
    checks.push({ id: "relay", label: "WebSocket Relay", status: "checking" });
    setDiagChecks([...checks]);
    try {
      const testWs = new WebSocket(`${WS_BASE}/functions/v1/camera-relay?sessionId=diag-test&type=phone&fps=1&quality=10&session_token=${session?.session_token || ""}`);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { testWs.close(); reject(new Error("timeout")); }, 5000);
        testWs.onopen = () => { clearTimeout(t); testWs.close(); resolve(); };
        testWs.onerror = () => { clearTimeout(t); reject(new Error("error")); };
      });
      checks[checks.length - 1] = { id: "relay", label: "WebSocket Relay", status: "pass", detail: "Connected successfully" };
    } catch {
      checks[checks.length - 1] = { id: "relay", label: "WebSocket Relay", status: "fail", detail: "Cannot reach relay server" };
    }
    setDiagChecks([...checks]);

    // 4. Agent virtual webcam support
    checks.push({ id: "vwc", label: "Virtual Webcam Driver", status: "checking" });
    setDiagChecks([...checks]);
    try {
      const result = await sendCommand("check_virtual_webcam", {}, { awaitResult: true, timeoutMs: 8000 });
      if (result?.success && "result" in result && (result.result as any)?.available) {
        checks[checks.length - 1] = { id: "vwc", label: "Virtual Webcam Driver", status: "pass", detail: (result.result as any)?.driver || "OBS Virtual Camera" };
      } else {
        checks[checks.length - 1] = { id: "vwc", label: "Virtual Webcam Driver", status: "warn", detail: "Install OBS Virtual Camera or pyvirtualcam for best results" };
      }
    } catch {
      checks[checks.length - 1] = { id: "vwc", label: "Virtual Webcam Driver", status: "warn", detail: "Could not check - agent may not support this command yet" };
    }
    setDiagChecks([...checks]);

    // 5. Network quality
    checks.push({ id: "network", label: "Network Quality", status: navigator.onLine ? "pass" : "fail", detail: navigator.onLine ? "Online" : "Offline" });
    setDiagChecks([...checks]);

    setDiagRunning(false);
  }, [selectedDevice, session, WS_BASE, sendCommand]);

  const StatusIcon = ({ status }: { status: DiagCheck["status"] }) => {
    switch (status) {
      case "pass": return <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />;
      case "fail": return <XCircle className="h-4 w-4 text-destructive" />;
      case "warn": return <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />;
      case "checking": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center justify-between h-14 px-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <BackButton />
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <Camera className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-semibold text-sm">Phone as Webcam</h1>
              <p className="text-xs text-muted-foreground">Use your phone camera for PC meetings</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <Badge variant="outline" className={cn("gap-1.5 text-xs", pcConnected ? "border-[hsl(var(--success))]/50 text-[hsl(var(--success))]" : "border-[hsl(var(--warning))]/50 text-[hsl(var(--warning))]")}>
                <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", pcConnected ? "bg-[hsl(var(--success))]" : "bg-[hsl(var(--warning))]")} />
                {pcConnected ? "PC Connected" : "Waiting..."}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <ScrollArea className="h-[calc(100vh-3.5rem)]">
        <main className="max-w-4xl mx-auto p-4 space-y-4">
          {/* Camera Preview */}
          <Card className="border-border/40 overflow-hidden">
            <div className="relative aspect-video bg-black">
              <video
                ref={videoRef}
                className={cn("w-full h-full object-cover", mirrored && "scale-x-[-1]")}
                autoPlay
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />
              
              {!isStreaming && !streamRef.current && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  <Camera className="h-16 w-16 mb-3 opacity-30" />
                  <p className="text-sm">Camera preview will appear here</p>
                  <p className="text-xs mt-1">Tap Start to begin streaming</p>
                </div>
              )}

              {/* Live stats overlay */}
              {isStreaming && (
                <div className="absolute top-3 left-3 flex gap-1.5">
                  <Badge variant="outline" className="bg-black/60 backdrop-blur-sm border-transparent text-white text-[10px] px-1.5 py-0 font-mono">
                    {liveFps} FPS
                  </Badge>
                  <Badge variant="outline" className="bg-black/60 backdrop-blur-sm border-transparent text-white text-[10px] px-1.5 py-0 font-mono">
                    {sentFrames} sent
                  </Badge>
                  <Badge variant="outline" className={cn("bg-black/60 backdrop-blur-sm border-transparent text-[10px] px-1.5 py-0", pcConnected ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]")}>
                    {pcConnected ? "● LIVE" : "● WAITING"}
                  </Badge>
                </div>
              )}

              {/* Camera controls overlay */}
              {isStreaming && (
                <div className="absolute bottom-3 right-3 flex gap-2">
                  <Button variant="ghost" size="icon" className="h-9 w-9 bg-black/50 text-white hover:bg-black/70" onClick={switchCamera}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className={cn("h-9 w-9 bg-black/50 text-white hover:bg-black/70", mirrored && "bg-primary/50")} onClick={() => setMirrored(!mirrored)}>
                    <FlipHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* How it works */}
          <Card className="border-border/40">
            <CardContent className="p-3">
              <div className="flex items-center gap-4 justify-center text-sm">
                <div className="flex flex-col items-center text-center">
                  <Smartphone className="h-6 w-6 text-primary mb-1" />
                  <span className="text-[10px] text-muted-foreground">Phone Camera</span>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col items-center text-center">
                  <Wifi className="h-6 w-6 text-primary mb-1" />
                  <span className="text-[10px] text-muted-foreground">Relay</span>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col items-center text-center">
                  <Monitor className="h-6 w-6 text-primary mb-1" />
                  <span className="text-[10px] text-muted-foreground">Virtual Webcam</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Controls */}
          <div className="flex items-center justify-center gap-3">
            {!isStreaming ? (
              <Button onClick={startStreaming} className="px-8" disabled={!isConnected}>
                <Play className="h-4 w-4 mr-2" />Start Webcam
              </Button>
            ) : (
              <Button onClick={stopStreaming} variant="destructive" className="px-8">
                <Square className="h-4 w-4 mr-2" />Stop Webcam
              </Button>
            )}
          </div>

          {/* Camera & Quality Settings */}
          <Card className="border-border/40">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Settings className="h-4 w-4" />Settings</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-4">
              {/* Camera select */}
              <div className="flex items-center justify-between">
                <Label className="text-sm">Camera</Label>
                <Select value={selectedCamera} onValueChange={setSelectedCamera} disabled={isStreaming}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select camera" /></SelectTrigger>
                  <SelectContent>
                    {cameras.map(c => <SelectItem key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${cameras.indexOf(c) + 1}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Resolution */}
              <div className="flex items-center justify-between">
                <Label className="text-sm">Resolution</Label>
                <Select value={resolution} onValueChange={setResolution} disabled={isStreaming}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="480p">480p (SD)</SelectItem>
                    <SelectItem value="720p">720p (HD)</SelectItem>
                    <SelectItem value="1080p">1080p (Full HD)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* FPS */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm flex items-center gap-2"><Gauge className="h-4 w-4" />Target FPS</Label>
                  <span className="font-mono text-sm font-bold text-primary">{fps}</span>
                </div>
                <Slider value={[fps]} onValueChange={([v]) => setFps(v)} min={5} max={60} step={5} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>5</span><span>30</span><span>60</span>
                </div>
              </div>

              {/* Quality */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm flex items-center gap-2"><Video className="h-4 w-4" />JPEG Quality</Label>
                  <span className="font-mono text-sm font-bold text-primary">{quality}%</span>
                </div>
                <Slider value={[quality]} onValueChange={([v]) => setQuality(v)} min={10} max={100} step={5} />
              </div>

              {/* Quick presets */}
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "🔋 Battery Saver", fps: 15, q: 40, res: "480p" },
                  { label: "⚖️ Balanced", fps: 30, q: 70, res: "720p" },
                  { label: "🎥 HD Meeting", fps: 30, q: 85, res: "1080p" },
                ].map(p => (
                  <Button key={p.label} variant="outline" size="sm" className="text-xs" onClick={() => { setFps(p.fps); setQuality(p.q); setResolution(p.res); }}>
                    {p.label}
                  </Button>
                ))}
              </div>

              {/* Mirror toggle */}
              <div className="flex items-center justify-between">
                <Label className="text-sm flex items-center gap-2"><FlipHorizontal className="h-4 w-4" />Mirror Preview</Label>
                <Switch checked={mirrored} onCheckedChange={setMirrored} />
              </div>
            </CardContent>
          </Card>

          {/* Diagnostics */}
          <Card className="border-border/40">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4" />Diagnostics</CardTitle>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={runDiagnostics} disabled={diagRunning}>
                  {diagRunning ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
                  {diagRunning ? "Running..." : "Run Check"}
                </Button>
              </div>
            </CardHeader>
            {showDiag && (
              <CardContent className="px-4 pb-4 space-y-2">
                {diagChecks.map(check => (
                  <div key={check.id} className={cn(
                    "flex items-center gap-3 p-2.5 rounded-lg border border-border/30",
                    check.status === "fail" && "bg-destructive/5",
                    check.status === "warn" && "bg-[hsl(var(--warning))]/5",
                    check.status === "pass" && "bg-[hsl(var(--success))]/5",
                  )}>
                    <StatusIcon status={check.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{check.label}</p>
                      {check.detail && <p className="text-[10px] text-muted-foreground truncate">{check.detail}</p>}
                    </div>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>

          {/* Instructions */}
          <Card className="border-border/40">
            <CardContent className="p-4">
              <h3 className="font-medium text-sm mb-2">How to use as webcam in meetings:</h3>
              <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
                <li>Install <strong>OBS Virtual Camera</strong> or <strong>pyvirtualcam</strong> on your PC</li>
                <li>Start streaming on this page</li>
                <li>The PC agent will pipe the video feed to the virtual webcam</li>
                <li>In Zoom/Teams/Meet, select <strong>"OBS Virtual Camera"</strong> as your camera</li>
                <li>Your phone camera is now your meeting webcam!</li>
              </ol>
            </CardContent>
          </Card>
        </main>
      </ScrollArea>
    </div>
  );
}
