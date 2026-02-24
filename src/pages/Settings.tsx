import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Settings2, Bell, Shield, Mic, Monitor, Check, Link2Off, Phone, PhoneIncoming, PhoneOff, Clock, Copy, FileUp, Smartphone, ArrowRight, Activity, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useCapacitorPlugins } from "@/hooks/useCapacitorPlugins";
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

  const {
    isNative,
    platform,
    callState,
    callDetectionActive,
    autoPauseEnabled,
    autoMuteEnabled,
    setAutoPauseEnabled,
    setAutoMuteEnabled,
    initCallDetection,
    stopCallDetection,
    simulateCall,
  } = useCapacitorPlugins();

  // Notification state
  const [notifEnabled, setNotifEnabled] = useState(() => localStorage.getItem("notif_enabled") === "true");

  // Call duration timer
  const [callDuration, setCallDuration] = useState(0);

  const isConnected = selectedDevice?.is_online || false;

  // Persist notification setting
  useEffect(() => localStorage.setItem("notif_enabled", String(notifEnabled)), [notifEnabled]);

  // Call duration timer
  useEffect(() => {
    if (!callState.isInCall) {
      setCallDuration(0);
      return;
    }
    const timer = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [callState.isInCall]);

  // Auto-start call detection on mount if native
  useEffect(() => {
    if (isNative && !callDetectionActive) {
      initCallDetection();
    }
  }, [isNative, callDetectionActive, initCallDetection]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSave = () => {
    toast({ title: "Settings Saved", description: "Your preferences have been updated" });
  };

  const handleUnpair = () => {
    unpair();
    toast({ title: "Device Unpaired", description: "You've been disconnected from your PC" });
    navigate("/pair", { replace: true });
  };

  const toggleCallDetection = async () => {
    if (callDetectionActive) {
      await stopCallDetection();
      toast({ title: "Call Detection Disabled" });
    } else {
      const success = await initCallDetection();
      toast({ 
        title: success ? "Call Detection Enabled" : "Call Detection Failed",
        description: success 
          ? (isNative ? "Using Android TelephonyManager" : "Web fallback mode")
          : "Could not activate phone state listener",
        variant: success ? "default" : "destructive",
      });
    }
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

        {/* Call Detection - Real Native Integration */}
        <Card className="border-border/30 bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className={cn("h-4 w-4", callState.isInCall ? "text-primary animate-pulse" : "text-muted-foreground")} />
              Call Detection
              {callState.isInCall && (
                <Badge variant="outline" className="ml-auto font-mono text-[10px] gap-1 border-primary/30 bg-primary/5">
                  <Clock className="h-3 w-3" />
                  {formatDuration(callDuration)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Detection Status */}
            <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-secondary/20">
              <div className="flex items-center gap-2">
                {callDetectionActive ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                )}
                <div>
                  <p className="text-xs font-medium">
                    {callDetectionActive ? "Monitoring Active" : "Detection Off"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {isNative 
                      ? `Android TelephonyManager${callState.phoneState ? ` • ${callState.phoneState}` : ""}` 
                      : "Web mode • Test only"}
                  </p>
                </div>
              </div>
              <Switch 
                checked={callDetectionActive} 
                onCheckedChange={toggleCallDetection}
              />
            </div>

            {/* Auto-actions */}
            <div className="flex gap-2">
              <div className={cn("flex-1 flex items-center justify-between p-2 rounded-lg border text-xs", autoMuteEnabled ? "border-primary/30 bg-primary/5" : "border-border/50")}>
                <span>Auto Mute PC</span>
                <Switch checked={autoMuteEnabled} onCheckedChange={setAutoMuteEnabled} className="scale-75" />
              </div>
              <div className={cn("flex-1 flex items-center justify-between p-2 rounded-lg border text-xs", autoPauseEnabled ? "border-primary/30 bg-primary/5" : "border-border/50")}>
                <span>Auto Pause Media</span>
                <Switch checked={autoPauseEnabled} onCheckedChange={setAutoPauseEnabled} className="scale-75" />
              </div>
            </div>

            {/* Active call state */}
            {callState.isInCall ? (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/30 animate-fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <Phone className="h-4 w-4 text-primary animate-pulse" />
                  <span className="text-sm font-medium">
                    {callState.callerName || callState.callerNumber || "Active Call"}
                  </span>
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    {callState.phoneState || callState.callType || "ACTIVE"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {autoMuteEnabled && <span className="text-primary">🔇 PC muted</span>}
                    {autoPauseEnabled && <span className="text-primary">⏸ Media paused</span>}
                  </div>
                  {!isNative && (
                    <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => simulateCall(false)}>
                      <PhoneOff className="h-3 w-3" /> End Test
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {!isNative && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full h-8 text-xs gap-1" 
                    onClick={() => simulateCall(true)} 
                    disabled={!isConnected}
                  >
                    <PhoneIncoming className="h-3 w-3" /> Test Call Detection
                  </Button>
                )}
                
                {/* Info about how it works */}
                <div className="p-2 rounded-lg bg-secondary/20 border border-border/30">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {isNative ? (
                      <>
                        <strong>KDE Connect-style detection:</strong> Uses Android's TelephonyManager 
                        with PhoneStateListener to detect RINGING, ON_CALL, OUTGOING, and IDLE states. 
                        Requires READ_PHONE_STATE permission.
                      </>
                    ) : (
                      <>
                        <strong>Web mode:</strong> Use the test button above to simulate call detection. 
                        For real call detection, build and install the APK on your Android device.
                      </>
                    )}
                  </p>
                </div>
              </div>
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
