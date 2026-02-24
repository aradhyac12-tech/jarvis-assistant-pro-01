/**
 * Background persistence for Capacitor APK.
 * Keeps the app alive in memory and maintains PC connection when backgrounded.
 * Works like KDE Connect - always connected, instant resume.
 */

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";

export function useBackgroundPersistence() {
  const isNative = Capacitor.isNativePlatform();
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    if (!isNative) return;

    // 1. Request wake lock to prevent CPU sleep
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          console.log('[Background] Wake lock acquired');
          
          wakeLockRef.current.addEventListener('release', () => {
            console.log('[Background] Wake lock released');
          });
        }
      } catch (err) {
        console.debug('[Background] Wake lock not available:', err);
      }
    };

    // 2. Keep WebView alive with periodic activity
    const keepAliveInterval = setInterval(() => {
      // Touch localStorage to keep the JS engine active
      try {
        localStorage.setItem('jarvis_keepalive', String(Date.now()));
      } catch { }
    }, 30000); // Every 30s

    // 3. Handle app state changes
    const setupAppStateListener = async () => {
      try {
        const { App } = await import("@capacitor/app");
        
        App.addListener("appStateChange", async ({ isActive }) => {
          if (isActive) {
            // Coming back to foreground - re-acquire wake lock
            console.log('[Background] App resumed');
            await requestWakeLock();
            // Touch session to keep it alive
            try {
              const sessionData = localStorage.getItem('jarvis_device_session');
              if (sessionData) {
                localStorage.setItem('jarvis_device_session', sessionData);
              }
            } catch { }
          } else {
            // Going to background - session stays in memory
            console.log('[Background] App backgrounded - maintaining connection');
            // Don't release wake lock - keep connection alive
          }
        });

        // Prevent back button from closing app
        App.addListener("backButton", ({ canGoBack }) => {
          if (!canGoBack) {
            // Minimize instead of close
            App.minimizeApp();
          }
        });
      } catch {
        // Not in Capacitor
      }
    };

    requestWakeLock();
    setupAppStateListener();

    // 4. Re-acquire wake lock when visibility changes
    const handleVisibility = async () => {
      if (!document.hidden && isNative) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(keepAliveInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch { }
      }
    };
  }, [isNative]);
}
