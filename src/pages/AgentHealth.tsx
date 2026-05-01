import { useState, useEffect, useCallback } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useP2PCommand } from "@/hooks/useP2PCommand";
import { useConnectionHealth } from "@/hooks/useConnectionHealth";
import { ConnectionHealthBadge } from "@/components/ConnectionHealthBadge";
import { BackButton } from "@/components/BackButton";
import { cn } from "@/lib/utils";
import {
  Activity, ShieldCheck, Clock, Zap, AlertTriangle,
  CheckCircle2, XCircle, BarChart3, RefreshCw, Trash2,
  ArrowDownUp, Cpu, Database
} from "lucide-react";

interface AuditEntry {
  ts: string;
  cmd_type: string;
  transport: string;
  success: boolean;
  latency_ms: number;
  error: string;
}

interface AuditStats {
  total: number;
  success: number;
  failed: number;
  success_rate: number;
  avg_latency_ms: number;
  min_latency_ms: number;
  max_latency_ms: number;
}

// Colour map per command category
const CMD_COLOR: Record<string, string> = {
  shutdown: "text-red-400",   restart: "text-red-400",
  hibernate: "text-orange-400", sleep: "text-orange-400",
  lock_screen: "text-yellow-400",
  mouse_move: "text-sky-400", mouse_click: "text-sky-400",
  key_press: "text-indigo-400", type_text: "text-indigo-400",
  set_volume: "text-teal-400", set_brightness: "text-teal-400",
  get_system_stats: "text-zinc-400",
};
const cmdColor = (cmd: string) =>
  CMD_COLOR[cmd] ?? "text-violet-400";

const TRANSPORT_BADGE: Record<string, string> = {
  local_p2p: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  p2p:       "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
  cloud:     "bg-amber-500/15 text-amber-400 border-amber-500/25",
  ble:       "bg-violet-500/15 text-violet-400 border-violet-500/25",
};
const transportBadge = (t: string) =>
  TRANSPORT_BADGE[t] ?? "bg-zinc-500/15 text-zinc-400 border-zinc-500/25";

function StatCard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="relative rounded-xl border border-border/20 bg-card/40 p-4 overflow-hidden">
      {/* faint glow behind the icon */}
      <div className={cn("absolute -top-3 -right-3 w-16 h-16 rounded-full blur-2xl opacity-20", accent ?? "bg-violet-500")} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">{label}</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <Icon className={cn("w-5 h-5 shrink-0 mt-0.5", accent ? `text-${accent.replace("bg-","").split("/")[0]}` : "text-violet-400")} />
      </div>
    </div>
  );
}

function LatencyBar({ ms, max }: { ms: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (ms / max) * 100) : 0;
  const color =
    ms < 30 ? "bg-emerald-500" :
    ms < 100 ? "bg-sky-500" :
    ms < 300 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-12 text-right">{ms}ms</span>
    </div>
  );
}

