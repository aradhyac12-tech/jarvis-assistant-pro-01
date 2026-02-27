import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Music, SkipBack, SkipForward, Play, Pause, Repeat, Shuffle,
  Volume2, Volume1, VolumeX, RefreshCw, Speaker, Loader2,
  Headphones, Monitor, Bluetooth, Radio, Check, Disc3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface MediaInfo {
  title?: string;
  artist?: string;
  album?: string;
  playing?: boolean;
  position?: number;
  duration?: number;
  app?: string;
  thumbnail?: string; // base64 album art
}

interface AudioSession {
  id: string;
  name: string;
  pid: number;
  volume: number;
  isMuted: boolean;
}

interface AudioOutputDevice {
  id: string;
  name: string;
  status: string;
  is_active?: boolean;
}

interface Props {
  isConnected: boolean;
  volume: number;
  isMuted: boolean;
  onVolumeChange: (v: number[]) => void;
  onVolumeCommit: (v: number[]) => void;
  onMuteToggle: () => void;
}

export function KDEMediaControl({ isConnected, volume, isMuted, onVolumeChange, onVolumeCommit, onMuteToggle }: Props) {
  const { sendCommand } = useDeviceCommands();

  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sessions, setSessions] = useState<AudioSession[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [showMixer, setShowMixer] = useState(false);
  const [showOutputs, setShowOutputs] = useState(true);
  const [switchingDevice, setSwitchingDevice] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const pollingRef = useRef<number | null>(null);
  const positionTimerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastFetchRef = useRef(0);

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // === PERSISTENT MEDIA SESSION (Android notification) ===
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const audio = document.createElement("audio");
    audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    audio.loop = true;
    audio.volume = 0.001;
    audioRef.current = audio;
    return () => { audio.pause(); audio.remove(); audioRef.current = null; };
  }, []);

  const updateMediaSession = useCallback((info: MediaInfo | null, playing: boolean) => {
    if (!('mediaSession' in navigator)) return;
    if (audioRef.current) audioRef.current.play().catch(() => {});
    
    const artwork: MediaImage[] = [];
    if (info?.thumbnail) {
      artwork.push({ src: `data:image/jpeg;base64,${info.thumbnail}`, sizes: "512x512", type: "image/jpeg" });
    }
    
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info?.title || "No media",
      artist: info?.artist || "",
      album: info?.album || "",
      artwork,
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const handlers: Record<string, () => void> = {
      play: () => handleMediaControl("play_pause"),
      pause: () => handleMediaControl("play_pause"),
      previoustrack: () => handleMediaControl("previous"),
      nexttrack: () => handleMediaControl("next"),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler); } catch {}
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, null); } catch {}
      }
    };
  }, []);

  // === FAST FETCH ===
  const fetchAll = useCallback(async (silent = false) => {
    if (!isConnected) return;
    const now = Date.now();
    if (now - lastFetchRef.current < 800) return;
    lastFetchRef.current = now;
    
    if (!silent) setMediaLoading(true);
    
    const [mediaResult, devicesResult] = await Promise.allSettled([
      sendCommand("get_media_info", { include_thumbnail: true }, { awaitResult: true, timeoutMs: 3000 }),
      sendCommand("get_audio_devices", {}, { awaitResult: true, timeoutMs: 3000 }),
    ]);

    if (mediaResult.status === "fulfilled" && mediaResult.value?.success && "result" in mediaResult.value) {
      const info = mediaResult.value.result as MediaInfo;
      setMediaInfo(info);
      setIsPlaying(info.playing ?? false);
      updateMediaSession(info, info.playing ?? false);
    }

    if (devicesResult.status === "fulfilled" && devicesResult.value?.success && "result" in devicesResult.value) {
      const data = devicesResult.value.result as { output_devices?: AudioOutputDevice[]; sessions?: AudioSession[] };
      if (data.output_devices) setOutputDevices(data.output_devices);
      if (data.sessions) setSessions(data.sessions);
    }
    
    if (!silent) setMediaLoading(false);
  }, [isConnected, sendCommand, updateMediaSession]);

  useEffect(() => {
    if (!isConnected) return;
    fetchAll();
    pollingRef.current = window.setInterval(() => fetchAll(true), 1500);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [isConnected, fetchAll]);

  // Position ticker
  useEffect(() => {
    if (isPlaying && mediaInfo?.duration && mediaInfo.duration > 0) {
      positionTimerRef.current = window.setInterval(() => {
        setMediaInfo(prev => {
          if (!prev || !prev.playing) return prev;
          return { ...prev, position: Math.min((prev.position || 0) + 1, prev.duration || 0) };
        });
      }, 1000);
    }
    return () => { if (positionTimerRef.current) clearInterval(positionTimerRef.current); };
  }, [isPlaying, mediaInfo?.duration]);

  const handleMediaControl = useCallback((action: string) => {
    if (action === "play_pause") {
      setIsPlaying(prev => {
        const next = !prev;
        updateMediaSession(mediaInfo, next);
        return next;
      });
    }
    sendCommand("media_control", { action }).catch(() => {});
    setTimeout(() => fetchAll(true), 300);
  }, [sendCommand, fetchAll, mediaInfo, updateMediaSession]);

  // === SEEK ===
  const handleSeekStart = useCallback(() => {
    setIsSeeking(true);
    setSeekValue(mediaInfo?.position || 0);
  }, [mediaInfo?.position]);

  const handleSeekChange = useCallback((v: number[]) => {
    setSeekValue(v[0]);
  }, []);

  const handleSeekCommit = useCallback((v: number[]) => {
    setIsSeeking(false);
    const pos = v[0];
    setMediaInfo(prev => prev ? { ...prev, position: pos } : prev);
    sendCommand("media_control", { action: "seek", position: pos }).catch(() => {});
    setTimeout(() => fetchAll(true), 500);
  }, [sendCommand, fetchAll]);

  const handleSwitchOutput = useCallback(async (deviceId: string) => {
    setSwitchingDevice(deviceId);
    try {
      await sendCommand("set_audio_output", { device_id: deviceId }, { awaitResult: true, timeoutMs: 5000 });
      setTimeout(() => fetchAll(true), 500);
    } catch {}
    setSwitchingDevice(null);
  }, [sendCommand, fetchAll]);

  const handleSessionVolume = useCallback((pid: number, level: number) => {
    setSessions(prev => prev.map(s => s.pid === pid ? { ...s, volume: level } : s));
    sendCommand("set_session_volume", { pid, level }).catch(() => {});
  }, [sendCommand]);

  const handleSessionMute = useCallback((pid: number, currentMuted: boolean) => {
    setSessions(prev => prev.map(s => s.pid === pid ? { ...s, isMuted: !currentMuted } : s));
    sendCommand("set_session_mute", { pid, mute: !currentMuted }).catch(() => {});
  }, [sendCommand]);

  const getDeviceIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("bluetooth") || lower.includes("buds") || lower.includes("airpods")) return Bluetooth;
    if (lower.includes("headphone") || lower.includes("headset") || lower.includes("earphone")) return Headphones;
    if (lower.includes("hdmi") || lower.includes("display") || lower.includes("monitor")) return Monitor;
    return Speaker;
  };

  const currentPosition = isSeeking ? seekValue : (mediaInfo?.position || 0);
  const progress = mediaInfo?.duration && mediaInfo.duration > 0
    ? (currentPosition / mediaInfo.duration) * 100 : 0;

  const activeDevice = outputDevices.find(d => d.is_active);

  return (
    <div className="space-y-3">
      {/* Now Playing */}
      <Card className="border-border/20 bg-card/50 overflow-hidden">
        <CardContent className="p-0">
          <div className="p-4 pb-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Music className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Now Playing</span>
              </div>
              <div className="flex items-center gap-1.5">
                {mediaInfo?.app && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                    {mediaInfo.app.split('.').pop()?.replace(/\.exe$/i, '') || "Media"}
                  </Badge>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => fetchAll()} disabled={mediaLoading}>
                  <RefreshCw className={cn("h-3 w-3", mediaLoading && "animate-spin")} />
                </Button>
              </div>
            </div>

            {mediaInfo?.title ? (
              <div className="flex gap-3">
                {/* Album Art */}
                <div className="w-16 h-16 rounded-lg bg-secondary/50 shrink-0 overflow-hidden flex items-center justify-center">
                  {mediaInfo.thumbnail ? (
                    <img
                      src={`data:image/jpeg;base64,${mediaInfo.thumbnail}`}
                      alt="Album art"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Disc3 className={cn("h-8 w-8 text-muted-foreground/30", isPlaying && "animate-spin")} style={{ animationDuration: "3s" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <Badge variant={isPlaying ? "default" : "secondary"} className={cn("text-[9px] px-1.5 py-0", isPlaying && "bg-emerald-500/20 text-emerald-400 border-emerald-500/30")}>
                    {isPlaying ? "▶ Playing" : "⏸ Paused"}
                  </Badge>
                  <p className="font-semibold text-sm truncate">{mediaInfo.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {mediaInfo.artist}{mediaInfo.album && ` • ${mediaInfo.album}`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <Music className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No media detected</p>
              </div>
            )}
          </div>

          {/* Seek Bar */}
          {mediaInfo?.duration && mediaInfo.duration > 0 && (
            <div className="px-4 pb-2 space-y-1">
              <Slider
                value={[currentPosition]}
                onValueChange={handleSeekChange}
                onValueCommit={handleSeekCommit}
                onPointerDown={handleSeekStart}
                max={mediaInfo.duration}
                step={1}
                className="cursor-pointer [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                disabled={!isConnected}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                <span>{formatDuration(currentPosition)}</span>
                <span>{formatDuration(mediaInfo.duration)}</span>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-1 px-4 py-3">
            <Button variant="ghost" size="icon" onClick={() => handleMediaControl("shuffle")} className="h-9 w-9" disabled={!isConnected}>
              <Shuffle className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => handleMediaControl("previous")} className="h-10 w-10" disabled={!isConnected}>
              <SkipBack className="h-5 w-5" />
            </Button>
            <Button onClick={() => handleMediaControl("play_pause")} className="h-14 w-14 rounded-full bg-primary hover:bg-primary/80" disabled={!isConnected}>
              {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 ml-0.5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => handleMediaControl("next")} className="h-10 w-10" disabled={!isConnected}>
              <SkipForward className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => handleMediaControl("repeat")} className="h-9 w-9" disabled={!isConnected}>
              <Repeat className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Master Volume + Active Output */}
      <Card className="border-border/20 bg-card/50">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onMuteToggle} className="h-8 w-8 shrink-0" disabled={!isConnected}>
              <VolumeIcon className="h-4 w-4" />
            </Button>
            <Slider
              value={[isMuted ? 0 : volume]}
              onValueChange={(v) => onVolumeChange(v)}
              onValueCommit={(v) => onVolumeCommit(v)}
              max={100} step={2}
              disabled={!isConnected}
              className="flex-1 cursor-pointer"
            />
            <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{isMuted ? 0 : volume}%</span>
          </div>
          {activeDevice && (
            <div className="flex items-center gap-2 px-1">
              {(() => { const I = getDeviceIcon(activeDevice.name); return <I className="h-3 w-3 text-primary" />; })()}
              <span className="text-[10px] text-muted-foreground truncate">{activeDevice.name}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audio Output Devices */}
      <Card className="border-border/20 bg-card/50">
        <CardContent className="p-3">
          <button onClick={() => setShowOutputs(!showOutputs)} className="flex items-center justify-between w-full mb-2">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">Audio Devices</span>
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{outputDevices.length}</Badge>
            </div>
            <span className="text-muted-foreground text-xs">{showOutputs ? "▼" : "▶"}</span>
          </button>

          {showOutputs && (
            <div className="space-y-1.5">
              {outputDevices.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-2">Loading devices...</p>
              ) : (
                outputDevices.map(device => {
                  const DevIcon = getDeviceIcon(device.name);
                  const isActive = device.is_active || false;
                  const isSwitchingDev = switchingDevice === device.id;
                  return (
                    <button
                      key={device.id}
                      onClick={() => !isActive && handleSwitchOutput(device.id)}
                      disabled={isActive || isSwitchingDev}
                      className={cn(
                        "w-full flex items-center gap-2.5 p-2.5 rounded-lg transition-all text-left",
                        isActive
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-secondary/30 active:bg-secondary/50 border border-transparent"
                      )}
                    >
                      <div className={cn("w-8 h-8 rounded-md flex items-center justify-center shrink-0", isActive ? "bg-primary/20" : "bg-secondary/50")}>
                        <DevIcon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-xs font-medium truncate", isActive && "text-primary")}>{device.name}</p>
                        <p className="text-[10px] text-muted-foreground">{isActive ? "Active" : device.status}</p>
                      </div>
                      {isSwitchingDev ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      ) : isActive ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-App Volume Mixer */}
      <Card className="border-border/20 bg-card/50">
        <CardContent className="p-3">
          <button
            onClick={() => { setShowMixer(!showMixer); if (!showMixer && sessions.length === 0) fetchAll(true); }}
            className="flex items-center justify-between w-full mb-2"
          >
            <div className="flex items-center gap-2">
              <Speaker className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">App Mixer</span>
              {sessions.length > 0 && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{sessions.length}</Badge>}
            </div>
            <span className="text-muted-foreground text-xs">{showMixer ? "▼" : "▶"}</span>
          </button>

          {showMixer && (
            <div className="space-y-2.5">
              {sessions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-2">No audio apps detected</p>
              ) : (
                sessions.map(session => (
                  <div key={session.id} className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                      onClick={() => handleSessionMute(session.pid, session.isMuted)}>
                      {session.isMuted ? <VolumeX className="h-3.5 w-3.5 text-destructive" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </Button>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <p className="text-[11px] font-medium truncate">{session.name.replace(/\.exe$/i, "")}</p>
                      <Slider
                        value={[session.isMuted ? 0 : session.volume]}
                        onValueChange={([v]) => handleSessionVolume(session.pid, v)}
                        max={100} step={5}
                        className="cursor-pointer"
                      />
                    </div>
                    <span className="text-[9px] font-mono text-muted-foreground w-7 text-right">{session.volume}%</span>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
