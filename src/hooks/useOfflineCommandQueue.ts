/**
 * useOfflineCommandQueue — Buffer commands when offline, replay on reconnect.
 *
 * Commands sent while connectionMode === "disconnected" (or while the cloud
 * is unreachable) are held in a queue.  When a healthy connection returns the
 * queue is drained in order, respecting per-command TTL so stale entries
 * (e.g. "set volume to 80") are not replayed minutes later.
 *
 * Usage:
 *   const queue = useOfflineCommandQueue(connectionMode, sendCommand);
 *   queue.enqueue({ type: "set_volume", payload: { level: 80 } });
 *   // → automatically replayed when online
 *   queue.pendingCount       // how many are waiting
 *   queue.clearQueue()       // discard all pending
 */

import { useRef, useState, useCallback, useEffect } from "react";
import type { ConnectionMode } from "@/hooks/useP2PCommand";

const DEFAULT_TTL_MS = 30_000;   // discard after 30 s by default
const DRAIN_INTERVAL_MS = 500;   // check queue every 500 ms when connected
const MAX_QUEUE_SIZE = 50;       // prevent unbounded growth

export interface QueuedCommand {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  enqueuedAt: number;
  ttlMs: number;
}

type SendFn = (type: string, payload?: Record<string, unknown>) => Promise<unknown>;

export interface OfflineQueueState {
  pendingCount: number;
  isReplaying: boolean;
  lastError: string | null;
}

export function useOfflineCommandQueue(
  connectionMode: ConnectionMode,
  sendCommand: SendFn
) {
  const queueRef = useRef<QueuedCommand[]>([]);
  const isDrainingRef = useRef(false);
  const [state, setState] = useState<OfflineQueueState>({
    pendingCount: 0,
    isReplaying: false,
    lastError: null,
  });

  const refreshState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      pendingCount: queueRef.current.length,
    }));
  }, []);

  /**
   * Add a command to the queue.
   * If already connected, the command is executed immediately and NOT queued.
   * ttlMs overrides the default 30 s expiry.
   */
  const enqueue = useCallback(
    async (
      type: string,
      payload: Record<string, unknown> = {},
      ttlMs = DEFAULT_TTL_MS
    ) => {
      const isConnected = connectionMode !== "disconnected";
      if (isConnected) {
        // Fast path — send immediately, no queue
        try {
          await sendCommand(type, payload);
        } catch (err) {
          console.warn("[OfflineQueue] Immediate send failed, queuing:", err);
          _addToQueue(type, payload, ttlMs);
        }
        return;
      }
      _addToQueue(type, payload, ttlMs);
    },
    [connectionMode, sendCommand] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function _addToQueue(
    type: string,
    payload: Record<string, unknown>,
    ttlMs: number
  ) {
    if (queueRef.current.length >= MAX_QUEUE_SIZE) {
      console.warn("[OfflineQueue] Queue full, dropping oldest command");
      queueRef.current.shift();
    }
    queueRef.current.push({
      id: crypto.randomUUID(),
      type,
      payload,
      enqueuedAt: Date.now(),
      ttlMs,
    });
    setState((prev) => ({ ...prev, pendingCount: queueRef.current.length }));
  }

  /** Drain expired entries without sending them */
  const purgeExpired = useCallback(() => {
    const now = Date.now();
    const before = queueRef.current.length;
    queueRef.current = queueRef.current.filter(
      (cmd) => now - cmd.enqueuedAt < cmd.ttlMs
    );
    if (queueRef.current.length !== before) {
      refreshState();
    }
  }, [refreshState]);

  /** Drain the queue serially, skipping expired commands */
  const drainQueue = useCallback(async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;
    setState((prev) => ({ ...prev, isReplaying: true }));

    try {
      while (queueRef.current.length > 0) {
        const cmd = queueRef.current[0];
        const age = Date.now() - cmd.enqueuedAt;

        if (age >= cmd.ttlMs) {
          // Expired — discard silently
          queueRef.current.shift();
          refreshState();
          continue;
        }

        try {
          await sendCommand(cmd.type, cmd.payload);
          queueRef.current.shift(); // success — remove
          refreshState();
        } catch (err) {
          // Failed to send — stop draining; will retry on next connection
          const errMsg = err instanceof Error ? err.message : String(err);
          setState((prev) => ({ ...prev, lastError: errMsg }));
          console.warn("[OfflineQueue] Drain failed, pausing:", errMsg);
          break;
        }

        // Small gap between replayed commands to avoid overwhelming the agent
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      isDrainingRef.current = false;
      setState((prev) => ({
        ...prev,
        isReplaying: false,
        pendingCount: queueRef.current.length,
      }));
    }
  }, [sendCommand, refreshState]);

  // Auto-drain when connection returns, purge expired periodically
  useEffect(() => {
    if (connectionMode === "disconnected") return;

    // Drain queued commands now that we're back online
    if (queueRef.current.length > 0) {
      drainQueue();
    }

    const purgeInterval = window.setInterval(purgeExpired, 5000);
    return () => clearInterval(purgeInterval);
  }, [connectionMode, drainQueue, purgeExpired]);

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setState({ pendingCount: 0, isReplaying: false, lastError: null });
  }, []);

  return { enqueue, clearQueue, purgeExpired, ...state };
}
