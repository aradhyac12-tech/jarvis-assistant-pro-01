/**
 * ConnectionHealthBadge — compact connection quality indicator for the Hub.
 *
 * Shows: stability score pill, current mode label, avg latency, and
 * a mini sparkline of the last N latency samples.
 *
 * Usage:
 *   <ConnectionHealthBadge
 *     health={health}          // from useConnectionHealth()
 *     showSparkline={true}     // optional, default true
 *   />
 */

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ConnectionHealthState } from "@/hooks/useConnectionHealth";
import type { ModeTransition } from "@/hooks/useConnectionHealth";

interface Props {
  health: ConnectionHealthState;
  showSparkline?: boolean;
  className?: string;
}

const MODE_LABELS: Record<string, string> = {
  local_p2p: "LAN P2P",
  p2p: "WebRTC",
  websocket: "WS",
  bluetooth: "BLE",
  fallback: "Cloud",
  disconnected: "Off",
};

const MODE_COLORS: Record<string, string> = {
  local_p2p: "text-emerald-400",
  p2p: "text-cyan-400",
  websocket: "text-blue-400",
  bluetooth: "text-violet-400",
  fallback: "text-amber-400",
  disconnected: "text-zinc-500",
};

function scoreColor(score: number) {
  if (score >= 80) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (score >= 60) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (score >= 40) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

function LatencySparkline({
  transitions,
  height = 24,
  width = 60,
}: {
  transitions: ModeTransition[];
  height?: number;
  width?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || transitions.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Draw mode-change bars
    const now = Date.now();
    const windowMs = 60_000; // show last 60s

    ctx.strokeStyle = "rgba(139,92,246,0.5)";
    ctx.lineWidth = 1;

    transitions.slice(0, 8).forEach((t) => {
      const age = now - t.at;
      if (age > windowMs) return;
      const x = width - (age / windowMs) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });
  }, [transitions, height, width]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="opacity-60"
    />
  );
}

export function ConnectionHealthBadge({
  health,
  showSparkline = true,
  className,
}: Props) {
  const modeLabel = MODE_LABELS[health.currentMode] ?? health.currentMode;
  const modeColor = MODE_COLORS[health.currentMode] ?? "text-zinc-400";
  const scoreClass = scoreColor(health.stabilityScore);

  const uptimeSec = Math.round(health.uptimeMs / 1000);
  const uptimeLabel =
    uptimeSec < 60
      ? `${uptimeSec}s`
      : uptimeSec < 3600
      ? `${Math.floor(uptimeSec / 60)}m`
      : `${Math.floor(uptimeSec / 3600)}h`;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1 rounded-lg bg-card/40 border border-border/20",
        className
      )}
    >
      {/* Stability score pill */}
      <span
        className={cn(
          "text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border",
          scoreClass
        )}
      >
        {health.stabilityScore}
      </span>

      {/* Mode + latency */}
      <div className="flex flex-col leading-none gap-0.5">
        <span className={cn("text-[10px] font-semibold uppercase tracking-wide", modeColor)}>
          {modeLabel}
        </span>
        {health.avgLatency > 0 && (
          <span className="text-[9px] text-muted-foreground font-mono">
            {health.avgLatency}ms
            {health.packetLossRate > 0 && (
              <span className="text-amber-400 ml-1">
                {(health.packetLossRate * 100).toFixed(0)}%loss
              </span>
            )}
          </span>
        )}
      </div>

      {/* Uptime */}
      {health.uptimeMs > 0 && (
        <span className="text-[9px] text-muted-foreground font-mono ml-1">
          ↑{uptimeLabel}
        </span>
      )}

      {/* Sparkline of mode transitions */}
      {showSparkline && health.recentTransitions.length > 1 && (
        <LatencySparkline transitions={health.recentTransitions} />
      )}
    </div>
  );
}
