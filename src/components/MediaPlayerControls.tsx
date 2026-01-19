import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Volume1,
  Music,
  RefreshCw,
  Repeat,
  Shuffle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { supabase } from "@/integrations/supabase/client";

interface MediaInfo {
  title?: string;
  artist?: string;
  album?: string;
  playing?: boolean;
  position?: number;
  duration?: number;
}

interface MediaPlayerControlsProps {
  className?: string;
  showVolumeControl?: boolean;
  compact?: boolean;
}

export function MediaPlayerControls({
  className,
  showVolumeControl = true,
  compact = false,
}: MediaPlayerControlsProps) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice, refreshDevices } = useDeviceContext();

  const [volume, setVolume] = useState(50);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isControlling, setIsControlling] = useState(false);
  const volumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load volume from device on connect
  useEffect(() => {
    if (selectedDevice) {
      setVolume(selectedDevice.current_volume ?? 50);
    }
  }, [selectedDevice]);

  // Listen for realtime volume/brightness updates
  useEffect(() => {
    const channel = supabase
      .channel("media-controls-updates")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "devices" },
        (payload) => {
          const device = payload.new as { id: string; current_volume?: number };
          if (device.id === selectedDevice?.id && device.current_volume !== undefined) {
            setVolume(device.current_volume);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDevice?.id]);

  // Fetch current playing media
  const fetchMediaInfo = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await sendCommand("get_media_info", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result.success && "result" in result && result.result) {
        const info = result.result as MediaInfo;
        setMediaInfo(info);
        setIsPlaying(info.playing ?? false);
      }
    } catch (err) {
      console.error("Failed to fetch media info:", err);
    }
    setIsLoading(false);
  }, [sendCommand]);

  // Sync status on connect
  useEffect(() => {
    if (selectedDevice?.is_online) {
      fetchMediaInfo();
      // Also refresh device to get latest volume/brightness
      refreshDevices();
    }
  }, [selectedDevice?.is_online, fetchMediaInfo, refreshDevices]);

  // Media controls - instant feedback then send command
  const handleMediaControl = async (action: string) => {
    if (isControlling) return;
    
    // Instant local feedback
    if (action === "play_pause") {
      setIsPlaying(!isPlaying);
    }
    
    setIsControlling(true);
    
    // Send command without waiting (fire and forget for responsiveness)
    sendCommand("media_control", { action }).then(() => {
      // Refresh media info after a short delay
      setTimeout(fetchMediaInfo, 200);
    }).finally(() => {
      setIsControlling(false);
    });
  };

  // Volume control - instant local update
  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  // Debounced volume commit for smoother slider experience
  const handleVolumeCommit = (value: number[]) => {
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current);
    }
    
    volumeTimeoutRef.current = setTimeout(() => {
      sendCommand("set_volume", { level: value[0] });
      toast({ title: "Volume", description: `Set to ${value[0]}%` });
    }, 100);
  };

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (newMuted) {
      sendCommand("set_volume", { level: 0 });
    } else {
      sendCommand("set_volume", { level: volume || 50 });
    }
  };

  // Quick volume adjustment
  const adjustVolume = (delta: number) => {
    const newVolume = Math.max(0, Math.min(100, volume + delta));
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    sendCommand("set_volume", { level: newVolume });
    toast({ title: "Volume", description: `Set to ${newVolume}%` });
  };

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Button variant="ghost" size="icon" onClick={() => handleMediaControl("previous")}>
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleMediaControl("play_pause")}
          className="h-10 w-10"
          disabled={isControlling}
        >
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => handleMediaControl("next")}>
          <SkipForward className="h-4 w-4" />
        </Button>
        
        {showVolumeControl && (
          <div className="flex items-center gap-2 ml-2">
            <Button variant="ghost" size="icon" onClick={handleMuteToggle}>
              <VolumeIcon className="h-4 w-4" />
            </Button>
            <Slider
              value={[isMuted ? 0 : volume]}
              onValueChange={handleVolumeChange}
              onValueCommit={handleVolumeCommit}
              max={100}
              step={5}
              className="w-20"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className={cn("glass-dark border-border/50", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Music className="h-5 w-5 text-primary" />
            Media Player
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchMediaInfo}
            disabled={isLoading}
            className="h-7 w-7"
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Now Playing Info - Always show status */}
        <div className="p-3 rounded-lg bg-secondary/30">
          {mediaInfo && (mediaInfo.title || mediaInfo.artist) ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={isPlaying ? "default" : "secondary"} className={cn(
                  "text-xs",
                  isPlaying ? "bg-neon-green/20 text-neon-green animate-pulse" : ""
                )}>
                  {isPlaying ? "▶ Playing" : "⏸ Paused"}
                </Badge>
              </div>
              <p className="font-medium text-sm truncate">{mediaInfo.title || "Unknown Track"}</p>
              <p className="text-xs text-muted-foreground truncate">
                {mediaInfo.artist || "Unknown Artist"}
                {mediaInfo.album && ` • ${mediaInfo.album}`}
              </p>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm text-muted-foreground">No media detected</p>
                <p className="text-xs text-muted-foreground">Play something on your PC</p>
              </div>
              <Badge variant="secondary" className="text-xs">
                {isPlaying ? "▶ Playing" : "⏸ Stopped"}
              </Badge>
            </div>
          )}
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleMediaControl("shuffle")}>
            <Shuffle className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleMediaControl("previous")}>
            <SkipBack className="h-5 w-5" />
          </Button>
          <Button
            onClick={() => handleMediaControl("play_pause")}
            disabled={isControlling}
            className={cn(
              "h-12 w-12 rounded-full transition-all",
              isPlaying ? "bg-primary hover:bg-primary/90" : "gradient-primary"
            )}
          >
            {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleMediaControl("next")}>
            <SkipForward className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleMediaControl("repeat")}>
            <Repeat className="h-4 w-4" />
          </Button>
        </div>

        {/* Volume Control */}
        {showVolumeControl && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={handleMuteToggle} className="h-7 w-7">
                  <VolumeIcon className="h-4 w-4" />
                </Button>
                <span className="text-muted-foreground">Volume</span>
              </div>
              <Badge variant="secondary" className="bg-neon-blue/10 text-neon-blue">
                {isMuted ? 0 : volume}%
              </Badge>
            </div>
            <Slider
              value={[isMuted ? 0 : volume]}
              onValueChange={handleVolumeChange}
              onValueCommit={handleVolumeCommit}
              max={100}
              step={5}
              className="cursor-pointer"
            />
            <div className="flex justify-between gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => adjustVolume(-10)}
              >
                <Volume1 className="h-3 w-3 mr-1" />
                -10
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => adjustVolume(10)}
              >
                <Volume2 className="h-3 w-3 mr-1" />
                +10
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
