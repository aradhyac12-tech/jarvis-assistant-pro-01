import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Wifi,
  WifiOff,
  Zap,
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Signal,
  ArrowRightLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectionMode } from "@/hooks/useP2PCommand";
import { NetworkState } from "@/hooks/useNetworkMonitor";
import { LocalP2PState } from "@/hooks/useLocalP2P";

interface SmartP2PManagerProps {
  connectionMode: ConnectionMode;
  latency: number;
  networkState: NetworkState;
  localP2PState: LocalP2PState;
  autoP2P: boolean;
  autoLocalP2P: boolean;
  onToggleAutoP2P: () => void;
  onToggleAutoLocalP2P: () => void;
  onForceUpgrade: () => void;
  onForceLocalP2P: () => void;
  className?: string;
}

const MODE_INFO: Record<ConnectionMode, { label: string; color: string; icon: React.ElementType; desc: string }> = {
  local_p2p: { label: "Local P2P", color: "text-emerald-500", icon: Zap, desc: "Ultra-fast same-network" },
  p2p: { label: "WebRTC P2P", color: "text-primary", icon: Signal, desc: "Peer-to-peer direct" },
  websocket: { label: "WebSocket", color: "text-blue-500", icon: ArrowRightLeft, desc: "Cloud-assisted" },
  fallback: { label: "Cloud Relay", color: "text-amber-500", icon: Globe, desc: "Edge function relay" },
  disconnected: { label: "Disconnected", color: "text-destructive", icon: WifiOff, desc: "Not connected" },
};

export function SmartP2PManager({
  connectionMode,
  latency,
  networkState,
  localP2PState,
  autoP2P,
  autoLocalP2P,
  onToggleAutoP2P,
  onToggleAutoLocalP2P,
  onForceUpgrade,
  onForceLocalP2P,
  className,
}: SmartP2PManagerProps) {
  const [isUpgrading, setIsUpgrading] = useState(false);
  
  const modeInfo = MODE_INFO[connectionMode];
  const ModeIcon = modeInfo.icon;
  
  // Latency quality indicator
  const getLatencyQuality = (ms: number) => {
    if (ms <= 10) return { label: "Excellent", color: "bg-emerald-500", percent: 100 };
    if (ms <= 30) return { label: "Great", color: "bg-primary", percent: 85 };
    if (ms <= 60) return { label: "Good", color: "bg-blue-500", percent: 70 };
    if (ms <= 100) return { label: "Fair", color: "bg-amber-500", percent: 50 };
    return { label: "Poor", color: "bg-destructive", percent: 25 };
  };
  
  const latencyQuality = getLatencyQuality(latency);
  
  const handleForceUpgrade = useCallback(async () => {
    setIsUpgrading(true);
    if (autoLocalP2P && networkState.sameNetwork) {
      onForceLocalP2P();
    } else {
      onForceUpgrade();
    }
    setTimeout(() => setIsUpgrading(false), 2000);
  }, [autoLocalP2P, networkState.sameNetwork, onForceLocalP2P, onForceUpgrade]);

  return (
    <Card className={cn("border-border/40", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              connectionMode === "disconnected" ? "bg-destructive/10" : "bg-primary/10"
            )}>
              <ModeIcon className={cn("h-4 w-4", modeInfo.color)} />
            </div>
            <div>
              <CardTitle className="text-base">Network Connection</CardTitle>
              <CardDescription className="text-xs">{modeInfo.desc}</CardDescription>
            </div>
          </div>
          <Badge 
            variant="outline" 
            className={cn("text-xs gap-1", modeInfo.color)}
          >
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              connectionMode === "disconnected" ? "bg-destructive" : 
              connectionMode === "local_p2p" ? "bg-emerald-500 animate-pulse" : "bg-primary"
            )} />
            {modeInfo.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Latency Indicator */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Latency</span>
            <span className="font-medium tabular-nums">
              {connectionMode === "disconnected" ? "—" : `${latency}ms`}
              <span className={cn("ml-2 text-xs", latencyQuality.color.replace("bg-", "text-"))}>
                {connectionMode !== "disconnected" && latencyQuality.label}
              </span>
            </span>
          </div>
          <Progress 
            value={connectionMode === "disconnected" ? 0 : latencyQuality.percent} 
            className={cn("h-1.5", connectionMode === "disconnected" && "opacity-30")}
          />
        </div>

        {/* Network Status */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-2.5 rounded-lg bg-muted/50 space-y-1">
            <p className="text-muted-foreground">Phone IP</p>
            <p className="font-mono font-medium truncate">
              {networkState.phone?.localIp || "Detecting..."}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/50 space-y-1">
            <p className="text-muted-foreground">PC IP</p>
            <p className="font-mono font-medium truncate">
              {networkState.pc?.localIp || localP2PState.pcIp || "Unknown"}
            </p>
          </div>
        </div>

        {/* Same Network Indicator */}
        <div className={cn(
          "flex items-center gap-3 p-3 rounded-lg",
          networkState.sameNetwork ? "bg-emerald-500/10" : "bg-muted/50"
        )}>
          {networkState.sameNetwork ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {networkState.sameNetwork ? "Same Network Detected" : "Different Networks"}
            </p>
            <p className="text-xs text-muted-foreground">
              {networkState.sameNetwork 
                ? "Ultra-low latency P2P available" 
                : "Using cloud relay for connectivity"}
            </p>
          </div>
          {networkState.sameNetwork && connectionMode !== "local_p2p" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleForceUpgrade}
              disabled={isUpgrading}
              className="shrink-0"
            >
              {isUpgrading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>

        {/* Auto-Switch Settings */}
        <div className="space-y-3 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Auto P2P Upgrade</Label>
              <p className="text-xs text-muted-foreground">Switch to P2P when available</p>
            </div>
            <Switch checked={autoP2P} onCheckedChange={onToggleAutoP2P} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Local P2P Priority</Label>
              <p className="text-xs text-muted-foreground">Prefer same-network direct path</p>
            </div>
            <Switch checked={autoLocalP2P} onCheckedChange={onToggleAutoLocalP2P} />
          </div>
        </div>

        {/* Connection Hierarchy */}
        <div className="text-xs text-muted-foreground pt-2 border-t border-border/50">
          <p className="font-medium mb-1.5">Connection Priority:</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {["Local P2P", "WebRTC", "WebSocket", "Cloud"].map((mode, i) => (
              <span key={mode} className="flex items-center gap-1">
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[10px]",
                  i === 0 && connectionMode === "local_p2p" ? "bg-emerald-500/20 text-emerald-600" :
                  i === 1 && connectionMode === "p2p" ? "bg-primary/20 text-primary" :
                  i === 2 && connectionMode === "websocket" ? "bg-blue-500/20 text-blue-600" :
                  i === 3 && connectionMode === "fallback" ? "bg-amber-500/20 text-amber-600" :
                  "bg-muted text-muted-foreground"
                )}>
                  {mode}
                </span>
                {i < 3 && <span className="text-muted-foreground/50">→</span>}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
