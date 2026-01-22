import { useState, useRef, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Bot,
  Monitor,
  Music,
  Keyboard,
  Terminal,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Cpu,
  HardDrive,
  Battery,
  Zap,
  RefreshCw,
  Send,
  Loader2,
  Check,
  X,
  Search,
  Globe,
  MessageSquare,
  Sparkles,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Disc3,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Mouse,
  Clipboard,
  Copy,
  Power,
  RotateCcw,
  Lock,
  Unlock,
  Snowflake,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useFastCommand } from "@/hooks/useFastCommand";
import { useOptimisticMedia } from "@/hooks/useOptimisticMedia";
import { DeviceSelector } from "@/components/DeviceSelector";
import { MonitoringPanel } from "@/components/MonitoringPanel";
import { supabase } from "@/integrations/supabase/client";
import { addLog } from "@/components/IssueLog";

// Types
interface CommandResult {
  command: string;
  success: boolean;
  message: string;
  timestamp: Date;
}

interface SystemStats {
  cpu_percent?: number;
  memory_percent?: number;
  memory_used_gb?: number;
  memory_total_gb?: number;
  disk_percent?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  battery_percent?: number;
  battery_plugged?: boolean;
}

type ServiceType = "web" | "youtube" | "chatgpt" | "perplexity";

