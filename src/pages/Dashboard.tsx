import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Mic,
  Monitor,
  Music,
  Wifi,
  WifiOff,
  Volume2,
  Sun,
  Lock,
  Unlock,
  Bot,
  RefreshCw,
  Cpu,
  HardDrive,
  Battery,
  Smartphone,
  ArrowRight,
  Camera,
  FolderOpen,
  Keyboard,
  Settings2,
  Zap,
  Share2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { DeviceSelector } from "@/components/DeviceSelector";
import { CommandCenter } from "@/components/CommandCenter";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

export default function Dashboard() {
  const { devices, selectedDevice, isLoading: loading, refreshDevices } = useDeviceContext();
  const { deviceInfo, isReconnecting, session } = useDeviceSession();
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();
  const [systemStats, setSystemStats] = useState<Record<string, unknown> | null>(null);

  const isConnected = selectedDevice?.is_online || false;
  const volume = selectedDevice?.current_volume || 0;
  const brightness = selectedDevice?.current_brightness || 0;

  // Fetch system stats on load
  useEffect(() => {
    if (selectedDevice?.is_online) {
      fetchSystemStats();
    }
  }, [selectedDevice]);

  const fetchSystemStats = async () => {
    const result = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 5000 });
    if (result && 'result' in result && result.result?.success) {
      setSystemStats(result.result as Record<string, unknown>);
    }
  };

  const quickActions = [
    { title: "Voice AI", description: "Talk to Jarvis", icon: Mic, href: "/voice", color: "text-neon-green", bgColor: "bg-neon-green/10" },
    { title: "Controls", description: "Volume & brightness", icon: Monitor, href: "/controls", color: "text-neon-blue", bgColor: "bg-neon-blue/10" },
    { title: "Music", description: "Media player", icon: Music, href: "/music", color: "text-neon-purple", bgColor: "bg-neon-purple/10" },
    { title: "Files", description: "Browse PC files", icon: FolderOpen, href: "/files", color: "text-neon-orange", bgColor: "bg-neon-orange/10" },
    { title: "Remote", description: "Keyboard & mouse", icon: Keyboard, href: "/remote", color: "text-neon-cyan", bgColor: "bg-neon-cyan/10" },
    { title: "Mic & Cam", description: "Stream audio/video", icon: Camera, href: "/miccamera", color: "text-neon-pink", bgColor: "bg-neon-pink/10" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header - KDE Connect style */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center pulse-neon shadow-lg">
                <Bot className="w-8 h-8 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold neon-text">JARVIS</h1>
                <p className="text-muted-foreground text-sm">
                  {selectedDevice ? `Connected to ${selectedDevice.name}` : "AI-powered PC control"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <DeviceSelector />
              <Button
                variant="outline"
                size="icon"
                onClick={() => { refreshDevices(); fetchSystemStats(); }}
                className="border-border/50"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Connection Status Bar */}
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
                      {isReconnecting 
                        ? "Waiting for PC to come back online"
                        : isConnected 
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
                        : isReconnecting
                          ? "border-neon-orange/50 text-neon-orange bg-neon-orange/10"
                          : "border-destructive/50 text-destructive bg-destructive/10"
                    )}
                  >
                    <span className={cn(
                      "w-2 h-2 rounded-full", 
                      isConnected ? "bg-neon-green animate-pulse" : 
                      isReconnecting ? "bg-neon-orange animate-pulse" : 
                      "bg-destructive"
                    )} />
                    {isReconnecting ? "Reconnecting" : isConnected ? "Online" : "Offline"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* No Device Warning */}
        {!loading && devices.length === 0 && (
          <Card className="glass-dark border-neon-orange/50 bg-neon-orange/5">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-neon-orange/10">
                  <Smartphone className="h-6 w-6 text-neon-orange" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">No PC Connected</h3>
                  <p className="text-muted-foreground mb-4">
                    Run the Python agent on your PC to connect it to Jarvis.
                  </p>
                  <div className="bg-secondary/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                    <p className="text-muted-foreground mb-2"># Install & run the agent:</p>
                    <p className="text-xs md:text-sm">pip install supabase pyautogui pillow psutil keyboard pycaw screen-brightness-control pyperclip mss pyaudio opencv-python websockets</p>
                    <p className="mt-2">python jarvis_agent.py</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions Grid - KDE Connect style */}
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {quickActions.map((action) => (
              <Link key={action.title} to={action.href}>
                <Card className="glass-dark border-border/50 hover:border-primary/50 transition-all cursor-pointer hover-scale h-full group">
                  <CardContent className="p-4 flex flex-col items-center text-center">
                    <div className={cn("p-3 rounded-xl mb-3 transition-colors", action.bgColor, "group-hover:scale-110 transition-transform")}>
                      <action.icon className={cn("h-6 w-6", action.color)} />
                    </div>
                    <h3 className="font-medium text-sm">{action.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* System Stats - KDE Connect style */}
        {systemStats && (
          <div>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              System Status
            </h2>
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
          </div>
        )}

        {/* Command Center */}
        <CommandCenter />

        {/* AI Status Card */}
        <Card className="glass-dark border-border/50 overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center pulse-neon">
                <Bot className="w-10 h-10 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold mb-1">JARVIS AI Ready</h2>
                <p className="text-muted-foreground mb-3 text-sm">
                  Voice control, smart automation, and PC management at your fingertips.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant="secondary" className="bg-neon-green/10 text-neon-green border-neon-green/30">
                    Voice Active
                  </Badge>
                  <Badge variant="secondary" className="bg-neon-blue/10 text-neon-blue border-neon-blue/30">
                    Hindi + English
                  </Badge>
                  <Badge variant="secondary" className="bg-neon-purple/10 text-neon-purple border-neon-purple/30">
                    ElevenLabs TTS
                  </Badge>
                </div>
              </div>
              <Link to="/voice">
                <Button className="gradient-primary">
                  <Mic className="h-4 w-4 mr-2" />
                  Start Chat
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* System Info from Device */}
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
      </div>
    </DashboardLayout>
  );
}
