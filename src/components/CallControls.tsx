import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Phone,
  PhoneIncoming,
  Pause,
  Volume2,
  VolumeX,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";

interface CallState {
  active: boolean;
  number: string;
  name: string;
  duration: number;
}

/**
 * Detect-only call controls with auto-mute/pause.
 * No answer/end buttons - requires native plugin for true call control.
 */
export function CallControls({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();
  
  const [autoMuteMedia, setAutoMuteMedia] = useState(true);
  const [autoPauseMedia, setAutoPauseMedia] = useState(true);
  const [callState, setCallState] = useState<CallState>({
    active: false,
    number: "",
    name: "",
    duration: 0,
  });

  // Duration timer
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

  // Handle call detected - auto-mute/pause PC
  const handleCallStart = useCallback(async (info: { number?: string; name?: string } = {}) => {
    setCallState({
      active: true,
      number: info.number || "",
      name: info.name || "",
      duration: 0,
    });
    
    if (autoMuteMedia) {
      try {
        await sendCommand("mute_pc", {});
        toast({ title: "PC Muted", description: "Call detected" });
      } catch {}
    }
    if (autoPauseMedia) {
      try {
        await sendCommand("media_control", { action: "pause" });
      } catch {}
    }
  }, [autoMuteMedia, autoPauseMedia, sendCommand, toast]);

  // Handle call ended - unmute PC
  const handleCallEnd = useCallback(async () => {
    setCallState({
      active: false,
      number: "",
      name: "",
      duration: 0,
    });
    
    if (autoMuteMedia) {
      try {
        await sendCommand("unmute_pc", {});
        toast({ title: "PC Unmuted", description: "Call ended" });
      } catch {}
    }
  }, [autoMuteMedia, sendCommand, toast]);

  // Simulate for demo/testing
  const simulateCall = () => {
    handleCallStart({ number: "+1 (555) 123-4567", name: "John Doe" });
  };

  const simulateEndCall = () => {
    handleCallEnd();
  };

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Phone className="h-5 w-5 text-primary" />
          Call Detection
        </CardTitle>
        <CardDescription>
          Auto-mute and pause media when phone calls are detected
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Settings */}
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
            <div className="flex items-center gap-2">
              <VolumeX className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="auto-mute" className="text-sm">Auto-mute PC audio</Label>
            </div>
            <Switch
              id="auto-mute"
              checked={autoMuteMedia}
              onCheckedChange={setAutoMuteMedia}
            />
          </div>
          
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
            <div className="flex items-center gap-2">
              <Pause className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="auto-pause" className="text-sm">Auto-pause media</Label>
            </div>
            <Switch
              id="auto-pause"
              checked={autoPauseMedia}
              onCheckedChange={setAutoPauseMedia}
            />
          </div>
        </div>

        {/* Call status */}
        {callState.active ? (
          <div className="p-4 rounded-xl bg-primary/10 border-2 border-primary/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-primary text-primary-foreground">
                  <Phone className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">{callState.name || callState.number || "Call in progress"}</p>
                  {callState.name && callState.number && (
                    <p className="text-xs text-muted-foreground">{callState.number}</p>
                  )}
                </div>
              </div>
              
              <Badge variant="outline" className="font-mono">
                <Clock className="h-3 w-3 mr-1" />
                {formatDuration(callState.duration)}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>PC media paused/muted automatically</span>
              <Button variant="outline" size="sm" onClick={simulateEndCall}>
                End Test
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
            <Phone className="h-10 w-10 mb-3" />
            <p className="text-sm">No active calls</p>
            <p className="text-xs mt-1">Media will be paused automatically when you receive a call</p>
            
            <Button
              variant="outline"
              size="sm"
              onClick={simulateCall}
              className="mt-4"
            >
              <PhoneIncoming className="h-4 w-4 mr-2" />
              Test Call Detection
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
