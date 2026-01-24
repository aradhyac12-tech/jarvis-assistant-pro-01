import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Bot,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Monitor,
  Wifi,
  WifiOff,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Power,
  Lock,
  RefreshCw,
  Send,
  Loader2,
  Cpu,
  HardDrive,
  Battery,
  Camera,
  FolderOpen,
  Settings,
  Keyboard,
  Mouse,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Search,
  ChevronRight,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useFastCommand } from "@/hooks/useFastCommand";
import { useOptimisticMedia } from "@/hooks/useOptimisticMedia";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

type Tab = "control" | "remote" | "media";

interface SystemStats {
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  battery_percent?: number;
  battery_plugged?: boolean;
}

export default function Hub() {
  const { devices, selectedDevice, isLoading, refreshDevices } = useDeviceContext();
  const { isReconnecting } = useDeviceSession();
  const { sendCommand } = useDeviceCommands();
  const { fireCommand, fireMouse, fireKey, fireScroll } = useFastCommand();
  const { toast } = useToast();

  const {
    mediaState,
    handlePlayPause,
    handleNext,
    handlePrevious,
    handleVolumeChange,
    handleVolumeCommit,
    fetchMediaState,
  } = useOptimisticMedia();

  const [activeTab, setActiveTab] = useState<Tab>("control");
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [volume, setVolume] = useState(selectedDevice?.current_volume ?? 50);
  const [brightness, setBrightness] = useState(selectedDevice?.current_brightness ?? 75);
  const [isLocked, setIsLocked] = useState(selectedDevice?.is_locked ?? false);
  const [cmdInput, setCmdInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const trackpadRef = useRef<HTMLDivElement>(null);
  const lastPosition = useRef({ x: 0, y: 0 });

  const isConnected = selectedDevice?.is_online || false;

  // Sync from device
  useEffect(() => {
    if (selectedDevice) {
      setVolume(selectedDevice.current_volume ?? 50);
      setBrightness(selectedDevice.current_brightness ?? 75);
      setIsLocked(selectedDevice.is_locked ?? false);
    }
  }, [selectedDevice]);

  // Fetch system stats
  const fetchStats = useCallback(async () => {
    if (!selectedDevice?.is_online) return;
    const result = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 5000 });
    if (result && "result" in result && result.result?.success) {
      setSystemStats(result.result as unknown as SystemStats);
    }
  }, [selectedDevice?.is_online, sendCommand]);

  useEffect(() => {
    if (selectedDevice?.is_online) {
      fetchStats();
      fetchMediaState();
    }
  }, [selectedDevice?.is_online, fetchStats, fetchMediaState]);

  // Realtime updates
  useEffect(() => {
    if (!selectedDevice?.id) return;
    const channel = supabase
      .channel(`hub-${selectedDevice.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "devices",
        filter: `id=eq.${selectedDevice.id}`,
      }, (payload) => {
        const d = payload.new as { current_volume?: number; current_brightness?: number; is_locked?: boolean };
        if (d.current_volume !== undefined) setVolume(d.current_volume);
        if (d.current_brightness !== undefined) setBrightness(d.current_brightness);
        if (d.is_locked !== undefined) setIsLocked(d.is_locked);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedDevice?.id]);

  // Handlers
  const handleVolumeSlider = useCallback(async (v: number[]) => {
    setVolume(v[0]);
  }, []);

  const handleVolumeSliderCommit = useCallback(async (v: number[]) => {
    await sendCommand("set_volume", { level: v[0] });
  }, [sendCommand]);

  const handleBrightnessSlider = useCallback(async (v: number[]) => {
    setBrightness(v[0]);
  }, []);

  const handleBrightnessCommit = useCallback(async (v: number[]) => {
    await sendCommand("set_brightness", { level: v[0] });
  }, [sendCommand]);

  const handleLock = useCallback(async () => {
    setIsLocked(true);
    await sendCommand("lock", {});
    toast({ title: "PC Locked" });
  }, [sendCommand, toast]);

  const handlePower = useCallback(async (action: string) => {
    await sendCommand(action, {});
    toast({ title: `${action.charAt(0).toUpperCase() + action.slice(1)} initiated` });
  }, [sendCommand, toast]);

  const handleCommand = async () => {
    if (!cmdInput.trim() || isProcessing) return;
    setIsProcessing(true);
    const lower = cmdInput.toLowerCase().trim();

    // Simple command parsing
    if (lower.startsWith("open ")) {
      await sendCommand("open_app", { app_name: lower.slice(5) });
    } else if (lower.startsWith("play ")) {
      await sendCommand("play_music", { query: lower.slice(5), service: "youtube" });
    } else if (lower.startsWith("search ")) {
      await sendCommand("search_web", { query: lower.slice(7), engine: "google" });
    } else {
      await sendCommand("search_web", { query: cmdInput, engine: "google" });
    }

    setCmdInput("");
    setIsProcessing(false);
    toast({ title: "Command sent" });
  };

  const handlePlayMusic = async () => {
    if (!searchQuery.trim()) return;
    await sendCommand("play_music", { query: searchQuery, service: "youtube" });
    toast({ title: "Playing", description: searchQuery });
    setSearchQuery("");
    setTimeout(fetchMediaState, 2000);
  };

  // Remote handlers
  const sendText = () => {
    if (!textInput.trim()) return;
    fireCommand("type_text", { text: textInput });
    setTextInput("");
    toast({ title: "Text sent" });
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
    const sensitivity = 3;
    const deltaX = (point.clientX - lastPosition.current.x) * sensitivity;
    const deltaY = (point.clientY - lastPosition.current.y) * sensitivity;
    lastPosition.current = { x: point.clientX, y: point.clientY };
    if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
      fireMouse(deltaX, deltaY);
    }
  }, [fireMouse]);

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

  const quickLinks = [
    { title: "Voice AI", icon: Mic, href: "/voice", color: "text-accent-green" },
    { title: "Files", icon: FolderOpen, href: "/files", color: "text-accent-orange" },
    { title: "Camera", icon: Camera, href: "/miccamera", color: "text-accent-pink" },
    { title: "Settings", icon: Settings, href: "/settings", color: "text-muted-foreground" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Compact Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between h-14 px-4 max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="hidden sm:block">
              <h1 className="font-semibold text-sm">JARVIS</h1>
              <p className="text-xs text-muted-foreground">
                {selectedDevice?.name || "No device"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Connection Status */}
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5 text-xs",
                isConnected ? "status-online" : isReconnecting ? "status-warning" : "status-offline"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-success pulse-live" : isReconnecting ? "bg-warning" : "bg-destructive")} />
              {isConnected ? "Online" : isReconnecting ? "Reconnecting" : "Offline"}
            </Badge>

            {/* Quick Stats */}
            {systemStats && (
              <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3" /> {systemStats.cpu_percent}%
                </span>
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" /> {systemStats.memory_percent}%
                </span>
                {systemStats.battery_percent !== undefined && (
                  <span className="flex items-center gap-1">
                    <Battery className="w-3 h-3" /> {systemStats.battery_percent}%
                  </span>
                )}
              </div>
            )}

            <Button variant="ghost" size="icon" onClick={() => { refreshDevices(); fetchStats(); }} disabled={isLoading}>
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </header>

      <ScrollArea className="h-[calc(100vh-3.5rem)]">
        <main className="max-w-5xl mx-auto p-4 space-y-4 animate-fade-in">
          {/* Command Input */}
          <Card className="card-clean overflow-hidden">
            <CardContent className="p-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Type a command... (open chrome, play music, search...)"
                  value={cmdInput}
                  onChange={(e) => setCmdInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCommand()}
                  className="flex-1 bg-secondary/50 border-0"
                  disabled={!isConnected}
                />
                <Button onClick={handleCommand} disabled={!isConnected || isProcessing} size="icon">
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 p-1 bg-secondary/30 rounded-lg w-fit">
            {[
              { id: "control" as Tab, label: "Control", icon: Monitor },
              { id: "remote" as Tab, label: "Remote", icon: Mouse },
              { id: "media" as Tab, label: "Media", icon: Play },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
                  activeTab === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="animate-fade-in">
            {/* Control Tab */}
            {activeTab === "control" && (
              <div className="grid gap-4 md:grid-cols-2">
                {/* Volume & Brightness */}
                <Card className="card-clean">
                  <CardContent className="p-4 space-y-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Volume2 className="w-4 h-4" /> Volume
                        </span>
                        <span className="font-medium">{volume}%</span>
                      </div>
                      <Slider
                        value={[volume]}
                        onValueChange={handleVolumeSlider}
                        onValueCommit={handleVolumeSliderCommit}
                        max={100}
                        step={1}
                        disabled={!isConnected}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Sun className="w-4 h-4" /> Brightness
                        </span>
                        <span className="font-medium">{brightness}%</span>
                      </div>
                      <Slider
                        value={[brightness]}
                        onValueChange={handleBrightnessSlider}
                        onValueCommit={handleBrightnessCommit}
                        max={100}
                        step={1}
                        disabled={!isConnected}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Power & Lock */}
                <Card className="card-clean">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-4 gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="icon" className="h-12 w-full" onClick={handleLock} disabled={!isConnected}>
                            {isLocked ? <Lock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Lock PC</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="icon" className="h-12 w-full" onClick={() => handlePower("sleep")} disabled={!isConnected}>
                            <Moon className="w-5 h-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Sleep</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="icon" className="h-12 w-full" onClick={() => handlePower("restart")} disabled={!isConnected}>
                            <RefreshCw className="w-5 h-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Restart</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="icon" className="h-12 w-full text-destructive hover:text-destructive" onClick={() => handlePower("shutdown")} disabled={!isConnected}>
                            <Power className="w-5 h-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Shutdown</TooltipContent>
                      </Tooltip>
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Links */}
                <Card className="card-clean md:col-span-2">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-4 gap-2">
                      {quickLinks.map((link) => (
                        <Link key={link.href} to={link.href}>
                          <Button variant="ghost" className="w-full h-auto flex-col gap-2 py-4 hover:bg-secondary/50">
                            <link.icon className={cn("w-5 h-5", link.color)} />
                            <span className="text-xs">{link.title}</span>
                          </Button>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Remote Tab */}
            {activeTab === "remote" && (
              <div className="grid gap-4 md:grid-cols-2">
                {/* Trackpad */}
                <Card className="card-clean">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-2">Touch/drag to move mouse</p>
                    <div
                      ref={trackpadRef}
                      className="aspect-[4/3] bg-secondary/30 rounded-lg border border-dashed border-border cursor-crosshair flex items-center justify-center select-none"
                      onMouseDown={handleTrackpadStart}
                      onMouseMove={handleTrackpadMove}
                      onTouchStart={handleTrackpadStart}
                      onTouchMove={handleTrackpadMove}
                    >
                      <Mouse className="w-8 h-8 text-muted-foreground/30" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <Button variant="secondary" onClick={() => fireCommand("mouse_click", { button: "left" })}>
                        Left Click
                      </Button>
                      <Button variant="secondary" onClick={() => fireCommand("mouse_click", { button: "right" })}>
                        Right Click
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Keyboard */}
                <Card className="card-clean">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type text to send..."
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendText()}
                        className="flex-1"
                        disabled={!isConnected}
                      />
                      <Button onClick={sendText} disabled={!isConnected}>
                        <Keyboard className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      {quickKeys.map((k) => (
                        <Button
                          key={k.key}
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => fireKey(k.key)}
                          disabled={!isConnected}
                        >
                          {k.label}
                        </Button>
                      ))}
                    </div>

                    {/* Arrow Keys */}
                    <div className="flex justify-center">
                      <div className="grid grid-cols-3 gap-1 w-fit">
                        <div />
                        <Button variant="outline" size="icon" onClick={() => fireKey("up")} disabled={!isConnected}>
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <div />
                        <Button variant="outline" size="icon" onClick={() => fireKey("left")} disabled={!isConnected}>
                          <ArrowLeft className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => fireKey("down")} disabled={!isConnected}>
                          <ArrowDown className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => fireKey("right")} disabled={!isConnected}>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Media Tab */}
            {activeTab === "media" && (
              <div className="grid gap-4 md:grid-cols-2">
                {/* Now Playing */}
                <Card className="card-clean">
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-lg bg-secondary flex items-center justify-center">
                        <Zap className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{mediaState.title || "Not Playing"}</p>
                        <p className="text-sm text-muted-foreground truncate">{mediaState.artist || "Unknown"}</p>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center justify-center gap-3">
                      <Button variant="ghost" size="icon" onClick={handlePrevious} disabled={!isConnected}>
                        <SkipBack className="w-5 h-5" />
                      </Button>
                      <Button size="icon" className="w-12 h-12 rounded-full" onClick={handlePlayPause} disabled={!isConnected}>
                        {mediaState.isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={handleNext} disabled={!isConnected}>
                        <SkipForward className="w-5 h-5" />
                      </Button>
                    </div>

                    {/* Volume */}
                    <div className="flex items-center gap-3">
                      <Volume2 className="w-4 h-4 text-muted-foreground" />
                      <Slider
                        value={[mediaState.volume]}
                        onValueChange={(v) => handleVolumeChange(v[0])}
                        onValueCommit={(v) => handleVolumeCommit(v[0])}
                        max={100}
                        step={1}
                        className="flex-1"
                        disabled={!isConnected}
                      />
                      <span className="text-sm text-muted-foreground w-8">{mediaState.volume}%</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Search & Play */}
                <Card className="card-clean">
                  <CardContent className="p-4 space-y-3">
                    <p className="text-sm font-medium">Play on YouTube</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Song, artist, or URL..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handlePlayMusic()}
                        className="flex-1"
                        disabled={!isConnected}
                      />
                      <Button onClick={handlePlayMusic} disabled={!isConnected || !searchQuery.trim()}>
                        <Play className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["lofi beats", "trending music", "chill vibes"].map((q) => (
                        <Button
                          key={q}
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => {
                            setSearchQuery(q);
                            setTimeout(handlePlayMusic, 100);
                          }}
                          disabled={!isConnected}
                        >
                          {q}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {/* No Device Warning */}
          {!isLoading && devices.length === 0 && (
            <Card className="card-clean border-warning/30 bg-warning/5">
              <CardContent className="p-6 text-center">
                <WifiOff className="w-10 h-10 text-warning mx-auto mb-3" />
                <h3 className="font-medium mb-1">No PC Connected</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Run the Python agent on your PC to get started
                </p>
                <code className="block p-3 bg-secondary/50 rounded-lg text-xs font-mono text-left overflow-x-auto">
                  python jarvis_agent.py
                </code>
              </CardContent>
            </Card>
          )}
        </main>
      </ScrollArea>
    </div>
  );
}
