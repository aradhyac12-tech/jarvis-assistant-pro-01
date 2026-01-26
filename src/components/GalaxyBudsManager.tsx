import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Headphones,
  Bluetooth,
  BluetoothConnected,
  BluetoothOff,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  Monitor,
  Zap,
} from "lucide-react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AudioDevice {
  id: string;
  name: string;
  isDefault?: boolean;
  isBluetooth?: boolean;
}

interface BudsState {
  detected: boolean;
  connectedTo: "pc" | "phone" | "none";
  deviceName: string | null;
  lastSeen: number;
}

const GALAXY_BUDS_PATTERNS = [
  "galaxy buds",
  "buds pro",
  "buds live",
  "buds2",
  "buds fe",
  "buds+",
  "samsung buds",
  "sm-r",  // Samsung model numbers
];

function isGalaxyBuds(deviceName: string): boolean {
  const lower = deviceName.toLowerCase();
  return GALAXY_BUDS_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function GalaxyBudsManager({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  // Settings
  const [autoSwitchEnabled, setAutoSwitchEnabled] = useState(() => {
    return localStorage.getItem("galaxy-buds-auto-switch") === "true";
  });
  const [pollInterval, setPollInterval] = useState(3000); // 3 seconds
  const [preferredBudsId, setPreferredBudsId] = useState<string | null>(() => {
    return localStorage.getItem("galaxy-buds-preferred-id");
  });

  // State
  const [pcAudioDevices, setPcAudioDevices] = useState<AudioDevice[]>([]);
  const [currentDefault, setCurrentDefault] = useState<string | null>(null);
  const [budsState, setBudsState] = useState<BudsState>({
    detected: false,
    connectedTo: "none",
    deviceName: null,
    lastSeen: 0,
  });
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<number>(0);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [fallbackDevice, setFallbackDevice] = useState<string | null>(() => {
    return localStorage.getItem("galaxy-buds-fallback-id");
  });

  const pollTimerRef = useRef<number | null>(null);
  const previousDefaultRef = useRef<string | null>(null);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem("galaxy-buds-auto-switch", String(autoSwitchEnabled));
  }, [autoSwitchEnabled]);

  useEffect(() => {
    if (preferredBudsId) {
      localStorage.setItem("galaxy-buds-preferred-id", preferredBudsId);
    }
  }, [preferredBudsId]);

  useEffect(() => {
    if (fallbackDevice) {
      localStorage.setItem("galaxy-buds-fallback-id", fallbackDevice);
    }
  }, [fallbackDevice]);

  // Poll PC audio devices
  const pollAudioDevices = useCallback(async () => {
    try {
      const result = await sendCommand("list_audio_outputs", {}, { awaitResult: true, timeoutMs: 5000 });
      
      if (result.success && result.result) {
        const devices = result.result as Array<{ id: string; name: string; is_default?: boolean }>;
        
        const mapped: AudioDevice[] = devices.map((d) => ({
          id: d.id,
          name: d.name,
          isDefault: d.is_default,
          isBluetooth: d.name.toLowerCase().includes("bluetooth") || isGalaxyBuds(d.name),
        }));

        setPcAudioDevices(mapped);
        setLastPollTime(Date.now());

        // Find current default
        const defaultDevice = mapped.find((d) => d.isDefault);
        const newDefaultId = defaultDevice?.id || null;
        
        // Detect Galaxy Buds
        const budsDevice = mapped.find((d) => isGalaxyBuds(d.name));
        
        if (budsDevice) {
          setBudsState({
            detected: true,
            connectedTo: budsDevice.isDefault ? "pc" : "none",
            deviceName: budsDevice.name,
            lastSeen: Date.now(),
          });

          // Auto-set preferred buds if not set
          if (!preferredBudsId) {
            setPreferredBudsId(budsDevice.id);
          }

          // Auto-switch logic: if buds just appeared and auto-switch is enabled
          if (autoSwitchEnabled && !budsDevice.isDefault) {
            const wasDefault = previousDefaultRef.current === budsDevice.id;
            if (!wasDefault) {
              // Buds detected but not default - switch to them
              await switchToDevice(budsDevice.id, budsDevice.name);
            }
          }
        } else {
          // Buds not detected - maybe disconnected
          if (budsState.detected) {
            setBudsState({
              detected: false,
              connectedTo: "none",
              deviceName: null,
              lastSeen: budsState.lastSeen,
            });

            // Auto-fallback if buds disappeared
            if (autoSwitchEnabled && fallbackDevice) {
              const fallback = mapped.find((d) => d.id === fallbackDevice);
              if (fallback && !fallback.isDefault) {
                await switchToDevice(fallback.id, fallback.name);
                toast({
                  title: "Audio Fallback",
                  description: `Switched to ${fallback.name} (buds disconnected)`,
                });
              }
            }
          }
        }

        setCurrentDefault(newDefaultId);
        previousDefaultRef.current = newDefaultId;
      }
    } catch (error) {
      console.error("Failed to poll audio devices:", error);
    }
  }, [sendCommand, autoSwitchEnabled, preferredBudsId, fallbackDevice, budsState.detected, budsState.lastSeen, toast]);

  // Switch audio output
  const switchToDevice = useCallback(async (deviceId: string, deviceName: string) => {
    setSwitchingTo(deviceId);
    try {
      const result = await sendCommand("set_audio_output", { device_id: deviceId }, { awaitResult: true, timeoutMs: 5000 });
      
      if (result.success) {
        setCurrentDefault(deviceId);
        toast({
          title: "Audio Output Changed",
          description: `Now using: ${deviceName}`,
        });
      } else {
        toast({
          title: "Switch Failed",
          description: "Could not change audio output",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to switch audio:", error);
      toast({
        title: "Switch Error",
        description: "Failed to communicate with PC agent",
        variant: "destructive",
      });
    } finally {
      setSwitchingTo(null);
    }
  }, [sendCommand, toast]);

  // Start/stop polling
  useEffect(() => {
    if (autoSwitchEnabled) {
      setIsPolling(true);
      pollAudioDevices(); // Initial poll
      
      pollTimerRef.current = window.setInterval(() => {
        pollAudioDevices();
      }, pollInterval);
    } else {
      setIsPolling(false);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [autoSwitchEnabled, pollInterval, pollAudioDevices]);

  // Manual refresh
  const handleRefresh = useCallback(() => {
    pollAudioDevices();
  }, [pollAudioDevices]);

  // Get non-buds devices for fallback selection
  const fallbackOptions = pcAudioDevices.filter((d) => !isGalaxyBuds(d.name));

  return (
    <Card className={cn("border-border/50 bg-card/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Headphones className="h-5 w-5 text-primary" />
          Galaxy Buds Manager
        </CardTitle>
        <CardDescription>
          Auto-switch audio when Galaxy Buds connect/disconnect
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Banner */}
        <div
          className={cn(
            "flex items-center gap-3 p-3 rounded-lg",
            budsState.detected ? "bg-primary/10" : "bg-secondary/30"
          )}
        >
          {budsState.detected ? (
            <BluetoothConnected className="h-5 w-5 text-primary" />
          ) : (
            <BluetoothOff className="h-5 w-5 text-muted-foreground" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {budsState.detected ? budsState.deviceName : "Galaxy Buds not detected"}
            </p>
            <p className="text-xs text-muted-foreground">
              {budsState.detected
                ? budsState.connectedTo === "pc"
                  ? "Connected & active on PC"
                  : "Detected on PC"
                : isPolling
                ? "Scanning for buds..."
                : "Enable auto-switch to scan"}
            </p>
          </div>
          {budsState.detected && (
            <Badge variant="outline" className="border-primary text-primary">
              <Bluetooth className="h-3 w-3 mr-1" />
              Active
            </Badge>
          )}
        </div>

        {/* Auto-Switch Toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
          <div className="flex items-center gap-3">
            <Zap className="h-4 w-4 text-primary" />
            <div>
              <Label htmlFor="auto-switch" className="font-medium">Auto-Switch</Label>
              <p className="text-xs text-muted-foreground">
                Automatically switch when buds connect
              </p>
            </div>
          </div>
          <Switch
            id="auto-switch"
            checked={autoSwitchEnabled}
            onCheckedChange={setAutoSwitchEnabled}
          />
        </div>

        {/* Fallback Device */}
        <div className="space-y-2">
          <Label className="text-sm">Fallback Device</Label>
          <Select value={fallbackDevice || ""} onValueChange={setFallbackDevice}>
            <SelectTrigger>
              <SelectValue placeholder="Select fallback when buds disconnect" />
            </SelectTrigger>
            <SelectContent>
              {fallbackOptions.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  <div className="flex items-center gap-2">
                    {device.isDefault && <CheckCircle2 className="h-3 w-3 text-primary" />}
                    <span>{device.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Device List */}
        {pcAudioDevices.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Audio Outputs</Label>
              <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isPolling}>
                <RefreshCw className={cn("h-3.5 w-3.5", isPolling && "animate-spin")} />
              </Button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {pcAudioDevices.map((device) => (
                <button
                  key={device.id}
                  onClick={() => switchToDevice(device.id, device.name)}
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
                    <Bluetooth className="h-4 w-4 text-primary shrink-0" />
                  ) : (
                    <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="flex-1 truncate">{device.name}</span>
                  {switchingTo === device.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : device.isDefault ? (
                    <Badge variant="outline" className="text-xs">Active</Badge>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="flex gap-2">
          {budsState.detected && !budsState.connectedTo && preferredBudsId && (
            <Button
              size="sm"
              onClick={() => {
                const buds = pcAudioDevices.find((d) => d.id === preferredBudsId);
                if (buds) switchToDevice(buds.id, buds.name);
              }}
              disabled={switchingTo !== null}
              className="flex-1"
            >
              <Headphones className="h-4 w-4 mr-2" />
              Switch to Buds
            </Button>
          )}
          {fallbackDevice && currentDefault !== fallbackDevice && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const fb = pcAudioDevices.find((d) => d.id === fallbackDevice);
                if (fb) switchToDevice(fb.id, fb.name);
              }}
              disabled={switchingTo !== null}
              className="flex-1"
            >
              <Monitor className="h-4 w-4 mr-2" />
              Use Speakers
            </Button>
          )}
        </div>

        {/* Status Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/50">
          <span className="flex items-center gap-1.5">
            {isPolling ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Polling every {pollInterval / 1000}s
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-muted" />
                Polling disabled
              </>
            )}
          </span>
          {lastPollTime > 0 && (
            <span>Last: {Math.round((Date.now() - lastPollTime) / 1000)}s ago</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
