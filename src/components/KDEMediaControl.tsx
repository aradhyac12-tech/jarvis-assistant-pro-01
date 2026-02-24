import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Music, SkipBack, SkipForward, Play, Pause, Repeat, Shuffle,
  Volume2, Volume1, VolumeX, RefreshCw, Speaker, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();

  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [sessions, setSessions] = useState<AudioSession[]>([]);
  const [showMixer, setShowMixer] = useState(false);
  const pollingRef = useRef<number | null>(null);
  const positionTimerRef = useRef<number | null>(null);

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Fetch media info
  const fetchMediaInfo = useCallback(async () => {
    if (!isConnected) return;
    try {
      const result = await sendCommand("get_media_info", {}, { awaitResult: true, timeoutMs: 4000 });
      if (result.success && "result" in result && result.result) {
        const info = result.result as MediaInfo;
        setMediaInfo(info);
        setIsPlaying(info.playing ?? false);

        // Update Media Session API for Android notification
        if ('mediaSession' in navigator && info.title) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: info.title || "Unknown",
            artist: info.artist || "",
            album: info.album || "",
          });
          navigator.mediaSession.playbackState = info.playing ? "playing" : "paused";
        }
      }
    } catch {
      // Silent fail for polling
    }
  }, [isConnected, sendCommand]);

  // Fetch audio sessions (mixer)
  const fetchSessions = useCallback(async () => {
    if (!isConnected) return;
    try {
      const result = await sendCommand("get_audio_devices", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result.success && "result" in result && result.result) {
        const data = result.result as { sessions?: AudioSession[] };
        setSessions(data.sessions || []);
      }
    } catch {}
  }, [isConnected, sendCommand]);

  // Auto-poll media state every 2 seconds (KDE Connect style - instant updates)
  useEffect(() => {
    if (!isConnected) return;
    fetchMediaInfo();
    pollingRef.current = window.setInterval(fetchMediaInfo, 2000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [isConnected, fetchMediaInfo]);

  // Position ticker - increment position locally every second while playing
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

  // Setup Media Session API handlers for Android notification controls
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    // Create a silent audio element to activate MediaSession on Android
    const audio = document.createElement("audio");
    audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    audio.loop = true;

    const playAudio = async () => {
      try { await audio.play(); } catch {}
    };

    if (isPlaying) playAudio();
    else audio.pause();

    navigator.mediaSession.setActionHandler("play", () => handleMediaControl("play_pause"));
    navigator.mediaSession.setActionHandler("pause", () => handleMediaControl("play_pause"));
    navigator.mediaSession.setActionHandler("previoustrack", () => handleMediaControl("previous"));
    navigator.mediaSession.setActionHandler("nexttrack", () => handleMediaControl("next"));

    return () => {
      audio.pause();
      audio.remove();
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    };
  }, [isPlaying]);

  const handleMediaControl = useCallback(async (action: string) => {
    if (action === "play_pause") setIsPlaying(prev => !prev);
    await sendCommand("media_control", { action });
    // Quick refresh after action
    setTimeout(fetchMediaInfo, 300);
  }, [sendCommand, fetchMediaInfo]);

  const handleSessionVolume = useCallback(async (pid: number, level: number) => {
    setSessions(prev => prev.map(s => s.pid === pid ? { ...s, volume: level } : s));
    await sendCommand("set_session_volume", { pid, level });
  }, [sendCommand]);

  const handleSessionMute = useCallback(async (pid: number, isMuted: boolean) => {
    setSessions(prev => prev.map(s => s.pid === pid ? { ...s, isMuted: !isMuted } : s));
    await sendCommand("set_session_mute", { pid, mute: !isMuted });
  }, [sendCommand]);

  const progress = mediaInfo?.duration && mediaInfo.duration > 0
    ? ((mediaInfo.position || 0) / mediaInfo.duration) * 100
    : 0;

  return (
    <div className="space-y-3">
      {/* Now Playing Card */}
      <Card className="border-border/20 bg-card/50 overflow-hidden">
        <CardContent className="p-0">
          {/* Track info header */}
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

      {/* Per-App Volume Mixer */}
      <Card className="border-border/20 bg-card/50">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Speaker className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">Volume Mixer</span>
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{sessions.length}</Badge>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowMixer(!showMixer); if (!showMixer) fetchSessions(); }}>
              <RefreshCw className={cn("h-3.5 w-3.5", mediaLoading && "animate-spin")} />
            </Button>
          </div>

          {showMixer || sessions.length > 0 ? (
            <div className="space-y-2.5">
              {sessions.length === 0 ? (
                <div className="text-center py-3">
                  <Button variant="outline" size="sm" className="text-xs" onClick={fetchSessions}>
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
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={fetchSessions}>
              <Speaker className="h-3 w-3 mr-1.5" />Show App Volumes
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
