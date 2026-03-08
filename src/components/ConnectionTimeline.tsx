import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Activity, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimelineEvent {
  mode: string;
  timestamp: number;
  latency?: number;
}

interface ConnectionTimelineProps {
  connectionMode: string;
  latency: number;
  className?: string;
}

const MODE_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  local_p2p: { bg: "bg-emerald-500/15", text: "text-emerald-400", bar: "bg-emerald-400" },
  p2p: { bg: "bg-green-500/15", text: "text-green-400", bar: "bg-green-400" },
  websocket: { bg: "bg-blue-500/15", text: "text-blue-400", bar: "bg-blue-400" },
  fallback: { bg: "bg-yellow-500/15", text: "text-yellow-400", bar: "bg-yellow-400" },
  ble: { bg: "bg-purple-500/15", text: "text-purple-400", bar: "bg-purple-400" },
  offline: { bg: "bg-muted", text: "text-muted-foreground", bar: "bg-muted-foreground" },
};

const MODE_LABELS: Record<string, string> = {
  local_p2p: "Local P2P",
  p2p: "P2P",
  websocket: "WebSocket",
  fallback: "Cloud",
  ble: "BLE",
  offline: "Offline",
};

const STORAGE_KEY = "connection_timeline";
const MAX_EVENTS = 200;

export function ConnectionTimeline({ connectionMode, latency, className }: ConnectionTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const lastModeRef = useRef(connectionMode);

  // Record mode changes
  useEffect(() => {
    if (connectionMode && connectionMode !== lastModeRef.current) {
      lastModeRef.current = connectionMode;
      setEvents((prev) => {
        const next = [...prev, { mode: connectionMode, timestamp: Date.now(), latency }].slice(-MAX_EVENTS);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }
  }, [connectionMode, latency]);

  const clearHistory = useCallback(() => {
    setEvents([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Compute mode distribution for the last hour
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const recentEvents = events.filter((e) => e.timestamp >= oneHourAgo);

  const modeStats: Record<string, number> = {};
  for (let i = 0; i < recentEvents.length; i++) {
    const e = recentEvents[i];
    const nextTs = recentEvents[i + 1]?.timestamp || now;
    const duration = nextTs - e.timestamp;
    modeStats[e.mode] = (modeStats[e.mode] || 0) + duration;
  }
  // If no events in last hour, show current mode for the full hour
  if (recentEvents.length === 0 && connectionMode) {
    modeStats[connectionMode] = 3600000;
  }
  const totalDuration = Object.values(modeStats).reduce((a, b) => a + b, 0) || 1;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const formatDuration = (ms: number) => {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  };

  const colors = MODE_COLORS[connectionMode] || MODE_COLORS.offline;

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardContent className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Connection Timeline</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", colors.text)}>
              {MODE_LABELS[connectionMode] || connectionMode} {latency > 0 && `${latency}ms`}
            </Badge>
            {events.length > 0 && (
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={clearHistory}>
                <Trash2 className="w-3 h-3 text-muted-foreground" />
              </Button>
            )}
          </div>
        </div>

        {/* Distribution Bar */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground">Last hour distribution</p>
          <div className="h-3 rounded-full overflow-hidden flex bg-secondary/30">
            {Object.entries(modeStats)
              .sort((a, b) => b[1] - a[1])
              .map(([mode, duration]) => {
                const pct = (duration / totalDuration) * 100;
                const c = MODE_COLORS[mode] || MODE_COLORS.offline;
                return (
                  <div
                    key={mode}
                    className={cn("h-full transition-all", c.bar)}
                    style={{ width: `${Math.max(pct, 1)}%`, opacity: 0.8 }}
                    title={`${MODE_LABELS[mode] || mode}: ${formatDuration(duration)} (${pct.toFixed(0)}%)`}
                  />
                );
              })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {Object.entries(modeStats)
              .sort((a, b) => b[1] - a[1])
              .map(([mode, duration]) => {
                const c = MODE_COLORS[mode] || MODE_COLORS.offline;
                const pct = ((duration / totalDuration) * 100).toFixed(0);
                return (
                  <div key={mode} className="flex items-center gap-1">
                    <div className={cn("w-2 h-2 rounded-full", c.bar)} />
                    <span className={cn("text-[9px]", c.text)}>
                      {MODE_LABELS[mode] || mode} {pct}%
                    </span>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Recent Events */}
        {events.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground">
              Recent switches ({events.length})
            </p>
            <ScrollArea className="max-h-[20vh]">
              <div className="space-y-0.5 pr-2">
                {[...events].reverse().slice(0, 30).map((e, i) => {
                  const c = MODE_COLORS[e.mode] || MODE_COLORS.offline;
                  return (
                    <div key={`${e.timestamp}-${i}`} className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-secondary/20 transition-colors">
                      <div className={cn("w-2 h-2 rounded-full shrink-0", c.bar)} />
                      <span className={cn("text-[10px] font-medium w-16 shrink-0", c.text)}>
                        {MODE_LABELS[e.mode] || e.mode}
                      </span>
                      {e.latency !== undefined && e.latency > 0 && (
                        <span className="text-[9px] text-muted-foreground">{e.latency}ms</span>
                      )}
                      <span className="text-[9px] text-muted-foreground ml-auto shrink-0">
                        {formatTime(e.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {events.length === 0 && (
          <div className="py-4 text-center">
            <p className="text-[10px] text-muted-foreground">No mode switches recorded yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
