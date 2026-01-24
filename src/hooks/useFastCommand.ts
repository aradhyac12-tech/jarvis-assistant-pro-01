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

  // Batched mouse move - accumulates movements and sends periodically
  const mouseAccumulator = useRef({ x: 0, y: 0 });
  const mouseTimerRef = useRef<number | null>(null);
  const MOUSE_BATCH_MS = 16; // ~60fps batching

  const fireMouse = useCallback(
    (deltaX: number, deltaY: number) => {
      mouseAccumulator.current.x += deltaX;
      mouseAccumulator.current.y += deltaY;

      if (mouseTimerRef.current !== null) return;

      mouseTimerRef.current = window.setTimeout(() => {
        const { x, y } = mouseAccumulator.current;
        if (Math.abs(x) > 0 || Math.abs(y) > 0) {
          fireCommand("mouse_move", { x: Math.round(x), y: Math.round(y), relative: true });
        }
        mouseAccumulator.current = { x: 0, y: 0 };
        mouseTimerRef.current = null;
      }, MOUSE_BATCH_MS);
    },
    [fireCommand]
  );

  // Debounced key presses for rapid typing
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

  // Mouse scroll - batched like mouse move for smooth scrolling
  const scrollAccumulator = useRef(0);
  const scrollTimerRef = useRef<number | null>(null);
  const SCROLL_BATCH_MS = 16; // ~60fps batching

  const fireScroll = useCallback(
    (deltaY: number) => {
      // Invert and scale for natural scrolling feel
      scrollAccumulator.current += deltaY * -0.5;

      if (scrollTimerRef.current !== null) return;

      scrollTimerRef.current = window.setTimeout(() => {
        const amount = Math.round(scrollAccumulator.current);
        if (Math.abs(amount) > 0) {
          fireCommand("mouse_scroll", { amount });
        }
        scrollAccumulator.current = 0;
        scrollTimerRef.current = null;
      }, SCROLL_BATCH_MS);
    },
    [fireCommand]
  );

  // Pinch-to-zoom - batched for smooth zooming
  const zoomAccumulator = useRef(0);
  const zoomTimerRef = useRef<number | null>(null);
  const ZOOM_BATCH_MS = 16; // ~60fps batching

  const fireZoom = useCallback(
    (delta: number) => {
      // delta > 0 = zoom in, delta < 0 = zoom out
      zoomAccumulator.current += delta;

      if (zoomTimerRef.current !== null) return;

      zoomTimerRef.current = window.setTimeout(() => {
        const amount = zoomAccumulator.current;
        if (Math.abs(amount) > 0.01) {
          // Send zoom command - positive = zoom in (ctrl+plus), negative = zoom out (ctrl+minus)
          const zoomType = amount > 0 ? "zoom_in" : "zoom_out";
          const steps = Math.min(Math.abs(Math.round(amount * 5)), 10); // Cap at 10 steps
          for (let i = 0; i < steps; i++) {
            fireCommand("key_combo", { keys: ["ctrl", zoomType === "zoom_in" ? "+" : "-"] });
          }
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

  return { fireCommand, fireMouse, fireKey, fireScroll, fireZoom, fireZoomReset };
}
