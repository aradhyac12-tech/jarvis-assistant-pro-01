import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  Bot,
  Mic,
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
  Search,
  Zap,
  Music,
  Clipboard,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useP2PCommand } from "@/hooks/useP2PCommand";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { ZoomMeetings } from "@/components/ZoomMeetings";
import { BoostPC } from "@/components/BoostPC";
import { NotificationSyncMinimal } from "@/components/NotificationSyncMinimal";
import { CallControlsMinimal } from "@/components/CallControlsMinimal";
import { ClipboardSync } from "@/components/ClipboardSync";
import { MediaSyncPanel } from "@/components/MediaSyncPanel";
import { RemoteInputPanel } from "@/components/RemoteInputPanel";
import { GalaxyBudsManager } from "@/components/GalaxyBudsManager";
import { SmartP2PManager } from "@/components/SmartP2PManager";
import { BidirectionalFileTransfer } from "@/components/BidirectionalFileTransfer";

type Tab = "control" | "remote" | "media" | "tools";

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
  const { 
    connectionMode, 
    latency: p2pLatency, 
    isConnected: p2pConnected,
    autoP2P,
    autoLocalP2P,
    toggleAutoP2P,
    toggleAutoLocalP2P,
    forceP2PUpgrade,
    forceLocalP2P,
    networkState,
    localP2PState,
  } = useP2PCommand();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>("control");
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  
  // FIXED: Volume/Brightness synced from device on connection
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(75);
  const [isLocked, setIsLocked] = useState(false);
  
  const [cmdInput, setCmdInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const volumeCommitRef = useRef<number | null>(null);
  const brightnessCommitRef = useRef<number | null>(null);

  const isConnected = selectedDevice?.is_online || false;

  // Sync volume/brightness from device when it becomes available
  useEffect(() => {
    if (selectedDevice) {
      const deviceVol = selectedDevice.current_volume;
      const deviceBright = selectedDevice.current_brightness;
      
      if (typeof deviceVol === 'number' && deviceVol >= 0) {
        setVolume(deviceVol);
      }
      if (typeof deviceBright === 'number' && deviceBright >= 0) {
        setBrightness(deviceBright);
      }
      setIsLocked(selectedDevice.is_locked ?? false);
    }
  }, [selectedDevice?.id, selectedDevice?.current_volume, selectedDevice?.current_brightness, selectedDevice?.is_locked]);

  // Fetch real volume/brightness from PC on connect
  const syncSystemState = useCallback(async () => {
    if (!selectedDevice?.is_online) return;
    try {
      const result = await sendCommand("get_system_state", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result?.success && 'result' in result && result.result) {
        const state = result.result as { volume?: number; brightness?: number; is_locked?: boolean };
        if (typeof state.volume === 'number') setVolume(state.volume);
        if (typeof state.brightness === 'number') setBrightness(state.brightness);
        if (typeof state.is_locked === 'boolean') setIsLocked(state.is_locked);
      }
    } catch (e) {
      console.debug("System state sync:", e);
    }
  }, [selectedDevice?.is_online, sendCommand]);

  useEffect(() => {
    if (selectedDevice?.is_online) {
      syncSystemState();
    }
  }, [selectedDevice?.is_online, syncSystemState]);

  // Fetch system stats
  const fetchStats = useCallback(async () => {
    if (!selectedDevice?.is_online) return;
    try {
      const result = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result && "result" in result && result.result?.success) {
        setSystemStats(result.result as unknown as SystemStats);
      }
    } catch (e) {
      console.error("Failed to fetch stats:", e);
    }
  }, [selectedDevice?.is_online, sendCommand]);

  useEffect(() => {
    if (selectedDevice?.is_online) {
      fetchStats();
    }
  }, [selectedDevice?.is_online, fetchStats]);

  // Realtime device updates
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
        if (typeof d.current_volume === 'number') setVolume(d.current_volume);
        if (typeof d.current_brightness === 'number') setBrightness(d.current_brightness);
        if (typeof d.is_locked === 'boolean') setIsLocked(d.is_locked);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedDevice?.id]);

  // Volume handler with debounced commit and DB update
  const handleVolumeSlider = useCallback((v: number[]) => {
    setVolume(v[0]);
  }, []);

  const handleVolumeCommit = useCallback(async (v: number[]) => {
    if (volumeCommitRef.current !== null) {
      clearTimeout(volumeCommitRef.current);
    }
    volumeCommitRef.current = window.setTimeout(async () => {
      try {
        const result = await sendCommand("set_volume", { level: v[0] }, { awaitResult: true, timeoutMs: 3000 });
        if (result?.success && selectedDevice?.id) {
          await supabase.from("devices").update({ current_volume: v[0] }).eq("id", selectedDevice.id);
        }
      } catch (e) {
        console.error("Volume update failed:", e);
      }
      volumeCommitRef.current = null;
    }, 100);
  }, [sendCommand, selectedDevice?.id]);

  // Brightness handler with debounced commit and DB update
  const handleBrightnessSlider = useCallback((v: number[]) => {
    setBrightness(v[0]);
  }, []);

  const handleBrightnessCommit = useCallback(async (v: number[]) => {
    if (brightnessCommitRef.current !== null) {
      clearTimeout(brightnessCommitRef.current);
    }
    brightnessCommitRef.current = window.setTimeout(async () => {
      try {
        const result = await sendCommand("set_brightness", { level: v[0] }, { awaitResult: true, timeoutMs: 3000 });
        if (result?.success && selectedDevice?.id) {
          await supabase.from("devices").update({ current_brightness: v[0] }).eq("id", selectedDevice.id);
        }
      } catch (e) {
        console.error("Brightness update failed:", e);
      }
      brightnessCommitRef.current = null;
    }, 100);
  }, [sendCommand, selectedDevice?.id]);

  const handleLock = useCallback(async () => {
    setIsLocked(true);
    await sendCommand("lock", {});
    toast({ title: "PC Locked" });
  }, [sendCommand, toast]);

  const handlePower = useCallback(async (action: string) => {
    await sendCommand(action, {});
    toast({ title: `${action.charAt(0).toUpperCase() + action.slice(1)} initiated` });
  }, [sendCommand, toast]);

  // Command execution
  const handleCommand = async () => {
    if (!cmdInput.trim() || isProcessing) return;
    setIsProcessing(true);
    const lower = cmdInput.toLowerCase().trim();

    try {
      if (lower.startsWith("open ")) {
        const appName = lower.slice(5).trim();
        const result = await sendCommand("open_app", { app_name: appName }, { awaitResult: true, timeoutMs: 8000 });
        if (!result?.success) {
          toast({ title: "Failed to open app", description: result?.error as string || "App not found", variant: "destructive" });
        } else {
          toast({ title: "Opened", description: appName });
        }
      } else if (lower.startsWith("play ")) {
        const query = lower.slice(5).trim();
        await sendCommand("play_music", { query, service: "youtube" });
        toast({ title: "Playing", description: query });
      } else if (lower.startsWith("search ")) {
        await sendCommand("search_web", { query: lower.slice(7), engine: "google" });
        toast({ title: "Searching..." });
      } else {
        await sendCommand("search_web", { query: cmdInput, engine: "google" });
        toast({ title: "Searching..." });
      }
    } catch (e) {
      toast({ title: "Command failed", variant: "destructive" });
    }

    setCmdInput("");
    setIsProcessing(false);
  };

  const quickLinks = [
    { title: "Voice", icon: Mic, href: "/voice", color: "text-primary" },
    { title: "Files", icon: FolderOpen, href: "/files", color: "text-primary" },
    { title: "Camera", icon: Camera, href: "/miccamera", color: "text-primary" },
    { title: "Settings", icon: Settings, href: "/settings", color: "text-muted-foreground" },
  ];

  // Loading state
  if (isLoading && !selectedDevice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">Connecting to device...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between h-14 px-4 max-w-4xl mx-auto">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-semibold text-sm">JARVIS</h1>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">{selectedDevice?.name || "No device"}</p>
                  {connectionMode !== "disconnected" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {connectionMode === "p2p" ? "P2P" : "WS"} {p2pLatency}ms
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "gap-1.5 text-xs font-medium",
                  isConnected ? "border-primary/50 text-primary" : "border-muted text-muted-foreground"
                )}
              >
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  isConnected ? "bg-primary" : isReconnecting ? "bg-warning animate-pulse" : "bg-muted-foreground"
                )} />
                {isConnected ? "Online" : isReconnecting ? "Reconnecting" : "Offline"}
              </Badge>

              {systemStats && (
                <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground px-2">
                  <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> {systemStats.cpu_percent}%</span>
                  <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> {systemStats.memory_percent}%</span>
                  {systemStats.battery_percent !== undefined && (
                    <span className="flex items-center gap-1"><Battery className="w-3 h-3" /> {systemStats.battery_percent}%</span>
                  )}
                </div>
              )}

              <Button variant="ghost" size="icon" onClick={() => { refreshDevices(); fetchStats(); }} disabled={isLoading} className="h-8 w-8">
                <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </header>

        <ScrollArea className="h-[calc(100vh-3.5rem)]">
          <main className="max-w-4xl mx-auto p-4 space-y-4">
            {/* Command Input */}
            <Card className="border-border/40">
              <CardContent className="p-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Type a command... (open chrome, play music, search...)"
                    value={cmdInput}
                    onChange={(e) => setCmdInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCommand()}
                    className="flex-1 bg-muted/50 border-0 focus-visible:ring-1"
                    disabled={!isConnected}
                  />
                  <Button onClick={handleCommand} disabled={!isConnected || isProcessing} size="icon" className="shrink-0">
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Tab Navigation */}
            <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg w-fit">
              {[
                { id: "control" as Tab, label: "Control", icon: Monitor },
                { id: "remote" as Tab, label: "Remote", icon: Mouse },
                { id: "media" as Tab, label: "Media", icon: Music },
                { id: "tools" as Tab, label: "Tools", icon: Zap },
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

            {/* Control Tab */}
            {activeTab === "control" && (
              <div className="grid gap-4 md:grid-cols-2">
                {/* Volume & Brightness */}
                <Card className="border-border/40">
                  <CardContent className="p-4 space-y-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Volume2 className="w-4 h-4" /> Volume
                        </span>
                        <span className="font-medium tabular-nums">{volume}%</span>
                      </div>
                      <Slider
                        value={[volume]}
                        onValueChange={handleVolumeSlider}
                        onValueCommit={handleVolumeCommit}
                        max={100}
                        step={1}
                        disabled={!isConnected}
                        className="cursor-pointer"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Sun className="w-4 h-4" /> Brightness
                        </span>
                        <span className="font-medium tabular-nums">{brightness}%</span>
                      </div>
                      <Slider
                        value={[brightness]}
                        onValueChange={handleBrightnessSlider}
                        onValueCommit={handleBrightnessCommit}
                        max={100}
                        step={1}
                        disabled={!isConnected}
                        className="cursor-pointer"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Power & Lock */}
                <Card className="border-border/40">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-4 gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="icon" className="h-12 w-full" onClick={handleLock} disabled={!isConnected}>
                            <Lock className="w-5 h-5" />
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
                <Card className="border-border/40 md:col-span-2">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-4 gap-2">
                      {quickLinks.map((link) => (
                        <Link key={link.href} to={link.href}>
                          <Button variant="ghost" className="w-full h-auto flex-col gap-2 py-4 hover:bg-muted/50">
                            <link.icon className={cn("w-5 h-5", link.color)} />
                            <span className="text-xs">{link.title}</span>
                          </Button>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Remote Input on front page */}
                <RemoteInputPanel className="md:col-span-2" />
              </div>
            )}

            {/* Remote Tab */}
            {activeTab === "remote" && (
              <div className="grid gap-4 md:grid-cols-2">
                <RemoteInputPanel />
                <div className="space-y-4">
                  <SmartP2PManager
                    connectionMode={connectionMode}
                    latency={p2pLatency}
                    networkState={networkState}
                    localP2PState={localP2PState}
                    autoP2P={autoP2P}
                    autoLocalP2P={autoLocalP2P}
                    onToggleAutoP2P={toggleAutoP2P}
                    onToggleAutoLocalP2P={toggleAutoLocalP2P}
                    onForceUpgrade={forceP2PUpgrade}
                    onForceLocalP2P={forceLocalP2P}
                  />
                  <ClipboardSync />
                </div>
              </div>
            )}

            {/* Media Tab */}
            {activeTab === "media" && (
              <div className="grid gap-4 md:grid-cols-2">
                <MediaSyncPanel />
                <GalaxyBudsManager />
                <ZoomMeetings className="md:col-span-2" />
              </div>
            )}

            {/* Tools Tab */}
            {activeTab === "tools" && (
              <div className="grid gap-4 md:grid-cols-2">
                <NotificationSyncMinimal />
                <CallControlsMinimal />
                <GalaxyBudsManager />
                <BoostPC />
                <BidirectionalFileTransfer className="md:col-span-2" />
              </div>
            )}

            {/* No Device Warning */}
            {!isLoading && devices.length === 0 && (
              <Card className="border-border/40">
                <CardContent className="p-6 text-center">
                  <WifiOff className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <h3 className="font-medium mb-1">No PC Connected</h3>
                  <p className="text-sm text-muted-foreground mb-4">Run the Python agent on your PC</p>
                  <code className="block p-3 bg-muted rounded-lg text-xs font-mono text-left overflow-x-auto">
                    python jarvis_agent.py
                  </code>
                </CardContent>
              </Card>
            )}
          </main>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
