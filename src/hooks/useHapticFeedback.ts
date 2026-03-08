import { useCallback, useRef } from "react";

/**
 * Haptic feedback hook.
 * Uses Capacitor Haptics on native, Web Vibration API as fallback.
 */
export function useHapticFeedback() {
  const isSupported = typeof navigator !== "undefined" && "vibrate" in navigator;
  const capacitorRef = useRef<any>(null);
  const checkedRef = useRef(false);

  const getHaptics = useCallback(async () => {
    if (capacitorRef.current) return capacitorRef.current;
    if (checkedRef.current) return null;
    checkedRef.current = true;
    try {
      const { Haptics } = await import("@capacitor/haptics");
      capacitorRef.current = Haptics;
      return Haptics;
    } catch {
      return null;
    }
  }, []);

  const tap = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.impact({ style: "light" }); return; } catch {}
    }
    if (isSupported) navigator.vibrate(10);
  }, [isSupported, getHaptics]);

  const doubleTap = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.impact({ style: "medium" }); return; } catch {}
    }
    if (isSupported) navigator.vibrate([10, 30, 10]);
  }, [isSupported, getHaptics]);

  const scroll = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.impact({ style: "light" }); return; } catch {}
    }
    if (isSupported) navigator.vibrate(5);
  }, [isSupported, getHaptics]);

  const zoom = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.impact({ style: "medium" }); return; } catch {}
    }
    if (isSupported) navigator.vibrate(15);
  }, [isSupported, getHaptics]);

  const gesture3Finger = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.notification({ type: "success" }); return; } catch {}
    }
    if (isSupported) navigator.vibrate([20, 50, 20]);
  }, [isSupported, getHaptics]);

  const gesture4Finger = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.notification({ type: "warning" }); return; } catch {}
    }
    if (isSupported) navigator.vibrate([15, 30, 15, 30, 15]);
  }, [isSupported, getHaptics]);

  const success = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.notification({ type: "success" }); return; } catch {}
    }
    if (isSupported) navigator.vibrate([10, 50, 30]);
  }, [isSupported, getHaptics]);

  const error = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.notification({ type: "error" }); return; } catch {}
    }
    if (isSupported) navigator.vibrate([50, 30, 50, 30, 50]);
  }, [isSupported, getHaptics]);

  // Heavy impact for power controls, toggles
  const heavy = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.impact({ style: "heavy" }); return; } catch {}
    }
    if (isSupported) navigator.vibrate(25);
  }, [isSupported, getHaptics]);

  // Selection changed - for pickers/tabs
  const selection = useCallback(async () => {
    const h = await getHaptics();
    if (h) {
      try { await h.selectionChanged(); return; } catch {}
    }
    if (isSupported) navigator.vibrate(5);
  }, [isSupported, getHaptics]);

  return {
    isSupported: true, // Always "supported" since we have Capacitor fallback
    tap,
    doubleTap,
    scroll,
    zoom,
    gesture3Finger,
    gesture4Finger,
    success,
    error,
    heavy,
    selection,
  };
}
