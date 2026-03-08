import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Monitor, Wifi, WifiOff, Check, RefreshCw, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceContext } from "@/hooks/useDeviceContext";

export function MultiDeviceDashboard({ className }: { className?: string }) {
  const { devices, selectedDevice, selectDevice, isLoading, refreshDevices } = useDeviceContext();

  if (devices.length <= 1) return null; // Only show if multiple devices

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Monitor className="h-4 w-4 text-primary" />
          Devices
          <Badge variant="secondary" className="ml-auto text-[10px]">{devices.length}</Badge>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={refreshDevices} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-48">
          <div className="space-y-1.5">
            {devices.map(device => {
              const isSelected = device.id === selectedDevice?.id;
              const lastSeen = device.last_seen ? new Date(device.last_seen) : null;
              const timeSince = lastSeen ? getTimeSince(lastSeen) : "Never";

              return (
                <button
                  key={device.id}
                  onClick={() => selectDevice(device.id)}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left",
                    isSelected
                      ? "border-primary/50 bg-primary/10 shadow-sm"
                      : "border-border/30 bg-secondary/5 hover:bg-secondary/10"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    device.is_online ? "bg-primary/20" : "bg-muted"
                  )}>
                    <Monitor className={cn("h-4 w-4", device.is_online ? "text-primary" : "text-muted-foreground")} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium truncate">{device.name}</p>
                      {isSelected && <Check className="h-3 w-3 text-primary shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {device.is_online ? (
                        <>
                          <Wifi className="h-2.5 w-2.5 text-primary" />
                          <span className="text-primary">Online</span>
                        </>
                      ) : (
                        <>
                          <WifiOff className="h-2.5 w-2.5" />
                          <span>Offline</span>
                        </>
                      )}
                      <span className="mx-0.5">•</span>
                      <Clock className="h-2.5 w-2.5" />
                      <span>{timeSince}</span>
                    </div>
                  </div>

                  {device.is_online && (
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      {device.current_volume !== null && (
                        <span className="text-[9px] text-muted-foreground">🔊 {device.current_volume}%</span>
                      )}
                      {device.current_brightness !== null && (
                        <span className="text-[9px] text-muted-foreground">☀️ {device.current_brightness}%</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function getTimeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
