import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";

/**
 * Ultra-fast fire-and-forget command sending.
 * Does NOT wait for command completion - just queues it and returns immediately.
 * Use for: mouse movements, key presses, quick controls.
 */
export function useFastCommand() {
  const { session } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();
  const pendingRef = useRef(new Set<string>());

  const fireCommand = useCallback(
    (commandType: string, payload: Record<string, unknown> = {}) => {
      const sessionToken = session?.session_token;
      const deviceId = selectedDevice?.id || session?.device_id;

      if (!sessionToken || !deviceId) return;

      // Fire and forget - no await
      supabase.functions.invoke("device-commands", {
        body: { action: "insert", commandType, payload },
        headers: { "x-session-token": sessionToken },
      });
    },
    [selectedDevice?.id, session?.device_id, session?.session_token]
  );

  // ============ OPTIMIZED BATCHING (KDE Connect style) ============
  
  // Mouse: Batch at 32ms (~30fps) with threshold to reduce spam
  const mouseAccumulator = useRef({ x: 0, y: 0 });
  const mouseTimerRef = useRef<number | null>(null);
  const MOUSE_BATCH_MS = 32;
  const MOUSE_THRESHOLD = 2;

  const fireMouse = useCallback(
    (deltaX: number, deltaY: number) => {
      mouseAccumulator.current.x += deltaX;
      mouseAccumulator.current.y += deltaY;

      if (mouseTimerRef.current !== null) return;

      mouseTimerRef.current = window.setTimeout(() => {
        const { x, y } = mouseAccumulator.current;
        if (Math.abs(x) >= MOUSE_THRESHOLD || Math.abs(y) >= MOUSE_THRESHOLD) {
          fireCommand("mouse_move", { x: Math.round(x), y: Math.round(y), relative: true });
        }
        mouseAccumulator.current = { x: 0, y: 0 };
        mouseTimerRef.current = null;
      }, MOUSE_BATCH_MS);
    },
    [fireCommand]
  );

  // Key presses with minimal debounce
  const lastKeyTime = useRef(0);
  const KEY_DEBOUNCE_MS = 30;

  const fireKey = useCallback(
    (key: string) => {
      const now = Date.now();
      if (now - lastKeyTime.current < KEY_DEBOUNCE_MS) return;
      lastKeyTime.current = now;

      if (key.includes("+")) {
        const keys = key.toLowerCase().split("+").map(k => k.trim());
        fireCommand("key_combo", { keys });
      } else {
        fireCommand("press_key", { key: key.toLowerCase() });
      }
    },
    [fireCommand]
  );

  // Scroll: Batch at 50ms with accumulation and threshold
  const scrollAccumulator = useRef(0);
  const scrollTimerRef = useRef<number | null>(null);
  const SCROLL_BATCH_MS = 50;
  const SCROLL_THRESHOLD = 3;

  const fireScroll = useCallback(
    (deltaY: number) => {
      // Natural scroll direction
      scrollAccumulator.current += deltaY * -0.3;

      if (scrollTimerRef.current !== null) return;

      scrollTimerRef.current = window.setTimeout(() => {
        const amount = Math.round(scrollAccumulator.current);
        if (Math.abs(amount) >= SCROLL_THRESHOLD) {
          fireCommand("mouse_scroll", { amount });
        }
        scrollAccumulator.current = 0;
        scrollTimerRef.current = null;
      }, SCROLL_BATCH_MS);
    },
    [fireCommand]
  );

  // Pinch-to-zoom: Batch at 100ms, single command
  const zoomAccumulator = useRef(0);
  const zoomTimerRef = useRef<number | null>(null);
  const ZOOM_BATCH_MS = 100;
  const ZOOM_THRESHOLD = 0.05;

  const fireZoom = useCallback(
    (delta: number) => {
      zoomAccumulator.current += delta;

      if (zoomTimerRef.current !== null) return;

      zoomTimerRef.current = window.setTimeout(() => {
        const amount = zoomAccumulator.current;
        if (Math.abs(amount) >= ZOOM_THRESHOLD) {
          // Single zoom command instead of multiple key_combo calls
          fireCommand("pinch_zoom", { 
            direction: amount > 0 ? "in" : "out",
            steps: Math.min(Math.ceil(Math.abs(amount) * 3), 5)
          });
        }
        zoomAccumulator.current = 0;
        zoomTimerRef.current = null;
      }, ZOOM_BATCH_MS);
    },
    [fireCommand]
  );

  // Zoom reset (Ctrl+0)
  const fireZoomReset = useCallback(() => {
    fireCommand("key_combo", { keys: ["ctrl", "0"] });
  }, [fireCommand]);

  // 3-finger gesture: Show Desktop
  const fireGesture3Finger = useCallback(() => {
    fireCommand("gesture_3_finger", {});
  }, [fireCommand]);

  // 4-finger swipe: Virtual desktop switch
  const fireGesture4Finger = useCallback((direction: "left" | "right") => {
    fireCommand("gesture_4_finger", { direction });
  }, [fireCommand]);

  return { 
    fireCommand, 
    fireMouse, 
    fireKey, 
    fireScroll, 
    fireZoom, 
    fireZoomReset,
    fireGesture3Finger,
    fireGesture4Finger,
  };
}
