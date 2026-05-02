/**
 * commandThrottle — client-side de-duplication & rate-limiting for outgoing
 * device commands. Prevents Zoom/system spam when buttons are tapped rapidly
 * or when proximity / auto logic fires repeated identical commands.
 *
 * - Per-command-type minimum interval (ms)
 * - Identical (type + payload) within window → suppressed (de-dup)
 * - Maintains a running count of suppressed commands, observable via subscribe()
 */

type Listener = () => void;

// Minimum ms between any two sends of the same command type.
// Identical payloads within this window are de-duplicated; different payloads
// within the window are still rate-limited.
const RULES: Record<string, { minIntervalMs: number; dedupOnly?: boolean }> = {
  // Zoom — heavy automation, never spam
  join_zoom: { minIntervalMs: 5000 },
  leave_zoom: { minIntervalMs: 3000 },
  zoom_status: { minIntervalMs: 2000 },
  zoom_mute: { minIntervalMs: 800 },
  zoom_video: { minIntervalMs: 800 },
  zoom_share: { minIntervalMs: 1500 },

  // System / power — destructive or expensive
  lock: { minIntervalMs: 2000 },
  shutdown: { minIntervalMs: 5000 },
  restart: { minIntervalMs: 5000 },
  sleep: { minIntervalMs: 5000 },
  boost_ram: { minIntervalMs: 10000 },
  clear_temp_files: { minIntervalMs: 30000 },
  set_power_plan: { minIntervalMs: 5000 },
  gaming_mode: { minIntervalMs: 5000 },
  optimize_drives: { minIntervalMs: 60000 },
  restart_explorer: { minIntervalMs: 10000 },

  // Mute / media — dedup identical, allow rapid toggles
  mute_pc: { minIntervalMs: 400, dedupOnly: true },
  unmute_pc: { minIntervalMs: 400, dedupOnly: true },

  // Proximity / auto-presence — never re-sync identical config
  set_proximity_config: { minIntervalMs: 1500 },

  // Background polling — drop duplicates fired in tight loop
  get_system_stats: { minIntervalMs: 1500, dedupOnly: true },
  get_system_state: { minIntervalMs: 1500, dedupOnly: true },
};

interface LastSend {
  at: number;
  payloadHash: string;
}

const lastSends = new Map<string, LastSend>();
let suppressedCount = 0;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => {
    try { l(); } catch { /* noop */ }
  });
}

function hashPayload(payload: unknown): string {
  try { return JSON.stringify(payload ?? {}); } catch { return ""; }
}

export interface ThrottleDecision {
  allow: boolean;
  reason?: "duplicate" | "rate_limited";
  retryInMs?: number;
}

/** Decide whether a command should be sent now. Records the send if allowed. */
export function shouldSendCommand(
  commandType: string,
  payload: Record<string, unknown> = {}
): ThrottleDecision {
  const rule = RULES[commandType];
  if (!rule) return { allow: true };

  const now = Date.now();
  const hash = hashPayload(payload);
  const last = lastSends.get(commandType);

  if (last) {
    const age = now - last.at;
    const withinWindow = age < rule.minIntervalMs;
    const isDuplicate = withinWindow && last.payloadHash === hash;

    if (isDuplicate) {
      suppressedCount += 1;
      emit();
      return { allow: false, reason: "duplicate", retryInMs: rule.minIntervalMs - age };
    }

    if (withinWindow && !rule.dedupOnly) {
      suppressedCount += 1;
      emit();
      return { allow: false, reason: "rate_limited", retryInMs: rule.minIntervalMs - age };
    }
  }

  lastSends.set(commandType, { at: now, payloadHash: hash });
  return { allow: true };
}

export function getSuppressedCount(): number {
  return suppressedCount;
}

export function resetSuppressedCount(): void {
  suppressedCount = 0;
  emit();
}

export function subscribeSuppressed(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
