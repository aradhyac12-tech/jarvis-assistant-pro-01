import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Wifi, WifiOff, Zap, Cloud, RefreshCw, Laptop } from "lucide-react";
import { ConnectionMode } from "@/hooks/useP2PCommand";
import { NetworkState } from "@/hooks/useNetworkMonitor";
import { LocalP2PState } from "@/hooks/useLocalP2P";
import { cn } from "@/lib/utils";

interface NetworkStatusBadgeProps {
  connectionMode: ConnectionMode;
  latency: number;
  networkState: NetworkState;
  localP2PState?: LocalP2PState;
  autoP2P: boolean;
  autoLocalP2P?: boolean;
  onToggleAutoP2P: () => void;
  onToggleAutoLocalP2P?: () => void;
  onForceUpgrade: () => void;
  onForceLocalP2P?: () => void;
  compact?: boolean;
}

export function NetworkStatusBadge({
  connectionMode,
  latency,
  networkState,
  localP2PState,
  autoP2P,
  autoLocalP2P = true,
  onToggleAutoP2P,
  onToggleAutoLocalP2P,
  onForceUpgrade,
  onForceLocalP2P,
  compact = false,
}: NetworkStatusBadgeProps) {
  const getModeInfo = () => {
    switch (connectionMode) {
      case "local_p2p":
        return {
          icon: Laptop,
          label: "Local P2P",
          color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
          description: "Direct local connection (~2-5ms)",
        };
      case "p2p":
        return {
          icon: Zap,
          label: "P2P Direct",
          color: "bg-green-500/20 text-green-400 border-green-500/30",
          description: "Ultra-low latency via WebRTC (~5-15ms)",
        };
      case "websocket":
        return {
          icon: Wifi,
          label: "WebSocket",
          color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
          description: "Direct connection via WebSocket (~20-50ms)",
        };
      case "fallback":
        return {
          icon: Cloud,
          label: "Cloud Relay",
          color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
          description: "Using cloud relay (~50-100ms)",
        };
      default:
        return {
          icon: WifiOff,
          label: "Disconnected",
          color: "bg-red-500/20 text-red-400 border-red-500/30",
          description: "No connection",
        };
    }
  };

  const modeInfo = getModeInfo();
  const Icon = modeInfo.icon;

  if (compact) {
    return (
      <Badge variant="outline" className={cn("gap-1", modeInfo.color)}>
        <Icon className="h-3 w-3" />
        <span>{latency > 0 ? `${latency}ms` : modeInfo.label}</span>
      </Badge>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      {/* Connection Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("p-1.5 rounded", modeInfo.color.split(" ")[0])}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="font-medium text-sm">{modeInfo.label}</div>
            <div className="text-xs text-muted-foreground">{modeInfo.description}</div>
          </div>
        </div>
        <Badge variant="outline" className={cn("font-mono", modeInfo.color)}>
          {latency > 0 ? `${latency}ms` : "—"}
        </Badge>
      </div>

      {/* Network Info */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="space-y-1">
          <div className="text-muted-foreground">Phone</div>
          <div className="font-mono">
            {networkState.phone?.localIp || "Detecting..."}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-muted-foreground">PC</div>
          <div className="font-mono">
            {localP2PState?.pcIp || networkState.pc?.localIp || "Waiting..."}
          </div>
        </div>
      </div>

      {/* Local P2P Status */}
      {localP2PState && (
        <div className="flex items-center justify-between py-1 px-2 rounded bg-muted/50">
          <span className="text-xs text-muted-foreground">Local P2P Server</span>
          <Badge 
            variant="outline" 
            className={localP2PState.isConnected 
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
              : localP2PState.isAvailable
                ? "bg-green-500/20 text-green-400 border-green-500/30"
                : "bg-muted text-muted-foreground"
            }
          >
            {localP2PState.isConnected 
              ? `Connected (${localP2PState.port})` 
              : localP2PState.isAvailable 
                ? "Available" 
                : "Not Found"}
          </Badge>
        </div>
      )}

      {/* Same Network Indicator */}
      <div className="flex items-center justify-between py-1 px-2 rounded bg-muted/50">
        <span className="text-xs text-muted-foreground">Same Network</span>
        <Badge 
          variant="outline" 
          className={networkState.sameNetwork 
            ? "bg-green-500/20 text-green-400 border-green-500/30" 
            : "bg-muted text-muted-foreground"
          }
        >
          {networkState.sameNetwork ? "Yes - P2P Available" : "No - Using Cloud"}
        </Badge>
      </div>

      {/* Controls */}
      <div className="space-y-2 pt-1 border-t">
        {/* Local P2P Toggle */}
        {onToggleAutoLocalP2P && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                id="auto-local-p2p"
                checked={autoLocalP2P}
                onCheckedChange={onToggleAutoLocalP2P}
              />
              <label htmlFor="auto-local-p2p" className="text-xs cursor-pointer">
                Auto Local P2P
              </label>
            </div>
            
            {networkState.sameNetwork && !localP2PState?.isConnected && onForceLocalP2P && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onForceLocalP2P}
                className="h-7 text-xs gap-1"
              >
                <Laptop className="h-3 w-3" />
                Try Local
              </Button>
            )}
          </div>
        )}
        
        {/* WebRTC P2P Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              id="auto-p2p"
              checked={autoP2P}
              onCheckedChange={onToggleAutoP2P}
            />
            <label htmlFor="auto-p2p" className="text-xs cursor-pointer">
              Auto WebRTC P2P
            </label>
          </div>
          
          {connectionMode === "websocket" && networkState.sameNetwork && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onForceUpgrade}
              className="h-7 text-xs gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Force P2P
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
