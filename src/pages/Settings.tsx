import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Settings2, Bell, Shield, Mic, Monitor, Check, Link2Off, Phone, PhoneIncoming, Clock, Copy, FileUp, Smartphone, ArrowRight, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useNavigate } from "react-router-dom";
import { StreamingDiagnostics } from "@/components/StreamingDiagnostics";
import { BackButton } from "@/components/BackButton";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export default function Settings() {
  const [wakeWord, setWakeWord] = useState("Hey Jarvis");
  const [unlockPin, setUnlockPin] = useState("1212");
  const [notifications, setNotifications] = useState(true);
  const { toast } = useToast();
  const { session, unpair } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();
  const { sendCommand } = useDeviceCommands();
  const navigate = useNavigate();

  // Notification state
  const [notifEnabled, setNotifEnabled] = useState(() => localStorage.getItem("notif_enabled") === "true");

  // Call detection state
  const [autoMuteCall, setAutoMuteCall] = useState(() => localStorage.getItem("auto_mute_call") !== "false");
  const [autoPauseCall, setAutoPauseCall] = useState(() => localStorage.getItem("auto_pause_call") !== "false");
  const [callState, setCallState] = useState({ active: false, number: "", name: "", duration: 0 });

  const isConnected = selectedDevice?.is_online || false;

  // Persist settings
  useEffect(() => localStorage.setItem("notif_enabled", String(notifEnabled)), [notifEnabled]);
  useEffect(() => localStorage.setItem("auto_mute_call", String(autoMuteCall)), [autoMuteCall]);
  useEffect(() => localStorage.setItem("auto_pause_call", String(autoPauseCall)), [autoPauseCall]);

  // Call duration timer
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

  const simulateCall = useCallback(async () => {
    setCallState({ active: true, number: "+1 (555) 123-4567", name: "Test Caller", duration: 0 });
    if (autoMuteCall) {
      try {
        await sendCommand("mute_pc", {}, { awaitResult: true, timeoutMs: 5000 });
        toast({ title: "PC Muted", description: "Call detected" });
      } catch {}
    }
    if (autoPauseCall) {
      try {
        await sendCommand("media_control", { action: "pause" }, { awaitResult: true, timeoutMs: 5000 });
      } catch {}
    }
  }, [autoMuteCall, autoPauseCall, sendCommand, toast]);

  const simulateEndCall = useCallback(async () => {
    setCallState({ active: false, number: "", name: "", duration: 0 });
    if (autoMuteCall) {
      try {
        await sendCommand("unmute_pc", {}, { awaitResult: true, timeoutMs: 5000 });
        toast({ title: "PC Unmuted", description: "Call ended" });
      } catch {}
    }
  }, [autoMuteCall, sendCommand, toast]);

  const handleSave = () => {
    toast({ title: "Settings Saved", description: "Your preferences have been updated" });
  };

  const handleUnpair = () => {
    unpair();
    toast({ title: "Device Unpaired", description: "You've been disconnected from your PC" });
    navigate("/pair", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto p-4 space-y-4 animate-fade-in">
        <div className="flex items-center gap-4">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">Configure your Jarvis assistant</p>
          </div>
        </div>

        {/* Streaming Diagnostics */}
        <StreamingDiagnostics />

        {/* Voice Settings */}
        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Mic className="h-4 w-4 text-primary" />Voice Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Wake Word</Label>
              <Input value={wakeWord} onChange={(e) => setWakeWord(e.target.value)} className="h-8 text-sm" />
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4 text-primary" />Security</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Unlock PIN</Label>
              <Input type="password" value={unlockPin} onChange={(e) => setUnlockPin(e.target.value)} maxLength={4} className="h-8 text-sm" />
            </div>
          </CardContent>
        </Card>

        {/* Device Connection */}
        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Monitor className="h-4 w-4 text-primary" />Device Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
                <div>
                  <p className="text-sm font-medium">{selectedDevice?.name || session?.device_name || "My PC"}</p>
                  <p className="text-xs text-muted-foreground">{isConnected ? "Online" : "Offline"}</p>
                </div>
              </div>
              <Badge variant="outline" className={isConnected ? "bg-green-500/10 text-green-500 border-green-500/30 text-xs" : "text-xs"}>
                {isConnected ? "Online" : "Offline"}
              </Badge>
            </div>
            <Button variant="destructive" className="w-full h-9 text-sm" onClick={handleUnpair}>
              <Link2Off className="h-4 w-4 mr-2" /> Unpair Device
            </Button>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-primary" />Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Notification Sync</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                  <Smartphone className="w-3 h-3" />
                  <ArrowRight className="w-3 h-3" />
                  <Monitor className="w-3 h-3" />
                  <span>{notifEnabled ? "Mirroring phone notifications" : "Enable to sync"}</span>
                </div>
              </div>
              <Switch checked={notifEnabled} onCheckedChange={(v) => {
                setNotifEnabled(v);
                sendCommand(v ? "start_notification_sync" : "stop_notification_sync", {});
                toast({ title: v ? "Sync Active" : "Sync Disabled" });
              }} />
            </div>

            {notifEnabled && (
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => {
                  sendCommand("get_clipboard", {}, { awaitResult: true, timeoutMs: 3000 }).then(r => {
                    if (r.success && 'result' in r) {
                      const content = (r.result as any)?.content;
                      if (content) {
                        navigator.clipboard.writeText(content);
                        toast({ title: "Clipboard synced" });
                      }
                    }
                  });
                }}>
                  <Copy className="w-3 h-3" /> Clipboard
                </Button>
                <Link to="/files">
                  <Button variant="outline" size="sm" className="text-xs h-7 gap-1">
                    <FileUp className="w-3 h-3" /> Files
                  </Button>
                </Link>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border/20">
              <div>
                <p className="text-sm font-medium">Push Notifications</p>
                <p className="text-xs text-muted-foreground">Receive alerts from your PC</p>
              </div>
              <Switch checked={notifications} onCheckedChange={setNotifications} />
            </div>
          </CardContent>
        </Card>

        {/* Call Detection */}
        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className={cn("h-4 w-4", callState.active ? "text-primary" : "text-muted-foreground")} />
              Call Detection
              {callState.active && (
                <Badge variant="outline" className="ml-auto font-mono text-[10px] gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(callState.duration)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <div className={cn("flex-1 flex items-center justify-between p-2 rounded-lg border text-xs", autoMuteCall ? "border-primary/30 bg-primary/5" : "border-border/50")}>
                <span>Auto Mute PC</span>
                <Switch checked={autoMuteCall} onCheckedChange={setAutoMuteCall} className="scale-75" />
              </div>
              <div className={cn("flex-1 flex items-center justify-between p-2 rounded-lg border text-xs", autoPauseCall ? "border-primary/30 bg-primary/5" : "border-border/50")}>
                <span>Auto Pause Media</span>
                <Switch checked={autoPauseCall} onCheckedChange={setAutoPauseCall} className="scale-75" />
              </div>
            </div>

            {callState.active ? (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/30">
                <div className="flex items-center gap-2 mb-2">
                  <Phone className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{callState.name || callState.number}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground">PC muted & media paused</span>
                  <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={simulateEndCall}>End Test</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1" onClick={simulateCall} disabled={!isConnected}>
                <PhoneIncoming className="h-3 w-3" /> Test Call Detection
              </Button>
            )}
          </CardContent>
        </Card>

        <Button onClick={handleSave} className="w-full h-9 text-sm">
          <Check className="h-4 w-4 mr-2" /> Save Settings
        </Button>
      </div>
    </div>
  );
}
