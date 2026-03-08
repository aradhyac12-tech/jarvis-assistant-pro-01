import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Cpu, HardDrive, Wifi, Activity, RefreshCw, Loader2, MemoryStick,
  Thermometer, AlertTriangle, XCircle, ChevronDown, ChevronUp, Skull, Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useAppNotifications } from "@/hooks/useAppNotifications";
import { useToast } from "@/hooks/use-toast";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";

interface StatsSnapshot {
  cpu: number;
  ram: number;
  disk: number;
  netUp: number;
  netDown: number;
  cpuTemp: number | null;
  gpuTemp: number | null;
  gpuName: string | null;
  gpuUtil: number | null;
  gpuMemUsed: number | null;
  gpuMemTotal: number | null;
  ts: number;
}

interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  memory_mb?: number;
}

const MAX_HISTORY = 30;
const CPU_THROTTLE_TEMP = 90;
const GPU_THROTTLE_TEMP = 85;

function MiniChart({ data, dataKey, color, domainMax }: { data: StatsSnapshot[]; dataKey: keyof StatsSnapshot; color: string; domainMax?: number }) {
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <YAxis domain={domainMax ? [0, domainMax] : ["auto", "auto"]} hide />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#grad-${dataKey})`}
          isAnimationActive={false}
          connectNulls
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

function getTempColor(temp: number | null, threshold: number): string {
  if (temp === null) return "text-muted-foreground";
  if (temp >= threshold) return "text-destructive";
  if (temp >= threshold - 10) return "text-amber-500";
  return "text-foreground";
}

export function SystemResourceMonitor({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { notify } = useAppNotifications();
  const { toast } = useToast();
  const isConnected = selectedDevice?.is_online || false;

  const [history, setHistory] = useState<StatsSnapshot[]>([]);
  const [polling, setPolling] = useState(true);
  const [loading, setLoading] = useState(false);
  const [throttleAlert, setThrottleAlert] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const lastAlertRef = useRef<number>(0);

  // Process killer state
  const [showProcesses, setShowProcesses] = useState(false);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [processesLoading, setProcessesLoading] = useState(false);
  const [killingPid, setKillingPid] = useState<number | null>(null);
  const [processSearch, setProcessSearch] = useState("");

  const fetchStats = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const result = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 8000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        const cpuTemp = r.cpu_temp ?? r.cpu_temperature ?? null;
        const gpuTemp = r.gpu_temp ?? r.gpu_temperature ?? null;

        const snapshot: StatsSnapshot = {
          cpu: r.cpu_percent ?? 0,
          ram: r.memory_percent ?? 0,
          disk: r.disk_percent ?? 0,
          netUp: r.net_bytes_sent_sec ?? r.net_upload ?? 0,
          netDown: r.net_bytes_recv_sec ?? r.net_download ?? 0,
          cpuTemp: typeof cpuTemp === "number" ? cpuTemp : null,
          gpuTemp: typeof gpuTemp === "number" ? gpuTemp : null,
          gpuName: r.gpu_name ?? null,
          gpuUtil: typeof r.gpu_util === "number" ? r.gpu_util : null,
          gpuMemUsed: typeof r.gpu_mem_used_mb === "number" ? r.gpu_mem_used_mb : null,
          gpuMemTotal: typeof r.gpu_mem_total_mb === "number" ? r.gpu_mem_total_mb : null,
          ts: Date.now(),
        };
        setHistory(prev => [...prev, snapshot].slice(-MAX_HISTORY));

        // Update top processes if available
        if (r.top_processes && Array.isArray(r.top_processes)) {
          setProcesses(r.top_processes.slice(0, 20));
        }

        // Throttle alerts
        const now = Date.now();
        if (now - lastAlertRef.current > 60000) {
          if (cpuTemp !== null && cpuTemp >= CPU_THROTTLE_TEMP) {
            setThrottleAlert(`CPU at ${cpuTemp}°C — thermal throttling likely!`);
            notify("thermal-cpu", "🌡️ CPU Overheating!", `CPU temperature: ${cpuTemp}°C`, 60000);
            lastAlertRef.current = now;
          } else if (gpuTemp !== null && gpuTemp >= GPU_THROTTLE_TEMP) {
            setThrottleAlert(`GPU at ${gpuTemp}°C — thermal throttling likely!`);
            notify("thermal-gpu", "🌡️ GPU Overheating!", `GPU temperature: ${gpuTemp}°C`, 60000);
            lastAlertRef.current = now;
          } else {
            setThrottleAlert(null);
          }
        }
      } else {
        // Fallback: use system_info from device heartbeat
        const sysInfo = selectedDevice?.system_info as Record<string, any> | null;
        if (sysInfo) {
          const snapshot: StatsSnapshot = {
            cpu: sysInfo.cpu_percent ?? 0,
            ram: sysInfo.memory_percent ?? 0,
            disk: 0,
            netUp: 0,
            netDown: 0,
            cpuTemp: null,
            gpuTemp: null,
            gpuName: null,
            gpuUtil: null,
            gpuMemUsed: null,
            gpuMemTotal: null,
            ts: Date.now(),
          };
          setHistory(prev => [...prev, snapshot].slice(-MAX_HISTORY));
        }
      }
    } catch {
      // Fallback: use system_info from device heartbeat
      const sysInfo = selectedDevice?.system_info as Record<string, any> | null;
      if (sysInfo) {
        const snapshot: StatsSnapshot = {
          cpu: sysInfo.cpu_percent ?? 0,
          ram: sysInfo.memory_percent ?? 0,
          disk: 0,
          netUp: 0,
          netDown: 0,
          cpuTemp: null,
          gpuTemp: null,
          gpuName: null,
          gpuUtil: null,
          gpuMemUsed: null,
          gpuMemTotal: null,
          ts: Date.now(),
        };
        setHistory(prev => [...prev, snapshot].slice(-MAX_HISTORY));
      }
    }
    setLoading(false);
  }, [isConnected, sendCommand, notify, selectedDevice?.system_info]);

  const fetchProcesses = useCallback(async () => {
    if (!isConnected) return;
    setProcessesLoading(true);
    try {
      const result = await sendCommand("get_running_apps", {}, { awaitResult: true, timeoutMs: 8000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        const apps = r.apps || r.processes || [];
        setProcesses(
          apps
            .filter((a: any) => a.cpu > 0 || a.memory > 0 || (a.memory_mb && a.memory_mb > 10))
            .sort((a: any, b: any) => (b.cpu || 0) - (a.cpu || 0))
            .slice(0, 25)
        );
      }
    } catch {}
    setProcessesLoading(false);
  }, [isConnected, sendCommand]);

  const killProcess = useCallback(async (pid: number, name: string) => {
    setKillingPid(pid);
    try {
      const result = await sendCommand("kill_process", { pid, force: true }, { awaitResult: true, timeoutMs: 8000 });
      if (result.success) {
        toast({ title: `Killed: ${name}`, description: `PID ${pid} terminated` });
        setProcesses(prev => prev.filter(p => p.pid !== pid));
      } else {
        toast({ title: "Kill failed", description: String(result.error), variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Kill failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
    setKillingPid(null);
  }, [sendCommand, toast]);

  useEffect(() => {
    if (!polling || !isConnected) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    fetchStats();
    intervalRef.current = window.setInterval(fetchStats, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [polling, isConnected, fetchStats]);

  const latest = history[history.length - 1];
  const hasTemps = history.some(s => s.cpuTemp !== null || s.gpuTemp !== null);
  const hasGpuInfo = history.some(s => s.gpuUtil !== null || s.gpuTemp !== null);

  if (!isConnected) return null;

  const metrics = [
    { key: "cpu" as const, label: "CPU", value: latest?.cpu, icon: Cpu, color: "hsl(var(--primary))", unit: "%", domainMax: 100 },
    { key: "ram" as const, label: "RAM", value: latest?.ram, icon: MemoryStick, color: "hsl(210, 80%, 60%)", unit: "%", domainMax: 100 },
    { key: "disk" as const, label: "Disk", value: latest?.disk, icon: HardDrive, color: "hsl(30, 80%, 55%)", unit: "%", domainMax: 100 },
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
        {/* Thermal Throttle Alert */}
        {throttleAlert && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 animate-in slide-in-from-top-2">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
            <span className="text-[10px] text-destructive font-medium">{throttleAlert}</span>
          </div>
        )}

        {/* CPU / RAM / Disk */}
        <div className="grid grid-cols-3 gap-1.5">
          {metrics.map(({ key, label, value, icon: Icon, color, unit, domainMax }) => (
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
              <MiniChart data={history} dataKey={key} color={color} domainMax={domainMax} />
            </div>
          ))}
        </div>

        {/* Temperature — always show */}
        <div className="grid grid-cols-2 gap-1.5">
          {/* CPU Temp */}
          <div className="rounded-lg border border-border/20 bg-secondary/5 p-1.5 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                <Thermometer className="h-2.5 w-2.5" /> CPU Temp
              </span>
              <span className={cn("font-mono text-[10px] font-bold", getTempColor(latest?.cpuTemp ?? null, CPU_THROTTLE_TEMP))}>
                {latest?.cpuTemp !== null && latest?.cpuTemp !== undefined ? `${Math.round(latest.cpuTemp)}°C` : "--"}
              </span>
            </div>
            {hasTemps && <MiniChart data={history} dataKey="cpuTemp" color="hsl(0, 75%, 55%)" domainMax={110} />}
            {latest?.cpuTemp !== null && latest?.cpuTemp !== undefined && latest.cpuTemp >= CPU_THROTTLE_TEMP - 10 && (
              <div className="flex items-center gap-0.5">
                <div className="h-1 flex-1 rounded-full overflow-hidden bg-muted">
                  <div className={cn("h-full rounded-full transition-all", latest.cpuTemp >= CPU_THROTTLE_TEMP ? "bg-destructive animate-pulse" : "bg-amber-500")}
                    style={{ width: `${Math.min(100, (latest.cpuTemp / 110) * 100)}%` }} />
                </div>
                <span className="text-[8px] text-muted-foreground">{CPU_THROTTLE_TEMP}°</span>
              </div>
            )}
            {!hasTemps && (
              <p className="text-[8px] text-muted-foreground/60">Waiting for data…</p>
            )}
          </div>

          {/* GPU Temp */}
          <div className="rounded-lg border border-border/20 bg-secondary/5 p-1.5 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                <Thermometer className="h-2.5 w-2.5" /> GPU Temp
              </span>
              <span className={cn("font-mono text-[10px] font-bold", getTempColor(latest?.gpuTemp ?? null, GPU_THROTTLE_TEMP))}>
                {latest?.gpuTemp !== null && latest?.gpuTemp !== undefined ? `${Math.round(latest.gpuTemp)}°C` : "--"}
              </span>
            </div>
            {latest?.gpuName && (
              <p className="text-[8px] text-muted-foreground truncate" title={latest.gpuName}>{latest.gpuName}</p>
            )}
            {hasTemps && <MiniChart data={history} dataKey="gpuTemp" color="hsl(280, 70%, 55%)" domainMax={110} />}
            {latest?.gpuTemp !== null && latest?.gpuTemp !== undefined && latest.gpuTemp >= GPU_THROTTLE_TEMP - 10 && (
              <div className="flex items-center gap-0.5">
                <div className="h-1 flex-1 rounded-full overflow-hidden bg-muted">
                  <div className={cn("h-full rounded-full transition-all", latest.gpuTemp >= GPU_THROTTLE_TEMP ? "bg-destructive animate-pulse" : "bg-amber-500")}
                    style={{ width: `${Math.min(100, (latest.gpuTemp / 110) * 100)}%` }} />
                </div>
                <span className="text-[8px] text-muted-foreground">{GPU_THROTTLE_TEMP}°</span>
              </div>
            )}
            {!hasTemps && !latest?.gpuName && (
              <p className="text-[8px] text-muted-foreground/60">Waiting for data…</p>
            )}
          </div>
        </div>

        {/* GPU Utilization & VRAM (when available from nvidia-smi) */}
        {hasGpuInfo && (
          <div className="rounded-lg border border-border/20 bg-secondary/5 p-1.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                <Cpu className="h-2.5 w-2.5" /> GPU Usage
              </span>
              <span className="font-mono text-[10px] font-bold text-foreground">
                {latest?.gpuUtil !== null && latest?.gpuUtil !== undefined ? `${Math.round(latest.gpuUtil)}%` : "--"}
              </span>
            </div>
            {latest?.gpuUtil !== null && (
              <div className="h-1.5 rounded-full overflow-hidden bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    (latest?.gpuUtil ?? 0) > 90 ? "bg-destructive" : (latest?.gpuUtil ?? 0) > 70 ? "bg-amber-500" : "bg-primary"
                  )}
                  style={{ width: `${Math.min(100, latest?.gpuUtil ?? 0)}%` }}
                />
              </div>
            )}
            {latest?.gpuMemUsed !== null && latest?.gpuMemTotal !== null && latest?.gpuMemUsed !== undefined && latest?.gpuMemTotal !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-muted-foreground">VRAM</span>
                <span className="text-[8px] font-mono text-muted-foreground">
                  {Math.round(latest.gpuMemUsed)} / {Math.round(latest.gpuMemTotal)} MB
                </span>
              </div>
            )}
          </div>
        )}

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

        {/* Process Killer */}
        <div className="rounded-lg border border-border/20 bg-secondary/5 overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-2 text-[10px] font-medium hover:bg-secondary/10 transition-colors"
            onClick={() => {
              const next = !showProcesses;
              setShowProcesses(next);
              if (next && processes.length === 0) fetchProcesses();
            }}
          >
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Skull className="h-3 w-3" /> Top Processes
              {processes.length > 0 && (
                <Badge variant="secondary" className="text-[8px] h-3.5 px-1">{processes.length}</Badge>
              )}
            </span>
            {showProcesses ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showProcesses && (
            <div className="border-t border-border/20">
              {/* Search bar */}
              <div className="px-2 py-1.5 border-b border-border/10">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Filter processes..."
                    value={processSearch}
                    onChange={e => setProcessSearch(e.target.value)}
                    className="h-6 text-[10px] pl-7 pr-2 bg-secondary/10 border-border/20"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-2 py-1 border-b border-border/10">
                <span className="text-[8px] text-muted-foreground font-medium">NAME</span>
                <div className="flex items-center gap-3">
                  <span className="text-[8px] text-muted-foreground font-medium w-10 text-right">CPU</span>
                  <span className="text-[8px] text-muted-foreground font-medium w-12 text-right">MEM</span>
                  <span className="w-6" />
                </div>
              </div>

              {processesLoading ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : processes.length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-[10px] text-muted-foreground">No process data</p>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] mt-1" onClick={fetchProcesses}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Fetch
                  </Button>
                </div>
              ) : (
                <ScrollArea className="max-h-44">
                  <div className="divide-y divide-border/10">
                    {processes
                      .filter(proc => !processSearch || proc.name.toLowerCase().includes(processSearch.toLowerCase()))
                      .map(proc => (
                      <div
                        key={proc.pid}
                        className={cn(
                          "flex items-center justify-between px-2 py-1.5 hover:bg-destructive/5 transition-colors group",
                          proc.cpu > 50 && "bg-destructive/5"
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-medium truncate">{proc.name}</p>
                          <p className="text-[8px] text-muted-foreground">PID {proc.pid}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={cn(
                            "text-[10px] font-mono w-10 text-right",
                            proc.cpu > 50 ? "text-destructive font-bold" : proc.cpu > 20 ? "text-amber-500" : "text-muted-foreground"
                          )}>
                            {proc.cpu.toFixed(1)}%
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground w-12 text-right">
                            {proc.memory_mb ? `${proc.memory_mb.toFixed(0)}M` : `${proc.memory.toFixed(1)}%`}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              killProcess(proc.pid, proc.name);
                            }}
                            disabled={killingPid === proc.pid}
                            title={`Kill ${proc.name}`}
                          >
                            {killingPid === proc.pid ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <XCircle className="h-3 w-3 text-destructive" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              <div className="flex justify-end px-2 py-1 border-t border-border/10">
                <Button variant="ghost" size="sm" className="h-5 text-[9px] gap-1" onClick={fetchProcesses} disabled={processesLoading}>
                  <RefreshCw className="h-2.5 w-2.5" /> Refresh
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
