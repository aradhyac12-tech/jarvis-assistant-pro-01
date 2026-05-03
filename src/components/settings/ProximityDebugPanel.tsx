import { useCallback, useEffect, useState } from "react";
import { Activity, Wifi, Bluetooth, Cloud, Lock, Unlock, KeyRound, RefreshCw, Loader2, CheckCircle2, XCircle, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { cn } from "@/lib/utils";

type Status = {
  enabled?: boolean;
  owner_present?: boolean;
  distance_state?: "near" | "away";
  last_seen_ago?: number;
  surveillance_active?: boolean;
  away_threshold?: number;
  grace_period?: number;
  unlock_pin_set?: boolean;
  last_source?: "p2p" | "ble" | "cloud" | "simulated" | null;
  signals_seen?: { p2p?: number; ble?: number; cloud?: number; simulated?: number };
  last_lock_attempt?: string | null;
  last_lock_result?: string | null;
  last_unlock_attempt?: string | null;
  last_unlock_result?: string | null;
  last_pin_check?: { at: string; ok: boolean; reason: string } | null;
  transport_status?: { p2p_active: boolean; ble_active: boolean; cloud_active: boolean };
};

function formatAgo(iso?: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || isNaN(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function SourceIcon({ source }: { source?: string | null }) {
  if (source === "p2p") return <Wifi className="h-3.5 w-3.5" />;
  if (source === "ble") return <Bluetooth className="h-3.5 w-3.5" />;
  if (source === "cloud") return <Cloud className="h-3.5 w-3.5" />;
  if (source === "simulated") return <Activity className="h-3.5 w-3.5" />;
  return <Activity className="h-3.5 w-3.5 opacity-50" />;
}

function ResultBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const ok = value === "success";
  return (
    <Badge
      variant={ok ? "default" : "destructive"}
      className="gap-1 text-[10px] normal-case font-medium"
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {ok ? "success" : value.replace(/^failed:/, "")}
    </Badge>
  );
}

export function ProximityDebugPanel() {
  const { sendCommand } = useDeviceCommands();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await sendCommand("proximity_status", {}, { awaitResult: true, timeoutMs: 6000 });
      const r: any = (res as any)?.result ?? res;
      if ((res as any)?.success === false) {
        setError((res as any)?.error || "Could not reach agent");
      } else {
        setStatus(r as Status);
      }
    } catch (e: any) {
      setError(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }, [sendCommand]);

  // Auto-refresh every 5s while panel mounted
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const transports = status?.transport_status;
  const distance = status?.distance_state;

  return (
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center justify-between text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            Proximity Debug
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            disabled={loading}
            className="h-7 w-7 p-0 rounded-lg"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 space-y-3">
        {error && (
          <div className="text-[11px] text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Distance state */}
        <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <MapPin className={cn(
              "h-4 w-4",
              distance === "near" ? "text-emerald-500" :
              distance === "away" ? "text-orange-500" :
              "text-muted-foreground"
            )} />
            <span className="text-xs font-medium">Distance</span>
          </div>
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] normal-case font-semibold",
              distance === "near" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
              distance === "away" && "bg-orange-500/15 text-orange-600 dark:text-orange-400",
            )}
          >
            {distance ? distance.toUpperCase() : "UNKNOWN"}
            {status?.last_seen_ago !== undefined && (
              <span className="ml-1.5 opacity-70">· {Math.round(status.last_seen_ago)}s</span>
            )}
          </Badge>
        </div>

        {/* Last source */}
        <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <SourceIcon source={status?.last_source} />
            <span className="text-xs font-medium">Last detection source</span>
          </div>
          <span className="text-xs font-mono uppercase text-muted-foreground">
            {status?.last_source ?? "—"}
          </span>
        </div>

        {/* Transport activity */}
        <div className="rounded-xl bg-secondary/30 px-3 py-2.5 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Transports active now
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: "p2p", label: "Wi‑Fi P2P", icon: Wifi, active: transports?.p2p_active, count: status?.signals_seen?.p2p },
              { key: "ble", label: "Bluetooth", icon: Bluetooth, active: transports?.ble_active, count: status?.signals_seen?.ble },
              { key: "cloud", label: "Cloud", icon: Cloud, active: transports?.cloud_active, count: status?.signals_seen?.cloud },
            ].map((t) => (
              <div
                key={t.key}
                className={cn(
                  "rounded-lg px-2 py-2 text-center border",
                  t.active
                    ? "bg-primary/10 border-primary/30"
                    : "bg-background/40 border-border/10"
                )}
              >
                <t.icon className={cn(
                  "h-3.5 w-3.5 mx-auto mb-1",
                  t.active ? "text-primary" : "text-muted-foreground/50"
                )} />
                <p className="text-[10px] font-medium">{t.label}</p>
                <p className="text-[9px] tabular-nums text-muted-foreground">
                  {t.count ?? 0} hits
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Lock attempt */}
        <div className="rounded-xl bg-secondary/30 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-xs font-medium">Last lock attempt</span>
            </div>
            <ResultBadge value={status?.last_lock_result} />
          </div>
          <p className="text-[10px] text-muted-foreground pl-5">
            {formatAgo(status?.last_lock_attempt)}
          </p>
        </div>

        {/* Unlock attempt */}
        <div className="rounded-xl bg-secondary/30 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Unlock className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-xs font-medium">Last unlock attempt</span>
            </div>
            <ResultBadge value={status?.last_unlock_result} />
          </div>
          <p className="text-[10px] text-muted-foreground pl-5">
            {formatAgo(status?.last_unlock_attempt)}
          </p>
        </div>

        {/* PIN verification */}
        <div className="rounded-xl bg-secondary/30 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium">Last PIN verification</span>
            </div>
            {status?.last_pin_check ? (
              <Badge
                variant={status.last_pin_check.ok ? "default" : "destructive"}
                className="gap-1 text-[10px] normal-case font-medium"
              >
                {status.last_pin_check.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {status.last_pin_check.ok ? "accepted" : "rejected"}
              </Badge>
            ) : (
              <span className="text-[10px] text-muted-foreground">never</span>
            )}
          </div>
          {status?.last_pin_check && (
            <p className="text-[10px] text-muted-foreground pl-5">
              {formatAgo(status.last_pin_check.at)} · {status.last_pin_check.reason}
            </p>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground/70 text-center pt-1">
          Auto-refreshing every 5s
        </p>
      </CardContent>
    </Card>
  );
}