const serviceConfig: Record<ServiceType, { label: string; icon: React.ReactNode; color: string }> = {
  web: { label: "Web", icon: <Globe className="h-3 w-3" />, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  youtube: { label: "YouTube", icon: <Music className="h-3 w-3" />, color: "bg-red-500/20 text-red-400 border-red-500/30" },
  chatgpt: { label: "ChatGPT", icon: <MessageSquare className="h-3 w-3" />, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  perplexity: { label: "Perplexity", icon: <Zap className="h-3 w-3" />, color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

const powerActions = [
  { title: "Sleep", icon: Moon, color: "text-neon-purple", command: "sleep" },
  { title: "Restart", icon: RotateCcw, color: "text-neon-orange", command: "restart" },
  { title: "Shutdown", icon: Power, color: "text-destructive", command: "shutdown" },
];

export default function ControlHub() {
  const { devices, selectedDevice, isLoading: loading, refreshDevices } = useDeviceContext();
  const { deviceInfo, isReconnecting, session } = useDeviceSession();
  const { sendCommand } = useDeviceCommands();
  const { fireCommand, fireMouse, fireKey } = useFastCommand();
  const { toast } = useToast();

  // Use optimistic media hook
  const {
    mediaState,
    isFetching: mediaFetching,
    pendingAction,
    formatTime,
    fetchMediaState,
    handlePlayPause,
    handleNext,
    handlePrevious,
    handleVolumeChange,
    handleVolumeCommit,
    handleMuteToggle,
    handleSeek,
  } = useOptimisticMedia();

  // System stats
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Volume/Brightness from device
  const [volume, setVolume] = useState(selectedDevice?.current_volume ?? 50);
  const [brightness, setBrightness] = useState(selectedDevice?.current_brightness ?? 75);
  const [isMuted, setIsMuted] = useState(false);
  const [isLocked, setIsLocked] = useState(selectedDevice?.is_locked ?? false);
  
  // Command Center state
  const [cmdInput, setCmdInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<CommandResult[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceType>("web");

  // Music search
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Remote state
  const [textInput, setTextInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [clipboardText, setClipboardText] = useState("");
  const trackpadRef = useRef<HTMLDivElement>(null);
  const lastPosition = useRef({ x: 0, y: 0 });

  const isConnected = selectedDevice?.is_online || false;

  // Sync volume/brightness from device
  useEffect(() => {
    if (selectedDevice) {
      setVolume(selectedDevice.current_volume ?? 50);
      setBrightness(selectedDevice.current_brightness ?? 75);
      setIsLocked(selectedDevice.is_locked ?? false);
    }
  }, [selectedDevice]);

  // Fetch system stats
  const fetchSystemStats = useCallback(async () => {
    if (!selectedDevice?.is_online) return;
    
    setIsRefreshing(true);
    const result = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 5000 });
    if (result && 'result' in result && result.result?.success) {
      setSystemStats(result.result as unknown as SystemStats);
    }
    setIsRefreshing(false);
  }, [selectedDevice?.is_online, sendCommand]);

  useEffect(() => {
    if (selectedDevice?.is_online) {
      fetchSystemStats();
    }
  }, [selectedDevice?.is_online, fetchSystemStats]);

  // Realtime device updates
  useEffect(() => {
    if (!selectedDevice?.id) return;

    const channel = supabase
      .channel(`device-hub-${selectedDevice.id}`)
      .on(
        "postgres_changes",
        { 
          event: "UPDATE", 
          schema: "public", 
          table: "devices",
          filter: `id=eq.${selectedDevice.id}`
        },
        (payload) => {
          const device = payload.new as { current_volume?: number; current_brightness?: number; is_locked?: boolean };
          if (device.current_volume !== undefined) setVolume(device.current_volume);
          if (device.current_brightness !== undefined) setBrightness(device.current_brightness);
          if (device.is_locked !== undefined) setIsLocked(device.is_locked);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDevice?.id]);

  // ==================== COMMAND CENTER ====================
  const parseAndExecute = useCallback(
    async (text: string, service: ServiceType) => {
      const lower = text.toLowerCase().trim();

      const addResult = (success: boolean, message: string) => {
        setCmdHistory((prev) => [
          { command: text, success, message, timestamp: new Date() },
          ...prev.slice(0, 19),
        ]);
      };

      try {
        // Service-based execution
        if (service !== "web") {
          if (service === "youtube") {
            const result = await sendCommand("play_music", { query: text, service: "youtube" }, { awaitResult: true, timeoutMs: 10000 });
            addResult(result.success, result.success ? `Playing "${text}" on YouTube` : result.error || "Failed");
            return;
          } else if (service === "chatgpt") {
            const result = await sendCommand("search_web", { query: text, engine: "chatgpt" }, { awaitResult: true, timeoutMs: 10000 });
            addResult(result.success, result.success ? `Asked ChatGPT: "${text}"` : result.error || "Failed");
            return;
          } else if (service === "perplexity") {
            const result = await sendCommand("search_web", { query: text, engine: "perplexity" }, { awaitResult: true, timeoutMs: 10000 });
            addResult(result.success, result.success ? `Asked Perplexity: "${text}"` : result.error || "Failed");
            return;
          }
        }

        // Open app patterns
        const openAppMatch = lower.match(/^open\s+(.+)$/i);
        if (openAppMatch) {
          const app = openAppMatch[1];
          const result = await sendCommand("open_app", { app_name: app }, { awaitResult: true, timeoutMs: 6000 });
          addResult(result.success, result.success ? `Opened ${app}` : result.error || "Failed");
          return;
        }

        // Play music patterns
        const playMatch = lower.match(/^play\s+(.+?)(?:\s+on\s+(youtube|spotify))?$/i);
        if (playMatch) {
          const query = playMatch[1];
          const svc = playMatch[2] || "youtube";
          const result = await sendCommand("play_music", { query, service: svc }, { awaitResult: true, timeoutMs: 10000 });
          addResult(result.success, result.success ? `Playing "${query}" on ${svc}` : result.error || "Failed");
          return;
        }

        // Volume patterns
        const volumeMatch = lower.match(/^(?:set\s+)?volume\s+(?:to\s+)?(\d+)%?$/i);
        if (volumeMatch) {
          const level = parseInt(volumeMatch[1]);
          const result = await sendCommand("set_volume", { level }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? `Volume set to ${level}%` : result.error || "Failed");
          return;
        }

        // Media controls
        if (["pause", "play", "play/pause", "playpause"].includes(lower)) {
          handlePlayPause();
          addResult(true, "Toggled play/pause");
          return;
        }
        if (["next", "next track", "skip"].includes(lower)) {
          handleNext();
          addResult(true, "Skipped to next track");
          return;
        }
        if (["previous", "prev", "previous track"].includes(lower)) {
          handlePrevious();
          addResult(true, "Went to previous track");
          return;
        }

        // Lock command
        if (["lock", "lock screen", "lock pc"].includes(lower)) {
          const result = await sendCommand("lock", {}, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Screen locked" : result.error || "Failed");
          return;
        }

        // Default: web search
        if (text.trim()) {
          const result = await sendCommand("search_web", { query: text, engine: "google" }, { awaitResult: true, timeoutMs: 6000 });
          addResult(result.success, result.success ? `Searched Google for: ${text}` : result.error || "Failed");
          return;
        }

        addResult(false, "Unknown command");
      } catch (error) {
        addResult(false, String(error));
      }
    },
    [sendCommand, handlePlayPause, handleNext, handlePrevious]
  );

  const handleCmdSubmit = async () => {
    if (!cmdInput.trim() || isProcessing) return;
    setIsProcessing(true);
    await parseAndExecute(cmdInput.trim(), selectedService);
    setCmdInput("");
    setIsProcessing(false);
  };

  // ==================== SYSTEM CONTROLS ====================
  const handleSystemVolumeChange = useCallback((value: number[]) => {
    setVolume(value[0]);
  }, []);

  const handleSystemVolumeCommit = useCallback(async (value: number[]) => {
    await sendCommand("set_volume", { level: value[0] });
  }, [sendCommand]);

  const handleBrightnessChange = useCallback((value: number[]) => {
    setBrightness(value[0]);
  }, []);

  const handleBrightnessCommit = useCallback(async (value: number[]) => {
    await sendCommand("set_brightness", { level: value[0] });
  }, [sendCommand]);

  const handleMuteSystemToggle = useCallback(async () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    await sendCommand("set_volume", { level: newMuted ? 0 : volume });
    toast({ title: newMuted ? "Muted" : "Unmuted" });
  }, [isMuted, volume, sendCommand, toast]);

  const handleLock = useCallback(async () => {
    setIsLocked(true);
    await sendCommand("lock", {});
    toast({ title: "PC Locked" });
  }, [sendCommand, toast]);

  const handlePowerAction = useCallback(async (command: string) => {
    await sendCommand(command, {});
    toast({ title: `${command.charAt(0).toUpperCase() + command.slice(1)} initiated` });
  }, [sendCommand, toast]);

  // ==================== MUSIC ====================
  const handlePlaySearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    await sendCommand("play_music", { query: searchQuery, service: "youtube" });
    toast({ title: "Playing", description: searchQuery });
    setSearchQuery("");
    setIsSearching(false);
    setTimeout(() => fetchMediaState(), 2000);
  };

  // ==================== REMOTE (FAST COMMANDS) ====================
  const sendKeyboard = async () => {
    if (!textInput.trim()) return;
    setIsSending(true);
    fireCommand("type_text", { text: textInput });
    toast({ title: "Text Sent" });
    setTextInput("");
    setIsSending(false);
  };

  const sendKey = (key: string) => {
    setLastKey(key);
    fireKey(key);
    setTimeout(() => setLastKey(null), 100);
  };

  const handleTrackpadStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const point = "touches" in e ? e.touches[0] : e;
    lastPosition.current = { x: point.clientX, y: point.clientY };
  }, []);

  const handleTrackpadMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!("buttons" in e) || e.buttons !== 1) {
      if (!("touches" in e)) return;
    }
    
    const point = "touches" in e ? e.touches[0] : e;
    // Higher sensitivity multiplier for faster response
    const sensitivity = 3.5;
    const deltaX = (point.clientX - lastPosition.current.x) * sensitivity;
    const deltaY = (point.clientY - lastPosition.current.y) * sensitivity;
    
    lastPosition.current = { x: point.clientX, y: point.clientY };
    
    // Lower threshold for more responsive movement
    if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
      fireMouse(deltaX, deltaY);
    }
  }, [fireMouse]);

  const handleMouseClick = (button: string = "left") => {
    fireCommand("mouse_click", { button, clicks: 1 });
  };

  const handleArrowMove = (direction: "up" | "down" | "left" | "right") => {
    const moves: Record<string, { x: number; y: number }> = {
      up: { x: 0, y: -50 },
      down: { x: 0, y: 50 },
      left: { x: -50, y: 0 },
      right: { x: 50, y: 0 },
    };
    fireCommand("mouse_move", { ...moves[direction], relative: true });
  };

  const sendClipboardToPC = () => {
    if (!clipboardText.trim()) return;
    fireCommand("set_clipboard", { content: clipboardText });
    toast({ title: "Clipboard Sent" });
  };

  const quickKeys = [
    { label: "Enter", key: "enter" },
    { label: "Esc", key: "escape" },
    { label: "Tab", key: "tab" },
    { label: "⌫", key: "backspace" },
    { label: "Ctrl+C", key: "ctrl+c" },
    { label: "Ctrl+V", key: "ctrl+v" },
    { label: "Alt+Tab", key: "alt+tab" },
    { label: "Win", key: "win" },
  ];

  const examples = ["play lofi beats", "open chrome", "volume 50"];

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-2rem)]">
        <div className="space-y-4 animate-fade-in pr-4 pt-12 md:pt-0">
          {/* Header */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center pulse-neon shadow-lg">
                  <Bot className="w-8 h-8 text-primary-foreground" />
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold neon-text">Control Hub</h1>
                  <p className="text-muted-foreground text-sm">
                    {selectedDevice ? `Connected to ${selectedDevice.name}` : "All-in-one PC control"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <DeviceSelector />
                <MonitoringPanel compact className="hidden md:flex" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => { refreshDevices(); fetchSystemStats(); fetchMediaState(); }}
                  className="border-border/50"
                  disabled={isRefreshing}
                >
                  <RefreshCw className={cn("h-4 w-4", (loading || isRefreshing) && "animate-spin")} />
                </Button>
              </div>
            </div>

            {/* Connection Status */}
            <Card className={cn(
              "glass-dark border-border/50 p-4",
              isConnected ? "border-neon-green/30" : "border-destructive/30"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isConnected ? (
                    <Wifi className="h-5 w-5 text-neon-green" />
                  ) : (
                    <WifiOff className="h-5 w-5 text-destructive" />
                  )}
                  <div>
                    <p className="font-medium">{selectedDevice?.name || "No Device"}</p>
                    <p className="text-xs text-muted-foreground">
                      {isConnected ? "Online & Ready" : "Offline"}
                    </p>
                  </div>
                </div>
                <Badge variant={isConnected ? "default" : "destructive"}>
                  {isConnected ? "Connected" : "Disconnected"}
                </Badge>
              </div>
            </Card>
          </div>

          {/* Main Tabs */}
          <Tabs defaultValue="media" className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="media" className="text-xs md:text-sm gap-1">
                <Music className="h-4 w-4" />
                <span className="hidden md:inline">Media</span>
              </TabsTrigger>
              <TabsTrigger value="system" className="text-xs md:text-sm gap-1">
                <Monitor className="h-4 w-4" />
                <span className="hidden md:inline">System</span>
              </TabsTrigger>
              <TabsTrigger value="remote" className="text-xs md:text-sm gap-1">
                <Keyboard className="h-4 w-4" />
                <span className="hidden md:inline">Remote</span>
              </TabsTrigger>
              <TabsTrigger value="command" className="text-xs md:text-sm gap-1">
                <Terminal className="h-4 w-4" />
                <span className="hidden md:inline">Command</span>
              </TabsTrigger>
            </TabsList>

            {/* ==================== MEDIA TAB ==================== */}
            <TabsContent value="media" className="space-y-4">
              {/* Now Playing Card with Optimistic UI */}
              <Card className="glass-dark border-border/50">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Album Art */}
                    <div className="w-full md:w-48 aspect-square rounded-2xl gradient-primary flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                      <Disc3 
                        className={cn(
                          "w-24 h-24 text-primary-foreground transition-all",
                          mediaState.isPlaying && "animate-spin"
                        )} 
                        style={{ animationDuration: "3s" }} 
                      />
                      {pendingAction && (
                        <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                          <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        <h2 className="text-xl font-bold truncate">{mediaState.title}</h2>
                        <p className="text-muted-foreground truncate">{mediaState.artist}</p>
                        <Badge 
                          variant={mediaState.isPlaying ? "default" : "secondary"} 
                          className={cn("mt-2", pendingAction === "play_pause" && "animate-pulse")}
                        >
                          {mediaState.isPlaying ? "Playing" : "Paused"}
                        </Badge>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-2 my-4">
                        <Slider 
                          value={[mediaState.position]} 
                          max={100} 
                          step={1} 
                          className="cursor-pointer" 
                          onValueCommit={(v) => handleSeek(v[0])}
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{formatTime(mediaState.positionMs)}</span>
                          <span>{formatTime(mediaState.durationMs)}</span>
                        </div>
                      </div>

                      {/* Controls - Optimistic */}
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="ghost" size="icon" onClick={handlePrevious}>
                          <SkipBack className="h-5 w-5" />
                        </Button>
                        <Button
                          size="icon"
                          className={cn(
                            "h-14 w-14 rounded-full gradient-primary transition-transform",
                            pendingAction === "play_pause" && "scale-95"
                          )}
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

                      {/* Volume - Optimistic */}
                      <div className="flex items-center gap-3 mt-4">
                        <Button variant="ghost" size="icon" onClick={handleMuteToggle}>
                          {mediaState.muted ? (
                            <VolumeX className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <Volume2 className="h-5 w-5 text-muted-foreground" />
                          )}
                        </Button>
                        <Slider
                          value={[mediaState.muted ? 0 : mediaState.volume]}
                          onValueChange={(v) => handleVolumeChange(v[0])}
                          onValueCommit={(v) => handleVolumeCommit(v[0])}
                          max={100}
                          className="flex-1 cursor-pointer"
                        />
                        <span className="text-sm text-muted-foreground w-10 text-right">
                          {mediaState.muted ? "0" : mediaState.volume}%
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Quick Play */}
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Search className="h-5 w-5 text-primary" />
                    Quick Play
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Search and play on YouTube..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handlePlaySearch()}
                      className="flex-1"
                    />
                    <Button onClick={handlePlaySearch} className="gradient-primary" disabled={isSearching}>
                      {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== SYSTEM TAB ==================== */}
            <TabsContent value="system" className="space-y-4">
              {/* System Stats */}
              {systemStats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="glass-dark border-border/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Cpu className="h-4 w-4 text-neon-blue" />
                        <span className="text-sm">CPU</span>
                      </div>
                      <p className="text-2xl font-bold text-neon-blue">{systemStats.cpu_percent || 0}%</p>
                      <Progress value={systemStats.cpu_percent || 0} className="mt-2 h-1" />
                    </CardContent>
                  </Card>
                  
                  <Card className="glass-dark border-border/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="h-4 w-4 text-neon-purple" />
                        <span className="text-sm">RAM</span>
                      </div>
                      <p className="text-2xl font-bold text-neon-purple">{systemStats.memory_percent || 0}%</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {systemStats.memory_used_gb || 0} / {systemStats.memory_total_gb || 0} GB
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="glass-dark border-border/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <HardDrive className="h-4 w-4 text-neon-orange" />
                        <span className="text-sm">Disk</span>
                      </div>
                      <p className="text-2xl font-bold text-neon-orange">{systemStats.disk_percent || 0}%</p>
                    </CardContent>
                  </Card>
                  
                  <Card className="glass-dark border-border/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Battery className="h-4 w-4 text-neon-green" />
                        <span className="text-sm">Battery</span>
                      </div>
                      <p className="text-2xl font-bold text-neon-green">
                        {systemStats.battery_percent !== undefined ? `${systemStats.battery_percent}%` : "N/A"}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Volume & Brightness */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Volume2 className="h-5 w-5 text-neon-blue" />
                      Volume
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Level</span>
                      <span className="text-2xl font-bold text-neon-blue">{isMuted ? 0 : volume}%</span>
                    </div>
                    <Slider
                      value={[isMuted ? 0 : volume]}
                      onValueChange={handleSystemVolumeChange}
                      onValueCommit={handleSystemVolumeCommit}
                      max={100}
                      step={5}
                      className="cursor-pointer"
                    />
                    <Button
                      variant={isMuted ? "destructive" : "secondary"}
                      className="w-full"
                      onClick={handleMuteSystemToggle}
                    >
                      {isMuted ? <VolumeX className="h-4 w-4 mr-2" /> : <Volume2 className="h-4 w-4 mr-2" />}
                      {isMuted ? "Unmute" : "Mute"}
                    </Button>
                  </CardContent>
                </Card>

                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Sun className="h-5 w-5 text-neon-orange" />
                      Brightness
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Level</span>
                      <span className="text-2xl font-bold text-neon-orange">{brightness}%</span>
                    </div>
                    <Slider
                      value={[brightness]}
                      onValueChange={handleBrightnessChange}
                      onValueCommit={handleBrightnessCommit}
                      min={0}
                      max={100}
                      step={5}
                      className="cursor-pointer"
                    />
                    <div className="flex gap-2">
                      <Button variant="secondary" className="flex-1" onClick={() => { setBrightness(0); sendCommand("set_brightness", { level: 0 }); }}>
                        <Moon className="h-4 w-4 mr-1" /> Off
                      </Button>
                      <Button variant="secondary" className="flex-1" onClick={() => { setBrightness(50); sendCommand("set_brightness", { level: 50 }); }}>
                        50%
                      </Button>
                      <Button variant="secondary" className="flex-1" onClick={() => { setBrightness(100); sendCommand("set_brightness", { level: 100 }); }}>
                        Max
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Lock & Power */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Lock className="h-5 w-5 text-neon-pink" />
                      Lock PC
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full" variant="secondary" onClick={handleLock}>
                      <Lock className="h-4 w-4 mr-2" /> Lock Screen
                    </Button>
                  </CardContent>
                </Card>

                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Power className="h-5 w-5 text-destructive" />
                      Power
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      {powerActions.map((action) => (
                        <AlertDialog key={action.command}>
                          <AlertDialogTrigger asChild>
                            <Button variant="secondary" className="flex-1">
                              <action.icon className={cn("h-4 w-4 mr-1", action.color)} />
                              {action.title}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="glass-dark border-border/50">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirm {action.title}</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to {action.title.toLowerCase()} your PC?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handlePowerAction(action.command)}>
                                {action.title}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ==================== REMOTE TAB ==================== */}
            <TabsContent value="remote" className="space-y-4">
              {/* Keyboard */}
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Keyboard className="h-5 w-5 text-primary" />
                    Keyboard
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Textarea 
                      placeholder="Type here to send to PC..." 
                      value={textInput} 
                      onChange={(e) => setTextInput(e.target.value)} 
                      className="min-h-[80px] text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.ctrlKey) {
                          e.preventDefault();
                          sendKeyboard();
                        }
                      }}
                    />
                  </div>
                  <Button 
                    className="w-full gradient-primary" 
                    onClick={sendKeyboard} 
                    disabled={!textInput || isSending}
                  >
                    {isSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                    Send (Ctrl+Enter)
                  </Button>
                  
                  <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                    {quickKeys.map((k) => (
                      <Button 
                        key={k.key} 
                        variant="secondary" 
                        size="sm" 
                        className={cn("text-xs", lastKey === k.label && "bg-neon-green/20 border-neon-green")}
                        onClick={() => sendKey(k.key)}
                      >
                        {k.label}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Trackpad */}
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Mouse className="h-5 w-5 text-primary" />
                    Trackpad
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div 
                    ref={trackpadRef}
                    className="aspect-video bg-secondary/30 rounded-xl border-2 border-dashed border-border cursor-crosshair touch-none select-none flex items-center justify-center min-h-[150px]"
                    onMouseDown={handleTrackpadStart}
                    onMouseMove={handleTrackpadMove}
                    onTouchStart={handleTrackpadStart}
                    onTouchMove={handleTrackpadMove}
                  >
                    <p className="text-muted-foreground text-sm pointer-events-none">Drag to move mouse</p>
                  </div>
                  
                  <div className="grid grid-cols-5 gap-2">
                    <div />
                    <Button variant="secondary" size="sm" onClick={() => handleArrowMove("up")}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <div />
                    <Button variant="secondary" size="sm" onClick={() => handleMouseClick("left")}>
                      Left
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleMouseClick("right")}>
                      Right
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleArrowMove("left")}>
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleArrowMove("down")}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleArrowMove("right")}>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Clipboard */}
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Clipboard className="h-5 w-5 text-primary" />
                    Clipboard
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea 
                    placeholder="Paste text here to send to PC clipboard..." 
                    value={clipboardText} 
                    onChange={(e) => setClipboardText(e.target.value)} 
                    className="min-h-[60px] text-sm"
                  />
                  <Button className="w-full" variant="secondary" onClick={sendClipboardToPC} disabled={!clipboardText}>
                    <Copy className="h-4 w-4 mr-2" /> Send to PC Clipboard
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ==================== COMMAND TAB ==================== */}
            <TabsContent value="command" className="space-y-4">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Terminal className="h-5 w-5 text-primary" />
                    Command Center
                  </CardTitle>
                  <CardDescription>Type commands like "open chrome", "play lofi", "volume 50"</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Service Selector */}
                  <div className="flex gap-2 flex-wrap">
                    {(Object.keys(serviceConfig) as ServiceType[]).map((key) => (
                      <Button
                        key={key}
                        variant="outline"
                        size="sm"
                        className={cn(
                          "gap-1 border",
                          selectedService === key ? serviceConfig[key].color : "border-border/50"
                        )}
                        onClick={() => setSelectedService(key)}
                      >
                        {serviceConfig[key].icon}
                        {serviceConfig[key].label}
                      </Button>
                    ))}
                  </div>

                  {/* Command Input */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter command..."
                      value={cmdInput}
                      onChange={(e) => setCmdInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCmdSubmit()}
                      className="flex-1"
                    />
                    <Button onClick={handleCmdSubmit} className="gradient-primary" disabled={isProcessing}>
                      {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>

                  {/* Quick Examples */}
                  <div className="flex gap-2 flex-wrap">
                    {examples.map((ex) => (
                      <Badge
                        key={ex}
                        variant="secondary"
                        className="cursor-pointer hover:bg-primary/20"
                        onClick={() => setCmdInput(ex)}
                      >
                        {ex}
                      </Badge>
                    ))}
                  </div>

                  {/* Command History */}
                  {cmdHistory.length > 0 && (
                    <ScrollArea className="h-[200px] border rounded-lg p-3">
                      <div className="space-y-2">
                        {cmdHistory.map((result, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            {result.success ? (
                              <Check className="h-4 w-4 text-neon-green mt-0.5" />
                            ) : (
                              <X className="h-4 w-4 text-destructive mt-0.5" />
                            )}
                            <div>
                              <p className="font-mono text-xs text-muted-foreground">$ {result.command}</p>
                              <p className={cn("text-xs", result.success ? "text-neon-green" : "text-destructive")}>
                                {result.message}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </DashboardLayout>
  );
}