export default function AgentHealth() {
  const { sendCommand } = useDeviceCommands();
  const { connectionMode, latency: p2pLatency } = useP2PCommand();
  const health = useConnectionHealth(connectionMode, p2pLatency);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [filter, setFilter] = useState<"all" | "ok" | "fail">("all");
  const [maxLatency, setMaxLatency] = useState(1);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const [logRes, statsRes] = await Promise.all([
        sendCommand("get_audit_log", { limit: 150 }),
        sendCommand("get_audit_stats"),
      ]);
      const logData = logRes as any;
      const statsData = statsRes as any;
      if (logData?.entries) {
        const list: AuditEntry[] = logData.entries;
        setEntries(list);
        const mx = Math.max(1, ...list.map((e) => e.latency_ms || 0));
        setMaxLatency(mx);
      }
      if (statsData?.stats) setStats(statsData.stats);
    } catch (e) {
      console.error("AgentHealth load failed", e);
    } finally {
      setLoading(false);
    }
  }, [sendCommand]);

  const clearLog = useCallback(async () => {
    setClearing(true);
    try {
      await sendCommand("clear_audit_log");
      setEntries([]);
      setStats(null);
    } finally {
      setClearing(false);
    }
  }, [sendCommand]);

  useEffect(() => {
    loadAudit();
    const interval = window.setInterval(loadAudit, 15_000);
    return () => clearInterval(interval);
  }, [loadAudit]);

  const visible = entries.filter((e) =>
    filter === "all" ? true : filter === "ok" ? e.success : !e.success
  );

  function fmtTs(ts: string) {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return ts; }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b border-border/20 px-4 py-3 flex items-center gap-3">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold tracking-tight flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-violet-400" />
            Agent Health
          </h1>
          <p className="text-[10px] text-muted-foreground">
            Command audit log · 24-hour window
          </p>
        </div>
        <ConnectionHealthBadge health={health} />
        <button
          onClick={loadAudit}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-muted/20 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto pb-20">

        {/* Stats grid */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              icon={ArrowDownUp}
              label="Total (24h)"
              value={stats.total.toLocaleString()}
              accent="bg-violet-500"
            />
            <StatCard
              icon={CheckCircle2}
              label="Success Rate"
              value={`${stats.success_rate}%`}
              sub={`${stats.success} ok · ${stats.failed} failed`}
              accent={stats.success_rate >= 95 ? "bg-emerald-500" : "bg-amber-500"}
            />
            <StatCard
              icon={Zap}
              label="Avg Latency"
              value={`${stats.avg_latency_ms}ms`}
              sub={`min ${stats.min_latency_ms}ms · max ${stats.max_latency_ms}ms`}
              accent="bg-sky-500"
            />
            <StatCard
              icon={BarChart3}
              label="Connection Score"
              value={health.stabilityScore}
              sub={`${health.currentMode} · p95 ${health.p95Latency}ms`}
              accent={health.stabilityScore >= 80 ? "bg-emerald-500" : health.stabilityScore >= 60 ? "bg-sky-500" : "bg-amber-500"}
            />
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-2">
          <div className="flex bg-muted/20 rounded-lg p-0.5 gap-0.5 flex-1">
            {(["all","ok","fail"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "flex-1 text-[11px] font-medium py-1.5 rounded-md transition-colors capitalize",
                  filter === f
                    ? "bg-card/80 text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "all" ? `All (${entries.length})` :
                 f === "ok"  ? `✓ ${entries.filter(e=>e.success).length}` :
                               `✗ ${entries.filter(e=>!e.success).length}`}
              </button>
            ))}
          </div>
          <button
            onClick={clearLog}
            disabled={clearing || entries.length === 0}
            className="flex items-center gap-1.5 text-[11px] px-3 py-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        </div>

        {/* Audit log entries */}
        {visible.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Database className="w-8 h-8 opacity-30" />
            <p className="text-sm">No commands recorded yet</p>
            <p className="text-xs opacity-60">Commands will appear here as they execute</p>
          </div>
        )}

        <div className="space-y-1.5">
          {visible.map((e, i) => (
            <div
              key={i}
              className={cn(
                "rounded-xl border px-3 py-2.5 bg-card/30 transition-colors",
                e.success
                  ? "border-border/15 hover:border-border/30"
                  : "border-red-500/20 bg-red-500/5 hover:border-red-500/30"
              )}
            >
              <div className="flex items-start gap-2">
                {/* status icon */}
                <div className="mt-0.5 shrink-0">
                  {e.success
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    : <XCircle className="w-3.5 h-3.5 text-red-400" />
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-[11px] font-mono font-semibold truncate", cmdColor(e.cmd_type))}>
                      {e.cmd_type}
                    </span>
                    <span className={cn(
                      "text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0",
                      transportBadge(e.transport)
                    )}>
                      {e.transport}
                    </span>
                  </div>

                  {e.latency_ms > 0 && (
                    <div className="mt-1.5">
                      <LatencyBar ms={e.latency_ms} max={maxLatency} />
                    </div>
                  )}

                  {e.error && (
                    <p className="text-[10px] text-red-400/80 mt-1 font-mono truncate">
                      {e.error}
                    </p>
                  )}
                </div>

                <span className="text-[9px] text-muted-foreground font-mono shrink-0 mt-0.5">
                  {fmtTs(e.ts)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {loading && entries.length === 0 && (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading audit log…</span>
          </div>
        )}
      </div>
    </div>
  );
}
