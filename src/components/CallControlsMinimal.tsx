import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  Mic,
  MicOff,
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
  muted: boolean;
}

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

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const toggleMute = useCallback(async () => {
    await sendCommand("call_mute", { mute: !callState.muted });
    setCallState(prev => ({ ...prev, muted: !prev.muted }));
  }, [callState.muted, sendCommand]);

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
    
    if (autoPause) {
      await sendCommand("media_control", { action: "play_pause" });
    }
    if (autoMute) {
      await sendCommand("unmute_pc", {});
    }
    
    toast({ title: "Call Ended" });
  }, [sendCommand, autoPause, autoMute, toast]);

  const answerCall = useCallback(async () => {
    if (autoMute) {
      await sendCommand("mute_pc", {});
    }
    if (autoPause) {
      await sendCommand("media_control", { action: "pause" });
    }
    
    await sendCommand("answer_call", {});
    setCallState(prev => ({ ...prev, active: true, incoming: false }));
    toast({ title: "Call Answered" });
  }, [sendCommand, autoMute, autoPause, toast]);

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
    toast({ title: "Call Declined" });
  }, [sendCommand, toast]);

  // Demo simulation
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

  const hasCall = callState.incoming || callState.active;

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
            Calls
          </CardTitle>
          
          {hasCall && callState.active && (
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

        {/* Call UI */}
        {hasCall ? (
          <div className={cn(
            "p-4 rounded-xl border-2 transition-all",
            callState.incoming 
              ? "bg-primary/5 border-primary animate-pulse" 
              : "bg-muted/30 border-border/50"
          )}>
            <div className="flex items-center gap-3 mb-4">
              <div className={cn(
                "p-3 rounded-full",
                callState.incoming ? "bg-primary text-primary-foreground" : "bg-muted"
              )}>
                {callState.incoming ? (
                  <PhoneIncoming className="h-5 w-5" />
                ) : (
                  <Phone className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {callState.name || callState.number}
                </p>
                {callState.name && (
                  <p className="text-xs text-muted-foreground">{callState.number}</p>
                )}
              </div>
            </div>

            {callState.incoming ? (
              <div className="flex gap-2">
                <Button
                  onClick={declineCall}
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                >
                  <PhoneOff className="h-4 w-4 mr-1.5" />
                  Decline
                </Button>
                <Button
                  onClick={answerCall}
                  size="sm"
                  className="flex-1 bg-primary hover:bg-primary/90"
                >
                  <Phone className="h-4 w-4 mr-1.5" />
                  Answer
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  onClick={toggleMute}
                  variant={callState.muted ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                >
                  {callState.muted ? (
                    <><MicOff className="h-4 w-4 mr-1.5" /> Unmute</>
                  ) : (
                    <><Mic className="h-4 w-4 mr-1.5" /> Mute</>
                  )}
                </Button>
                <Button
                  onClick={endCall}
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                >
                  <PhoneOff className="h-4 w-4 mr-1.5" />
                  End
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-muted/30 flex flex-col items-center text-center">
            <Phone className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground mb-3">
              PC media will pause when you receive a call
            </p>
            <Button variant="outline" size="sm" onClick={simulateCall}>
              <PhoneIncoming className="h-4 w-4 mr-1.5" />
              Test Call
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
