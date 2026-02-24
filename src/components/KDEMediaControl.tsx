import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Music, SkipBack, SkipForward, Play, Pause, Repeat, Shuffle,
  Volume2, Volume1, VolumeX, RefreshCw, Speaker, Loader2,
  Headphones, Monitor, Bluetooth, Radio, Check,
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
  const [showOutputs, setShowOutputs] = useState(false);
  const [switchingDevice, setSwitchingDevice] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);
  const positionTimerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // === PERSISTENT MEDIA SESSION (Android notification) ===
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    // Create a silent looping audio to keep MediaSession alive
    const audio = document.createElement("audio");
    audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    audio.loop = true;
    audio.volume = 0.001; // near-silent
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.remove();
      audioRef.current = null;
    };
  }, []);

  // Update MediaSession metadata & playback state
  const updateMediaSession = useCallback((info: MediaInfo | null, playing: boolean) => {
    if (!('mediaSession' in navigator)) return;

    // Keep silent audio playing to maintain notification
    if (audioRef.current) {
      if (playing) {
        audioRef.current.play().catch(() => {});
      } else {
        // Don't pause - keep notification alive, just update state
        audioRef.current.play().catch(() => {});
      }
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: info?.title || "No media",
      artist: info?.artist || "",
      album: info?.album || "",
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, []);

  // Register MediaSession action handlers (these control from notification)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const handlers: Record<string, () => void> = {
      play: () => handleMediaControl("play_pause"),
      pause: () => handleMediaControl("play_pause"),
      previoustrack: () => handleMediaControl("previous"),
      nexttrack: () => handleMediaControl("next"),
      stop: () => handleMediaControl("stop"),
    };

    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler);
      } catch {}
    }

    return () => {
      for (const action of Object.keys(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(action as MediaSessionAction, null);
        } catch {}
      }
    };
  }, []);

  // === FETCH MEDIA INFO ===
  const fetchMediaInfo = useCallback(async () => {
    if (!isConnected) return;
    try {
      const result = await sendCommand("get_media_info", {}, { awaitResult: true, timeoutMs: 3000 });
      if (result.success && "result" in result && result.result) {
        const info = result.result as MediaInfo;
        setMediaInfo(info);
        setIsPlaying(info.playing ?? false);
        updateMediaSession(info, info.playing ?? false);
      }
    } catch {}
  }, [isConnected, sendCommand, updateMediaSession]);

  // === FETCH AUDIO OUTPUT DEVICES ===
  const fetchOutputDevices = useCallback(async () => {
    if (!isConnected) return;
    try {
      const result = await sendCommand("get_audio_devices", {}, { awaitResult: true, timeoutMs: 4000 });
      if (result.success && "result" in result && result.result) {
        const data = result.result as { output_devices?: AudioOutputDevice[]; sessions?: AudioSession[] };
        if (data.output_devices) setOutputDevices(data.output_devices);
        if (data.sessions) setSessions(data.sessions);
      }
    } catch {}
  }, [isConnected, sendCommand]);

  // Auto-poll media state every 2 seconds
  useEffect(() => {
    if (!isConnected) return;
    fetchMediaInfo();
    pollingRef.current = window.setInterval(fetchMediaInfo, 2000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [isConnected, fetchMediaInfo]);

  // Position ticker - increment locally every second while playing
  useEffect(() => {
    if (isPlaying && mediaInfo?.duration && mediaInfo.duration > 0) {
      positionTimerRef.current = window.setInterval(() => {
        setMediaInfo(prev => {
          if (!prev || !prev.playing) return prev;
          const newPos = Math.min((prev.position || 0) + 1, prev.duration || 0);
          return { ...prev, position: newPos };
        });
      }, 1000);
    }
    return () => {
      if (positionTimerRef.current) clearInterval(positionTimerRef.current);
    };
  }, [isPlaying, mediaInfo?.duration]);

  // Fetch output devices when section opens
  useEffect(() => {
    if (showOutputs && isConnected) fetchOutputDevices();
  }, [showOutputs, isConnected, fetchOutputDevices]);

  // === INSTANT MEDIA CONTROL (fire-and-forget) ===
  const handleMediaControl = useCallback((action: string) => {
    // Optimistic UI update INSTANTLY
    if (action === "play_pause") {
      setIsPlaying(prev => {
        const next = !prev;
        updateMediaSession(mediaInfo, next);
        return next;
      });
    }

    // Fire-and-forget: don't await, don't block UI
    sendCommand("media_control", { action }).catch(() => {});

    // Light refresh after a moment
    setTimeout(() => fetchMediaInfo(), 400);
  }, [sendCommand, fetchMediaInfo, mediaInfo, updateMediaSession]);

  // === SWITCH AUDIO OUTPUT ===
  const handleSwitchOutput = useCallback(async (deviceId: string) => {
    setSwitchingDevice(deviceId);
    try {
      await sendCommand("set_audio_output", { device_id: deviceId }, { awaitResult: true, timeoutMs: 5000 });
      // Refresh devices to show new active
      setTimeout(fetchOutputDevices, 500);
    } catch {}
    setSwitchingDevice(null);
  }, [sendCommand, fetchOutputDevices]);

  const handleSessionVolume = useCallback((pid: number, level: number) => {
    setSessions(prev => prev.map(s => s.pid === pid ? { ...s, volume: level } : s));
    // Fire-and-forget
    sendCommand("set_session_volume", { pid, level }).catch(() => {});
  }, [sendCommand]);

  const handleSessionMute = useCallback((pid: number, isMuted: boolean) => {
    setSessions(prev => prev.map(s => s.pid === pid ? { ...s, isMuted: !isMuted } : s));
    sendCommand("set_session_mute", { pid, mute: !isMuted }).catch(() => {});
  }, [sendCommand]);

  const getDeviceIcon = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("bluetooth") || lower.includes("buds") || lower.includes("airpods")) return Bluetooth;
    if (lower.includes("headphone") || lower.includes("headset") || lower.includes("earphone")) return Headphones;
    if (lower.includes("hdmi") || lower.includes("display") || lower.includes("monitor")) return Monitor;
    return Speaker;
  };

  const progress = mediaInfo?.duration && mediaInfo.duration > 0
    ? ((mediaInfo.position || 0) / mediaInfo.duration) * 100
    : 0;

  return (
    <div className="space-y-3">
      {/* Now Playing Card */}
      <Card className="border-border/20 bg-card/50 overflow-hidden">
        <CardContent className="p-0">
          <div className="p-4 pb-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Music className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Now Playing</span>
              </div>
              {mediaInfo?.app && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                  {mediaInfo.app.split('.').pop()?.replace(/\.exe$/i, '') || "Media"}
                </Badge>
              )}
            </div>

            {mediaInfo?.title ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={isPlaying ? "default" : "secondary"} className={cn("text-[9px] px-1.5 py-0", isPlaying && "bg-emerald-500/20 text-emerald-400 border-emerald-500/30")}>
                    {isPlaying ? "▶ Playing" : "⏸ Paused"}
                  </Badge>
                </div>
                <p className="font-semibold text-sm truncate">{mediaInfo.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {mediaInfo.artist}{mediaInfo.album && ` • ${mediaInfo.album}`}
                </p>
              </div>
            ) : (
              <div className="text-center py-4">
                <Music className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No media detected</p>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {mediaInfo?.duration && mediaInfo.duration > 0 && (
            <div className="px-4 pb-2 space-y-1">
              <div className="w-full h-1 rounded-full bg-secondary/50 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-1000 ease-linear" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                <span>{formatDuration(mediaInfo.position || 0)}</span>
                <span>{formatDuration(mediaInfo.duration)}</span>
              </div>
            </div>
          )}

          {/* Playback controls */}
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

      {/* Master Volume */}
      <Card className="border-border/20 bg-card/50">
        <CardContent className="p-3 space-y-3">
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
        </CardContent>
      </Card>

      {/* Audio Output Devices (KDE Connect style) */}
      <Card className="border-border/20 bg-card/50">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">Audio Output</span>
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{outputDevices.length}</Badge>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowOutputs(!showOutputs); }}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {showOutputs ? (
            <div className="space-y-1.5">
              {outputDevices.length === 0 ? (
                <div className="text-center py-3">
                  <Button variant="outline" size="sm" className="text-xs" onClick={fetchOutputDevices}>
                    <RefreshCw className="h-3 w-3 mr-1.5" />Scan Devices
                  </Button>
                </div>
              ) : (
                outputDevices.map(device => {
                  const DevIcon = getDeviceIcon(device.name);
                  const isActive = device.is_active || false;
                  const isSwitching = switchingDevice === device.id;
                  return (
                    <button
                      key={device.id}
                      onClick={() => !isActive && handleSwitchOutput(device.id)}
                      disabled={isActive || isSwitching}
                      className={cn(
                        "w-full flex items-center gap-2.5 p-2.5 rounded-lg transition-all text-left",
                        isActive
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-secondary/30 active:bg-secondary/50 border border-transparent"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                        isActive ? "bg-primary/20" : "bg-secondary/50"
                      )}>
                        <DevIcon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-xs font-medium truncate", isActive && "text-primary")}>{device.name}</p>
                        <p className="text-[10px] text-muted-foreground">{device.status}</p>
                      </div>
                      {isSwitching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      ) : isActive ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => { setShowOutputs(true); fetchOutputDevices(); }}>
              <Radio className="h-3 w-3 mr-1.5" />Show Audio Devices
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Per-App Volume Mixer */}
      <Card className="border-border/20 bg-card/50">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Speaker className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">Volume Mixer</span>
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{sessions.length}</Badge>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowMixer(!showMixer); if (!showMixer) fetchOutputDevices(); }}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {showMixer || sessions.length > 0 ? (
            <div className="space-y-2.5">
              {sessions.length === 0 ? (
                <div className="text-center py-3">
                  <Button variant="outline" size="sm" className="text-xs" onClick={fetchOutputDevices}>
                    <RefreshCw className="h-3 w-3 mr-1.5" />Load Apps
                  </Button>
                </div>
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
          ) : (
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={fetchOutputDevices}>
              <Speaker className="h-3 w-3 mr-1.5" />Show App Volumes
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
