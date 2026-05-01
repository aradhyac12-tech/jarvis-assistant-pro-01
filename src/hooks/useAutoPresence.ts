import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useAuth } from "@/hooks/useAuth";
import { useAppNotifications } from "@/hooks/useAppNotifications";
import { addLog } from "@/components/IssueLog";
import { registerPlugin } from "@capacitor/core";

// Background geolocation plugin — only available in native Capacitor context
interface BackgroundGeolocationWatcher {
  addWatcher(options: {
    backgroundMessage: string;
    backgroundTitle: string;
    requestPermissions: boolean;
    stale: boolean;
    distanceFilter: number;
  }, callback: (location: { latitude: number; longitude: number; accuracy: number } | undefined, error: any) => void): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationWatcher>("BackgroundGeolocation");

type PresenceStatus = "home" | "away" | "unknown";
type PresenceMode = "device" | "geofence" | "both";

const PRESENCE_KEY = "auto_presence_enabled";
const AWAY_DELAY_KEY = "auto_presence_away_delay";
const PRESENCE_MODE_KEY = "auto_presence_mode";
const GEO_HOME_LAT_KEY = "auto_presence_home_lat";
const GEO_HOME_LNG_KEY = "auto_presence_home_lng";
const GEO_RADIUS_KEY = "auto_presence_radius";
const GEO_POLL_KEY = "auto_presence_geo_poll";

const POLL_INTERVAL = 15_000;
const DEFAULT_AWAY_DELAY = 60_000;
const DEFAULT_RADIUS = 200; // meters
const DEFAULT_GEO_POLL = 30_000; // 30s

function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useAutoPresence() {
  const { selectedDevice } = useDeviceContext();
  const { user } = useAuth();
  const { notify } = useAppNotifications();

  const [enabled, setEnabled] = useState(() => localStorage.getItem(PRESENCE_KEY) === "true");
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>("unknown");
  const [awayDelay, setAwayDelay] = useState(() =>
    parseInt(localStorage.getItem(AWAY_DELAY_KEY) || String(DEFAULT_AWAY_DELAY))
  );

  // Geofencing state
  const [presenceMode, setPresenceMode] = useState<PresenceMode>(
    () => (localStorage.getItem(PRESENCE_MODE_KEY) as PresenceMode) || "device"
  );
  const [homeLat, setHomeLat] = useState<number | null>(() => {
    const v = localStorage.getItem(GEO_HOME_LAT_KEY);
    return v ? parseFloat(v) : null;
  });
  const [homeLng, setHomeLng] = useState<number | null>(() => {
    const v = localStorage.getItem(GEO_HOME_LNG_KEY);
    return v ? parseFloat(v) : null;
  });
  const [homeRadius, setHomeRadius] = useState(() =>
    parseInt(localStorage.getItem(GEO_RADIUS_KEY) || String(DEFAULT_RADIUS))
  );
  const [geoPollInterval, setGeoPollInterval] = useState(() =>
    parseInt(localStorage.getItem(GEO_POLL_KEY) || String(DEFAULT_GEO_POLL))
  );
  const [currentDistance, setCurrentDistance] = useState<number | null>(null);
  const [geoPermission, setGeoPermission] = useState<"granted" | "denied" | "prompt" | "unavailable">("prompt");
  const [settingHome, setSettingHome] = useState(false);

  // Callbacks
  const onAwayRef = useRef<(() => void) | null>(null);
  const onHomeRef = useRef<(() => void) | null>(null);
  const lastStatusRef = useRef<PresenceStatus>("unknown");
  const lastSeenTimestampRef = useRef<number>(Date.now());
  const graceStartRef = useRef<number | null>(null);

  // Geo result refs for combining with device status
  const geoInsideRef = useRef<boolean | null>(null);
  const deviceOnlineRef = useRef<boolean | null>(null);

  // Persist settings
  useEffect(() => { localStorage.setItem(PRESENCE_KEY, String(enabled)); }, [enabled]);
  useEffect(() => { localStorage.setItem(AWAY_DELAY_KEY, String(awayDelay)); }, [awayDelay]);
  useEffect(() => { localStorage.setItem(PRESENCE_MODE_KEY, presenceMode); }, [presenceMode]);
  useEffect(() => { if (homeLat !== null) localStorage.setItem(GEO_HOME_LAT_KEY, String(homeLat)); }, [homeLat]);
  useEffect(() => { if (homeLng !== null) localStorage.setItem(GEO_HOME_LNG_KEY, String(homeLng)); }, [homeLng]);
  useEffect(() => { localStorage.setItem(GEO_RADIUS_KEY, String(homeRadius)); }, [homeRadius]);
  useEffect(() => { localStorage.setItem(GEO_POLL_KEY, String(geoPollInterval)); }, [geoPollInterval]);

  const setOnAway = useCallback((cb: () => void) => { onAwayRef.current = cb; }, []);
  const setOnHome = useCallback((cb: () => void) => { onHomeRef.current = cb; }, []);

  // Check geo permission on mount — clean up listener on unmount
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGeoPermission("unavailable");
      return;
    }
    if (!("permissions" in navigator)) return;

