import { useState, useEffect, useCallback } from "react";
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

  // Media controls
  const handleMediaControl = async (action: string) => {
    await sendCommand("media_control", { action });
    
    if (action === "play_pause") {
      setIsPlaying(!isPlaying);
    }
    
    // Refresh media info after action
    setTimeout(fetchMediaInfo, 500);
  };

  // Volume control
  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const handleVolumeCommit = (value: number[]) => {
    sendCommand("set_volume", { level: value[0] });
    toast({ title: "Volume", description: `Set to ${value[0]}%` });
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
        {/* Now Playing Info */}
        {mediaInfo && (mediaInfo.title || mediaInfo.artist) && (
          <div className="p-3 rounded-lg bg-secondary/30">
            <p className="font-medium text-sm truncate">{mediaInfo.title || "Unknown Track"}</p>
            <p className="text-xs text-muted-foreground truncate">
              {mediaInfo.artist || "Unknown Artist"}
              {mediaInfo.album && ` • ${mediaInfo.album}`}
            </p>
          </div>
        )}

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
            className={cn(
              "h-12 w-12 rounded-full",
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
                onClick={() => handleMediaControl("volume_down")}
              >
                <Volume1 className="h-3 w-3 mr-1" />
                -10
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleMediaControl("volume_up")}
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
