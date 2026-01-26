import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Music,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Speaker,
  Headphones,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";

interface AudioDevice {
  id: string;
  name: string;
  type: "speaker" | "headphone" | "bluetooth" | "default";
  volume: number;
  isMuted: boolean;
  isDefault: boolean;
}

interface MediaState {
  title: string;
  artist: string;
  album?: string;
  isPlaying: boolean;
  progress?: number;
  duration?: number;
  artworkUrl?: string;
}

interface MediaSyncPanelProps {
  className?: string;
  onMediaUpdate?: (media: MediaState) => void;
}

export function MediaSyncPanel({ className, onMediaUpdate }: MediaSyncPanelProps) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();

  const [mediaState, setMediaState] = useState<MediaState>({
    title: "Not Playing",
    artist: "Play something on your PC",
    isPlaying: false,
  });
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState<string>("");
  const [masterVolume, setMasterVolume] = useState(50);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showInNotification, setShowInNotification] = useState(true);

  const isConnected = selectedDevice?.is_online || false;

  // Fetch media state
  const fetchMediaState = useCallback(async () => {
    if (!isConnected) return;
    
    try {
      const result = await sendCommand("get_media_state", {}, { awaitResult: true, timeoutMs: 4000 });
      if (result?.success && "result" in result && result.result) {
        const state = result.result as Record<string, unknown>;
        const newMedia: MediaState = {
          title: (state.title as string) || "Not Playing",
          artist: (state.artist as string) || "Unknown artist",
          album: state.album as string | undefined,
          isPlaying: (state.is_playing as boolean) ?? false,
          progress: state.progress as number | undefined,
          duration: state.duration as number | undefined,
          artworkUrl: state.artwork_url as string | undefined,
        };
        setMediaState(newMedia);
        onMediaUpdate?.(newMedia);
      }
    } catch (err) {
      console.debug("Media state fetch failed:", err);
    }
  }, [isConnected, sendCommand, onMediaUpdate]);

  // Fetch audio devices
  const fetchAudioDevices = useCallback(async () => {
    if (!isConnected) return;
    
    try {
      const result = await sendCommand("get_audio_devices", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result?.success && "result" in result && result.result) {
        const data = result.result as { devices?: AudioDevice[]; master_volume?: number; is_muted?: boolean };
        if (data.devices) {
          setAudioDevices(data.devices);
          const defaultDevice = data.devices.find(d => d.isDefault);
          if (defaultDevice) {
            setSelectedOutputId(defaultDevice.id);
          }
        }
        if (typeof data.master_volume === "number") {
          setMasterVolume(data.master_volume);
        }
        if (typeof data.is_muted === "boolean") {
          setIsMuted(data.is_muted);
        }
      }
    } catch (err) {
      console.debug("Audio devices fetch failed:", err);
    }
  }, [isConnected, sendCommand]);

  // Initial fetch
  useEffect(() => {
    if (isConnected) {
      fetchMediaState();
      fetchAudioDevices();
    }
  }, [isConnected, fetchMediaState, fetchAudioDevices]);

  // Poll media state periodically
  useEffect(() => {
    if (!isConnected) return;
    
    const interval = setInterval(fetchMediaState, 3000);
    return () => clearInterval(interval);
  }, [isConnected, fetchMediaState]);

  // Media controls
  const handlePlayPause = useCallback(async () => {
    setMediaState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
    await sendCommand("media_control", { action: "play_pause" });
    setTimeout(fetchMediaState, 500);
  }, [sendCommand, fetchMediaState]);

  const handleNext = useCallback(async () => {
    await sendCommand("media_control", { action: "next" });
    setTimeout(fetchMediaState, 800);
  }, [sendCommand, fetchMediaState]);

  const handlePrevious = useCallback(async () => {
    await sendCommand("media_control", { action: "previous" });
    setTimeout(fetchMediaState, 800);
  }, [sendCommand, fetchMediaState]);

  // Volume control
  const handleVolumeChange = useCallback(async (value: number[]) => {
    setMasterVolume(value[0]);
  }, []);

  const handleVolumeCommit = useCallback(async (value: number[]) => {
    try {
      await sendCommand("set_volume", { level: value[0] }, { awaitResult: true, timeoutMs: 3000 });
    } catch (err) {
      console.error("Volume set failed:", err);
    }
  }, [sendCommand]);

  const handleMuteToggle = useCallback(async () => {
    setIsMuted(!isMuted);
    await sendCommand("toggle_mute", {});
  }, [isMuted, sendCommand]);

  // Change output device
  const handleOutputChange = useCallback(async (deviceId: string) => {
    setSelectedOutputId(deviceId);
    try {
      await sendCommand("set_audio_output", { device_id: deviceId }, { awaitResult: true, timeoutMs: 5000 });
      toast({ title: "Audio output changed" });
    } catch (err) {
      toast({ title: "Failed to change output", variant: "destructive" });
    }
  }, [sendCommand, toast]);

  // Get device icon
  const getDeviceIcon = (type: string) => {
    switch (type) {
      case "headphone":
      case "bluetooth":
        return Headphones;
      default:
        return Speaker;
    }
  };

  return (
    <Card className={cn("border-border/40", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Music className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Media & Audio</CardTitle>
              <CardDescription className="text-xs">Control PC media and speakers</CardDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => { fetchMediaState(); fetchAudioDevices(); }}
            disabled={!isConnected || isLoading}
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Now Playing */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
          <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center shrink-0">
            {mediaState.artworkUrl ? (
              <img src={mediaState.artworkUrl} alt="Artwork" className="w-full h-full object-cover rounded-lg" />
            ) : (
              <Music className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{mediaState.title}</p>
            <p className="text-xs text-muted-foreground truncate">{mediaState.artist}</p>
          </div>
          <Badge variant={mediaState.isPlaying ? "default" : "secondary"} className="text-xs shrink-0">
            {mediaState.isPlaying ? "Playing" : "Paused"}
          </Badge>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="icon" onClick={handlePrevious} disabled={!isConnected}>
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button size="icon" className="w-10 h-10 rounded-full" onClick={handlePlayPause} disabled={!isConnected}>
            {mediaState.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={handleNext} disabled={!isConnected}>
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>

        {/* Master volume */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleMuteToggle} disabled={!isConnected}>
              {isMuted ? <VolumeX className="w-4 h-4 text-muted-foreground" /> : <Volume2 className="w-4 h-4" />}
            </Button>
            <span className="font-medium tabular-nums text-xs">{masterVolume}%</span>
          </div>
          <Slider
            value={[masterVolume]}
            onValueChange={handleVolumeChange}
            onValueCommit={handleVolumeCommit}
            max={100}
            step={1}
            disabled={!isConnected}
            className="cursor-pointer"
          />
        </div>

        {/* Output device selector */}
        {audioDevices.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Speaker className="w-3 h-3" />
              Output Device
            </label>
            <Select value={selectedOutputId} onValueChange={handleOutputChange} disabled={!isConnected}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select output" />
              </SelectTrigger>
              <SelectContent>
                {audioDevices.map((device) => {
                  const DeviceIcon = getDeviceIcon(device.type);
                  return (
                    <SelectItem key={device.id} value={device.id} className="text-xs">
                      <div className="flex items-center gap-2">
                        <DeviceIcon className="w-3 h-3" />
                        {device.name}
                        {device.isDefault && <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">Default</Badge>}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Show in notification option */}
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Smartphone className="w-3 h-3" />
            Show in phone notification
          </span>
          <Button
            variant={showInNotification ? "default" : "outline"}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setShowInNotification(!showInNotification)}
          >
            {showInNotification ? "On" : "Off"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