    let permResult: PermissionStatus | null = null;
    const handler = () => {
      if (permResult) setGeoPermission(permResult.state as any);
    };

    navigator.permissions
      .query({ name: "geolocation" })
      .then((result) => {
        permResult = result;
        setGeoPermission(result.state as any);
        result.addEventListener("change", handler);
      })
      .catch(() => {});

    return () => {
      permResult?.removeEventListener("change", handler);
    };
  }, []);

  // Set current location as home
  const setCurrentAsHome = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    setSettingHome(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHomeLat(pos.coords.latitude);
        setHomeLng(pos.coords.longitude);
        setSettingHome(false);
        setGeoPermission("granted");
        addLog("info", "web", `Geofence home set: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
        notify("geo-home-set", "📍 Home Location Set", `Radius: ${homeRadius}m`, 10000);
      },
      (err) => {
        setSettingHome(false);
        if (err.code === err.PERMISSION_DENIED) setGeoPermission("denied");
        addLog("error", "web", `Geolocation error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, [homeRadius, notify]);

  // Combined presence evaluation
  const evaluatePresence = useCallback(() => {
    // If a signal hasn't produced its first reading yet (null = still initialising),
    // treat the mode as "unknown" and skip evaluation entirely.
    // This prevents false "away" triggers the moment the app loads.
    if (presenceMode === "geofence" && geoInsideRef.current === null) return;
    if (presenceMode === "device" && deviceOnlineRef.current === null) return;
    if (presenceMode === "both" && geoInsideRef.current === null && deviceOnlineRef.current === null) return;

    let isPresent: boolean;

    if (presenceMode === "device") {
      isPresent = deviceOnlineRef.current === true;
    } else if (presenceMode === "geofence") {
      isPresent = geoInsideRef.current === true;
    } else {
      // "both" — present if EITHER signal says home
      // (away only when BOTH confirm absence)
      isPresent = deviceOnlineRef.current === true || geoInsideRef.current === true;
    }

    const now = Date.now();

    if (isPresent) {
      graceStartRef.current = null;
      if (lastStatusRef.current !== "home") {
        lastStatusRef.current = "home";
        setPresenceStatus("home");
        addLog("info", "web", "Auto-presence: Owner detected");
        notify("presence-home", "🏠 Welcome Home", "Surveillance auto-disabled", 30000);
        onHomeRef.current?.();
      }
      lastSeenTimestampRef.current = now;
    } else {
      if (graceStartRef.current === null) {
        graceStartRef.current = now;
        addLog("info", "web", `Auto-presence: Signals lost, grace period (${awayDelay / 1000}s)`);
      }
      if (graceStartRef.current && (now - graceStartRef.current) >= awayDelay) {
        if (lastStatusRef.current !== "away") {
          lastStatusRef.current = "away";
          setPresenceStatus("away");
          addLog("warn", "web", "Auto-presence: Owner away — activating surveillance");
          notify("presence-away", "🔒 Away Mode", "Surveillance auto-enabled", 30000);
          onAwayRef.current?.();
        }
      }
    }
  }, [presenceMode, awayDelay, notify]);

  // Poll device online status
  useEffect(() => {
    if (!enabled || !selectedDevice?.id || !user) return;
    if (presenceMode === "geofence") return; // Skip device polling in geo-only mode

    const checkDevice = async () => {
      try {
        const { data, error } = await supabase
          .from("devices")
          .select("is_online, last_seen")
          .eq("id", selectedDevice.id)
          .single();

        if (error || !data) return;

        const isOnline = data.is_online;
        const lastSeen = data.last_seen ? new Date(data.last_seen).getTime() : 0;
        // Consider stale if last_seen is older than 2 minutes (agent heartbeat is ~30s)
        const STALE_THRESHOLD = Math.max(awayDelay, 120_000);
        const isStale = lastSeen > 0 && (Date.now() - lastSeen) > STALE_THRESHOLD;
        deviceOnlineRef.current = isOnline && !isStale;
        evaluatePresence();
      } catch (err) {
        console.error("Auto-presence device check failed:", err);
      }
    };

    checkDevice();
    const interval = setInterval(checkDevice, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [enabled, selectedDevice?.id, user, awayDelay, presenceMode, evaluatePresence]);

  // Geofence: use native background geolocation (Capacitor) or web watchPosition
  const watchIdRef = useRef<number | null>(null);
  const bgWatcherIdRef = useRef<string | null>(null);
  const [backgroundTracking, setBackgroundTracking] = useState(false);

  useEffect(() => {
    if (!enabled || presenceMode === "device") return;
    if (homeLat === null || homeLng === null) return;

    const handlePosition = (lat: number, lng: number) => {
      const dist = getDistanceMeters(homeLat, homeLng, lat, lng);
      setCurrentDistance(Math.round(dist));
      const wasInside = geoInsideRef.current;
      geoInsideRef.current = dist <= homeRadius;
      if (wasInside !== geoInsideRef.current || wasInside === null) {
        addLog("info", "web", `Geofence: ${dist.toFixed(0)}m from home (${geoInsideRef.current ? "inside" : "outside"} ${homeRadius}m radius)`);
      }
      evaluatePresence();
    };

    let cleanupFns: (() => void)[] = [];

    // Try native Capacitor background geolocation first
    const tryNativeBackground = async () => {
      try {
        const watcherId = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: "JARVIS is tracking your presence for surveillance automation.",
            backgroundTitle: "Presence Tracking Active",
            requestPermissions: true,
            stale: false,
            distanceFilter: Math.max(20, Math.round(homeRadius / 5)),
          },
          (location, error) => {
            if (error) {
              if (error.code === "NOT_AUTHORIZED") {
                setGeoPermission("denied");
                addLog("warn", "web", "Background geolocation permission denied");
              }
              return;
            }
            if (location) {
              setGeoPermission("granted");
              handlePosition(location.latitude, location.longitude);
            }
          }
        );

        bgWatcherIdRef.current = watcherId;
        setBackgroundTracking(true);
        setGeoPermission("granted");
        addLog("info", "web", "✅ Native background geolocation active — presence tracks even when app is minimized");

        cleanupFns.push(() => {
          if (bgWatcherIdRef.current) {
            BackgroundGeolocation.removeWatcher({ id: bgWatcherIdRef.current });
            bgWatcherIdRef.current = null;
            setBackgroundTracking(false);
          }
        });
      } catch {
        // Not running in native Capacitor — fall back to web API
        addLog("info", "web", "Background geolocation unavailable — using web watchPosition");
        startWebGeofence();
      }
    };

    const startWebGeofence = () => {
      if (!("geolocation" in navigator)) return;

      const geoOptions: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 };

      const watchId = navigator.geolocation.watchPosition(
        (pos) => handlePosition(pos.coords.latitude, pos.coords.longitude),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) setGeoPermission("denied");
          addLog("warn", "web", `Geolocation error: ${err.message}`);
        },
        geoOptions
      );
      watchIdRef.current = watchId;
      setGeoPermission("granted");

      // Fallback polling for devices where watchPosition stalls
      const fallbackInterval = setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          (pos) => handlePosition(pos.coords.latitude, pos.coords.longitude),
          () => {},
          geoOptions
        );
      }, geoPollInterval);

      cleanupFns.push(() => {
        navigator.geolocation.clearWatch(watchId);
        watchIdRef.current = null;
        clearInterval(fallbackInterval);
      });
    };

    tryNativeBackground();

    return () => {
      cleanupFns.forEach(fn => fn());
    };
  }, [enabled, presenceMode, homeLat, homeLng, homeRadius, geoPollInterval, evaluatePresence]);

  // Realtime device updates
  useEffect(() => {
    if (!enabled || !selectedDevice?.id || presenceMode === "geofence") return;

    const channel = supabase
      .channel(`presence_${selectedDevice.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "devices", filter: `id=eq.${selectedDevice.id}` },
        (payload) => {
          const device = payload.new as any;
          deviceOnlineRef.current = device.is_online;
          evaluatePresence();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [enabled, selectedDevice?.id, presenceMode, evaluatePresence]);

  return {
    enabled,
    setEnabled,
    presenceStatus,
    awayDelay,
    setAwayDelay,
    setOnAway,
    setOnHome,
    // Geofencing
    presenceMode,
    setPresenceMode,
    homeLat,
    homeLng,
    homeRadius,
    setHomeRadius,
    geoPollInterval,
    setGeoPollInterval,
    currentDistance,
    geoPermission,
    setCurrentAsHome,
    settingHome,
    homeConfigured: homeLat !== null && homeLng !== null,
    backgroundTracking,
  };
}
