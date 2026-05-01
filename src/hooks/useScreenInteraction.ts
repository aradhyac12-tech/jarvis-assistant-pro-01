/**
 * useScreenInteraction
 *
 * Translates phone touch gestures on a screen-mirror image into PC mouse
 * commands. All coordinates are sent as 0..1 normalised fractions so the
 * agent can map them to the actual PC resolution without the phone ever
 * needing to know it.
 *
 * ──────────────────────────────────────────────────────────────────────
 *  Gesture          →  PC action
 * ──────────────────────────────────────────────────────────────────────
 *  Tap              →  left click
 *  Double tap       →  double click
 *  Long press       →  right click   (vibrates at ~550 ms threshold)
 *  Long press+drag  →  left drag     (mousedown → move → mouseup)
 *  One-finger drag  →  cursor move   (no button held)
 *  Two-finger drag  →  scroll
 *  Two-finger tap   →  right click
 *  Three-finger tap →  middle click
 * ──────────────────────────────────────────────────────────────────────
 */

import { useRef, useCallback, useEffect } from "react";

type SendCommandFn = (
  cmd: string,
  payload: Record<string, unknown>,
  opts?: { awaitResult?: boolean }
) => void;

interface GestureState {
  // Timing
  touchStartTime: number;
  lastTapTime: number;
  lastTapX: number;
  lastTapY: number;
  longPressTimer: ReturnType<typeof setTimeout> | null;

  // Drag state
  isDragging: boolean;       // cursor-move drag (no button)
  isMouseDown: boolean;      // long-press drag (button held)
  startX: number;
  startY: number;
  lastMoveX: number;
  lastMoveY: number;
  hasMoved: boolean;

  // Move throttle
  lastMoveSent: number;
  moveRaf: number | null;

  // Two-finger scroll
  lastPinchY: number;
}

/** Pixels of movement before a tap becomes a drag */
const MOVE_THRESHOLD = 10;
/** ms before a held press becomes a right-click / drag */
const LONG_PRESS_MS = 550;
/** ms window to count a second tap as double-click */
const DOUBLE_TAP_MS = 280;
/** ms between throttled mouse_move commands */
const MOVE_THROTTLE_MS = 16; // ~60 fps

// ─── Coordinate mapping ───────────────────────────────────────────────────────

/**
 * Given a touch position in viewport coordinates and the container element,
 * returns {nx, ny} normalised 0..1 relative to the actual rendered image area.
 *
 * Handles object-contain letterboxing: the stream is always 16:9, but the
 * container might be a different shape in fullscreen mode on a phone.
 */
