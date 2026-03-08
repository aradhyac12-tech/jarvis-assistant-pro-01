import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cpu, HardDrive, Wifi, Activity, RefreshCw, Loader2, MemoryStick } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";

interface StatsSnapshot {
  cpu: number;
  ram: number;
  disk: number;
  netUp: number;
  netDown: number;
  ts: number;
}

const MAX_HISTORY = 30;

function MiniChart({ data, dataKey, color }: { data: StatsSnapshot[]; dataKey: keyof StatsSnapshot; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <YAxis domain={dataKey === "netUp" || dataKey === "netDown" ? ["auto", "auto"] : [0, 100]} hide />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#grad-${dataKey})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1048576).toFixed(1)} MB/s`;
}

export function SystemResourceMonitor({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const isConnected = selectedDevice?.is_online || false;

  const [history, setHistory] = useState<StatsSnapshot[]>([]);
  const [polling, setPolling] = useState(true);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const fetchStats = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const result = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 5000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        const snapshot: StatsSnapshot = {
          cpu: r.cpu_percent ?? 0,
          ram: r.memory_percent ?? 0,
          disk: r.disk_percent ?? 0,
          netUp: r.net_bytes_sent_sec ?? r.net_upload ?? 0,
          netDown: r.net_bytes_recv_sec ?? r.net_download ?? 0,
          ts: Date.now(),
        };
        setHistory(prev => [...prev, snapshot].slice(-MAX_HISTORY));
      }
    } catch {}
    setLoading(false);
  }, [isConnected, sendCommand]);

  useEffect(() => {
    if (!polling || !isConnected) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    fetchStats();
    intervalRef.current = window.setInterval(fetchStats, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [polling, isConnected, fetchStats]);

  const latest = history[history.length - 1];

  if (!isConnected) return null;

  const metrics = [
    { key: "cpu" as const, label: "CPU", value: latest?.cpu, icon: Cpu, color: "hsl(var(--primary))", unit: "%" },
    { key: "ram" as const, label: "RAM", value: latest?.ram, icon: MemoryStick, color: "hsl(210, 80%, 60%)", unit: "%" },
    { key: "disk" as const, label: "Disk", value: latest?.disk, icon: HardDrive, color: "hsl(30, 80%, 55%)", unit: "%" },
  ];

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardHeader className="pb-1.5 pt-3 px-3">
        <CardTitle className="text-xs flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-primary" />
          System Monitor
          <div className="ml-auto flex items-center gap-1">
            {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setPolling(!polling)}
              title={polling ? "Pause" : "Resume"}
            >
              {polling ? (
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              ) : (
                <RefreshCw className="h-3 w-3 text-muted-foreground" />
              )}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {/* CPU / RAM / Disk */}
        <div className="grid grid-cols-3 gap-1.5">
          {metrics.map(({ key, label, value, icon: Icon, color, unit }) => (
            <div key={key} className="rounded-lg border border-border/20 bg-secondary/5 p-1.5 space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                  <Icon className="h-2.5 w-2.5" /> {label}
                </span>
                <span className={cn(
                  "font-mono text-[10px] font-bold",
                  value !== undefined && value > 80 ? "text-destructive" : "text-foreground"
                )}>
                  {value !== undefined ? `${Math.round(value)}${unit}` : "--"}
                </span>
              </div>
              <MiniChart data={history} dataKey={key} color={color} />
            </div>
          ))}
        </div>

        {/* Network */}
        <div className="rounded-lg border border-border/20 bg-secondary/5 p-1.5">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
              <Wifi className="h-2.5 w-2.5" /> Network
            </span>
            <div className="flex items-center gap-2 text-[9px] font-mono">
              <span className="text-primary">↑ {latest ? formatBytes(latest.netUp) : "--"}</span>
              <span className="text-foreground">↓ {latest ? formatBytes(latest.netDown) : "--"}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <MiniChart data={history} dataKey="netUp" color="hsl(var(--primary))" />
            <MiniChart data={history} dataKey="netDown" color="hsl(150, 60%, 50%)" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
