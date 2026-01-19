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
  Bot,
  Monitor,
  Music,
  Keyboard,
  Terminal,
  Wifi,
  WifiOff,
  Volume2,
  Sun,
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
  VolumeX,
  Disc3,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Mouse,
  Clipboard,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
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

type ServiceType = "web" | "youtube" | "chatgpt" | "perplexity";

const serviceConfig: Record<ServiceType, { label: string; icon: React.ReactNode; color: string }> = {
  web: { label: "Web", icon: <Globe className="h-3 w-3" />, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  youtube: { label: "YouTube", icon: <Music className="h-3 w-3" />, color: "bg-red-500/20 text-red-400 border-red-500/30" },
  chatgpt: { label: "ChatGPT", icon: <MessageSquare className="h-3 w-3" />, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  perplexity: { label: "Perplexity", icon: <Zap className="h-3 w-3" />, color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

export default function ControlHub() {
  const { devices, selectedDevice, isLoading: loading, refreshDevices } = useDeviceContext();
  const { deviceInfo, isReconnecting, session } = useDeviceSession();
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  // Dashboard state
  const [systemStats, setSystemStats] = useState<Record<string, unknown> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Command Center state
  const [cmdInput, setCmdInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<CommandResult[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceType>("web");

  // Media state
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
  const [isFetching, setIsFetching] = useState(false);
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
  const volume = selectedDevice?.current_volume || 0;
  const brightness = selectedDevice?.current_brightness || 0;

  // Fetch system stats
  const fetchSystemStats = useCallback(async () => {
    if (!selectedDevice?.is_online) return;
    
    setIsRefreshing(true);
    const result = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 5000 });
    if (result && 'result' in result && result.result?.success) {
      setSystemStats(result.result as Record<string, unknown>);
    }
    setIsRefreshing(false);
  }, [selectedDevice?.is_online, sendCommand]);

  // Fetch media state
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
        }
      }
    } catch (error) {
      console.error("Failed to fetch media state:", error);
    } finally {
      setIsFetching(false);
    }
  }, [selectedDevice, sendCommand, isFetching]);

  useEffect(() => {
    if (selectedDevice?.is_online) {
      fetchSystemStats();
      fetchMediaState();
    }
  }, [selectedDevice?.is_online, fetchSystemStats, fetchMediaState]);

  // Realtime device updates
  useEffect(() => {
    if (!selectedDevice?.id) return;

    const channel = supabase
      .channel(`device-status-${selectedDevice.id}`)
      .on(
        "postgres_changes",
        { 
          event: "UPDATE", 
          schema: "public", 
          table: "devices",
          filter: `id=eq.${selectedDevice.id}`
        },
        () => {
          addLog("info", "web", "Device status updated");
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

        // Brightness patterns
        const brightnessMatch = lower.match(/^(?:set\s+)?brightness\s+(?:to\s+)?(\d+)%?$/i);
        if (brightnessMatch) {
          const level = parseInt(brightnessMatch[1]);
          const result = await sendCommand("set_brightness", { level }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? `Brightness set to ${level}%` : result.error || "Failed");
          return;
        }

        // Media controls
        if (["pause", "play", "play/pause", "playpause"].includes(lower)) {
          const result = await sendCommand("media_control", { action: "play_pause" }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Toggled play/pause" : result.error || "Failed");
          return;
        }
        if (["next", "next track", "skip"].includes(lower)) {
          const result = await sendCommand("media_control", { action: "next" }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Skipped to next track" : result.error || "Failed");
          return;
        }
        if (["previous", "prev", "previous track"].includes(lower)) {
          const result = await sendCommand("media_control", { action: "previous" }, { awaitResult: true, timeoutMs: 4000 });
          addResult(result.success, result.success ? "Went to previous track" : result.error || "Failed");
          return;
        }

        // System commands
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
    [sendCommand]
  );

  const handleCmdSubmit = async () => {
    if (!cmdInput.trim() || isProcessing) return;
    setIsProcessing(true);
    await parseAndExecute(cmdInput.trim(), selectedService);
    setCmdInput("");
    setIsProcessing(false);
  };

  // ==================== MEDIA ====================
  const formatTime = (ms: number) => {
    if (!ms || ms <= 0) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handlePlayPause = async () => {
    await sendCommand("media_control", { action: "play_pause" });
    setTimeout(fetchMediaState, 300);
  };

  const handleNext = async () => {
    await sendCommand("media_control", { action: "next" });
    setTimeout(fetchMediaState, 500);
  };

  const handlePrevious = async () => {
    await sendCommand("media_control", { action: "previous" });
    setTimeout(fetchMediaState, 500);
  };

  const handleVolumeChange = async (newVolume: number[]) => {
    const vol = newVolume[0];
    await sendCommand("set_volume", { level: vol });
  };

  const handleMuteToggle = async () => {
    await sendCommand("media_control", { action: "mute" });
  };

  const handlePlaySearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    await sendCommand("play_music", { query: searchQuery, service: "youtube" });
    toast({ title: "Playing", description: searchQuery });
    setSearchQuery("");
    setIsSearching(false);
    setTimeout(fetchMediaState, 2000);
  };

  // ==================== REMOTE ====================
  const sendKeyboard = async () => {
    if (!textInput.trim()) return;
    setIsSending(true);
    await sendCommand("type_text", { text: textInput });
    toast({ title: "Text Sent", description: `Typed: ${textInput.slice(0, 30)}...` });
    setTextInput("");
    setIsSending(false);
  };

  const sendKey = async (key: string) => {
    setLastKey(key);
    if (key.includes("+")) {
      const keys = key.toLowerCase().split("+").map(k => k.trim());
      await sendCommand("key_combo", { keys });
    } else {
      await sendCommand("press_key", { key: key.toLowerCase() });
    }
    setTimeout(() => setLastKey(null), 200);
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
    const deltaX = (point.clientX - lastPosition.current.x) * 2.5;
    const deltaY = (point.clientY - lastPosition.current.y) * 2.5;
    
    lastPosition.current = { x: point.clientX, y: point.clientY };
    
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      sendCommand("mouse_move", { x: Math.round(deltaX), y: Math.round(deltaY), relative: true });
    }
  }, [sendCommand]);

  const handleMouseClick = async (button: string = "left") => {
    await sendCommand("mouse_click", { button, clicks: 1 });
  };

  const handleArrowMove = async (direction: "up" | "down" | "left" | "right") => {
    const moves: Record<string, { x: number; y: number }> = {
      up: { x: 0, y: -30 },
      down: { x: 0, y: 30 },
      left: { x: -30, y: 0 },
      right: { x: 30, y: 0 },
    };
    await sendCommand("mouse_move", { ...moves[direction], relative: true });
  };

  const sendClipboardToPC = async () => {
    if (!clipboardText.trim()) return;
    await sendCommand("set_clipboard", { content: clipboardText });
    toast({ title: "Clipboard Sent", description: "Text copied to PC clipboard" });
  };

  const quickKeys = [
    { label: "Enter", key: "enter" },
    { label: "Esc", key: "escape" },
    { label: "Tab", key: "tab" },
    { label: "Space", key: "space" },
    { label: "⌫", key: "backspace" },
    { label: "Ctrl+C", key: "ctrl+c" },
    { label: "Ctrl+V", key: "ctrl+v" },
    { label: "Alt+Tab", key: "alt+tab" },
  ];

  const examples = ["play Bohemian Rhapsody", "open chrome", "volume 50", "pause"];

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
              "glass-dark border-2 transition-all",
              isConnected ? "border-neon-green/50 bg-neon-green/5" : 
              isReconnecting ? "border-neon-orange/50 bg-neon-orange/5" : 
              "border-destructive/50 bg-destructive/5"
            )}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center",
                      isConnected ? "bg-neon-green/20" : 
                      isReconnecting ? "bg-neon-orange/20" : 
                      "bg-destructive/20"
                    )}>
                      {isReconnecting ? (
                        <Loader2 className="h-6 w-6 text-neon-orange animate-spin" />
                      ) : isConnected ? (
                        <Wifi className="h-6 w-6 text-neon-green" />
                      ) : (
                        <WifiOff className="h-6 w-6 text-destructive" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold">
                        {isReconnecting ? "Reconnecting..." : isConnected ? "PC Connected" : "PC Offline"}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {isConnected 
                          ? `Last seen: ${selectedDevice?.last_seen ? new Date(selectedDevice.last_seen).toLocaleTimeString() : 'Just now'}`
                          : "Run the Python agent on your PC"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right hidden md:block">
                      <p className="text-sm text-muted-foreground">Volume</p>
                      <p className="font-bold text-neon-blue">{volume}%</p>
                    </div>
                    <div className="text-right hidden md:block">
                      <p className="text-sm text-muted-foreground">Brightness</p>
                      <p className="font-bold text-neon-orange">{brightness}%</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "gap-2 px-4 py-2",
                        isConnected
                          ? "border-neon-green/50 text-neon-green bg-neon-green/10"
                          : "border-destructive/50 text-destructive bg-destructive/10"
                      )}
                    >
                      <span className={cn(
                        "w-2 h-2 rounded-full", 
                        isConnected ? "bg-neon-green animate-pulse" : "bg-destructive"
                      )} />
                      {isConnected ? "Online" : "Offline"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="commands" className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="commands" className="text-xs md:text-sm">
                <Terminal className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Commands</span>
              </TabsTrigger>
              <TabsTrigger value="media" className="text-xs md:text-sm">
                <Music className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Media</span>
              </TabsTrigger>
              <TabsTrigger value="remote" className="text-xs md:text-sm">
                <Keyboard className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Remote</span>
              </TabsTrigger>
              <TabsTrigger value="system" className="text-xs md:text-sm">
                <Monitor className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">System</span>
              </TabsTrigger>
            </TabsList>

            {/* Commands Tab */}
            <TabsContent value="commands">
              <Card className="glass-dark border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Terminal className="h-5 w-5 text-primary" />
                    Command Center
                    <Badge variant="secondary" className="text-[10px]">
                      <Sparkles className="h-3 w-3 mr-1" />
                      Natural Language
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Service Selector */}
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(serviceConfig) as ServiceType[]).map((svc) => (
                      <Badge
                        key={svc}
                        variant="outline"
                        className={cn(
                          "cursor-pointer transition-all flex items-center gap-1.5 px-3 py-1",
                          selectedService === svc
                            ? serviceConfig[svc].color + " border-2"
                            : "hover:bg-secondary/50"
                        )}
                        onClick={() => setSelectedService(svc)}
                      >
                        {serviceConfig[svc].icon}
                        {serviceConfig[svc].label}
                      </Badge>
                    ))}
                  </div>

                  {/* Input */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder={
                          selectedService === "youtube"
                            ? "Search and play on YouTube..."
                            : selectedService === "chatgpt"
                            ? "Ask ChatGPT anything..."
                            : "Type a command or search..."
                        }
                        value={cmdInput}
                        onChange={(e) => setCmdInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleCmdSubmit();
                          }
                        }}
                        className="pl-10"
                        disabled={isProcessing}
                      />
                    </div>
                    <Button
                      onClick={handleCmdSubmit}
                      disabled={!cmdInput.trim() || isProcessing}
                      className="gradient-primary"
                    >
                      {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>

                  {/* Quick examples */}
                  <div className="flex flex-wrap gap-2">
                    {examples.map((ex) => (
                      <Badge
                        key={ex}
                        variant="outline"
                        className="cursor-pointer hover:bg-primary/10 text-xs"
                        onClick={() => setCmdInput(ex)}
                      >
                        {ex}
                      </Badge>
                    ))}
                  </div>

                  {/* History */}
                  {cmdHistory.length > 0 && (
                    <div className="border-t border-border/30 pt-3">
                      <p className="text-xs text-muted-foreground mb-2">Recent commands</p>
                      <ScrollArea className="h-[150px]">
                        <div className="space-y-2">
                          {cmdHistory.map((item, i) => (
                            <div
                              key={i}
                              className={cn(
                                "flex items-start gap-2 p-2 rounded-lg text-sm",
                                item.success ? "bg-neon-green/5" : "bg-destructive/5"
                              )}
                            >
                              {item.success ? (
                                <Check className="h-4 w-4 text-neon-green shrink-0 mt-0.5" />
                              ) : (
                                <X className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{item.command}</p>
                                <p className="text-muted-foreground text-xs">{item.message}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Media Tab */}
            <TabsContent value="media">
              <Card className="glass-dark border-border/50">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Album Art */}
                    <div className="w-full md:w-48 aspect-square rounded-2xl gradient-primary flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                      <Disc3 className={cn("w-24 h-24 text-primary-foreground", mediaState.isPlaying && "animate-spin")} style={{ animationDuration: "3s" }} />
                      <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
                    </div>

                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        <h2 className="text-xl font-bold mb-1 truncate">{mediaState.title}</h2>
                        <p className="text-muted-foreground truncate">{mediaState.artist}</p>
                        <Badge variant={mediaState.isPlaying ? "default" : "secondary"} className="mt-2">
                          {mediaState.isPlaying ? "Playing" : "Paused"}
                        </Badge>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-2 my-4">
                        <Slider value={[mediaState.position]} max={100} step={1} className="cursor-pointer" />
                        <div className="flex justify-between text-sm text-muted-foreground">
                          <span>{formatTime(mediaState.positionMs)}</span>
                          <span>{formatTime(mediaState.durationMs)}</span>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="ghost" size="icon" onClick={handlePrevious}>
                          <SkipBack className="h-5 w-5" />
                        </Button>
                        <Button
                          size="icon"
                          className="h-12 w-12 rounded-full gradient-primary"
                          onClick={handlePlayPause}
                        >
                          {mediaState.isPlaying ? (
                            <Pause className="h-5 w-5 text-primary-foreground" />
                          ) : (
                            <Play className="h-5 w-5 text-primary-foreground ml-0.5" />
                          )}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={handleNext}>
                          <SkipForward className="h-5 w-5" />
                        </Button>
                      </div>

                      {/* Volume */}
                      <div className="flex items-center gap-3 mt-4">
                        <Button variant="ghost" size="icon" onClick={handleMuteToggle}>
                          {mediaState.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                        </Button>
                        <Slider
                          value={[mediaState.muted ? 0 : mediaState.volume]}
                          onValueCommit={handleVolumeChange}
                          max={100}
                          className="flex-1 cursor-pointer"
                        />
                        <span className="text-sm text-muted-foreground w-10">{mediaState.volume}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Search */}
                  <div className="border-t border-border/30 mt-6 pt-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Search and play a song..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handlePlaySearch()}
                        className="flex-1"
                      />
                      <Button onClick={handlePlaySearch} className="gradient-primary" disabled={isSearching}>
                        {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Remote Tab */}
            <TabsContent value="remote">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        className="min-h-[60px] text-sm"
                      />
                    </div>
                    <Button 
                      className="w-full gradient-primary" 
                      onClick={sendKeyboard} 
                      disabled={!textInput || isSending}
                    >
                      {isSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                      Send Text
                    </Button>
                    
                    <div className="border-t border-border/30 pt-3">
                      <p className="text-sm text-muted-foreground mb-2">Quick Keys</p>
                      <div className="grid grid-cols-4 gap-2">
                        {quickKeys.map((k) => (
                          <Button 
                            key={k.key} 
                            variant="secondary" 
                            size="sm" 
                            className={cn("text-xs", lastKey === k.label && "bg-neon-green/20")}
                            onClick={() => sendKey(k.key)}
                          >
                            {k.label}
                          </Button>
                        ))}
                      </div>
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
                      <p className="text-muted-foreground text-sm pointer-events-none">
                        Drag to move mouse
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" onClick={() => handleMouseClick("left")}>
                        Left Click
                      </Button>
                      <Button variant="secondary" onClick={() => handleMouseClick("right")}>
                        Right Click
                      </Button>
                    </div>

                    <div className="flex justify-center">
                      <div className="grid grid-cols-3 gap-1">
                        <div />
                        <Button variant="secondary" size="sm" onClick={() => handleArrowMove("up")}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <div />
                        <Button variant="secondary" size="sm" onClick={() => handleArrowMove("left")}>
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleMouseClick("left")}>
                          •
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleArrowMove("right")}>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                        <div />
                        <Button variant="secondary" size="sm" onClick={() => handleArrowMove("down")}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <div />
                      </div>
                    </div>

                    {/* Clipboard */}
                    <div className="border-t border-border/30 pt-3">
                      <p className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                        <Clipboard className="h-4 w-4" /> Clipboard
                      </p>
                      <div className="flex gap-2">
                        <Textarea
                          placeholder="Paste text to send to PC clipboard..."
                          value={clipboardText}
                          onChange={(e) => setClipboardText(e.target.value)}
                          className="min-h-[40px] text-sm"
                        />
                        <Button variant="secondary" onClick={sendClipboardToPC} disabled={!clipboardText.trim()}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* System Tab */}
            <TabsContent value="system">
              <div className="space-y-4">
                {/* System Stats */}
                {systemStats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card className="glass-dark border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Cpu className="h-4 w-4 text-neon-blue" />
                          <span className="text-sm font-medium">CPU</span>
                        </div>
                        <p className="text-2xl font-bold text-neon-blue">{systemStats.cpu_percent as number || 0}%</p>
                        <Progress value={systemStats.cpu_percent as number || 0} className="mt-2 h-1.5" />
                      </CardContent>
                    </Card>
                    
                    <Card className="glass-dark border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="h-4 w-4 text-neon-purple" />
                          <span className="text-sm font-medium">RAM</span>
                        </div>
                        <p className="text-2xl font-bold text-neon-purple">{systemStats.memory_percent as number || 0}%</p>
                        <p className="text-xs text-muted-foreground">
                          {systemStats.memory_used_gb as number || 0} / {systemStats.memory_total_gb as number || 0} GB
                        </p>
                      </CardContent>
                    </Card>
                    
                    <Card className="glass-dark border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <HardDrive className="h-4 w-4 text-neon-orange" />
                          <span className="text-sm font-medium">Disk</span>
                        </div>
                        <p className="text-2xl font-bold text-neon-orange">{systemStats.disk_percent as number || 0}%</p>
                        <p className="text-xs text-muted-foreground">
                          {systemStats.disk_used_gb as number || 0} / {systemStats.disk_total_gb as number || 0} GB
                        </p>
                      </CardContent>
                    </Card>
                    
                    <Card className="glass-dark border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Battery className="h-4 w-4 text-neon-green" />
                          <span className="text-sm font-medium">Battery</span>
                        </div>
                        <p className="text-2xl font-bold text-neon-green">
                          {systemStats.battery_percent !== null ? `${systemStats.battery_percent}%` : "N/A"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {systemStats.battery_plugged ? "⚡ Charging" : "On battery"}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Device Info */}
                {selectedDevice?.system_info && (
                  <Card className="glass-dark border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Monitor className="h-5 w-5 text-primary" />
                        Device Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-3 rounded-lg bg-secondary/30">
                          <p className="text-xs text-muted-foreground">OS</p>
                          <p className="font-medium text-sm">{(selectedDevice.system_info as Record<string, unknown>)?.os as string || "Unknown"}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-secondary/30">
                          <p className="text-xs text-muted-foreground">Hostname</p>
                          <p className="font-medium text-sm">{(selectedDevice.system_info as Record<string, unknown>)?.hostname as string || selectedDevice.name}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-secondary/30">
                          <p className="text-xs text-muted-foreground">CPU Cores</p>
                          <p className="font-medium text-sm">{(selectedDevice.system_info as Record<string, unknown>)?.cpu_count as number || "N/A"}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-secondary/30">
                          <p className="text-xs text-muted-foreground">RAM</p>
                          <p className="font-medium text-sm">{(selectedDevice.system_info as Record<string, unknown>)?.memory_total_gb as number || "N/A"} GB</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Quick Controls */}
                <Card className="glass-dark border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Quick Controls</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Button
                        variant="secondary"
                        className="h-auto py-4 flex-col gap-2"
                        onClick={() => sendCommand("lock", {})}
                      >
                        <Monitor className="h-6 w-6" />
                        <span className="text-xs">Lock</span>
                      </Button>
                      <Button
                        variant="secondary"
                        className="h-auto py-4 flex-col gap-2"
                        onClick={() => sendCommand("sleep", {})}
                      >
                        <Sun className="h-6 w-6" />
                        <span className="text-xs">Sleep</span>
                      </Button>
                      <Button
                        variant="secondary"
                        className="h-auto py-4 flex-col gap-2"
                        onClick={() => sendCommand("restart", {})}
                      >
                        <RefreshCw className="h-6 w-6" />
                        <span className="text-xs">Restart</span>
                      </Button>
                      <Button
                        variant="secondary"
                        className="h-auto py-4 flex-col gap-2 hover:bg-destructive/20 hover:text-destructive"
                        onClick={() => {
                          if (confirm("Are you sure you want to shut down your PC?")) {
                            sendCommand("shutdown", {});
                          }
                        }}
                      >
                        <Zap className="h-6 w-6" />
                        <span className="text-xs">Shutdown</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </DashboardLayout>
  );
}
