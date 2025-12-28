import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";

interface SystemInfo {
  os?: string;
  hostname?: string;
  cpu_count?: number;
  memory_total_gb?: number;
}

interface Device {
  id: string;
  name: string;
  device_key: string;
  is_online: boolean;
  is_locked: boolean | null;
  current_volume: number | null;
  current_brightness: number | null;
  last_seen: string | null;
  system_info: SystemInfo | null;
}

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const activeDevice = devices.find(d => d.is_online) || devices[0];

  const fetchDevices = async () => {
    try {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .order("last_seen", { ascending: false });

      if (error) throw error;
      setDevices((data as unknown as Device[]) || []);
    } catch (error) {
      console.error("Error fetching devices:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();

    // Subscribe to realtime device updates
    const channel = supabase
      .channel("devices-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "devices",
        },
        (payload) => {
          console.log("Device update:", payload);
          if (payload.eventType === "INSERT") {
            setDevices((prev) => [payload.new as Device, ...prev]);
            toast({ title: "New device connected!", description: (payload.new as Device).name });
          } else if (payload.eventType === "UPDATE") {
            setDevices((prev) =>
              prev.map((d) => (d.id === (payload.new as Device).id ? (payload.new as Device) : d))
            );
          } else if (payload.eventType === "DELETE") {
            setDevices((prev) => prev.filter((d) => d.id !== (payload.old as Device).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const isConnected = activeDevice?.is_online || false;
  const volume = activeDevice?.current_volume || 0;
  const brightness = activeDevice?.current_brightness || 0;
  const isLocked = activeDevice?.is_locked || false;

  const statusCards = [
    {
      title: "PC Connection",
      value: isConnected ? "Connected" : devices.length > 0 ? "Offline" : "No Device",
      icon: isConnected ? Wifi : WifiOff,
      color: isConnected ? "text-neon-green" : "text-destructive",
      bgColor: isConnected ? "bg-neon-green/10" : "bg-destructive/10",
    },
    {
      title: "Volume",
      value: `${volume}%`,
      icon: Volume2,
      color: "text-neon-blue",
      bgColor: "bg-neon-blue/10",
    },
    {
      title: "Brightness",
      value: `${brightness}%`,
      icon: Sun,
      color: "text-neon-orange",
      bgColor: "bg-neon-orange/10",
    },
    {
      title: "Lock Status",
      value: isLocked ? "Locked" : "Unlocked",
      icon: isLocked ? Lock : Unlock,
      color: isLocked ? "text-neon-pink" : "text-neon-green",
      bgColor: isLocked ? "bg-neon-pink/10" : "bg-neon-green/10",
    },
  ];

  const quickActions = [
    { title: "Voice Chat", description: "Talk to Jarvis", icon: Mic, href: "/voice" },
    { title: "System Controls", description: "Volume, brightness, power", icon: Monitor, href: "/controls" },
    { title: "Music Player", description: "Play your favorite songs", icon: Music, href: "/music" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold neon-text">Dashboard</h1>
            <p className="text-muted-foreground">
              {activeDevice ? `Connected to ${activeDevice.name}` : "Welcome, Commander"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={fetchDevices}
              className="border-border/50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Badge
              variant="outline"
              className={cn(
                "gap-2 px-4 py-2",
                isConnected
                  ? "border-neon-green/50 text-neon-green bg-neon-green/10"
                  : "border-destructive/50 text-destructive bg-destructive/10"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", isConnected ? "bg-neon-green animate-pulse" : "bg-destructive")} />
              {isConnected ? "PC Online" : "PC Offline"}
            </Badge>
          </div>
        </div>

        {/* No Device Warning */}
        {!loading && devices.length === 0 && (
          <Card className="glass-dark border-neon-orange/50 bg-neon-orange/5">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-neon-orange/10">
                  <Monitor className="h-6 w-6 text-neon-orange" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">No PC Connected</h3>
                  <p className="text-muted-foreground mb-4">
                    Run the Python agent on your PC to connect it to Jarvis.
                  </p>
                  <div className="bg-secondary/50 rounded-lg p-4 font-mono text-sm">
                    <p className="text-muted-foreground mb-2"># Install & run the agent:</p>
                    <p>pip install supabase pyautogui pillow psutil keyboard pycaw screen-brightness-control</p>
                    <p className="mt-2">python jarvis_agent.py</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statusCards.map((card, index) => (
            <Card
              key={card.title}
              className="glass-dark border-border/50 hover:border-primary/50 transition-all hover-scale"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{card.title}</p>
                    <p className={cn("text-2xl font-bold mt-1", card.color)}>{card.value}</p>
                  </div>
                  <div className={cn("p-3 rounded-xl", card.bgColor)}>
                    <card.icon className={cn("h-6 w-6", card.color)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* System Info */}
        {activeDevice?.system_info && (
          <Card className="glass-dark border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                System Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-secondary/30">
                  <p className="text-sm text-muted-foreground">OS</p>
                  <p className="font-medium">{activeDevice.system_info.os || "Unknown"}</p>
                </div>
                <div className="p-4 rounded-lg bg-secondary/30">
                  <p className="text-sm text-muted-foreground">Hostname</p>
                  <p className="font-medium">{activeDevice.system_info.hostname || activeDevice.name}</p>
                </div>
                <div className="p-4 rounded-lg bg-secondary/30">
                  <p className="text-sm text-muted-foreground">CPU Cores</p>
                  <p className="font-medium">{activeDevice.system_info.cpu_count || "N/A"}</p>
                </div>
                <div className="p-4 rounded-lg bg-secondary/30">
                  <p className="text-sm text-muted-foreground">RAM</p>
                  <p className="font-medium">{activeDevice.system_info.memory_total_gb || "N/A"} GB</p>
                </div>
              </div>
              {activeDevice.last_seen && (
                <p className="text-xs text-muted-foreground mt-4">
                  Last seen: {new Date(activeDevice.last_seen).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* AI Status */}
        <Card className="glass-dark border-border/50 overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-2xl gradient-primary flex items-center justify-center pulse-neon">
                <Bot className="w-12 h-12 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold mb-1">JARVIS AI</h2>
                <p className="text-muted-foreground mb-3">
                  Your intelligent assistant is ready. Say "Hey Jarvis" or click the mic to start.
                </p>
                <div className="flex items-center gap-4">
                  <Badge variant="secondary" className="bg-neon-green/10 text-neon-green border-neon-green/30">
                    Voice Active
                  </Badge>
                  <Badge variant="secondary" className="bg-neon-blue/10 text-neon-blue border-neon-blue/30">
                    Multi-language
                  </Badge>
                  <Badge variant="secondary" className="bg-neon-purple/10 text-neon-purple border-neon-purple/30">
                    ElevenLabs TTS
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {quickActions.map((action, index) => (
              <Link key={action.title} to={action.href}>
                <Card
                  className="glass-dark border-border/50 hover:border-primary/50 transition-all cursor-pointer hover-scale group"
                  style={{ animationDelay: `${(index + 4) * 100}ms` }}
                >
                  <CardHeader>
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                        <action.icon className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{action.title}</CardTitle>
                        <CardDescription>{action.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
