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
  Phone,
  Bell,
  Keyboard,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Repeat,
  Shuffle,
  Clock,
  Smartphone,
  ArrowRight,
  Copy,
  FileUp,
  PhoneIncoming,
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
import { EnhancedTrackpad } from "@/components/EnhancedTrackpad";
import { MobileKeyboard } from "@/components/MobileKeyboard";
import { AutoClipboardSync } from "@/components/AutoClipboardSync";
import { Switch } from "@/components/ui/switch";

type Tab = "control" | "remote" | "media" | "tools" | "network";

interface SystemStats {
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  battery_percent?: number;
  battery_plugged?: boolean;
}

interface MediaInfo {
  title?: string;
  artist?: string;
  album?: string;
  playing?: boolean;
  position?: number;
  duration?: number;
}

interface CallState {
  active: boolean;
  number: string;
  name: string;
  duration: number;
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

  const [activeTab, setActiveTab] = useState<Tab>("control");
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(75);
  const [isLocked, setIsLocked] = useState(false);
  
  const [cmdInput, setCmdInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);

  // Media state
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);

  // Call state
  const [autoMuteCall, setAutoMuteCall] = useState(true);
  const [autoPauseCall, setAutoPauseCall] = useState(true);
  const [callState, setCallState] = useState<CallState>({ active: false, number: "", name: "", duration: 0 });

  // Notification state
  const [notifEnabled, setNotifEnabled] = useState(false);

  const volumeCommitRef = useRef<number | null>(null);
  const brightnessCommitRef = useRef<number | null>(null);

  const isConnected = selectedDevice?.is_online || false;

  // Force dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

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

  // Volume handler - sends set_volume with awaitResult for reliability
  const handleVolumeSlider = useCallback((v: number[]) => {
    setVolume(v[0]);
  }, []);

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
  }, []);

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

  // Media info fetch
  const fetchMediaInfo = useCallback(async () => {
    setMediaLoading(true);
    try {
      const result = await sendCommand("get_media_info", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result.success && "result" in result && result.result) {
        const info = result.result as MediaInfo;
        setMediaInfo(info);
        setIsPlaying(info.playing ?? false);
      }
    } catch {}
    setMediaLoading(false);
  }, [sendCommand]);

  useEffect(() => {
    if (selectedDevice?.is_online) fetchMediaInfo();
  }, [selectedDevice?.is_online, fetchMediaInfo]);

  const handleMediaControl = async (action: string) => {
    if (action === "play_pause") setIsPlaying(!isPlaying);
    sendCommand("media_control", { action }).then(() => setTimeout(fetchMediaInfo, 300));
  };

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    sendCommand(newMuted ? "mute_pc" : "unmute_pc", {});
  };

  // Call detection
  useEffect(() => {
    if (!callState.active) return;
    const timer = setInterval(() => {
      setCallState(prev => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
    return () => clearInterval(timer);
  }, [callState.active]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const simulateCall = useCallback(async () => {
    setCallState({ active: true, number: "+1 (555) 123-4567", name: "Test Caller", duration: 0 });
    if (autoMuteCall) {
      try {
        await sendCommand("mute_pc", {}, { awaitResult: true, timeoutMs: 5000 });
        toast({ title: "PC Muted", description: "Call detected" });
      } catch {}
    }
    if (autoPauseCall) {
      try {
        await sendCommand("media_control", { action: "pause" }, { awaitResult: true, timeoutMs: 5000 });
      } catch {}
    }
  }, [autoMuteCall, autoPauseCall, sendCommand, toast]);

  const simulateEndCall = useCallback(async () => {
    setCallState({ active: false, number: "", name: "", duration: 0 });
    if (autoMuteCall) {
      try {
        await sendCommand("unmute_pc", {}, { awaitResult: true, timeoutMs: 5000 });
        toast({ title: "PC Unmuted", description: "Call ended" });
      } catch {}
    }
  }, [autoMuteCall, sendCommand, toast]);

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
    { title: "AI", icon: Bot, href: "/assistant" },
    { title: "Voice", icon: Mic, href: "/voice" },
    { title: "Files", icon: FolderOpen, href: "/files" },
    { title: "Camera", icon: Camera, href: "/miccamera" },
    { title: "Settings", icon: Settings, href: "/settings" },
  ];

  const tabs = [
    { id: "control" as Tab, label: "Control", icon: Monitor },
    { id: "remote" as Tab, label: "Remote", icon: Mouse },
    { id: "media" as Tab, label: "Media", icon: Music },
    { id: "network" as Tab, label: "Network", icon: Wifi },
    { id: "tools" as Tab, label: "Tools", icon: Wrench },
  ];

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
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-border/20 bg-background/80 backdrop-blur-xl">
          <div className="flex items-center justify-between h-12 px-4 max-w-3xl mx-auto">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-sm tracking-tight">JARVIS</span>
            </div>

            <div className="flex items-center gap-2">
              {systemStats && (
                <div className="hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
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
          <main className="max-w-3xl mx-auto p-3 space-y-3">
            {/* Command Input */}
            <div className="flex gap-2">
              <Input
                placeholder="Type a command... (open, play, search)"
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

            {/* Tab Navigation */}
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
                {/* Volume & Brightness */}
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-3 space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <VolumeIcon className="w-3.5 h-3.5 cursor-pointer" onClick={handleMuteToggle} /> Volume
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
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { icon: Lock, action: handleLock, label: "Lock" },
                        { icon: Moon, action: () => handlePower("sleep"), label: "Sleep" },
                        { icon: RefreshCw, action: () => handlePower("restart"), label: "Restart" },
                        { icon: Power, action: () => handlePower("shutdown"), label: "Shutdown", danger: true },
                        { icon: Zap, action: handleQuickBoost, label: "Boost" },
                      ].map((btn) => (
                        <Tooltip key={btn.label}>
                          <TooltipTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="icon" 
                              className={cn(
                                "h-10 w-full border-border/20",
                                btn.danger && "text-destructive hover:text-destructive hover:border-destructive/30",
                                btn.label === "Boost" && "hover:border-primary/30"
                              )}
                              onClick={btn.action} 
                              disabled={!isConnected || (btn.label === "Boost" && isBoosting)}
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

                {/* Quick Links (Apps integrated into Hub) */}
                <Card className="border-border/20 bg-card/50 md:col-span-2">
                  <CardContent className="p-3">
                    <div className="grid grid-cols-5 gap-2">
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

                {/* Notifications - Compact */}
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Bell className="w-4 h-4 text-primary" />
                        Notifications
                      </div>
                      <Switch checked={notifEnabled} onCheckedChange={(v) => {
                        setNotifEnabled(v);
                        sendCommand(v ? "start_notification_sync" : "stop_notification_sync", {});
                        toast({ title: v ? "Sync Active" : "Sync Disabled" });
                      }} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Smartphone className="w-3 h-3" />
                      <ArrowRight className="w-3 h-3" />
                      <Monitor className="w-3 h-3" />
                      <span>{notifEnabled ? "Mirroring phone notifications" : "Enable to sync"}</span>
                    </div>
                    {notifEnabled && (
                      <div className="mt-2 flex gap-2">
                        <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => {
                          sendCommand("get_clipboard", {}, { awaitResult: true, timeoutMs: 3000 }).then(r => {
                            if (r.success && 'result' in r) {
                              const content = (r.result as any)?.content;
                              if (content) {
                                navigator.clipboard.writeText(content);
                                toast({ title: "Clipboard synced" });
                              }
                            }
                          });
                        }}>
                          <Copy className="w-3 h-3" /> Clipboard
                        </Button>
                        <Link to="/files">
                          <Button variant="outline" size="sm" className="text-xs h-7 gap-1">
                            <FileUp className="w-3 h-3" /> Files
                          </Button>
                        </Link>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Call Detection - Compact */}
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Phone className={cn("w-4 h-4", callState.active ? "text-primary" : "text-muted-foreground")} />
                        Call Detection
                      </div>
                      {callState.active && (
                        <Badge variant="outline" className="font-mono text-[10px] gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(callState.duration)}
                        </Badge>
                      )}
                    </div>
                    
                    <div className="flex gap-2 mb-2">
                      <div className={cn("flex-1 flex items-center justify-between p-2 rounded-lg border text-xs", autoMuteCall ? "border-primary/30 bg-primary/5" : "border-border/50")}>
                        <span>Mute</span>
                        <Switch checked={autoMuteCall} onCheckedChange={setAutoMuteCall} className="scale-75" />
                      </div>
                      <div className={cn("flex-1 flex items-center justify-between p-2 rounded-lg border text-xs", autoPauseCall ? "border-primary/30 bg-primary/5" : "border-border/50")}>
                        <span>Pause</span>
                        <Switch checked={autoPauseCall} onCheckedChange={setAutoPauseCall} className="scale-75" />
                      </div>
                    </div>

                    {callState.active ? (
                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/30">
                        <div className="flex items-center gap-2 mb-2">
                          <Phone className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">{callState.name || callState.number}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-muted-foreground">PC muted & paused</span>
                          <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={simulateEndCall}>End Test</Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1" onClick={simulateCall} disabled={!isConnected}>
                        <PhoneIncoming className="h-3 w-3" /> Test Call Detection
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Remote Tab */}
            {activeTab === "remote" && (
              <div className="space-y-3">
                <EnhancedTrackpad
                  onMouseMove={fireMouse}
                  onScroll={fireScroll}
                  onZoom={fireZoom}
                  onGesture3Finger={fireGesture3Finger}
                  onGesture4Finger={fireGesture4Finger}
                  onClick={fireClick}
                  onTypeText={handleTypeText}
                  connectionMode={connectionMode}
                  latency={p2pLatency}
                  isConnected={isConnected}
                />

                <Card className="border-border/30 bg-card/50">
                  <CardContent className="p-4">
                    <MobileKeyboard 
                      onKeyPress={fireKey} 
                      onTypeText={handleTypeText}
                      disabled={!isConnected} 
                    />
                  </CardContent>
                </Card>

                <Card className="border-border/30 bg-card/50">
                  <CardContent className="p-4">
                    <AutoClipboardSync />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Media Tab - KDE Connect Style */}
            {activeTab === "media" && (
              <div className="space-y-3">
                {/* Now Playing - KDE Connect Style */}
                <Card className="border-border/20 bg-card/50">
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Music className="h-5 w-5 text-primary" />
                        <span className="font-medium text-sm">Now Playing</span>
                      </div>
                      <Button variant="ghost" size="icon" onClick={fetchMediaInfo} disabled={mediaLoading} className="h-7 w-7">
                        <RefreshCw className={cn("h-3.5 w-3.5", mediaLoading && "animate-spin")} />
                      </Button>
                    </div>

                    <div className="p-3 rounded-lg bg-secondary/30">
                      {mediaInfo?.title ? (
                        <>
                          <Badge variant={isPlaying ? "default" : "secondary"} className={cn("text-[10px] mb-1", isPlaying && "bg-emerald-500/20 text-emerald-400")}>
                            {isPlaying ? "▶ Playing" : "⏸ Paused"}
                          </Badge>
                          <p className="font-medium text-sm truncate">{mediaInfo.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{mediaInfo.artist}{mediaInfo.album && ` • ${mediaInfo.album}`}</p>
                          {mediaInfo.duration && mediaInfo.duration > 0 && (
                            <div className="mt-2 space-y-1">
                              <div className="w-full h-1 rounded-full bg-secondary">
                                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((mediaInfo.position || 0) / mediaInfo.duration) * 100}%` }} />
                              </div>
                              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                                <span>{formatDuration(mediaInfo.position || 0)}</span>
                                <span>{formatDuration(mediaInfo.duration)}</span>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-center py-2">
                          <p className="text-sm text-muted-foreground">No media detected</p>
                          <p className="text-xs text-muted-foreground">Play something on your PC</p>
                        </div>
                      )}
                    </div>

                    {/* Playback Controls */}
                    <div className="flex items-center justify-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleMediaControl("shuffle")} className="h-8 w-8">
                        <Shuffle className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleMediaControl("previous")} className="h-9 w-9">
                        <SkipBack className="h-5 w-5" />
                      </Button>
                      <Button onClick={() => handleMediaControl("play_pause")} className={cn("h-12 w-12 rounded-full", isPlaying ? "bg-primary" : "bg-primary")}>
                        {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleMediaControl("next")} className="h-9 w-9">
                        <SkipForward className="h-5 w-5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleMediaControl("repeat")} className="h-8 w-8">
                        <Repeat className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Volume Control with Mute */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={handleMuteToggle} className="h-7 w-7">
                          <VolumeIcon className="h-4 w-4" />
                        </Button>
                        <Slider
                          value={[isMuted ? 0 : volume]}
                          onValueChange={(v) => { setVolume(v[0]); setIsMuted(v[0] === 0); }}
                          onValueCommit={handleVolumeCommit}
                          max={100}
                          step={5}
                          disabled={!isConnected}
                          className="flex-1 cursor-pointer"
                        />
                        <Badge variant="secondary" className="text-[10px] w-10 justify-center">{isMuted ? 0 : volume}%</Badge>
                      </div>
                    </div>

                    {/* Audio Output Selection */}
                    <div className="pt-2 border-t border-border/20">
                      <p className="text-xs text-muted-foreground mb-2">Audio Output: Default Speaker</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => {
                          sendCommand("list_audio_outputs", {}, { awaitResult: true, timeoutMs: 5000 }).then(r => {
                            if (r.success && 'result' in r) {
                              const devices = (r.result as any)?.devices || [];
                              toast({ title: "Audio Devices", description: devices.map((d: any) => d.name).join(", ") || "Default only" });
                            }
                          });
                        }}>
                          List Devices
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Tools Tab */}
            {activeTab === "tools" && (
              <div className="grid gap-3 md:grid-cols-2">
                <Card className="border-border/20 bg-card/50 md:col-span-2">
                  <CardContent className="p-0">
                    <ZoomMeetings />
                  </CardContent>
                </Card>
                <BidirectionalFileTransfer className="md:col-span-2" />
                <BoostPC />
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
