import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  Cpu,
  HardDrive,
  Battery,
  Zap,
  Wifi,
  WifiOff,
  RefreshCw,
  Volume2,
  Sun,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Bug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { IssueLog, useLogs } from "@/components/IssueLog";

interface SystemStats {
  cpu_percent?: number;
  memory_percent?: number;
  memory_used_gb?: number;
  memory_total_gb?: number;
  disk_percent?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  battery_percent?: number | null;
  battery_plugged?: boolean;
}

interface MonitoringPanelProps {
  className?: string;
  compact?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function MonitoringPanel({
  className,
  compact = false,
  autoRefresh = true,
  refreshInterval = 5000,
}: MonitoringPanelProps) {
  const { selectedDevice } = useDeviceContext();
  const { sendCommand } = useDeviceCommands();
  const logs = useLogs();
  const [systemStats, setSystemStats] = useState<SystemStats>({});
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isExpanded, setIsExpanded] = useState(!compact);

  const errorCount = logs.filter((l) => l.level === "error").length;
  const warnCount = logs.filter((l) => l.level === "warn").length;

  const fetchSystemStats = useCallback(async () => {
    if (!selectedDevice?.is_online) return;
    
    setIsLoading(true);
    try {
      const res = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 5000 });
      if (res.success && "result" in res && res.result) {
        const result = res.result as Record<string, unknown>;
        if (result.success !== false) {
          setSystemStats(result as unknown as SystemStats);
          setLastUpdated(new Date());
        }
      }
    } catch (err) {
      console.error("Failed to fetch system stats:", err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDevice?.is_online, sendCommand]);

  // Auto-refresh system stats
  useEffect(() => {
    if (!autoRefresh || !selectedDevice?.is_online) return;

    fetchSystemStats();
    const interval = setInterval(fetchSystemStats, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, selectedDevice?.is_online, fetchSystemStats]);

  const isConnected = selectedDevice?.is_online ?? false;

  if (compact && !isExpanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn("gap-2", className)}
        onClick={() => setIsExpanded(true)}
      >
        <Activity className="h-4 w-4" />
        <span>Monitor</span>
        {errorCount > 0 && (
          <Badge variant="destructive" className="h-5 px-1.5 text-xs">
            {errorCount}
          </Badge>
        )}
        {isConnected && systemStats.cpu_percent !== undefined && (
          <Badge variant="secondary" className="h-5 px-1.5 text-xs">
            CPU {Math.round(systemStats.cpu_percent)}%
          </Badge>
        )}
      </Button>
    );
  }

  return (
    <Card className={cn("glass-dark border-border/50", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-primary" />
            PC Monitoring
            {isConnected ? (
              <Badge variant="outline" className="bg-neon-green/10 text-neon-green border-neon-green/30">
                <Wifi className="h-3 w-3 mr-1" />
                Live
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                <WifiOff className="h-3 w-3 mr-1" />
                Offline
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {errorCount > 0 && (
              <Badge variant="destructive">{errorCount} errors</Badge>
            )}
            {warnCount > 0 && (
              <Badge className="bg-yellow-500/20 text-yellow-500">{warnCount} warnings</Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={fetchSystemStats}
              disabled={isLoading || !isConnected}
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
            {compact && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsExpanded(false)}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {lastUpdated && (
          <p className="text-xs text-muted-foreground">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <Tabs defaultValue="stats" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-3">
            <TabsTrigger value="stats" className="text-xs">
              <Cpu className="h-3 w-3 mr-1" />
              System Stats
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-xs">
              <Bug className="h-3 w-3 mr-1" />
              Issue Log
              {errorCount > 0 && (
                <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                  {errorCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="mt-0">
            {isConnected && Object.keys(systemStats).length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-secondary/30">
                  <div className="flex items-center gap-1 mb-1">
                    <Cpu className="h-3 w-3 text-neon-blue" />
                    <span className="text-xs">CPU</span>
                  </div>
                  <p className="text-lg font-bold text-neon-blue">
                    {systemStats.cpu_percent ?? 0}%
                  </p>
                  <Progress value={systemStats.cpu_percent ?? 0} className="mt-1 h-1" />
                </div>

                <div className="p-2 rounded-lg bg-secondary/30">
                  <div className="flex items-center gap-1 mb-1">
                    <Zap className="h-3 w-3 text-neon-purple" />
                    <span className="text-xs">RAM</span>
                  </div>
                  <p className="text-lg font-bold text-neon-purple">
                    {systemStats.memory_percent ?? 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {systemStats.memory_used_gb ?? 0}/{systemStats.memory_total_gb ?? 0} GB
                  </p>
                </div>

                <div className="p-2 rounded-lg bg-secondary/30">
                  <div className="flex items-center gap-1 mb-1">
                    <HardDrive className="h-3 w-3 text-neon-orange" />
                    <span className="text-xs">Disk</span>
                  </div>
                  <p className="text-lg font-bold text-neon-orange">
                    {systemStats.disk_percent ?? 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {systemStats.disk_used_gb ?? 0}/{systemStats.disk_total_gb ?? 0} GB
                  </p>
                </div>

                <div className="p-2 rounded-lg bg-secondary/30">
                  <div className="flex items-center gap-1 mb-1">
                    <Battery className="h-3 w-3 text-neon-green" />
                    <span className="text-xs">Battery</span>
                  </div>
                  <p className="text-lg font-bold text-neon-green">
                    {systemStats.battery_percent !== null ? `${systemStats.battery_percent}%` : "N/A"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {systemStats.battery_plugged ? "⚡ Charging" : "On battery"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                {isConnected ? "Loading stats..." : "PC offline - no stats available"}
              </div>
            )}

            {/* Quick status */}
            {isConnected && selectedDevice && (
              <div className="mt-3 flex items-center gap-3 p-2 rounded-lg bg-secondary/20">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-neon-blue" />
                  <span className="text-sm">{selectedDevice.current_volume ?? 0}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-neon-orange" />
                  <span className="text-sm">{selectedDevice.current_brightness ?? 0}%</span>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs" className="mt-0">
            <ScrollArea className="h-[180px]">
              {logs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No issues logged
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.slice(0, 20).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-2 p-1.5 rounded bg-secondary/20 text-xs"
                    >
                      {log.level === "error" ? (
                        <Bug className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                      ) : log.level === "warn" ? (
                        <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0 mt-0.5" />
                      ) : (
                        <Activity className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[10px] h-4 px-1">
                            {log.source}
                          </Badge>
                          <span className="text-muted-foreground text-[10px]">
                            {log.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <p className={cn(
                          "mt-0.5 break-words",
                          log.level === "error" ? "text-destructive" : 
                          log.level === "warn" ? "text-yellow-500" : "text-muted-foreground"
                        )}>
                          {log.message.slice(0, 100)}{log.message.length > 100 ? "..." : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
