import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { supabase } from "@/integrations/supabase/client";

const UNLOCK_PIN = "1212";

export default function SystemControls() {
  const [volume, setVolume] = useState(50);
  const [brightness, setBrightness] = useState(75);
  const [isMuted, setIsMuted] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
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

    // Subscribe to device updates
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

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    sendCommand("set_volume", { level: newVolume });
  };

  const handleBrightnessChange = (value: number[]) => {
    const newBrightness = value[0];
    setBrightness(newBrightness);
    sendCommand("set_brightness", { level: newBrightness });
  };

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

  const handleUnlockAttempt = () => {
    if (pinInput === UNLOCK_PIN) {
      setIsLocked(false);
      setPinInput("");
      setPinError(false);
      setShowPinDialog(false);
      sendCommand("unlock", { pin: UNLOCK_PIN });
      toast({ title: "PC Unlocked", description: "Your PC has been unlocked" });
    } else {
      setPinError(true);
      setPinInput("");
    }
  };

  const powerActions = [
    { title: "Shutdown", icon: Power, color: "text-destructive", command: "shutdown", description: "Turn off your PC completely" },
    { title: "Restart", icon: RotateCcw, color: "text-neon-orange", command: "restart", description: "Restart your PC" },
    { title: "Sleep", icon: Sleep, color: "text-neon-purple", command: "sleep", description: "Put your PC to sleep" },
    { title: "Hibernate", icon: Snowflake, color: "text-neon-cyan", command: "hibernate", description: "Hibernate your PC" },
  ];

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-6rem)]">
        <div className="space-y-6 animate-fade-in pr-4">
          {/* Header */}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold neon-text">System Controls</h1>
            <p className="text-muted-foreground text-sm md:text-base">Manage your PC settings remotely</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {/* Volume Control */}
            <Card className="glass-dark border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-lg md:text-xl">
                  <div className="p-2 rounded-lg bg-neon-blue/10">
                    <Volume2 className="h-5 w-5 text-neon-blue" />
                  </div>
                  Volume Control
                </CardTitle>
                <CardDescription className="text-sm">Adjust your PC's volume level</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Volume Level</span>
                  <span className="text-2xl font-bold text-neon-blue">{isMuted ? 0 : volume}%</span>
                </div>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  onValueChange={handleVolumeChange}
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
                <CardTitle className="flex items-center gap-3 text-lg md:text-xl">
                  <div className="p-2 rounded-lg bg-neon-orange/10">
                    <Sun className="h-5 w-5 text-neon-orange" />
                  </div>
                  Brightness Control
                </CardTitle>
                <CardDescription className="text-sm">Adjust your screen brightness</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Brightness Level</span>
                  <span className="text-2xl font-bold text-neon-orange">{brightness}%</span>
                </div>
                <Slider
                  value={[brightness]}
                  onValueChange={handleBrightnessChange}
                  max={100}
                  step={5}
                  className="cursor-pointer"
                />
                <div className="flex gap-2">
                  <Button 
                    variant="secondary" 
                    className="flex-1" 
                    onClick={() => {
                      setBrightness(25);
                      sendCommand("set_brightness", { level: 25 });
                    }}
                  >
                    <Moon className="h-4 w-4 mr-2" /> Dim
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
                <CardTitle className="flex items-center gap-3 text-lg md:text-xl">
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
                <div className="flex items-center justify-between p-3 md:p-4 rounded-lg bg-secondary">
                  <div className="flex items-center gap-3">
                    <Monitor className="h-6 w-6 md:h-8 md:w-8 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm md:text-base">Lock Status</p>
                      <p className={cn("text-xs md:text-sm", isLocked ? "text-neon-pink" : "text-neon-green")}>
                        {isLocked ? "Locked" : "Unlocked"}
                      </p>
                    </div>
                  </div>
                  <div className={cn("w-3 h-3 md:w-4 md:h-4 rounded-full", isLocked ? "bg-neon-pink" : "bg-neon-green")} />
                </div>

                {isLocked ? (
                  <Button
                    className="w-full gradient-primary"
                    onClick={() => setShowPinDialog(true)}
                  >
                    <Unlock className="h-4 w-4 mr-2" /> Unlock PC
                  </Button>
                ) : (
                  <Button variant="secondary" className="w-full" onClick={handleLock}>
                    <Lock className="h-4 w-4 mr-2" /> Lock PC
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Power Options */}
            <Card className="glass-dark border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-lg md:text-xl">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <Power className="h-5 w-5 text-destructive" />
                  </div>
                  Power Options
                </CardTitle>
                <CardDescription className="text-sm">Control your PC's power state</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  {powerActions.map((action) => (
                    <AlertDialog key={action.command}>
                      <AlertDialogTrigger asChild>
                        <Button variant="secondary" className="h-auto py-3 md:py-4 flex flex-col gap-1 md:gap-2 hover-scale">
                          <action.icon className={cn("h-5 w-5 md:h-6 md:w-6", action.color)} />
                          <span className="text-xs md:text-sm">{action.title}</span>
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
                  Enter PIN to Unlock
                </DialogTitle>
                <DialogDescription>
                  Enter your 4-digit PIN to unlock the PC
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
