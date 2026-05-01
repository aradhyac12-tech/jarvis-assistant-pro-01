/**
 * useConnectionHealth — Connection quality tracker for JARVIS
 *
 * Tracks:
 *  - Latency history (rolling 60 samples)
 *  - Packet-loss rate (commands that timed out vs sent)
 *  - Connection-mode transitions with timestamps
 *  - A 0–100 stability score derived from the above
 *
 * Usage:
 *   const health = useConnectionHealth(connectionMode, latency);
 *   health.stabilityScore   // 0–100
 *   health.avgLatency        // ms
 *   health.packetLossRate    // 0.0–1.0
 *   health.recentTransitions // last 10 mode changes
 */

import { useRef, useState, useCallback, useEffect } from "react";
import type { ConnectionMode } from "@/hooks/useP2PCommand";

const MAX_SAMPLES = 60;
const MAX_TRANSITIONS = 10;
const SCORE_UPDATE_INTERVAL_MS = 3000;

export interface ModeTransition {
  from: ConnectionMode;
  to: ConnectionMode;
  at: number; // epoch ms
}

export interface ConnectionHealthState {
  stabilityScore: number;         // 0–100 (100 = perfect)
  avgLatency: number;             // ms, rolling average
  p95Latency: number;             // ms, 95th percentile
  packetLossRate: number;         // 0.0–1.0
  totalCommandsSent: number;
  totalCommandsFailed: number;
  recentTransitions: ModeTransition[];
  currentMode: ConnectionMode;
  uptimeMs: number;               // ms since first successful connection
  isHealthy: boolean;             // score >= 60
}

interface HealthRef {
  latencySamples: number[];
  commandsSent: number;
  commandsFailed: number;
  transitions: ModeTransition[];
  lastMode: ConnectionMode;
  connectedAt: number | null;
}

export function useConnectionHealth(
  connectionMode: ConnectionMode,
  latency: number
): ConnectionHealthState & {
  recordCommandSent: () => void;
  recordCommandFailed: () => void;
} {
  const ref = useRef<HealthRef>({
    latencySamples: [],
    commandsSent: 0,
    commandsFailed: 0,
    transitions: [],
    lastMode: "disconnected",
    connectedAt: null,
  });

  const [state, setState] = useState<ConnectionHealthState>({
    stabilityScore: 0,
    avgLatency: 0,
    p95Latency: 0,
    packetLossRate: 0,
    totalCommandsSent: 0,
    totalCommandsFailed: 0,
    recentTransitions: [],
    currentMode: "disconnected",
    uptimeMs: 0,
    isHealthy: false,
  });

  // Track mode transitions
  useEffect(() => {
    const h = ref.current;
    if (connectionMode !== h.lastMode) {
      const transition: ModeTransition = {
        from: h.lastMode,
        to: connectionMode,
        at: Date.now(),
      };
      h.transitions = [transition, ...h.transitions].slice(0, MAX_TRANSITIONS);
      h.lastMode = connectionMode;

      // Record when we first became connected
      if (connectionMode !== "disconnected" && h.connectedAt === null) {
        h.connectedAt = Date.now();
      }
      if (connectionMode === "disconnected") {
        h.connectedAt = null;
      }
    }
  }, [connectionMode]);

  // Track latency samples
  useEffect(() => {
    if (latency > 0 && connectionMode !== "disconnected") {
      const h = ref.current;
      h.latencySamples.push(latency);
      if (h.latencySamples.length > MAX_SAMPLES) {
        h.latencySamples.shift();
      }
    }
  }, [latency, connectionMode]);

  // Compute and publish score periodically
  useEffect(() => {
    const interval = window.setInterval(() => {
      const h = ref.current;
      const samples = h.latencySamples;
      const avgLatency = samples.length
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : 0;

      const p95Latency = (() => {
        if (!samples.length) return 0;
        const sorted = [...samples].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
      })();

      const packetLossRate = h.commandsSent > 0
        ? h.commandsFailed / h.commandsSent
        : 0;

      // Stability score:
      // - 40 pts from latency (0ms=40, 200ms=0)
      // - 40 pts from packet loss (0%=40, 100%=0)
      // - 20 pts from connection mode quality
      const latencyScore = Math.max(0, 40 - (avgLatency / 5));
      const lossScore = Math.max(0, 40 - packetLossRate * 40);
      const modeScore: Record<ConnectionMode, number> = {
        local_p2p: 20,
        p2p: 18,
        websocket: 14,
        bluetooth: 10,
        fallback: 6,
        disconnected: 0,
      };
      const stabilityScore = Math.round(
        latencyScore + lossScore + (modeScore[connectionMode] ?? 0)
      );

      const uptimeMs =
        h.connectedAt !== null ? Date.now() - h.connectedAt : 0;

      setState({
        stabilityScore,
        avgLatency: Math.round(avgLatency),
        p95Latency: Math.round(p95Latency),
        packetLossRate,
        totalCommandsSent: h.commandsSent,
        totalCommandsFailed: h.commandsFailed,
        recentTransitions: [...h.transitions],
        currentMode: connectionMode,
        uptimeMs,
        isHealthy: stabilityScore >= 60,
      });
    }, SCORE_UPDATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [connectionMode]);

  const recordCommandSent = useCallback(() => {
    ref.current.commandsSent += 1;
  }, []);

  const recordCommandFailed = useCallback(() => {
    ref.current.commandsFailed += 1;
  }, []);

  return { ...state, recordCommandSent, recordCommandFailed };
}
