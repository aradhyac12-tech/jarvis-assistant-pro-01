import { useState, useEffect, useCallback, useRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Search,
  Music,
  Disc3,
  Plus,
  Heart,
  Shuffle,
  Repeat,
  Loader2,
  RefreshCw,
  Phone,
  PhoneOff,
  Youtube,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";

interface Song {
  id: string;
  title: string;
  artist: string;
  duration: string;
  durationMs?: number;
  thumbnail?: string;
}

interface MediaState {
  title: string;
  artist: string;
  isPlaying: boolean;
  position: number;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
}

export default function MusicPlayer() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [volume, setVolume] = useState(80);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [autoMuteOnCall, setAutoMuteOnCall] = useState(true);
  const [isOnCall, setIsOnCall] = useState(false);
  const [wasPlayingBeforeCall, setWasPlayingBeforeCall] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Real media state from PC
  const [mediaState, setMediaState] = useState<MediaState>({
    title: "No media playing",
    artist: "Play something on your PC",
    isPlaying: false,
    position: 0,
    positionMs: 0,
    durationMs: 0,
    volume: 80,
    muted: false,
  });

  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [queue, setQueue] = useState<Song[]>([]);

  // Format milliseconds to mm:ss
  const formatTime = (ms: number) => {
    if (!ms || ms <= 0) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Fetch current media state from PC
  const fetchMediaState = useCallback(async () => {
    if (!selectedDevice?.is_online || isFetching) return;
    
    setIsFetching(true);
    try {
      const result = await sendCommand("get_media_state", {}, { awaitResult: true, timeoutMs: 4000 });
      if (result?.success && 'result' in result && result.result) {
        const state = result.result as Record<string, unknown>;
        if (state.success) {
          setMediaState({
            title: (state.title as string) || "No media playing",
            artist: (state.artist as string) || "Unknown artist",
            isPlaying: (state.is_playing as boolean) ?? false,
            position: (state.position_percent as number) ?? 0,
            positionMs: (state.position_ms as number) ?? 0,
            durationMs: (state.duration_ms as number) ?? 0,
            volume: (state.volume as number) ?? 80,
            muted: (state.muted as boolean) ?? false,
          });
          setVolume((state.volume as number) ?? 80);
          setIsMuted((state.muted as boolean) ?? false);
        }
      }
    } catch (error) {
      console.error("Failed to fetch media state:", error);
    } finally {
      setIsFetching(false);
    }
  }, [selectedDevice, sendCommand, isFetching]);

  // Poll media state every 3 seconds (reduced from 2 to avoid overwhelming)
  useEffect(() => {
    if (selectedDevice?.is_online) {
      fetchMediaState();
      pollIntervalRef.current = setInterval(fetchMediaState, 3000);
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [selectedDevice]);

  // Media controls
  const handlePlayPause = async () => {
    await sendCommand("media_control", { action: "play_pause" });
    setTimeout(fetchMediaState, 300);
  };

  const handleNext = async () => {
    await sendCommand("media_control", { action: "next" });
    toast({ title: "Next Track" });
    setTimeout(fetchMediaState, 500);
  };

  const handlePrevious = async () => {
    await sendCommand("media_control", { action: "previous" });
    toast({ title: "Previous Track" });
    setTimeout(fetchMediaState, 500);
  };

  const handleVolumeChange = async (newVolume: number[]) => {
    const vol = newVolume[0];
    setVolume(vol);
    await sendCommand("set_volume", { level: vol });
  };

  const handleMuteToggle = async () => {
    await sendCommand("media_control", { action: "mute" });
    setIsMuted(!isMuted);
  };

  const handleSeek = async (position: number[]) => {
    const percent = position[0];
    await sendCommand("media_seek", { position_percent: percent });
    setTimeout(fetchMediaState, 300);
  };

  // Phone call detection simulation (in real app, this would come from phone notifications)
  const simulatePhoneCall = (callActive: boolean) => {
    setIsOnCall(callActive);
    if (callActive && autoMuteOnCall) {
      if (mediaState.isPlaying) {
        setWasPlayingBeforeCall(true);
        handlePlayPause();
        sendCommand("set_volume", { level: 0 });
        toast({ 
          title: "Phone Call Detected", 
          description: "Media paused and PC muted automatically" 
        });
      }
    } else if (!callActive && wasPlayingBeforeCall) {
      setWasPlayingBeforeCall(false);
      sendCommand("set_volume", { level: volume });
      handlePlayPause();
      toast({ 
        title: "Call Ended", 
        description: "Media resumed" 
      });
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    // Search results simulation - in production would search YouTube/Spotify API
    setTimeout(() => {
      setSearchResults([
        { id: "s1", title: searchQuery, artist: "Artist 1", duration: "3:45", durationMs: 225000 },
        { id: "s2", title: `${searchQuery} Remix`, artist: "Artist 2", duration: "4:12", durationMs: 252000 },
        { id: "s3", title: `Best of ${searchQuery}`, artist: "Various Artists", duration: "5:20", durationMs: 320000 },
      ]);
      setIsSearching(false);
    }, 1000);
  };

  const handlePlay = async (song: Song) => {
    await sendCommand("play_music", { query: song.title, service: "youtube" });
    toast({ title: "Now Playing", description: `${song.title} - ${song.artist}` });
    setTimeout(fetchMediaState, 2000);
  };

  const handleAddToQueue = (song: Song) => {
    setQueue((prev) => [...prev, song]);
    toast({ title: "Added to Queue", description: song.title });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold neon-text">Music Player</h1>
            <p className="text-muted-foreground">Control PC media playback</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Phone Call Toggle (for testing) */}
            <Button
              variant={isOnCall ? "destructive" : "outline"}
              size="sm"
              onClick={() => simulatePhoneCall(!isOnCall)}
              className="gap-2"
            >
              {isOnCall ? <PhoneOff className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
              {isOnCall ? "End Call" : "Simulate Call"}
            </Button>
            <Button variant="outline" size="icon" onClick={fetchMediaState}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {selectedDevice && (
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                {selectedDevice.name}
              </Badge>
            )}
          </div>
        </div>

        {/* Auto-mute on call toggle */}
        <Card className="glass-dark border-border/50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              <span className="text-sm">Auto-pause & mute on phone call</span>
            </div>
            <Button
              variant={autoMuteOnCall ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoMuteOnCall(!autoMuteOnCall)}
            >
              {autoMuteOnCall ? "Enabled" : "Disabled"}
            </Button>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Now Playing */}
          <Card className="lg:col-span-2 glass-dark border-border/50 overflow-hidden">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-6">
                {/* Album Art */}
                <div className="w-full md:w-64 aspect-square rounded-2xl gradient-primary flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                  <Disc3 className={cn("w-32 h-32 text-primary-foreground", mediaState.isPlaying && "animate-spin")} style={{ animationDuration: "3s" }} />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
                  {isOnCall && (
                    <div className="absolute top-2 right-2 bg-destructive text-destructive-foreground px-2 py-1 rounded text-xs font-medium flex items-center gap-1">
                      <Phone className="h-3 w-3" /> On Call
                    </div>
                  )}
                </div>

                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">{mediaState.title}</h2>
                    <p className="text-muted-foreground text-lg">{mediaState.artist}</p>
                    <Badge variant={mediaState.isPlaying ? "default" : "secondary"} className="mt-2">
                      {mediaState.isPlaying ? "Playing" : "Paused"}
                    </Badge>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2 my-6">
                    <Slider 
                      value={[mediaState.position]} 
                      max={100} 
                      step={1} 
                      className="cursor-pointer" 
                      onValueCommit={handleSeek}
                    />
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{formatTime(mediaState.positionMs)}</span>
                      <span>{formatTime(mediaState.durationMs)}</span>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShuffle(!shuffle)}
                      className={cn(shuffle && "text-primary")}
                    >
                      <Shuffle className="h-5 w-5" />
                    </Button>

                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={handlePrevious}>
                        <SkipBack className="h-5 w-5" />
                      </Button>
                      <Button
                        size="icon"
                        className="h-14 w-14 rounded-full gradient-primary pulse-neon"
                        onClick={handlePlayPause}
                      >
                        {mediaState.isPlaying ? (
                          <Pause className="h-6 w-6 text-primary-foreground" />
                        ) : (
                          <Play className="h-6 w-6 text-primary-foreground ml-1" />
                        )}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={handleNext}>
                        <SkipForward className="h-5 w-5" />
                      </Button>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRepeat(!repeat)}
                      className={cn(repeat && "text-primary")}
                    >
                      <Repeat className="h-5 w-5" />
                    </Button>
                  </div>

                  {/* Volume */}
                  <div className="flex items-center gap-3 mt-4">
                    <Button variant="ghost" size="icon" onClick={handleMuteToggle}>
                      {isMuted ? (
                        <VolumeX className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <Volume2 className="h-5 w-5 text-muted-foreground" />
                      )}
                    </Button>
                    <Slider
                      value={[isMuted ? 0 : volume]}
                      onValueChange={(v) => setVolume(v[0])}
                      onValueCommit={handleVolumeChange}
                      max={100}
                      className="w-32 cursor-pointer"
                    />
                    <span className="text-sm text-muted-foreground w-8">{isMuted ? "0" : volume}%</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Queue */}
          <Card className="glass-dark border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Music className="h-5 w-5 text-primary" />
                Up Next
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[300px]">
                <div className="p-4 space-y-2">
                  {queue.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-4">
                      Queue is empty. Search and add songs!
                    </p>
                  ) : (
                    queue.map((song, index) => (
                      <div
                        key={song.id}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors group"
                        onClick={() => handlePlay(song)}
                      >
                        <span className="text-sm text-muted-foreground w-6">{index + 1}</span>
                        <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                          <Music className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{song.title}</p>
                          <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                        </div>
                        <span className="text-sm text-muted-foreground">{song.duration}</span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <Card className="glass-dark border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              Search Songs
            </CardTitle>
            <CardDescription>Search for songs to play on your PC</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 mb-4">
              <Input
                placeholder="Search for a song..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button onClick={handleSearch} className="gradient-primary" disabled={isSearching}>
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="space-y-2">
                {searchResults.map((song) => (
                  <div
                    key={song.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                      <Music className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{song.title}</p>
                      <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                    </div>
                    <span className="text-sm text-muted-foreground">{song.duration}</span>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handlePlay(song)}>
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleAddToQueue(song)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon">
                        <Heart className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
