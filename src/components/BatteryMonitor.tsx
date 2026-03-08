import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning,
  Loader2, RefreshCw, Zap, Clock, Heart, Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";

interface BatteryData {
  percent: number;
  isCharging: boolean;
  isPluggedIn: boolean;
  timeRemaining: number | null; // minutes
  health: number | null; // percentage
  designCapacity: number | null; // mWh
  fullChargeCapacity: number | null; // mWh
  cycleCount: number | null;
  powerDraw: number | null; // watts
}

function formatTime(minutes: number | null): string {
  if (minutes === null || minutes < 0) return "--";
  if (minutes > 1440) return "∞";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function getBatteryIcon(percent: number, charging: boolean) {
  if (charging) return BatteryCharging;
  if (percent >= 90) return BatteryFull;
  if (percent >= 50) return BatteryMedium;
  if (percent >= 20) return BatteryLow;
  return BatteryWarning;
}

function getPercentColor(percent: number, charging: boolean): string {
  if (charging) return "text-primary";
  if (percent <= 10) return "text-destructive";
  if (percent <= 20) return "text-amber-500";
  return "text-foreground";
}

function getHealthColor(health: number | null): string {
  if (health === null) return "text-muted-foreground";
  if (health >= 80) return "text-primary";
  if (health >= 50) return "text-amber-500";
  return "text-destructive";
}

export function BatteryMonitor({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const isConnected = selectedDevice?.is_online || false;

  const [battery, setBattery] = useState<BatteryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(true);
  const [noBattery, setNoBattery] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const fetchBattery = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const result = await sendCommand("get_battery_status", {}, { awaitResult: true, timeoutMs: 6000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        if (r.no_battery || r.hasBattery === false || r.has_battery === false) {
          setNoBattery(true);
          setBattery(null);
        } else {
          setNoBattery(false);
          setBattery({
            percent: r.percent ?? r.battery_percent ?? r.level ?? 0,
            isCharging: r.is_charging ?? r.charging ?? r.status === "charging",
            isPluggedIn: r.is_plugged_in ?? r.plugged_in ?? r.power_plugged ?? r.is_charging ?? false,
            timeRemaining: r.time_remaining ?? r.minutes_remaining ?? r.secs_left != null ? Math.round((r.secs_left ?? 0) / 60) : null,
            health: r.health ?? r.battery_health ?? null,
            designCapacity: r.design_capacity ?? null,
            fullChargeCapacity: r.full_charge_capacity ?? null,
            cycleCount: r.cycle_count ?? null,
            powerDraw: r.power_draw ?? r.power_now ?? null,
          });
        }
      }
    } catch {}
    setLoading(false);
  }, [isConnected, sendCommand]);

  useEffect(() => {
    if (!polling || !isConnected) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    fetchBattery();
    intervalRef.current = window.setInterval(fetchBattery, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [polling, isConnected, fetchBattery]);

  if (!isConnected || noBattery) return null;

  const BatteryIcon = battery ? getBatteryIcon(battery.percent, battery.isCharging) : Battery;

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardHeader className="pb-1.5 pt-3 px-3">
        <CardTitle className="text-xs flex items-center gap-2">
          <BatteryIcon className={cn("h-3.5 w-3.5", battery?.isCharging ? "text-primary" : "text-muted-foreground")} />
          Battery
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
      <CardContent className="px-3 pb-3">
        {!battery ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {/* Main battery bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className={cn("text-lg font-bold font-mono", getPercentColor(battery.percent, battery.isCharging))}>
                  {Math.round(battery.percent)}%
                </span>
                <div className="flex items-center gap-1.5">
                  {battery.isCharging && (
                    <Badge variant="secondary" className="text-[8px] h-4 px-1.5 gap-0.5">
                      <Zap className="h-2.5 w-2.5 text-primary" /> Charging
                    </Badge>
                  )}
                  {battery.isPluggedIn && !battery.isCharging && (
                    <Badge variant="secondary" className="text-[8px] h-4 px-1.5 gap-0.5">
                      <Plug className="h-2.5 w-2.5" /> Plugged in
                    </Badge>
                  )}
                </div>
              </div>
              <div className="h-2 w-full rounded-full overflow-hidden bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    battery.isCharging
                      ? "bg-primary"
                      : battery.percent <= 10
                        ? "bg-destructive animate-pulse"
                        : battery.percent <= 20
                          ? "bg-amber-500"
                          : "bg-primary"
                  )}
                  style={{ width: `${Math.min(100, battery.percent)}%` }}
                />
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-1.5">
              {/* Time remaining */}
              <div className="rounded-lg border border-border/20 bg-secondary/5 p-1.5">
                <div className="flex items-center gap-1 mb-0.5">
                  <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                  <span className="text-[8px] text-muted-foreground">
                    {battery.isCharging ? "Until full" : "Remaining"}
                  </span>
                </div>
                <span className="text-[11px] font-mono font-medium">
                  {formatTime(battery.timeRemaining)}
                </span>
              </div>

              {/* Health */}
              <div className="rounded-lg border border-border/20 bg-secondary/5 p-1.5">
                <div className="flex items-center gap-1 mb-0.5">
                  <Heart className="h-2.5 w-2.5 text-muted-foreground" />
                  <span className="text-[8px] text-muted-foreground">Health</span>
                </div>
                <span className={cn("text-[11px] font-mono font-medium", getHealthColor(battery.health))}>
                  {battery.health !== null ? `${Math.round(battery.health)}%` : "--"}
                </span>
              </div>

              {/* Power draw */}
              {battery.powerDraw !== null && (
                <div className="rounded-lg border border-border/20 bg-secondary/5 p-1.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    <Zap className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-[8px] text-muted-foreground">Power</span>
                  </div>
                  <span className="text-[11px] font-mono font-medium">
                    {battery.powerDraw.toFixed(1)}W
                  </span>
                </div>
              )}

              {/* Cycle count */}
              {battery.cycleCount !== null && (
                <div className="rounded-lg border border-border/20 bg-secondary/5 p-1.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    <RefreshCw className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-[8px] text-muted-foreground">Cycles</span>
                  </div>
                  <span className="text-[11px] font-mono font-medium">
                    {battery.cycleCount}
                  </span>
                </div>
              )}
            </div>

            {/* Capacity info */}
            {battery.designCapacity !== null && battery.fullChargeCapacity !== null && (
              <div className="text-[8px] text-muted-foreground text-center">
                {(battery.fullChargeCapacity / 1000).toFixed(1)} / {(battery.designCapacity / 1000).toFixed(1)} Wh capacity
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
