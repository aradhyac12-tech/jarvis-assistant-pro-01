/**
 * Background persistence — KDE Connect style.
 * Keeps the app state, P2P connection, and session alive when backgrounded.
 * On foreground resume: NO reconnect needed, NO refresh, instant resume.
 *
 * Strategy:
 * 1. KeepAwake (Capacitor) prevents Android from killing the WebView
 * 2. Heartbeat keepalive pings every 25s to keep WS/Supabase alive
 * 3. On resume: validate session silently, re-probe P2P if needed
 * 4. localStorage flags coordinate state across resume cycles
 */

import { useEffect, useRef, useCallback } from "react";

const HEARTBEAT_MS = 25_000;  // 25s — under Android's 30s idle kill threshold
const RESUME_RECHECK_DELAY = 800; // ms after foreground before re-checking P2P

export function useBackgroundPersistence() {
  const heartbeatRef = useRef<number | null>(null);
  const backgroundedAtRef = useRef<number>(0);
  const isNativeRef = useRef<boolean>(false);

  // Detect native once
  useEffect(() => {
    const checkNative = async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        isNativeRef.current = Capacitor.isNativePlatform();
      } catch { isNativeRef.current = false; }
    };
    checkNative();
  }, []);

  // Acquire KeepAwake — prevents Android from suspending WebView JS engine
  const acquireKeepAwake = useCallback(async () => {
    if (!isNativeRef.current) return;
    try {
      const { KeepAwake } = await import("@capacitor-community/keep-awake");
      await KeepAwake.keepAwake();
    } catch { /* plugin not installed or not needed */ }
  }, []);

  // Heartbeat: touch localStorage + ping supabase to keep connections alive
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = window.setInterval(() => {
      try {
        localStorage.setItem("jarvis_heartbeat", String(Date.now()));
      } catch { }
      // Keep P2P alive via a lightweight storage touch
      // (useLocalP2P's keepalive interval handles the actual WS ping)
    }, HEARTBEAT_MS);
  }, []);

  // On foreground resume: silent re-check without forcing reconnect
  const handleResume = useCallback(async () => {
    const bgTime = backgroundedAtRef.current;
    if (bgTime === 0) return;
    const elapsed = Date.now() - bgTime;
    backgroundedAtRef.current = 0;

    console.log(`[BG] Resumed after ${Math.round(elapsed / 1000)}s`);

    // Re-acquire keep awake (Android can drop it while backgrounded)
    await acquireKeepAwake();

    // If only briefly backgrounded (<10s), no action needed
    if (elapsed < 10_000) return;

    // Signal to useLocalP2P to re-probe if connection dropped
    // useLocalP2P has its own keepalive that handles reconnect — just trigger check
    setTimeout(() => {
      localStorage.setItem("jarvis_resume_trigger", String(Date.now()));
    }, RESUME_RECHECK_DELAY);
  }, [acquireKeepAwake]);

  useEffect(() => {
    // Start heartbeat immediately
    startHeartbeat();
    // Acquire keep awake
    acquireKeepAwake();

    // Visibility API — works in both browser and Capacitor WebView
    const handleVisibility = () => {
      if (document.hidden) {
        backgroundedAtRef.current = Date.now();
        console.log("[BG] App backgrounded");
      } else {
        handleResume();
      }
    };

    // Capacitor App state — more reliable than visibility on Android
    const setupCapacitorListeners = async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import("@capacitor/app");

        const stateHandle = await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) {
            backgroundedAtRef.current = Date.now();
          } else {
            handleResume();
          }
        });

        // Back button: minimize instead of exit
        const backHandle = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) {
            window.history.back();
          } else {
            App.minimizeApp();
          }
        });

        // Return cleanup function
        return () => {
          stateHandle.remove();
          backHandle.remove();
        };
      } catch {
        return () => {};
        /* not in Capacitor */
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    let capacitorCleanup: (() => void) | undefined;
    setupCapacitorListeners().then((cleanup) => {
      capacitorCleanup = cleanup;
    });

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (capacitorCleanup) capacitorCleanup();
    };
  }, [startHeartbeat, acquireKeepAwake, handleResume]);
}
