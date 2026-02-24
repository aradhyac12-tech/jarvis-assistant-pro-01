import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Phone,
  PhoneIncoming,
  PhoneOff,
  Pause,
  Play,
  Volume2,
  VolumeX,
  Clock,
  Mic,
  MicOff,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useToast } from "@/hooks/use-toast";
import { useAppNotifications } from "@/hooks/useAppNotifications";
import { getFunctionsWsBase } from "@/lib/relay";
import { Capacitor } from "@capacitor/core";

interface CallState {
  active: boolean;
  number: string;
  name: string;
  duration: number;
  type: "incoming" | "outgoing" | "manual" | string;
}

/**
 * Call controls with real Capacitor call detection + bidirectional audio relay.
 * On native: detects incoming/outgoing calls via TelephonyManager plugin.
 * On web: manual call button starts bidirectional audio with PC.
 */
export function CallControls({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const { toast } = useToast();
  const { notifyCallIncoming } = useAppNotifications();

  const [autoMuteMedia, setAutoMuteMedia] = useState(() => localStorage.getItem("call_auto_mute") !== "false");
  const [autoPauseMedia, setAutoPauseMedia] = useState(() => localStorage.getItem("call_auto_pause") !== "false");
  const [callState, setCallState] = useState<CallState>({
    active: false, number: "", name: "", duration: 0, type: "manual",
  });
  const [connecting, setConnecting] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  // Audio refs for bidirectional call
  const audioWsRef = useRef<WebSocket | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackTimeRef = useRef(0);

  const isNative = Capacitor.isNativePlatform();

  // Persist settings
  useEffect(() => { localStorage.setItem("call_auto_mute", String(autoMuteMedia)); }, [autoMuteMedia]);
  useEffect(() => { localStorage.setItem("call_auto_pause", String(autoPauseMedia)); }, [autoPauseMedia]);

  // Duration timer
  useEffect(() => {
    if (!callState.active) return;
    const timer = setInterval(() => {
      setCallState(prev => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
    return () => clearInterval(timer);
  }, [callState.active]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Auto-mute/pause PC on call start
  const handleCallStart = useCallback(async (info: { number?: string; name?: string; type?: string } = {}) => {
    setCallState({
      active: true,
      number: info.number || "",
      name: info.name || "",
      duration: 0,
      type: info.type || "manual",
    });

    if (autoMuteMedia) {
      try { await sendCommand("mute_pc", {}); } catch {}
    }
    if (autoPauseMedia) {
      try { await sendCommand("media_control", { action: "pause" }); } catch {}
    }
    
    if (info.type === "incoming") {
      notifyCallIncoming();
    }
  }, [autoMuteMedia, autoPauseMedia, sendCommand, notifyCallIncoming]);

  // Restore PC state on call end
  const handleCallEnd = useCallback(async () => {
    setCallState({ active: false, number: "", name: "", duration: 0, type: "manual" });

    if (autoMuteMedia) {
      try { await sendCommand("unmute_pc", {}); } catch {}
    }
    if (autoPauseMedia) {
      try { await sendCommand("media_control", { action: "play" }); } catch {}
    }
  }, [autoMuteMedia, autoPauseMedia, sendCommand]);

  // Native call detection via Capacitor plugin
  useEffect(() => {
    if (!isNative) return;
    
    let cleanup: (() => void) | null = null;
    
    (async () => {
      try {
        const { CallDetector } = await import("capacitor-plugin-incoming-call");
        
        const listener = await (CallDetector as any).addListener("incomingCall", (data: any) => {
          const state = data?.callState || data?.state;
          if (state === "RINGING" || state === "ringing") {
            handleCallStart({ number: data?.number, type: "incoming" });
          } else if (state === "OFFHOOK" || state === "offhook") {
            if (!callState.active) {
              handleCallStart({ number: data?.number, type: "outgoing" });
            }
          } else if (state === "IDLE" || state === "idle") {
            if (callState.active) {
              handleCallEnd();
            }
          }
        });
        
        cleanup = () => { listener.remove(); };
      } catch (err) {
        console.debug("Call detection plugin not available:", err);
      }
    })();
    
    return () => { if (cleanup) cleanup(); };
  }, [isNative, handleCallStart, handleCallEnd, callState.active]);

  // Start bidirectional audio call with PC
  const startCall = useCallback(async () => {
    if (!session?.session_token) {
      toast({ title: "Not Paired", description: "Connect to your PC first", variant: "destructive" });
      return;
    }

    setConnecting(true);

    try {
      const callSessionId = crypto.randomUUID();
      const WS_BASE = getFunctionsWsBase();
      const wsUrl = `${WS_BASE}/functions/v1/audio-relay?sessionId=${callSessionId}&type=phone&direction=bidirectional&session_token=${session.session_token}`;

      // Get mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      audioStreamRef.current = stream;

      // Connect WS
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { ws.close(); reject(new Error("Connection timeout")); }, 10000);
        ws.onopen = () => { clearTimeout(t); resolve(); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("Connection failed")); };
      });

      audioWsRef.current = ws;

      // Keepalive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
        } else { clearInterval(pingInterval); }
      }, 30000);

      // Audio processing with proper resampling
      const ac = new AudioContext();
      audioCtxRef.current = ac;
      if (ac.state === "suspended") await ac.resume();

      const nativeRate = ac.sampleRate;
      const TARGET_RATE = 16000;

      const source = ac.createMediaStreamSource(stream);
      const processor = ac.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(ac.destination);

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN || micMuted) return;
        const samples = e.inputBuffer.getChannelData(0);

        // Resample from native to 16kHz
        const ratio = TARGET_RATE / nativeRate;
        const outLen = Math.round(samples.length * ratio);
        const resampled = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
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

      // Receive & play PC audio
      let playbackTime = 0;
      ws.onmessage = async (event) => {
        if (typeof event.data === "string") return;
        if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
          try {
            if (ac.state === "suspended") await ac.resume();
            const pcm16 = new Int16Array(event.data);
            const float32 = new Float32Array(pcm16.length);
            for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

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

      ws.onclose = () => {
        clearInterval(pingInterval);
        audioWsRef.current = null;
        handleCallEnd();
      };

      // Tell agent to join with system audio
      sendCommand("start_audio_relay", {
        session_id: callSessionId,
        direction: "bidirectional",
        use_system_audio: true,
      }, { awaitResult: false });

      handleCallStart({ type: "manual" });
      toast({ title: "📞 Call Connected", description: "Bidirectional audio with PC" });
    } catch (err) {
      toast({
        title: "Call Failed",
        description: err instanceof Error ? err.message : "Could not connect",
        variant: "destructive",
      });
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(t => t.stop());
        audioStreamRef.current = null;
      }
    } finally {
      setConnecting(false);
    }
  }, [session, sendCommand, toast, handleCallStart, handleCallEnd, micMuted]);

  // End call
  const endCall = useCallback(() => {
    if (audioWsRef.current) { try { audioWsRef.current.close(); } catch {} audioWsRef.current = null; }
    if (audioStreamRef.current) { audioStreamRef.current.getTracks().forEach(t => t.stop()); audioStreamRef.current = null; }
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      try { audioCtxRef.current.close(); } catch {}
    }
    audioCtxRef.current = null;
    sendCommand("stop_audio_relay", {});
    handleCallEnd();
    toast({ title: "Call Ended" });
  }, [sendCommand, handleCallEnd, toast]);

  // Toggle mic mute
  const toggleMic = useCallback(() => {
    if (audioStreamRef.current) {
      const track = audioStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = micMuted; // toggle
        setMicMuted(!micMuted);
      }
    }
  }, [micMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioWsRef.current) try { audioWsRef.current.close(); } catch {}
      if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
      if (processorRef.current) processorRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") try { audioCtxRef.current.close(); } catch {}
    };
  }, []);

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Phone className="h-5 w-5 text-primary" />
          Call
          {callState.active && (
            <Badge className="bg-primary/20 text-primary text-[10px] animate-pulse">Live</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {isNative
            ? "Auto-detects phone calls and mutes PC. Tap call button for bidirectional audio."
            : "Bidirectional audio call with your PC"
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Auto settings */}
        <div className="space-y-2">
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/20 border border-border/30">
            <div className="flex items-center gap-2">
              <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
              <Label htmlFor="auto-mute" className="text-xs">Auto-mute PC on call</Label>
            </div>
            <Switch id="auto-mute" checked={autoMuteMedia} onCheckedChange={setAutoMuteMedia} />
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/20 border border-border/30">
            <div className="flex items-center gap-2">
              <Pause className="h-3.5 w-3.5 text-muted-foreground" />
              <Label htmlFor="auto-pause" className="text-xs">Auto-pause media on call</Label>
            </div>
            <Switch id="auto-pause" checked={autoPauseMedia} onCheckedChange={setAutoPauseMedia} />
          </div>
        </div>

        {/* Call UI */}
        {callState.active ? (
          <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-primary text-primary-foreground animate-pulse">
                  <Phone className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {callState.name || callState.number || "Call in progress"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {callState.type === "incoming" ? "Incoming" : callState.type === "outgoing" ? "Outgoing" : "PC Call"}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {formatDuration(callState.duration)}
              </Badge>
            </div>

            {/* In-call controls */}
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                className={cn("h-10 gap-1", micMuted && "bg-destructive/10 border-destructive/30 text-destructive")}
                onClick={toggleMic}
              >
                {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                <span className="text-[10px]">{micMuted ? "Unmute" : "Mute"}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-10 gap-1"
                onClick={() => sendCommand("toggle_mute", {})}
              >
                <Volume2 className="h-4 w-4" />
                <span className="text-[10px]">PC Vol</span>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-10 gap-1"
                onClick={endCall}
              >
                <PhoneOff className="h-4 w-4" />
                <span className="text-[10px]">End</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Phone className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No active calls</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {isNative
                ? "Calls are detected automatically. Use the button below for manual PC audio call."
                : "Start a bidirectional audio call with your PC"
              }
            </p>

            <Button
              onClick={startCall}
              disabled={connecting}
              className="mt-4 gap-2"
            >
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PhoneIncoming className="h-4 w-4" />
              )}
              {connecting ? "Connecting..." : "Start Call"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
