import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Headphones,
  Bluetooth,
  BluetoothConnected,
  BluetoothOff,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Smartphone,
  Monitor,
  Zap,
  Radio,
  ArrowRightLeft,
  Volume2,
  Waves,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useSeamlessBuds, isGalaxyBuds } from "@/hooks/useSeamlessBuds";

export function GalaxyBudsManager({ className }: { className?: string }) {
  const { toast } = useToast();
  const {
    state,
    autoSwitch,
    setAutoSwitch,
    fallbackDeviceId,
    setFallbackDeviceId,
    poll,
    startAudioStream,
    stopAudioStream,
    switchPcOutput,
  } = useSeamlessBuds();

  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const handleSwitchDevice = async (deviceId: string, deviceName: string) => {
    setSwitchingTo(deviceId);
    try {
      const ok = await switchPcOutput(deviceId);
      toast({
        title: ok ? "Audio Output Changed" : "Switch Failed",
        description: ok ? `Now using: ${deviceName}` : "Could not change audio output",
        variant: ok ? "default" : "destructive",
      });
      if (ok) poll();
    } catch {
      toast({ title: "Switch Error", variant: "destructive" });
    }
    setSwitchingTo(null);
  };

  const handleStreamToggle = () => {
    if (state.isStreaming) {
      stopAudioStream();
      toast({ title: "Audio Stream Stopped", description: "PC audio no longer routed to phone" });
    } else {
      startAudioStream();
      toast({ title: "Audio Stream Started", description: "PC system audio → Phone (Buds)" });
    }
  };

  const locationIcon = () => {
    switch (state.budsLocation) {
      case "phone": return <Smartphone className="h-5 w-5 text-primary" />;
      case "pc": return <Monitor className="h-5 w-5 text-primary" />;
      case "both": return <ArrowRightLeft className="h-5 w-5 text-primary" />;
      default: return <BluetoothOff className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const locationLabel = () => {
    switch (state.budsLocation) {
      case "phone": return "Connected to Phone";
      case "pc": return "Connected to PC";
      case "both": return "Detected on both";
      default: return "Not detected";
    }
  };

  const routeLabel = () => {
    switch (state.audioRoute) {
      case "direct": return "Direct to Buds (PC)";
      case "streaming": return "PC Audio → Phone → Buds";
      default: return "No active route";
    }
  };

  const fallbackOptions = state.pcDevices.filter((d) => !isGalaxyBuds(d.name));

  return (
    <Card className={cn("border-border/50 bg-card/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Headphones className="h-5 w-5 text-primary" />
          Seamless Buds
        </CardTitle>
        <CardDescription>
          Samsung-style audio switching between PC & Phone
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status Banner */}
        <div className={cn(
          "flex items-center gap-3 p-3 rounded-lg",
          state.budsLocation !== "none" ? "bg-primary/10" : "bg-secondary/30"
        )}>
          {locationIcon()}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {state.pcBudsName || state.phoneBudsName || "Galaxy Buds"}
            </p>
            <p className="text-xs text-muted-foreground">{locationLabel()}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {state.budsLocation !== "none" && (
              <Badge variant="outline" className="text-[10px] border-primary text-primary">
                <Bluetooth className="h-3 w-3 mr-0.5" />
                {state.budsLocation}
              </Badge>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={poll}>
              <RefreshCw className={cn("h-3.5 w-3.5", state.isPolling && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Audio Route Indicator */}
        <div className={cn(
          "flex items-center gap-3 p-2.5 rounded-lg border",
          state.audioRoute === "streaming"
            ? "border-primary/40 bg-primary/5"
            : state.audioRoute === "direct"
              ? "border-primary/20 bg-primary/5"
              : "border-border/30 bg-secondary/20"
        )}>
          {state.audioRoute === "streaming" ? (
            <Waves className="h-4 w-4 text-primary animate-pulse" />
          ) : state.audioRoute === "direct" ? (
            <Volume2 className="h-4 w-4 text-primary" />
          ) : (
            <Radio className="h-4 w-4 text-muted-foreground" />
          )}
          <div className="flex-1">
            <p className="text-xs font-medium">{routeLabel()}</p>
            {state.isStreaming && (
              <p className="text-[10px] text-muted-foreground">
                Streaming PC system audio to your phone
              </p>
            )}
          </div>
          {state.budsLocation === "phone" && (
            <Button
              size="sm"
              variant={state.isStreaming ? "destructive" : "default"}
              className="h-7 text-xs px-3"
              onClick={handleStreamToggle}
            >
              {state.isStreaming ? "Stop" : "Stream PC Audio"}
            </Button>
          )}
        </div>

        <Tabs defaultValue="settings" className="w-full">
          <TabsList className="w-full grid grid-cols-2 h-8">
            <TabsTrigger value="settings" className="text-xs h-7">Settings</TabsTrigger>
            <TabsTrigger value="devices" className="text-xs h-7">PC Devices</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-3 mt-3">
            {/* Auto-Switch Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
              <div className="flex items-center gap-3">
                <Zap className="h-4 w-4 text-primary" />
                <div>
                  <Label htmlFor="auto-switch-buds" className="font-medium text-sm">Seamless Auto-Switch</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Auto-stream when buds move to phone, auto-switch back on PC
                  </p>
                </div>
              </div>
              <Switch
                id="auto-switch-buds"
                checked={autoSwitch}
                onCheckedChange={setAutoSwitch}
              />
            </div>

            {/* Fallback Device */}
            <div className="space-y-1.5">
              <Label className="text-xs">Fallback when buds disconnect</Label>
              <Select value={fallbackDeviceId || ""} onValueChange={setFallbackDeviceId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select fallback speaker" />
                </SelectTrigger>
                <SelectContent>
                  {fallbackOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        {d.isDefault && <CheckCircle2 className="h-3 w-3 text-primary" />}
                        {d.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Detection Status */}
            <div className="grid grid-cols-2 gap-2">
              <div className={cn(
                "p-2.5 rounded-lg border text-center",
                state.phoneBudsDetected ? "border-primary/30 bg-primary/5" : "border-border/30 bg-secondary/10"
              )}>
                <Smartphone className={cn("h-4 w-4 mx-auto mb-1", state.phoneBudsDetected ? "text-primary" : "text-muted-foreground")} />
                <p className="text-[10px] font-medium">{state.phoneBudsDetected ? "On Phone" : "Not on Phone"}</p>
                {state.phoneBudsName && (
                  <p className="text-[9px] text-muted-foreground truncate">{state.phoneBudsName}</p>
                )}
              </div>
              <div className={cn(
                "p-2.5 rounded-lg border text-center",
                state.pcBudsDetected ? "border-primary/30 bg-primary/5" : "border-border/30 bg-secondary/10"
              )}>
                <Monitor className={cn("h-4 w-4 mx-auto mb-1", state.pcBudsDetected ? "text-primary" : "text-muted-foreground")} />
                <p className="text-[10px] font-medium">{state.pcBudsDetected ? "On PC" : "Not on PC"}</p>
                {state.pcBudsName && (
                  <p className="text-[9px] text-muted-foreground truncate">{state.pcBudsName}</p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="devices" className="space-y-2 mt-3">
            {state.pcDevices.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No PC audio devices detected. Make sure agent is running.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {state.pcDevices.map((device) => (
                  <button
                    key={device.id}
                    onClick={() => handleSwitchDevice(device.id, device.name)}
                    disabled={switchingTo !== null}
                    className={cn(
                      "w-full flex items-center gap-2 p-2.5 rounded-lg text-left text-sm transition-colors",
                      device.isDefault
                        ? "bg-primary/10 border border-primary/30"
                        : "bg-secondary/20 hover:bg-secondary/40",
                      switchingTo === device.id && "opacity-70"
                    )}
                  >
                    {device.isBluetooth ? (
                      <BluetoothConnected className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 truncate text-xs">{device.name}</span>
                    {switchingTo === device.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : device.isDefault ? (
                      <Badge variant="outline" className="text-[10px]">Active</Badge>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Status Footer */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border/50">
          <span className="flex items-center gap-1.5">
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              state.isStreaming ? "bg-primary animate-pulse" : "bg-muted"
            )} />
            {state.isStreaming ? "Streaming" : state.isPolling ? "Polling..." : "Idle"}
          </span>
          {state.lastPollTime > 0 && (
            <span>Last: {Math.round((Date.now() - state.lastPollTime) / 1000)}s ago</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
