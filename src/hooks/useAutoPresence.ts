import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useAuth } from "@/hooks/useAuth";
import { useAppNotifications } from "@/hooks/useAppNotifications";
import { addLog } from "@/components/IssueLog";

type PresenceStatus = "home" | "away" | "unknown";

const PRESENCE_KEY = "auto_presence_enabled";
const AWAY_DELAY_KEY = "auto_presence_away_delay";
const POLL_INTERVAL = 15_000; // Check every 15s
const DEFAULT_AWAY_DELAY = 60_000; // 60s grace period before marking "away"

export function useAutoPresence() {
  const { selectedDevice } = useDeviceContext();
  const { user } = useAuth();
  const { notify } = useAppNotifications();

  const [enabled, setEnabled] = useState(() => localStorage.getItem(PRESENCE_KEY) === "true");
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>("unknown");
  const [awayDelay, setAwayDelay] = useState(() =>
    parseInt(localStorage.getItem(AWAY_DELAY_KEY) || String(DEFAULT_AWAY_DELAY))
  );

  // Callbacks set by the consumer (SurveillancePanel)
  const onAwayRef = useRef<(() => void) | null>(null);
  const onHomeRef = useRef<(() => void) | null>(null);
  const lastStatusRef = useRef<PresenceStatus>("unknown");
  const lastSeenTimestampRef = useRef<number>(Date.now());
  const graceStartRef = useRef<number | null>(null);

  // Persist settings
  useEffect(() => { localStorage.setItem(PRESENCE_KEY, String(enabled)); }, [enabled]);
  useEffect(() => { localStorage.setItem(AWAY_DELAY_KEY, String(awayDelay)); }, [awayDelay]);

  const setOnAway = useCallback((cb: () => void) => { onAwayRef.current = cb; }, []);
  const setOnHome = useCallback((cb: () => void) => { onHomeRef.current = cb; }, []);

  // Poll device online status
  useEffect(() => {
    if (!enabled || !selectedDevice?.id || !user) return;

    const checkPresence = async () => {
      try {
        const { data, error } = await supabase
          .from("devices")
          .select("is_online, last_seen")
          .eq("id", selectedDevice.id)
          .single();

        if (error || !data) return;

        const isOnline = data.is_online;
        const lastSeen = data.last_seen ? new Date(data.last_seen).getTime() : 0;
        const now = Date.now();

        // Check if device went offline or stale (no heartbeat for awayDelay)
        const isStale = lastSeen > 0 && (now - lastSeen) > awayDelay;
        const devicePresent = isOnline && !isStale;

        if (devicePresent) {
          graceStartRef.current = null;
          if (lastStatusRef.current !== "home") {
            lastStatusRef.current = "home";
            setPresenceStatus("home");
            addLog("info", "web", "Auto-presence: Owner detected (device online)");
            notify("presence-home", "🏠 Welcome Home", "Surveillance auto-disabled — you're connected", 30000);
            onHomeRef.current?.();
          }
          lastSeenTimestampRef.current = now;
        } else {
          // Start grace period
          if (graceStartRef.current === null) {
            graceStartRef.current = now;
            addLog("info", "web", `Auto-presence: Device offline, grace period started (${awayDelay / 1000}s)`);
          }

          // Grace period elapsed → mark away
          if (graceStartRef.current && (now - graceStartRef.current) >= awayDelay) {
            if (lastStatusRef.current !== "away") {
              lastStatusRef.current = "away";
              setPresenceStatus("away");
              addLog("warn", "web", "Auto-presence: Owner away — activating surveillance");
              notify("presence-away", "🔒 Away Mode", "Surveillance auto-enabled — you disconnected", 30000);
              onAwayRef.current?.();
            }
          }
        }
      } catch (err) {
        console.error("Auto-presence check failed:", err);
      }
    };

    // Initial check
    checkPresence();
    const interval = setInterval(checkPresence, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [enabled, selectedDevice?.id, user, awayDelay, notify]);

  // Also subscribe to realtime device changes for instant detection
  useEffect(() => {
    if (!enabled || !selectedDevice?.id) return;

    const channel = supabase
      .channel(`presence_${selectedDevice.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "devices",
          filter: `id=eq.${selectedDevice.id}`,
        },
        (payload) => {
          const device = payload.new as any;
          if (device.is_online && lastStatusRef.current === "away") {
            graceStartRef.current = null;
            lastStatusRef.current = "home";
            setPresenceStatus("home");
            addLog("info", "web", "Auto-presence: Device came online (realtime)");
            notify("presence-home", "🏠 Welcome Home", "Surveillance auto-disabled", 30000);
            onHomeRef.current?.();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [enabled, selectedDevice?.id, notify]);

  return {
    enabled,
    setEnabled,
    presenceStatus,
    awayDelay,
    setAwayDelay,
    setOnAway,
    setOnHome,
  };
}
