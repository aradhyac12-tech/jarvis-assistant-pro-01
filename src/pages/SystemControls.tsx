import { useState, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Power,
  RotateCcw,
  Moon as Sleep,
  Snowflake,
  Lock,
  Unlock,
  Monitor,
  Cpu,
  HardDrive,
  Zap,
  RefreshCw,
  Battery,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { supabase } from "@/integrations/supabase/client";

const UNLOCK_PIN = "1212";

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

export default function SystemControls() {
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(75);
  const [isMuted, setIsMuted] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [systemStats, setSystemStats] = useState<SystemStats>({});
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();

  // Load initial state from connected device
  useEffect(() => {
    const loadDeviceState = async () => {
      const { data: devices } = await supabase
        .from("devices")
        .select("current_volume, current_brightness, is_locked")
        .eq("is_online", true)
        .limit(1);

      if (devices?.[0]) {
        setVolume(devices[0].current_volume || 50);
        setBrightness(devices[0].current_brightness || 75);
        setIsLocked(devices[0].is_locked || false);
      }
    };

    loadDeviceState();
    fetchSystemStats();

    const channel = supabase
      .channel("device-controls")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "devices" },
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
  }, []);

  const fetchSystemStats = async () => {
    setIsLoadingStats(true);
    const res = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 8000 });

    if (res.success && "result" in res && res.result) {
      const result = res.result as Record<string, unknown>;
      if (result.success) setSystemStats(result as unknown as SystemStats);
    } else {
      toast({
        title: "Could not fetch system stats",
        description: typeof (res as any).error === "string" ? (res as any).error : "Try again.",
        variant: "destructive",
      });
    }

    setIsLoadingStats(false);
  };

  // Debounced volume change
  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
  }, []);

  const handleVolumeCommit = useCallback((value: number[]) => {
    sendCommand("set_volume", { level: value[0] });
  }, [sendCommand]);

  // Debounced brightness change
  const handleBrightnessChange = useCallback((value: number[]) => {
    const newBrightness = value[0];
    setBrightness(newBrightness);
  }, []);

  const handleBrightnessCommit = useCallback((value: number[]) => {
    sendCommand("set_brightness", { level: value[0] });
  }, [sendCommand]);

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (newMuted) {
      sendCommand("set_volume", { level: 0 });
    } else {
      sendCommand("set_volume", { level: volume });
    }
    toast({ 
      title: newMuted ? "Muted" : "Unmuted",
      description: newMuted ? "Volume muted" : `Volume at ${volume}%`
    });
  };

  const handleLock = () => {
    setIsLocked(true);
    sendCommand("lock", {});
    toast({ title: "PC Locked", description: "Your PC has been locked" });
  };

  const handleUnlockAttempt = async () => {
    if (pinInput !== UNLOCK_PIN) {
      setPinError(true);
      setPinInput("");
      return;
    }

    setPinError(false);
    setShowPinDialog(false);

    const res = await sendCommand("unlock", { pin: UNLOCK_PIN }, { awaitResult: true, timeoutMs: 10000 });

    if (res.success) {
      setIsLocked(false);
      toast({ title: "PC Unlocked", description: "Unlock completed" });
    } else {
      toast({
        title: "Unlock failed",
        description: typeof (res as any).error === "string" ? (res as any).error : "Check the PC lock screen",
        variant: "destructive",
      });
    }

    setPinInput("");
  };

  const handleBoost = async () => {
    await sendCommand("boost", {});
    toast({ title: "Boost Mode", description: "Optimizing PC performance..." });
  };

  const powerActions = [
    { title: "Shutdown", icon: Power, color: "text-destructive", command: "shutdown", description: "Turn off your PC completely" },
    { title: "Restart", icon: RotateCcw, color: "text-neon-orange", command: "restart", description: "Restart your PC" },
    { title: "Sleep", icon: Sleep, color: "text-neon-purple", command: "sleep", description: "Put your PC to sleep" },
    { title: "Hibernate", icon: Snowflake, color: "text-neon-cyan", command: "hibernate", description: "Hibernate your PC" },
  ];

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-2rem)]">
        <div className="space-y-4 animate-fade-in pr-4 pt-12 md:pt-0">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold neon-text">System Controls</h1>
              <p className="text-muted-foreground text-sm">Manage your PC settings remotely</p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchSystemStats} disabled={isLoadingStats}>
              <RefreshCw className={cn("h-4 w-4 mr-2", isLoadingStats && "animate-spin")} />
              Refresh
            </Button>
          </div>

          {/* System Stats */}
          {Object.keys(systemStats).length > 0 && (
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
                  <p className="text-xs text-muted-foreground mt-1">
                    {systemStats.disk_used_gb || 0} / {systemStats.disk_total_gb || 0} GB
                  </p>
                </CardContent>
              </Card>
              
              <Card className="glass-dark border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Battery className="h-4 w-4 text-neon-green" />
                    <span className="text-sm">Battery</span>
                  </div>
                  <p className="text-2xl font-bold text-neon-green">
                    {systemStats.battery_percent !== null ? `${systemStats.battery_percent}%` : "N/A"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {systemStats.battery_plugged ? "⚡ Charging" : "On battery"}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Volume Control */}
            <Card className="glass-dark border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-lg">
                  <div className="p-2 rounded-lg bg-neon-blue/10">
                    <Volume2 className="h-5 w-5 text-neon-blue" />
                  </div>
                  Volume Control
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Volume Level</span>
                  <span className="text-2xl font-bold text-neon-blue">{isMuted ? 0 : volume}%</span>
                </div>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  onValueChange={handleVolumeChange}
                  onValueCommit={handleVolumeCommit}
                  max={100}
                  step={5}
                  className="cursor-pointer"
                  disabled={isMuted}
                />
                <Button
                  variant={isMuted ? "destructive" : "secondary"}
                  className="w-full"
                  onClick={handleMuteToggle}
                >
                  {isMuted ? (
                    <>
                      <VolumeX className="h-4 w-4 mr-2" /> Unmute
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-4 w-4 mr-2" /> Mute
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Brightness Control */}
            <Card className="glass-dark border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-lg">
                  <div className="p-2 rounded-lg bg-neon-orange/10">
                    <Sun className="h-5 w-5 text-neon-orange" />
                  </div>
                  Brightness Control
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Brightness Level</span>
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
                  <Button 
                    variant="secondary" 
                    className="flex-1" 
                    onClick={() => {
                      setBrightness(0);
                      sendCommand("set_brightness", { level: 0 });
                    }}
                  >
                    <Moon className="h-4 w-4 mr-2" /> Off
                  </Button>
                  <Button 
                    variant="secondary" 
                    className="flex-1" 
                    onClick={() => {
                      setBrightness(50);
                      sendCommand("set_brightness", { level: 50 });
                    }}
                  >
                    <Sun className="h-4 w-4 mr-2" /> 50%
                  </Button>
                  <Button 
                    variant="secondary" 
                    className="flex-1" 
                    onClick={() => {
                      setBrightness(100);
                      sendCommand("set_brightness", { level: 100 });
                    }}
                  >
                    <Sun className="h-4 w-4 mr-2" /> Max
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Lock/Unlock Control */}
            <Card className="glass-dark border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-lg">
                  <div className={cn("p-2 rounded-lg", isLocked ? "bg-neon-pink/10" : "bg-neon-green/10")}>
                    {isLocked ? (
                      <Lock className="h-5 w-5 text-neon-pink" />
                    ) : (
                      <Unlock className="h-5 w-5 text-neon-green" />
                    )}
                  </div>
                  Lock / Unlock PC
                </CardTitle>
                <CardDescription className="text-sm">
                  {isLocked ? "Your PC is currently locked" : "Your PC is currently unlocked"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div className="flex items-center gap-3">
                    <Monitor className="h-6 w-6 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">Lock Status</p>
                      <p className={cn("text-xs", isLocked ? "text-neon-pink" : "text-neon-green")}>
                        {isLocked ? "Locked" : "Unlocked"}
                      </p>
                    </div>
                  </div>
                  <div className={cn("w-3 h-3 rounded-full", isLocked ? "bg-neon-pink" : "bg-neon-green")} />
                </div>

                {isLocked ? (
                  <Button
                    className="w-full gradient-primary"
                    onClick={() => setShowPinDialog(true)}
                  >
                    <Unlock className="h-4 w-4 mr-2" /> Smart Unlock
                  </Button>
                ) : (
                  <Button variant="secondary" className="w-full" onClick={handleLock}>
                    <Lock className="h-4 w-4 mr-2" /> Lock PC
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Power Options + Boost */}
            <Card className="glass-dark border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-lg">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <Power className="h-5 w-5 text-destructive" />
                  </div>
                  Power Options
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  variant="secondary" 
                  className="w-full bg-neon-green/10 hover:bg-neon-green/20 text-neon-green border-neon-green/30"
                  onClick={handleBoost}
                >
                  <Zap className="h-4 w-4 mr-2" />
                  Boost PC (Refresh Explorer + Clear Temp)
                </Button>
                
                <div className="grid grid-cols-2 gap-2">
                  {powerActions.map((action) => (
                    <AlertDialog key={action.command}>
                      <AlertDialogTrigger asChild>
                        <Button variant="secondary" className="h-auto py-3 flex flex-col gap-1">
                          <action.icon className={cn("h-5 w-5", action.color)} />
                          <span className="text-xs">{action.title}</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="glass-dark border-border/50 max-w-[90vw] md:max-w-md">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Confirm {action.title}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {action.description}. Are you sure you want to continue?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              sendCommand(action.command, {});
                              toast({ title: action.title, description: `${action.title} command sent` });
                            }}
                            className={cn(
                              action.command === "shutdown" && "bg-destructive hover:bg-destructive/90"
                            )}
                          >
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

          {/* PIN Dialog */}
          <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
            <DialogContent className="glass-dark border-border/50 max-w-[90vw] sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Unlock className="h-5 w-5 text-primary" />
                  Smart Unlock
                </DialogTitle>
                <DialogDescription>
                  Enter your PIN to unlock. This will wake the screen and type the PIN.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="pin">PIN Code</Label>
                  <Input
                    id="pin"
                    type="password"
                    maxLength={4}
                    placeholder="••••"
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value.replace(/\D/g, ""));
                      setPinError(false);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleUnlockAttempt()}
                    className={cn("text-center text-2xl tracking-[0.5em]", pinError && "border-destructive")}
                  />
                  {pinError && (
                    <p className="text-sm text-destructive">Incorrect PIN. Please try again.</p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setShowPinDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleUnlockAttempt} className="gradient-primary">
                  Unlock
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </ScrollArea>
    </DashboardLayout>
  );
}
