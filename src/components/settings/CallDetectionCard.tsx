import { Phone, PhoneIncoming, PhoneOff, Clock, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

interface CallDetectionCardProps {
  isNative: boolean;
  callState: any;
  callDetectionActive: boolean;
  autoPauseEnabled: boolean;
  autoMuteEnabled: boolean;
  isConnected: boolean;
  setAutoPauseEnabled: (v: boolean) => void;
  setAutoMuteEnabled: (v: boolean) => void;
  toggleCallDetection: () => void;
  simulateCall: (start: boolean) => void;
}

export function CallDetectionCard({
  isNative, callState, callDetectionActive,
  autoPauseEnabled, autoMuteEnabled, isConnected,
  setAutoPauseEnabled, setAutoMuteEnabled,
  toggleCallDetection, simulateCall,
}: CallDetectionCardProps) {
  const [callDuration, setCallDuration] = useState(0);

  useEffect(() => {
    if (!callState.isInCall) { setCallDuration(0); return; }
    const timer = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [callState.isInCall]);

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center gap-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", callState.isInCall ? "bg-primary/15" : "bg-accent-cyan/10")}>
            <Phone className={cn("h-4 w-4", callState.isInCall ? "text-primary animate-pulse" : "text-[hsl(var(--accent-cyan))]")} />
          </div>
          Calls
          {callState.isInCall && (
            <Badge variant="outline" className="ml-auto font-mono text-[10px] gap-1 border-primary/20 bg-primary/5 rounded-lg">
              <Clock className="h-3 w-3" />
              {formatDuration(callDuration)}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 space-y-3">
        {/* Status */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 border border-border/5">
          <div className="flex items-center gap-2.5">
            {callDetectionActive
              ? <CheckCircle className="h-4 w-4 text-[hsl(var(--success))]" />
              : <XCircle className="h-4 w-4 text-muted-foreground" />}
            <div>
              <p className="text-xs font-medium">{callDetectionActive ? "Monitoring" : "Off"}</p>
              <p className="text-[10px] text-muted-foreground">
                {isNative
                  ? `TelephonyManager${callState.phoneState ? ` · ${callState.phoneState}` : ""}`
                  : "Web · Test only"}
              </p>
            </div>
          </div>
          <Switch checked={callDetectionActive} onCheckedChange={toggleCallDetection} />
        </div>

        {/* Auto-actions */}
        <div className="grid grid-cols-2 gap-2">
          <div className={cn("flex items-center justify-between p-2.5 rounded-xl border text-xs", autoMuteEnabled ? "border-primary/20 bg-primary/5" : "border-border/5 bg-secondary/10")}>
            <span>Auto Mute</span>
            <Switch checked={autoMuteEnabled} onCheckedChange={setAutoMuteEnabled} className="scale-75" />
          </div>
          <div className={cn("flex items-center justify-between p-2.5 rounded-xl border text-xs", autoPauseEnabled ? "border-primary/20 bg-primary/5" : "border-border/5 bg-secondary/10")}>
            <span>Auto Pause</span>
            <Switch checked={autoPauseEnabled} onCheckedChange={setAutoPauseEnabled} className="scale-75" />
          </div>
        </div>

        {/* Active call */}
        {callState.isInCall ? (
          <div className="p-3 rounded-xl bg-primary/8 border border-primary/20 animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <Phone className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-sm font-medium">{callState.callerName || callState.callerNumber || "Active Call"}</span>
            </div>
            <div className="flex justify-between items-center text-[10px] text-muted-foreground">
              <div className="flex gap-2">
                {autoMuteEnabled && <span className="text-primary">🔇 Muted</span>}
                {autoPauseEnabled && <span className="text-primary">⏸ Paused</span>}
              </div>
              {!isNative && (
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => simulateCall(false)}>
                  <PhoneOff className="h-3 w-3" /> End
                </Button>
              )}
            </div>
          </div>
        ) : !isNative && (
          <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5 rounded-xl" onClick={() => simulateCall(true)} disabled={!isConnected}>
            <PhoneIncoming className="h-3 w-3" /> Test Call Detection
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
