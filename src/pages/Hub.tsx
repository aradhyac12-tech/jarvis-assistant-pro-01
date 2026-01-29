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
  Sun,
  Monitor,
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
  Mouse,
  Zap,
  Music,
  Moon,
  Wifi,
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
  
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(75);
  const [isLocked, setIsLocked] = useState(false);
  
  const [cmdInput, setCmdInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const volumeCommitRef = useRef<number | null>(null);
  const brightnessCommitRef = useRef<number | null>(null);

  const isConnected = selectedDevice?.is_online || false;

  // Sync volume/brightness from device
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

  // Fetch real volume/brightness from PC
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

  // Volume handler
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

  // Brightness handler
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
    } catch {
      toast({ title: "Command failed", variant: "destructive" });
    }

    setCmdInput("");
    setIsProcessing(false);
  };

  const quickLinks = [
    { title: "Voice", icon: Mic, href: "/voice" },
    { title: "Files", icon: FolderOpen, href: "/files" },
    { title: "Camera", icon: Camera, href: "/miccamera" },
    { title: "Settings", icon: Settings, href: "/settings" },
  ];

  const tabs = [
    { id: "control" as Tab, label: "Control", icon: Monitor },
    { id: "remote" as Tab, label: "Remote", icon: Mouse },
    { id: "media" as Tab, label: "Media", icon: Music },
    { id: "tools" as Tab, label: "Tools", icon: Zap },
  ];

  // Loading state
  if (isLoading && !selectedDevice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground">Connecting...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* Header - Ultra Minimal */}
        <header className="sticky top-0 z-50 border-b border-border/20 bg-background/80 backdrop-blur-xl">
          <div className="flex items-center justify-between h-12 px-4 max-w-3xl mx-auto">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm tracking-tight">JARVIS</span>
                {connectionMode !== "disconnected" && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono border-border/30">
                    {p2pLatency}ms
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* System Stats - Compact */}
              {systemStats && (
                <div className="hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                  <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />{systemStats.cpu_percent}%</span>
                  <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{systemStats.memory_percent}%</span>
                  {systemStats.battery_percent !== undefined && (
                    <span className="flex items-center gap-1"><Battery className="w-3 h-3" />{systemStats.battery_percent}%</span>
                  )}
                </div>
              )}

              {/* Status Badge */}
              <div className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium",
                isConnected ? "text-[hsl(var(--success))]" : "text-muted-foreground"
              )}>
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  isConnected ? "bg-[hsl(var(--success))]" : isReconnecting ? "bg-[hsl(var(--warning))] animate-pulse" : "bg-muted-foreground"
                )} />
                {isConnected ? "Online" : isReconnecting ? "..." : "Offline"}
              </div>

              <Button variant="ghost" size="icon" onClick={() => { refreshDevices(); fetchStats(); }} disabled={isLoading} className="h-7 w-7">
                <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </header>

        <ScrollArea className="h-[calc(100vh-3rem)]">
          <main className="max-w-3xl mx-auto p-3 space-y-3">
            {/* Command Input - Minimal */}
            <div className="flex gap-2">
              <Input
                placeholder="Type a command..."
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCommand()}
                className="flex-1 h-9 bg-card border-border/30 focus-visible:ring-1 text-sm"
                disabled={!isConnected}
              />
              <Button onClick={handleCommand} disabled={!isConnected || isProcessing} size="icon" className="h-9 w-9 shrink-0">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>

            {/* Tab Navigation - Pill Style */}
            <div className="flex items-center gap-0.5 p-0.5 bg-card/50 rounded-lg w-fit border border-border/20">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                    activeTab === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Control Tab */}
            {activeTab === "control" && (
              <div className="grid gap-3 md:grid-cols-2">
                {/* Volume & Brightness - Combined */}
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-3 space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Volume2 className="w-3.5 h-3.5" /> Volume
                        </span>
                        <span className="font-mono text-muted-foreground">{volume}%</span>
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

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Sun className="w-3.5 h-3.5" /> Brightness
                        </span>
                        <span className="font-mono text-muted-foreground">{brightness}%</span>
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

                {/* Power Controls */}
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-3">
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { icon: Lock, action: handleLock, label: "Lock" },
                        { icon: Moon, action: () => handlePower("sleep"), label: "Sleep" },
                        { icon: RefreshCw, action: () => handlePower("restart"), label: "Restart" },
                        { icon: Power, action: () => handlePower("shutdown"), label: "Shutdown", danger: true },
                      ].map((btn) => (
                        <Tooltip key={btn.label}>
                          <TooltipTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="icon" 
                              className={cn(
                                "h-10 w-full border-border/20",
                                btn.danger && "text-destructive hover:text-destructive hover:border-destructive/30"
                              )}
                              onClick={btn.action} 
                              disabled={!isConnected}
                            >
                              <btn.icon className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="text-xs">{btn.label}</TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Links */}
                <Card className="border-border/20 bg-card/50 md:col-span-2">
                  <CardContent className="p-3">
                    <div className="grid grid-cols-4 gap-2">
                      {quickLinks.map((link) => (
                        <Link key={link.href} to={link.href}>
                          <Button variant="ghost" className="w-full h-auto flex-col gap-1.5 py-3 hover:bg-secondary/50 border border-transparent hover:border-border/20">
                            <link.icon className="w-4 h-4 text-primary" />
                            <span className="text-[10px] text-muted-foreground">{link.title}</span>
                          </Button>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Remote Input Preview */}
                <RemoteInputPanel className="md:col-span-2" />
              </div>
            )}

            {/* Remote Tab */}
            {activeTab === "remote" && (
              <div className="grid gap-3 md:grid-cols-2">
                <RemoteInputPanel />
                <div className="space-y-3">
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
              <div className="grid gap-3 md:grid-cols-2">
                <MediaSyncPanel />
                <GalaxyBudsManager />
                <ZoomMeetings className="md:col-span-2" />
              </div>
            )}

            {/* Tools Tab */}
            {activeTab === "tools" && (
              <div className="grid gap-3 md:grid-cols-2">
                <NotificationSyncMinimal />
                <CallControlsMinimal />
                <GalaxyBudsManager />
                <BoostPC />
                <BidirectionalFileTransfer className="md:col-span-2" />
              </div>
            )}

            {/* No Device Warning */}
            {!isLoading && devices.length === 0 && (
              <Card className="border-border/20 bg-card/50">
                <CardContent className="p-6 text-center">
                  <Wifi className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <h3 className="font-medium text-sm mb-1">No PC Connected</h3>
                  <p className="text-xs text-muted-foreground mb-3">Run the Python agent on your PC</p>
                  <code className="block p-2 bg-secondary/50 rounded-md text-[10px] font-mono">
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
