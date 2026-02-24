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
  Volume2,
  Volume1,
  VolumeX,
  Sun,
  Monitor,
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
  Wrench,
  AppWindow,
  Search,
  XCircle,
  RotateCcw,
  Activity,
  Video,
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
import { SmartP2PManager } from "@/components/SmartP2PManager";
import { BidirectionalFileTransfer } from "@/components/BidirectionalFileTransfer";
import { KDERemoteInput } from "@/components/KDERemoteInput";
import { AutoClipboardSync } from "@/components/AutoClipboardSync";
import { KDEMediaControl } from "@/components/KDEMediaControl";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

type Tab = "control" | "remote" | "media" | "apps" | "zoom" | "network" | "settings";

interface SystemStats {
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  battery_percent?: number;
  battery_plugged?: boolean;
}




interface AppInfo {
  pid?: number;
  name: string;
  cpu?: number;
  memory?: number;
  memory_mb?: number;
  status?: string;
  app_id?: string;
  source?: string;
}

export default function Hub() {
  const haptic = useHapticFeedback();
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
    inputSessionId,
    fireMouse,
    fireKey,
    fireScroll,
    fireZoom,
    fireClick,
    fireGesture3Finger,
    fireGesture4Finger,
  } = useP2PCommand();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = localStorage.getItem("hub_active_tab");
    return (saved as Tab) || "control";
  });
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(75);
  const [isLocked, setIsLocked] = useState(false);
  
  const [cmdInput, setCmdInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);

  // Media state
  const [isMuted, setIsMuted] = useState(false);

  // Apps state
  const [runningApps, setRunningApps] = useState<AppInfo[]>([]);
  const [installedApps, setInstalledApps] = useState<AppInfo[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appSearch, setAppSearch] = useState("");
  const [appView, setAppView] = useState<"running" | "installed" | "services">("running");
  const [services, setServices] = useState<Array<{ name: string; display_name: string; status: string; start_type: string; pid: number | null }>>([]); 
  const [selectedApp, setSelectedApp] = useState<AppInfo | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const volumeCommitRef = useRef<number | null>(null);
  const brightnessCommitRef = useRef<number | null>(null);

  const isConnected = selectedDevice?.is_online || false;

  // Force dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Persist active tab
  useEffect(() => {
    localStorage.setItem("hub_active_tab", activeTab);
  }, [activeTab]);

  const getConnectionStatus = useCallback(() => {
    if (!selectedDevice) return { text: "No Device", color: "text-muted-foreground", dot: "bg-muted-foreground" };
    if (!isConnected) return { text: "Offline", color: "text-muted-foreground", dot: "bg-muted-foreground" };
    if (isReconnecting) return { text: "Reconnecting", color: "text-amber-400", dot: "bg-amber-400 animate-pulse" };
    
    switch (connectionMode) {
      case "local_p2p":
        return { text: `Local ${p2pLatency}ms`, color: "text-emerald-400", dot: "bg-emerald-400" };
      case "p2p":
        return { text: `P2P ${p2pLatency}ms`, color: "text-green-400", dot: "bg-green-400" };
      case "websocket":
        return { text: `WS ${p2pLatency}ms`, color: "text-blue-400", dot: "bg-blue-400" };
      case "fallback":
        return { text: "Cloud", color: "text-yellow-400", dot: "bg-yellow-400" };
      default:
        return { text: "Connecting", color: "text-muted-foreground", dot: "bg-muted-foreground animate-pulse" };
    }
  }, [selectedDevice, isConnected, isReconnecting, connectionMode, p2pLatency]);

  const status = getConnectionStatus();

  // Sync volume/brightness from device
  useEffect(() => {
    if (selectedDevice) {
      const deviceVol = selectedDevice.current_volume;
      const deviceBright = selectedDevice.current_brightness;
      if (typeof deviceVol === 'number' && deviceVol >= 0) setVolume(deviceVol);
      if (typeof deviceBright === 'number' && deviceBright >= 0) setBrightness(deviceBright);
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
    if (selectedDevice?.is_online) fetchStats();
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
    haptic.scroll();
  }, [haptic]);

  const handleVolumeCommit = useCallback(async (v: number[]) => {
    if (volumeCommitRef.current !== null) clearTimeout(volumeCommitRef.current);
    volumeCommitRef.current = window.setTimeout(async () => {
      try {
        await sendCommand("set_volume", { level: v[0] }, { awaitResult: true, timeoutMs: 5000 });
        if (selectedDevice?.id) {
          await supabase.from("devices").update({ current_volume: v[0] }).eq("id", selectedDevice.id);
        }
      } catch (e) {
        console.error("Volume update failed:", e);
      }
      volumeCommitRef.current = null;
    }, 150);
  }, [sendCommand, selectedDevice?.id]);

  const handleBrightnessSlider = useCallback((v: number[]) => {
    setBrightness(v[0]);
    haptic.scroll();
  }, [haptic]);

  const handleBrightnessCommit = useCallback(async (v: number[]) => {
    if (brightnessCommitRef.current !== null) clearTimeout(brightnessCommitRef.current);
    brightnessCommitRef.current = window.setTimeout(async () => {
      try {
        await sendCommand("set_brightness", { level: v[0] }, { awaitResult: true, timeoutMs: 5000 });
        if (selectedDevice?.id) {
          await supabase.from("devices").update({ current_brightness: v[0] }).eq("id", selectedDevice.id);
        }
      } catch (e) {
        console.error("Brightness update failed:", e);
      }
      brightnessCommitRef.current = null;
    }, 150);
  }, [sendCommand, selectedDevice?.id]);

  const handleLock = useCallback(async () => {
    setIsLocked(true);
    sendCommand("lock", {});
    toast({ title: "PC Locked" });
  }, [sendCommand, toast]);

  const handlePower = useCallback(async (action: string) => {
    sendCommand(action, {});
    toast({ title: `${action.charAt(0).toUpperCase() + action.slice(1)} initiated` });
  }, [sendCommand, toast]);

  const handleQuickBoost = useCallback(async () => {
    if (!isConnected || isBoosting) return;
    setIsBoosting(true);
    try {
      toast({ title: "Boost started" });
      await sendCommand("boost_ram", {}, { awaitResult: true, timeoutMs: 30000 });
      await sendCommand("clear_temp_files", {}, { awaitResult: true, timeoutMs: 60000 });
      await sendCommand("set_power_plan", { plan: "high_performance" }, { awaitResult: true, timeoutMs: 15000 });
      toast({ title: "Boost complete" });
    } catch {
      toast({ title: "Boost failed", variant: "destructive" });
    } finally {
      setIsBoosting(false);
    }
  }, [isBoosting, isConnected, sendCommand, toast]);

  // Remote input session
  useEffect(() => {
    if (!isConnected || activeTab !== "remote") return;
    let timer: number | null = null;
    const enable = () => {
      sendCommand("remote_input_enable", { session: inputSessionId, ttl_ms: 12000 });
    };
    enable();
    timer = window.setInterval(enable, 5000);
    return () => {
      if (timer) window.clearInterval(timer);
      sendCommand("remote_input_disable", { session: inputSessionId });
    };
  }, [activeTab, inputSessionId, isConnected, sendCommand]);

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    sendCommand(newMuted ? "mute_pc" : "unmute_pc", {});
  };

  // Apps fetching
  const fetchRunningApps = useCallback(async () => {
    setAppsLoading(true);
    try {
      const result = await sendCommand("get_running_apps", {}, { awaitResult: true, timeoutMs: 10000 });
      if (result.success && "result" in result) {
        const data = result.result as { apps?: AppInfo[] };
        setRunningApps(data?.apps || []);
      }
    } catch {}
    setAppsLoading(false);
  }, [sendCommand]);

  const fetchInstalledApps = useCallback(async () => {
    setAppsLoading(true);
    try {
      const result = await sendCommand("get_installed_apps", {}, { awaitResult: true, timeoutMs: 15000 });
      if (result.success && "result" in result) {
        const data = result.result as { apps?: AppInfo[] };
        setInstalledApps(data?.apps || []);
      }
    } catch {}
    setAppsLoading(false);
  }, [sendCommand]);

  const fetchServices = useCallback(async () => {
    setAppsLoading(true);
    try {
      const result = await sendCommand("get_services", {}, { awaitResult: true, timeoutMs: 15000 });
      if (result.success && "result" in result) {
        const data = result.result as { services?: any[] };
        setServices(data?.services || []);
      }
    } catch {}
    setAppsLoading(false);
  }, [sendCommand]);

  useEffect(() => {
    if (activeTab === "apps" && isConnected) {
      fetchRunningApps();
      fetchInstalledApps();
      fetchServices();
    }
  }, [activeTab, isConnected, fetchRunningApps, fetchInstalledApps, fetchServices]);

  const handleOpenApp = useCallback(async (appName: string) => {
    try {
      const result = await sendCommand("open_app", { app_name: appName }, { awaitResult: true, timeoutMs: 8000 });
      if (result?.success) {
        toast({ title: "Opened", description: appName });
        setTimeout(fetchRunningApps, 2000);
      } else {
        toast({ title: "Failed", description: (result?.error as string) || "Could not open app", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error opening app", variant: "destructive" });
    }
  }, [sendCommand, toast, fetchRunningApps]);

  const handleCloseApp = useCallback(async (appName: string, pid?: number) => {
    try {
      const result = await sendCommand("kill_app", { app_name: appName, pid }, { awaitResult: true, timeoutMs: 5000 });
      if (result?.success) {
        toast({ title: "Closed", description: appName });
        setTimeout(fetchRunningApps, 1000);
      } else {
        toast({ title: "Failed to close", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }, [sendCommand, toast, fetchRunningApps]);

  const handleRestartApp = useCallback(async (appName: string, pid?: number) => {
    await handleCloseApp(appName, pid);
    setTimeout(() => handleOpenApp(appName), 1500);
  }, [handleCloseApp, handleOpenApp]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

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
        let query = lower.slice(5).trim();
        let service = "youtube";
        const onMatch = query.match(/(.+?)\s+on\s+(spotify|youtube|yt)$/i);
        if (onMatch) {
          query = onMatch[1].trim();
          service = onMatch[2].toLowerCase() === "yt" ? "youtube" : onMatch[2].toLowerCase();
        }
        await sendCommand("play_music", { query, service, auto_play: true }, { awaitResult: true, timeoutMs: 15000 });
        toast({ title: "Playing", description: `${query} on ${service}` });
      } else if (lower.startsWith("search ")) {
        let query = lower.slice(7).trim();
        let engine = "google";
        const engineMatch = query.match(/(.+?)\s+(?:on|with)\s+(chatgpt|perplexity|gemini|google|bing|wikipedia|wiki|duckduckgo)$/i);
        if (engineMatch) {
          query = engineMatch[1].trim();
          engine = engineMatch[2].toLowerCase();
          if (engine === "wiki") engine = "wikipedia";
        }
        await sendCommand("search_web", { query, engine, auto_enter: true }, { awaitResult: true, timeoutMs: 15000 });
        toast({ title: "Searching", description: `${query} on ${engine}` });
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

  const handleTypeText = useCallback((text: string) => {
    sendCommand("type_text", { text });
    toast({ title: "Text sent" });
  }, [sendCommand, toast]);

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  const quickLinks = [
    { title: "AI", icon: Bot, href: "/voice" },
    { title: "Files", icon: FolderOpen, href: "/files" },
    { title: "Camera", icon: Camera, href: "/miccamera" },
  ];

  const tabs = [
    { id: "control" as Tab, label: "Control", icon: Monitor },
    { id: "remote" as Tab, label: "Remote", icon: Mouse },
    { id: "media" as Tab, label: "Media", icon: Music },
    { id: "apps" as Tab, label: "Apps", icon: AppWindow },
    { id: "zoom" as Tab, label: "Zoom", icon: Video },
    { id: "network" as Tab, label: "Network", icon: Wifi },
    { id: "settings" as Tab, label: "Settings", icon: Settings },
  ];

  // Filter apps by search
  const filteredRunning = runningApps
    .filter(a => a.name.toLowerCase().includes(appSearch.toLowerCase()))
    .sort((a, b) => ((b.cpu || 0) + (b.memory || 0)) - ((a.cpu || 0) + (a.memory || 0)));
  const filteredInstalled = installedApps.filter(a => a.name.toLowerCase().includes(appSearch.toLowerCase()));

  // Long-press handlers for app context menu
  const handleAppLongPressStart = useCallback((app: AppInfo) => {
    longPressTimerRef.current = window.setTimeout(() => {
      haptic.doubleTap();
      setSelectedApp(app);
    }, 500);
  }, [haptic]);

  const handleAppLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  if (isLoading && !selectedDevice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground">Connecting...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-black text-foreground">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-border/10 bg-black/90 backdrop-blur-xl safe-area-top">
          <div className="flex items-center justify-between h-12 px-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-sm tracking-tight">JARVIS</span>
            </div>

            <div className="flex items-center gap-2">
              {systemStats && (
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                  <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />{systemStats.cpu_percent}%</span>
                  <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{systemStats.memory_percent}%</span>
                  {systemStats.battery_percent !== undefined && (
                    <span className="flex items-center gap-1"><Battery className="w-3 h-3" />{systemStats.battery_percent}%</span>
                  )}
                </div>
              )}

              <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium", status.color)}>
                <span className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
                {status.text}
              </div>

              <Button variant="ghost" size="icon" onClick={() => { refreshDevices(); fetchStats(); syncSystemState(); }} disabled={isLoading} className="h-7 w-7">
                <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </header>

        <ScrollArea className="h-[calc(100vh-3rem)]">
          <main className="p-3 space-y-3 pb-6">
            {/* Command Input */}
            <div className="flex gap-2">
              <Input
                placeholder="Type a command... (open, play, search)"
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCommand()}
                className="flex-1 h-10 bg-card/30 border-border/10 focus-visible:ring-1 text-sm"
                disabled={!isConnected}
              />
              <Button onClick={handleCommand} disabled={!isConnected || isProcessing} size="icon" className="h-10 w-10 shrink-0">
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>

            {/* Tab Navigation */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-black/80 rounded-lg w-full border border-border/10">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); haptic.tap(); }}
                  className={cn(
                    "flex items-center justify-center gap-1 px-1.5 py-2 rounded-md text-xs font-medium transition-all",
                    activeTab === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  <span className="text-[10px]">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Control Tab */}
            {activeTab === "control" && (
              <div className="grid gap-3">
                {/* Volume & Brightness */}
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-3 space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <VolumeIcon className="w-3.5 h-3.5 cursor-pointer" onClick={handleMuteToggle} /> Volume
                        </span>
                        <span className="font-mono text-muted-foreground w-8 text-right">{volume}%</span>
                      </div>
                      <Slider
                        value={[volume]}
                        onValueChange={handleVolumeSlider}
                        onValueCommit={handleVolumeCommit}
                        max={100}
                        step={1}
                        disabled={!isConnected}
                        className="cursor-pointer w-full"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Sun className="w-3.5 h-3.5" /> Brightness
                        </span>
                        <span className="font-mono text-muted-foreground w-8 text-right">{brightness}%</span>
                      </div>
                      <Slider
                        value={[brightness]}
                        onValueChange={handleBrightnessSlider}
                        onValueCommit={handleBrightnessCommit}
                        max={100}
                        step={1}
                        disabled={!isConnected}
                        className="cursor-pointer w-full"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Power Controls */}
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-3">
                    <div className="grid grid-cols-5 gap-1.5">
                      {[
                        { icon: Lock, action: handleLock, label: "Lock", danger: false },
                        { icon: Moon, action: () => handlePower("sleep"), label: "Sleep", danger: false },
                        { icon: RefreshCw, action: () => handlePower("restart"), label: "Restart", danger: false },
                        { icon: Power, action: () => handlePower("shutdown"), label: "Off", danger: true },
                        { icon: Zap, action: handleQuickBoost, label: "Boost", danger: false },
                      ].map((btn) => (
                        <Button 
                          key={btn.label}
                          variant="outline" 
                          className={cn(
                            "h-14 w-full flex flex-col gap-1 border-border/20 text-xs",
                            btn.danger && "text-destructive hover:text-destructive hover:border-destructive/30",
                            btn.label === "Boost" && "hover:border-primary/30"
                          )}
                          onClick={btn.action} 
                          disabled={!isConnected || (btn.label === "Boost" && isBoosting)}
                        >
                          <btn.icon className="w-4 h-4" />
                          <span className="text-[10px]">{btn.label}</span>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Links */}
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-3">
                    <div className="grid grid-cols-3 gap-1.5">
                      {quickLinks.map((link) => (
                        <Link key={link.href} to={link.href}>
                          <Button variant="ghost" className="w-full h-14 flex-col gap-1 hover:bg-secondary/50 border border-transparent hover:border-border/20">
                            <link.icon className="w-4 h-4 text-primary" />
                            <span className="text-[10px] text-muted-foreground">{link.title}</span>
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
              <div className="space-y-3">
                <KDERemoteInput
                  onMouseMove={fireMouse}
                  onScroll={fireScroll}
                  onZoom={fireZoom}
                  onGesture3Finger={fireGesture3Finger}
                  onGesture4Finger={fireGesture4Finger}
                  onClick={fireClick}
                  onDoubleClick={() => fireClick("left")}
                  onDragStart={() => sendCommand("mouse_down", { button: "left" })}
                  onDragEnd={() => sendCommand("mouse_up", { button: "left" })}
                  onKeyPress={fireKey}
                  onTypeText={handleTypeText}
                  connectionMode={connectionMode}
                  latency={p2pLatency}
                  isConnected={isConnected}
                />
                <Card className="border-border/30 bg-card/50">
                  <CardContent className="p-4">
                    <AutoClipboardSync />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Media Tab */}
            {activeTab === "media" && (
              <KDEMediaControl
                isConnected={isConnected}
                volume={volume}
                isMuted={isMuted}
                onVolumeChange={(v) => { setVolume(v[0]); setIsMuted(v[0] === 0); }}
                onVolumeCommit={handleVolumeCommit}
                onMuteToggle={handleMuteToggle}
              />
            )}

            {/* Apps Tab */}
            {activeTab === "apps" && (
              <div className="space-y-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search apps & services..."
                    value={appSearch}
                    onChange={(e) => setAppSearch(e.target.value)}
                    className="pl-9 h-9 bg-card border-border/30 text-sm"
                  />
                </div>

                {/* App View Toggle */}
                <div className="flex gap-1 p-0.5 bg-card/50 rounded-lg border border-border/20">
                  {(["running", "installed", "services"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => { setAppView(v); haptic.tap(); }}
                      className={cn(
                        "flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all capitalize",
                        appView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {v === "running" ? `Running (${filteredRunning.length})` : v === "installed" ? `Installed (${filteredInstalled.length})` : `Services (${services.length})`}
                    </button>
                  ))}
                </div>

                {appsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <ScrollArea className="h-[55vh]">
                    <div className="space-y-0.5 pr-2">
                      {appView === "running" ? (
                        filteredRunning.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            {appSearch ? "No matching apps" : "No running apps found"}
                          </div>
                        ) : (
                          filteredRunning.map((app) => (
                            <div
                              key={`${app.name}-${app.pid}`}
                              className={cn(
                                "flex items-center gap-2 p-2 rounded-lg transition-colors select-none",
                                "hover:bg-secondary/30 active:bg-secondary/50",
                                selectedApp?.pid === app.pid && selectedApp?.name === app.name && "bg-secondary/40 ring-1 ring-primary/30"
                              )}
                              onTouchStart={() => handleAppLongPressStart(app)}
                              onTouchEnd={handleAppLongPressEnd}
                              onTouchCancel={handleAppLongPressEnd}
                              onMouseDown={() => handleAppLongPressStart(app)}
                              onMouseUp={handleAppLongPressEnd}
                              onMouseLeave={handleAppLongPressEnd}
                              onClick={() => setSelectedApp(prev => prev?.pid === app.pid && prev?.name === app.name ? null : app)}
                            >
                              <div className={cn(
                                "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                                (app.cpu || 0) > 50 ? "bg-destructive/10" : (app.cpu || 0) > 20 ? "bg-yellow-500/10" : "bg-secondary/50"
                              )}>
                                <AppWindow className={cn("w-3.5 h-3.5",
                                  (app.cpu || 0) > 50 ? "text-destructive" : "text-muted-foreground"
                                )} />
                              </div>
                              <div className="flex-1 min-w-0 overflow-hidden">
                                <p className="text-xs font-medium truncate max-w-[45vw]">{app.name}</p>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground overflow-hidden">
                                  {app.cpu !== undefined && (
                                    <span className={cn("shrink-0", app.cpu > 50 && "text-destructive font-medium")}>
                                      CPU {app.cpu}%
                                    </span>
                                  )}
                                  {app.memory !== undefined && (
                                    <span className={cn("shrink-0", app.memory > 50 && "text-yellow-400 font-medium")}>
                                      RAM {app.memory}%{app.memory_mb ? ` (${app.memory_mb}MB)` : ""}
                                    </span>
                                  )}
                                  {app.pid && <span className="shrink-0 opacity-50">PID {app.pid}</span>}
                                </div>
                              </div>
                              <Badge
                                variant={app.status === "running" ? "default" : "secondary"}
                                className={cn("text-[9px] px-1.5 py-0 shrink-0",
                                  app.status === "running" && "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                                )}
                              >
                                {app.status || "active"}
                              </Badge>
                            </div>
                          ))
                        )
                      ) : appView === "installed" ? (
                        filteredInstalled.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            {appSearch ? "No matching apps" : "No installed apps found"}
                          </div>
                        ) : (
                          filteredInstalled.map((app) => (
                            <div
                              key={app.app_id || app.name}
                              className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/30 transition-colors"
                            >
                              <div className="w-8 h-8 rounded-md bg-secondary/50 flex items-center justify-center shrink-0">
                                <AppWindow className="w-3.5 h-3.5 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0 overflow-hidden">
                                <p className="text-xs font-medium truncate max-w-[45vw]">{app.name}</p>
                                {app.source && <p className="text-[10px] text-muted-foreground truncate max-w-[40vw]">{app.source}</p>}
                              </div>
                              <Button variant="outline" size="sm" className="h-7 text-[10px] px-2 shrink-0" onClick={() => handleOpenApp(app.name)}>
                                Open
                              </Button>
                            </div>
                          ))
                        )
                      ) : (
                        services.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            Loading services...
                          </div>
                        ) : (
                          services
                            .filter(s => !appSearch || s.display_name?.toLowerCase().includes(appSearch.toLowerCase()) || s.name?.toLowerCase().includes(appSearch.toLowerCase()))
                            .slice(0, 150)
                            .map((svc) => (
                              <div
                                key={svc.name}
                                className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/30 transition-colors"
                              >
                                <div className={cn("w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                                  svc.status === "running" ? "bg-emerald-500/10" : "bg-secondary/50"
                                )}>
                                  <Activity className={cn("w-3.5 h-3.5", svc.status === "running" ? "text-emerald-400" : "text-muted-foreground")} />
                                </div>
                                <div className="flex-1 min-w-0 overflow-hidden">
                                  <p className="text-xs font-medium truncate max-w-[45vw]">{svc.display_name || svc.name}</p>
                                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                                    <span className="truncate max-w-[30vw]">{svc.name}</span>
                                    <span className="shrink-0">{svc.start_type}</span>
                                  </div>
                                </div>
                                <Badge
                                  variant={svc.status === "running" ? "default" : "secondary"}
                                  className={cn("text-[9px] px-1.5 py-0 shrink-0",
                                    svc.status === "running" && "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                                  )}
                                >
                                  {svc.status}
                                </Badge>
                              </div>
                            ))
                        )
                      )}
                    </div>
                  </ScrollArea>
                )}

                {/* Context menu for selected app */}
                {selectedApp && (
                  <Card className="border-primary/20 bg-card/80 backdrop-blur-sm">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate">{selectedApp.name}</p>
                          <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                            {selectedApp.cpu !== undefined && <span>CPU: {selectedApp.cpu}%</span>}
                            {selectedApp.memory !== undefined && <span>RAM: {selectedApp.memory}%{selectedApp.memory_mb ? ` (${selectedApp.memory_mb}MB)` : ""}</span>}
                            {selectedApp.pid && <span>PID: {selectedApp.pid}</span>}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setSelectedApp(null)}>
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 text-[10px] flex-col gap-0.5"
                          onClick={() => { handleOpenApp(selectedApp.name); setSelectedApp(null); }}
                        >
                          <AppWindow className="w-3.5 h-3.5" />
                          Open
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 text-[10px] flex-col gap-0.5"
                          onClick={() => { handleRestartApp(selectedApp.name, selectedApp.pid); setSelectedApp(null); }}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Restart
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 text-[10px] flex-col gap-0.5 text-destructive hover:text-destructive"
                          onClick={() => { handleCloseApp(selectedApp.name, selectedApp.pid); setSelectedApp(null); }}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Kill
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Button variant="outline" className="w-full text-xs h-8" onClick={() => { fetchRunningApps(); fetchInstalledApps(); fetchServices(); }} disabled={appsLoading}>
                  <RefreshCw className={cn("w-3 h-3 mr-1", appsLoading && "animate-spin")} />
                  Refresh All
                </Button>
              </div>
            )}

            {/* Zoom Tab */}
            {activeTab === "zoom" && (
              <div className="grid gap-3">
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-0">
                    <ZoomMeetings />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Settings Tab (merged with tools) */}
            {activeTab === "settings" && (
              <div className="grid gap-3">
                <BidirectionalFileTransfer />
                <BoostPC />
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-3">
                    <Link to="/settings" className="flex items-center gap-3 w-full">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Settings className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">App Settings</p>
                        <p className="text-[10px] text-muted-foreground">Voice, security, device config</p>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Network Tab */}
            {activeTab === "network" && (
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
                    python jarvis_agent.py --gui
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
