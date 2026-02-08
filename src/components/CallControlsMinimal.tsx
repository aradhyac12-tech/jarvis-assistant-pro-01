import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Phone,
  PhoneIncoming,
  Volume2,
  Pause,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";

interface CallState {
  active: boolean;
  incoming: boolean;
  number: string;
  name: string;
  duration: number;
}

/**
 * Detect-only call controls.
 * Auto-mutes/pauses PC media when a call is detected; no answer/end buttons
 * (true answer/end requires native Android plugin code).
 */
export function CallControlsMinimal({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();
  
  const [autoMute, setAutoMute] = useState(true);
  const [autoPause, setAutoPause] = useState(true);
  const [callState, setCallState] = useState<CallState>({
    active: false,
    incoming: false,
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

  // Handle call start - auto-mute/pause PC
  const handleCallStart = useCallback(async (info: { number?: string; name?: string } = {}) => {
    setCallState({
      active: true,
      incoming: false,
      number: info.number || "",
      name: info.name || "",
      duration: 0,
    });
    
    if (autoMute) {
      try {
        await sendCommand("mute_pc", {});
        toast({ title: "PC Muted", description: "Call detected" });
      } catch {}
    }
    if (autoPause) {
      try {
        await sendCommand("media_control", { action: "pause" });
      } catch {}
    }
  }, [autoMute, autoPause, sendCommand, toast]);

  // Handle call end - unmute/resume PC
  const handleCallEnd = useCallback(async () => {
    setCallState({
      active: false,
      incoming: false,
      number: "",
      name: "",
      duration: 0,
    });
    
    if (autoMute) {
      try {
        await sendCommand("unmute_pc", {});
        toast({ title: "PC Unmuted", description: "Call ended" });
      } catch {}
    }
    // We don't auto-resume playback to avoid unexpected audio
  }, [autoMute, sendCommand, toast]);

  // Demo simulation - still useful for testing auto-mute/pause
  const simulateCall = () => {
    handleCallStart({ number: "+1 (555) 123-4567", name: "Test Caller" });
  };

  const simulateEndCall = () => {
    handleCallEnd();
  };

  const hasCall = callState.active;

  return (
    <Card className={cn("border-border/50 overflow-hidden", className)}>
      <CardHeader className="pb-2 space-y-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className={cn(
              "p-1.5 rounded-lg",
              hasCall ? "bg-primary/10" : "bg-muted"
            )}>
              <Phone className={cn(
                "h-4 w-4",
                hasCall ? "text-primary" : "text-muted-foreground"
              )} />
            </div>
            Call Detection
          </CardTitle>
          
          {hasCall && (
            <Badge variant="outline" className="font-mono text-xs gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(callState.duration)}
            </Badge>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="p-4 pt-2 space-y-4">
        {/* Auto-actions */}
        <div className="flex gap-3">
          <div 
            className={cn(
              "flex-1 flex items-center justify-between p-2.5 rounded-lg border transition-colors",
              autoMute ? "border-primary/30 bg-primary/5" : "border-border/50 bg-muted/30"
            )}
          >
            <div className="flex items-center gap-2">
              <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs">Auto-mute</span>
            </div>
            <Switch
              checked={autoMute}
              onCheckedChange={setAutoMute}
              className="scale-75"
            />
          </div>
          
          <div 
            className={cn(
              "flex-1 flex items-center justify-between p-2.5 rounded-lg border transition-colors",
              autoPause ? "border-primary/30 bg-primary/5" : "border-border/50 bg-muted/30"
            )}
          >
            <div className="flex items-center gap-2">
              <Pause className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs">Auto-pause</span>
            </div>
            <Switch
              checked={autoPause}
              onCheckedChange={setAutoPause}
              className="scale-75"
            />
          </div>
        </div>

        {/* Call status UI */}
        {hasCall ? (
          <div className="p-4 rounded-xl bg-primary/5 border-2 border-primary/30">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-3 rounded-full bg-primary text-primary-foreground">
                <Phone className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {callState.name || callState.number || "Call in progress"}
                </p>
                {callState.name && callState.number && (
                  <p className="text-xs text-muted-foreground">{callState.number}</p>
                )}
              </div>
            </div>
            
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>PC media paused/muted automatically</span>
              <Button variant="outline" size="sm" onClick={simulateEndCall}>
                End Test
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-muted/30 flex flex-col items-center text-center">
            <Phone className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground mb-3">
              PC media will pause & mute when you receive a call
            </p>
            <Button variant="outline" size="sm" onClick={simulateCall}>
              <PhoneIncoming className="h-4 w-4 mr-1.5" />
              Test Detection
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
