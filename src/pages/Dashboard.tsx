import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const [isConnected, setIsConnected] = useState(false);
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(75);
  const [isLocked, setIsLocked] = useState(false);

  // Simulate connection status
  useEffect(() => {
    const timer = setTimeout(() => setIsConnected(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  const statusCards = [
    {
      title: "PC Connection",
      value: isConnected ? "Connected" : "Disconnected",
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
            <p className="text-muted-foreground">Welcome back, Commander</p>
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
            <span className={cn("w-2 h-2 rounded-full", isConnected ? "bg-neon-green animate-pulse" : "bg-destructive")} />
            {isConnected ? "PC Online" : "PC Offline"}
          </Badge>
        </div>

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
              <Card
                key={action.title}
                className="glass-dark border-border/50 hover:border-primary/50 transition-all cursor-pointer hover-scale group"
                style={{ animationDelay: `${(index + 4) * 100}ms` }}
                onClick={() => window.location.href = action.href}
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
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
