import { useDeviceContext } from "@/hooks/useDeviceContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Monitor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DeviceSelector() {
  const { devices, selectedDevice, selectDevice, isLoading, refreshDevices } =
    useDeviceContext();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30">
        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading devices...</span>
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30">
        <Monitor className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive">No devices connected</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selectedDevice?.id ?? ""}
        onValueChange={selectDevice}
      >
        <SelectTrigger className="w-[200px] bg-secondary/30 border-border/50">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            <SelectValue placeholder="Select device" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {devices.map((device) => (
            <SelectItem key={device.id} value={device.id}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full",
                    device.is_online ? "bg-neon-green animate-pulse" : "bg-muted-foreground"
                  )}
                />
                <span>{device.name}</span>
                {device.is_online && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    Online
                  </Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" onClick={refreshDevices}>
        <RefreshCw className="h-4 w-4" />
      </Button>
    </div>
  );
}
