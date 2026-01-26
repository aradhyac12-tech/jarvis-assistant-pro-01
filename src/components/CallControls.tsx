import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  PhoneOutgoing,
  Mic,
  MicOff,
  Pause,
  Play,
  Volume2,
  VolumeX,
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
  muted: boolean;
}

export function CallControls({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();
  
  const [autoMuteMedia, setAutoMuteMedia] = useState(true);
  const [autoPauseMedia, setAutoPauseMedia] = useState(true);
  const [callState, setCallState] = useState<CallState>({
    active: false,
    incoming: false,
    number: "",
    name: "",
    duration: 0,
    muted: false,
  });

  // Duration timer
  useEffect(() => {
    if (!callState.active) return;
    
    const timer = setInterval(() => {
      setCallState(prev => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
    
    return () => clearInterval(timer);
  }, [callState.active]);

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Toggle mute
  const toggleMute = useCallback(async () => {
    await sendCommand("call_mute", { mute: !callState.muted });
    setCallState(prev => ({ ...prev, muted: !prev.muted }));
  }, [callState.muted, sendCommand]);

  // End call
  const endCall = useCallback(async () => {
    await sendCommand("end_call", {});
    setCallState({
      active: false,
      incoming: false,
      number: "",
      name: "",
      duration: 0,
      muted: false,
    });
    
    // Resume media if enabled
    if (autoPauseMedia) {
      await sendCommand("media_control", { action: "play_pause" });
    }
    if (autoMuteMedia) {
      await sendCommand("unmute_pc", {});
    }
  }, [sendCommand, autoPauseMedia, autoMuteMedia]);

  // Answer call
  const answerCall = useCallback(async () => {
    // Auto mute/pause media when answering
    if (autoMuteMedia) {
      await sendCommand("mute_pc", {});
    }
    if (autoPauseMedia) {
      await sendCommand("media_control", { action: "pause" });
    }
    
    await sendCommand("answer_call", {});
    setCallState(prev => ({ ...prev, active: true, incoming: false }));
  }, [sendCommand, autoMuteMedia, autoPauseMedia]);

  // Decline call
  const declineCall = useCallback(async () => {
    await sendCommand("decline_call", {});
    setCallState({
      active: false,
      incoming: false,
      number: "",
      name: "",
      duration: 0,
      muted: false,
    });
  }, [sendCommand]);

  // Simulate incoming call for demo
  const simulateCall = () => {
    setCallState({
      active: false,
      incoming: true,
      number: "+1 (555) 123-4567",
      name: "John Doe",
      duration: 0,
      muted: false,
    });
  };

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Phone className="h-5 w-5 text-primary" />
          Call Controls
        </CardTitle>
        <CardDescription>
          Auto-mute and pause media during phone calls
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

        {/* Active/Incoming call UI */}
        {callState.incoming || callState.active ? (
          <div className={cn(
            "p-4 rounded-xl border-2 transition-colors",
            callState.incoming 
              ? "bg-primary/10 border-primary animate-pulse" 
              : "bg-secondary/30 border-border/50"
          )}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-3 rounded-full",
                  callState.incoming ? "bg-primary text-primary-foreground" : "bg-secondary"
                )}>
                  {callState.incoming ? (
                    <PhoneIncoming className="h-5 w-5" />
                  ) : (
                    <Phone className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{callState.name || callState.number}</p>
                  {callState.name && (
                    <p className="text-xs text-muted-foreground">{callState.number}</p>
                  )}
                </div>
              </div>
              
              {callState.active && (
                <Badge variant="outline" className="font-mono">
                  <Clock className="h-3 w-3 mr-1" />
                  {formatDuration(callState.duration)}
                </Badge>
              )}
            </div>

            {callState.incoming ? (
              <div className="flex gap-2">
                <Button
                  onClick={declineCall}
                  variant="destructive"
                  className="flex-1"
                >
                  <PhoneOff className="h-4 w-4 mr-2" />
                  Decline
                </Button>
                <Button
                  onClick={answerCall}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  <Phone className="h-4 w-4 mr-2" />
                  Answer
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  onClick={toggleMute}
                  variant={callState.muted ? "default" : "outline"}
                  className="flex-1"
                >
                  {callState.muted ? (
                    <MicOff className="h-4 w-4 mr-2" />
                  ) : (
                    <Mic className="h-4 w-4 mr-2" />
                  )}
                  {callState.muted ? "Unmute" : "Mute"}
                </Button>
                <Button
                  onClick={endCall}
                  variant="destructive"
                  className="flex-1"
                >
                  <PhoneOff className="h-4 w-4 mr-2" />
                  End
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
            <Phone className="h-10 w-10 mb-3" />
            <p className="text-sm">No active calls</p>
            <p className="text-xs mt-1">Media will be paused automatically when you receive a call</p>
            
            {/* Demo button */}
            <Button
              variant="outline"
              size="sm"
              onClick={simulateCall}
              className="mt-4"
            >
              <PhoneIncoming className="h-4 w-4 mr-2" />
              Simulate Incoming Call
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