function toNormalized(
  clientX: number,
  clientY: number,
  container: HTMLElement,
  imageAspect = 16 / 9
): { nx: number; ny: number } {
  const rect = container.getBoundingClientRect();

  const cw = rect.width;
  const ch = rect.height;
  const containerAspect = cw / ch;

  let imageW: number;
  let imageH: number;
  let offsetX: number;
  let offsetY: number;

  if (containerAspect >= imageAspect) {
    // Container is wider → pillar-boxed left/right
    imageH = ch;
    imageW = ch * imageAspect;
    offsetX = (cw - imageW) / 2;
    offsetY = 0;
  } else {
    // Container is taller → letter-boxed top/bottom
    imageW = cw;
    imageH = cw / imageAspect;
    offsetX = 0;
    offsetY = (ch - imageH) / 2;
  }

  const tx = clientX - rect.left - offsetX;
  const ty = clientY - rect.top - offsetY;

  return {
    nx: Math.max(0, Math.min(1, tx / imageW)),
    ny: Math.max(0, Math.min(1, ty / imageH)),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useScreenInteraction(
  sendCommand: SendCommandFn,
  containerRef: React.RefObject<HTMLElement>,
  enabled: boolean
) {
  const g = useRef<GestureState>({
    touchStartTime: 0,
    lastTapTime: 0,
    lastTapX: -1,
    lastTapY: -1,
    longPressTimer: null,
    isDragging: false,
    isMouseDown: false,
    startX: 0,
    startY: 0,
    lastMoveX: 0,
    lastMoveY: 0,
    hasMoved: false,
    lastMoveSent: 0,
    moveRaf: null,
    lastPinchY: 0,
  });

  // Vibration helper (silently ignored if unavailable)
  const vibrate = useCallback((ms: number) => {
    try { navigator.vibrate?.(ms); } catch {}
  }, []);

  const cancelLongPress = useCallback(() => {
    if (g.current.longPressTimer !== null) {
      clearTimeout(g.current.longPressTimer);
      g.current.longPressTimer = null;
    }
  }, []);

  const flushMouseUp = useCallback(() => {
    if (g.current.isMouseDown) {
      g.current.isMouseDown = false;
      sendCommand("mouse_up", { button: "left" }, { awaitResult: false });
    }
  }, [sendCommand]);

  // ── onTouchStart ──────────────────────────────────────────────────────────
  const onTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || !containerRef.current) return;

    const touches = e.touches;
    const now = Date.now();
    const state = g.current;

    // ── Two-finger: right-click or scroll setup ───────────────────────────
    if (touches.length === 2) {
      cancelLongPress();
      e.preventDefault();
      const midY = (touches[0].clientY + touches[1].clientY) / 2;
      state.lastPinchY = midY;
      // Two-finger tap detection: record start
      state.touchStartTime = now;
      state.hasMoved = false;
      return;
    }

    // ── Three-finger: middle click ────────────────────────────────────────
    if (touches.length >= 3) {
      cancelLongPress();
      e.preventDefault();
      const { nx, ny } = toNormalized(touches[0].clientX, touches[0].clientY, containerRef.current);
      sendCommand("mouse_click", { button: "middle", clicks: 1, normalized_x: nx, normalized_y: ny }, { awaitResult: false });
      vibrate(30);
      return;
    }

    // ── Single finger ─────────────────────────────────────────────────────
    e.preventDefault();
    const t = touches[0];
    state.touchStartTime = now;
    state.startX = t.clientX;
    state.startY = t.clientY;
    state.lastMoveX = t.clientX;
    state.lastMoveY = t.clientY;
    state.hasMoved = false;
    state.isDragging = false;

    // Schedule long-press right-click
    state.longPressTimer = setTimeout(() => {
      if (!state.hasMoved) {
        const { nx, ny } = toNormalized(state.lastMoveX, state.lastMoveY, containerRef.current!);
        sendCommand("mouse_click", { button: "right", clicks: 1, normalized_x: nx, normalized_y: ny }, { awaitResult: false });
        vibrate(60);
        state.isMouseDown = false;
        state.isDragging = false;
        state.longPressTimer = null;
      }
    }, LONG_PRESS_MS);
  }, [enabled, containerRef, sendCommand, vibrate, cancelLongPress]);

  // ── onTouchMove ───────────────────────────────────────────────────────────
  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || !containerRef.current) return;

    const touches = e.touches;
    e.preventDefault();
    const state = g.current;

    // ── Two-finger scroll ─────────────────────────────────────────────────
    if (touches.length === 2) {
      const midY = (touches[0].clientY + touches[1].clientY) / 2;
      const midX = (touches[0].clientX + touches[1].clientX) / 2;
      const delta = midY - state.lastPinchY;
      state.lastPinchY = midY;
      state.hasMoved = true;
      cancelLongPress();

      if (Math.abs(delta) > 1) {
        const scrollAmount = Math.round(delta * 0.25); // scale to reasonable scroll steps
        const { nx, ny } = toNormalized(midX, midY, containerRef.current);
        sendCommand(
          "mouse_scroll",
          { amount: scrollAmount, normalized_x: nx, normalized_y: ny },
          { awaitResult: false }
        );
      }
      return;
    }

    if (touches.length !== 1) return;

    const t = touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;

    if (!state.hasMoved && Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      state.hasMoved = true;
      cancelLongPress();
    }

    if (!state.hasMoved) return;

    const { nx, ny } = toNormalized(t.clientX, t.clientY, containerRef.current);

    // ── Long-press drag: first move after long press held ─────────────────
    if (state.isMouseDown) {
      // Mouse is already down — just keep moving
    } else if (state.isDragging) {
      // Already in cursor-move mode — keep sending moves
    } else {
      // Decide mode: if we moved before long-press fired → cursor move
      state.isDragging = true;
    }

    // Throttle moves via RAF
    if (state.moveRaf !== null) return;
    const now = Date.now();
    if (now - state.lastMoveSent < MOVE_THROTTLE_MS) {
      state.moveRaf = requestAnimationFrame(() => {
        state.moveRaf = null;
        const pos = toNormalized(state.lastMoveX, state.lastMoveY, containerRef.current!);
        sendCommand("mouse_move", { x: pos.nx, y: pos.ny, normalized: true }, { awaitResult: false });
        state.lastMoveSent = Date.now();
      });
    } else {
      sendCommand("mouse_move", { x: nx, y: ny, normalized: true }, { awaitResult: false });
      state.lastMoveSent = now;
    }

    state.lastMoveX = t.clientX;
    state.lastMoveY = t.clientY;
  }, [enabled, containerRef, sendCommand, cancelLongPress]);

  // ── onTouchEnd ────────────────────────────────────────────────────────────
  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (!enabled || !containerRef.current) return;

    e.preventDefault();
    const state = g.current;
    const now = Date.now();
    const elapsed = now - state.touchStartTime;

    cancelLongPress();

    // ── Two-finger tap → right click ──────────────────────────────────────
    if (e.changedTouches.length >= 2 || (e.touches.length === 0 && e.changedTouches.length === 2)) {
      if (!state.hasMoved && elapsed < LONG_PRESS_MS) {
        const t = e.changedTouches[0];
        const { nx, ny } = toNormalized(t.clientX, t.clientY, containerRef.current);
        sendCommand("mouse_click", { button: "right", clicks: 1, normalized_x: nx, normalized_y: ny }, { awaitResult: false });
        vibrate(30);
      }
      state.hasMoved = false;
      return;
    }

    // Flush any pending RAF move
    if (state.moveRaf !== null) {
      cancelAnimationFrame(state.moveRaf);
      state.moveRaf = null;
    }

    // End a drag
    if (state.isMouseDown) {
      flushMouseUp();
      state.isDragging = false;
      state.hasMoved = false;
      return;
    }

    // Cursor move: nothing to do on lift (no click)
    if (state.isDragging && state.hasMoved) {
      state.isDragging = false;
      state.hasMoved = false;
      return;
    }

    // ── It's a tap ────────────────────────────────────────────────────────
    if (!state.hasMoved && elapsed < LONG_PRESS_MS) {
      const t = e.changedTouches[0];
      const { nx, ny } = toNormalized(t.clientX, t.clientY, containerRef.current);

      const timeSinceLastTap = now - state.lastTapTime;
      const distFromLastTap = Math.hypot(
        t.clientX - state.lastTapX,
        t.clientY - state.lastTapY
      );
      const isDoubleTap = timeSinceLastTap < DOUBLE_TAP_MS && distFromLastTap < 40;

      if (isDoubleTap) {
        // Double click
        sendCommand("mouse_click", { button: "left", clicks: 2, normalized_x: nx, normalized_y: ny }, { awaitResult: false });
        vibrate(20);
        state.lastTapTime = 0; // reset so triple-tap doesn't fire again
      } else {
        // Single click — move cursor there first, then click
        sendCommand("mouse_move", { x: nx, y: ny, normalized: true }, { awaitResult: false });
        sendCommand("mouse_click", { button: "left", clicks: 1, normalized_x: nx, normalized_y: ny }, { awaitResult: false });
        vibrate(10);
        state.lastTapTime = now;
        state.lastTapX = t.clientX;
        state.lastTapY = t.clientY;
      }
    }

    state.hasMoved = false;
    state.isDragging = false;
  }, [enabled, containerRef, sendCommand, vibrate, cancelLongPress, flushMouseUp]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelLongPress();
      flushMouseUp();
      if (g.current.moveRaf !== null) cancelAnimationFrame(g.current.moveRaf);
    };
  }, [cancelLongPress, flushMouseUp]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}
