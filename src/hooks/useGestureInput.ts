import { useCallback, useRef } from "react";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

/**
 * KDE Connect-style gesture detection for remote trackpad.
 * 
 * Features (matching KDE Connect mousepad):
 * - 1 finger: Mouse movement with cursor acceleration
 * - Single tap: Left click
 * - Double tap: Double-click
 * - Double-tap-and-hold+drag: Click-drag (like holding left mouse button)
 * - 2 finger tap: Right click
 * - 2 fingers vertical: Scroll
 * - 2 fingers pinch: Zoom
 * - 3 fingers down: Show desktop (Win+D)
 * - 4 fingers left/right: Switch virtual desktop
 * 
 * Cursor acceleration: slow finger = precise, fast finger = large cursor jumps
 */

export interface GestureState {
  type: "move" | "scroll" | "pinch" | "gesture_3" | "gesture_4_left" | "gesture_4_right" | "drag" | null;
  fingerCount: number;
  deltaX: number;
  deltaY: number;
  scale: number;
}

interface TouchPoint {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
}

interface GestureCallbacks {
  onMouseMove: (deltaX: number, deltaY: number) => void;
  onScroll: (deltaY: number) => void;
  onPinchZoom: (delta: number) => void;
  onGesture3Finger: () => void;
  onGesture4FingerLeft: () => void;
  onGesture4FingerRight: () => void;
  onClick: (button: "left" | "right" | "middle") => void;
  onDoubleClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

// Tuned thresholds
const SCROLL_THRESHOLD = 3;
const PINCH_THRESHOLD = 0.04;
const SWIPE_THRESHOLD = 80;
const GESTURE_3_THRESHOLD = 60;
const TAP_MAX_TIME = 200;
const TAP_MAX_MOVE = 15;
const DOUBLE_TAP_WINDOW = 300;

// Acceleration curve (KDE Connect style)
function accelerate(delta: number, sensitivity: number): number {
  const absDelta = Math.abs(delta);
  // Slow movement: linear (precise). Fast movement: quadratic (large jumps)
  const speed = absDelta < 3
    ? absDelta * sensitivity
    : (absDelta * sensitivity) + (absDelta * absDelta * 0.06 * sensitivity);
  return delta >= 0 ? speed : -speed;
}

export function useGestureInput(callbacks: GestureCallbacks, sensitivity = 1.0) {
  const haptics = useHapticFeedback();
  const touchesRef = useRef<Map<number, TouchPoint>>(new Map());
  const gestureStartRef = useRef<{ time: number; centerX: number; centerY: number; distance: number } | null>(null);
  const lastCenterRef = useRef<{ x: number; y: number } | null>(null);
  const lastDistanceRef = useRef<number>(0);
  const gestureTriggeredRef = useRef(false);
  const touchStartTimeRef = useRef(0);
  const totalMovementRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);

  // Double-tap and drag detection
  const lastTapTimeRef = useRef(0);
  const isDraggingRef = useRef(false);
  const doubleTapPendingRef = useRef(false);
  const tapTimerRef = useRef<number | null>(null);

  const getCenter = useCallback((touches: Map<number, TouchPoint>) => {
    if (touches.size === 0) return { x: 0, y: 0 };
    let sumX = 0, sumY = 0;
    touches.forEach(t => { sumX += t.x; sumY += t.y; });
    return { x: sumX / touches.size, y: sumY / touches.size };
  }, []);

  const getAverageDistance = useCallback((touches: Map<number, TouchPoint>, center: { x: number; y: number }) => {
    if (touches.size < 2) return 0;
    let sumDist = 0;
    touches.forEach(t => { sumDist += Math.hypot(t.x - center.x, t.y - center.y); });
    return sumDist / touches.size;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touches = e.touches;
    touchesRef.current.clear();

    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      touchesRef.current.set(t.identifier, {
        id: t.identifier, x: t.clientX, y: t.clientY,
        startX: t.clientX, startY: t.clientY,
      });
    }

    const center = getCenter(touchesRef.current);
    const distance = getAverageDistance(touchesRef.current, center);

    gestureStartRef.current = { time: Date.now(), centerX: center.x, centerY: center.y, distance };
    lastCenterRef.current = center;
    lastDistanceRef.current = distance;
    gestureTriggeredRef.current = false;
    touchStartTimeRef.current = Date.now();
    totalMovementRef.current = 0;

    // Check for double-tap-and-hold (drag mode)
    const now = Date.now();
    if (touches.length === 1 && now - lastTapTimeRef.current < DOUBLE_TAP_WINDOW) {
      // This is a second touch within double-tap window → enter drag mode
      doubleTapPendingRef.current = true;
    }
  }, [getCenter, getAverageDistance]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touches = e.touches;
    const fingerCount = touches.length;

    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const existing = touchesRef.current.get(t.identifier);
      if (existing) { existing.x = t.clientX; existing.y = t.clientY; }
    }

    const center = getCenter(touchesRef.current);
    const lastCenter = lastCenterRef.current;
    if (!lastCenter) { lastCenterRef.current = center; return; }

    const deltaX = center.x - lastCenter.x;
    const deltaY = center.y - lastCenter.y;
    totalMovementRef.current += Math.abs(deltaX) + Math.abs(deltaY);

    // Activate drag mode on movement after double-tap
    if (doubleTapPendingRef.current && totalMovementRef.current > 5 && !isDraggingRef.current) {
      isDraggingRef.current = true;
      doubleTapPendingRef.current = false;
      haptics.tap();
      callbacks.onDragStart?.();
    }

    if (fingerCount === 1) {
      // Mouse movement with acceleration
      const accX = accelerate(deltaX, sensitivity);
      const accY = accelerate(deltaY, sensitivity);

      if (Math.abs(accX) > 0.5 || Math.abs(accY) > 0.5) {
        if (!pendingMoveRef.current) pendingMoveRef.current = { x: 0, y: 0 };
        pendingMoveRef.current.x += accX;
        pendingMoveRef.current.y += accY;

        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(() => {
            if (pendingMoveRef.current) {
              callbacks.onMouseMove(pendingMoveRef.current.x, pendingMoveRef.current.y);
              pendingMoveRef.current = null;
            }
            rafRef.current = null;
          });
        }
      }
    } else if (fingerCount === 2) {
      const currentDistance = getAverageDistance(touchesRef.current, center);
      const distanceDelta = currentDistance - lastDistanceRef.current;

      if (Math.abs(distanceDelta) > PINCH_THRESHOLD * 50) {
        callbacks.onPinchZoom(distanceDelta / 100);
        lastDistanceRef.current = currentDistance;
      } else if (Math.abs(deltaY) > SCROLL_THRESHOLD / 2) {
        callbacks.onScroll(deltaY * 3);
      }
    } else if (fingerCount === 3 && !gestureTriggeredRef.current) {
      const startCenter = gestureStartRef.current;
      if (startCenter) {
        const totalDeltaY = center.y - startCenter.centerY;
        if (totalDeltaY > GESTURE_3_THRESHOLD) {
          haptics.gesture3Finger();
          callbacks.onGesture3Finger();
          gestureTriggeredRef.current = true;
        }
      }
    } else if (fingerCount === 4 && !gestureTriggeredRef.current) {
      const startCenter = gestureStartRef.current;
      if (startCenter) {
        const totalDeltaX = center.x - startCenter.centerX;
        if (totalDeltaX > SWIPE_THRESHOLD) {
          haptics.gesture4Finger();
          callbacks.onGesture4FingerRight();
          gestureTriggeredRef.current = true;
        } else if (totalDeltaX < -SWIPE_THRESHOLD) {
          haptics.gesture4Finger();
          callbacks.onGesture4FingerLeft();
          gestureTriggeredRef.current = true;
        }
      }
    }

    lastCenterRef.current = center;
  }, [callbacks, getCenter, getAverageDistance, haptics, sensitivity]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const elapsed = Date.now() - touchStartTimeRef.current;
    const fingerCount = touchesRef.current.size;

    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingMoveRef.current = null;

    // End drag mode
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      callbacks.onDragEnd?.();
    }
    doubleTapPendingRef.current = false;

    // Detect taps
    if (elapsed < TAP_MAX_TIME && totalMovementRef.current < TAP_MAX_MOVE) {
      const now = Date.now();
      if (fingerCount === 1) {
        // Check for double-tap
        if (now - lastTapTimeRef.current < DOUBLE_TAP_WINDOW) {
          // Double-tap → double click
          if (tapTimerRef.current) { clearTimeout(tapTimerRef.current); tapTimerRef.current = null; }
          haptics.doubleTap();
          callbacks.onDoubleClick?.();
          lastTapTimeRef.current = 0;
        } else {
          // Single tap → delay to check for double-tap
          lastTapTimeRef.current = now;
          tapTimerRef.current = window.setTimeout(() => {
            haptics.tap();
            callbacks.onClick("left");
            tapTimerRef.current = null;
          }, DOUBLE_TAP_WINDOW);
        }
      } else if (fingerCount === 2) {
        haptics.doubleTap();
        callbacks.onClick("right");
        lastTapTimeRef.current = 0;
      } else if (fingerCount === 3) {
        haptics.tap();
        callbacks.onClick("middle");
        lastTapTimeRef.current = 0;
      }
    } else {
      lastTapTimeRef.current = 0;
    }

    // Clean up
    const remainingTouches = e.touches;
    touchesRef.current.clear();
    for (let i = 0; i < remainingTouches.length; i++) {
      const t = remainingTouches[i];
      touchesRef.current.set(t.identifier, {
        id: t.identifier, x: t.clientX, y: t.clientY,
        startX: t.clientX, startY: t.clientY,
      });
    }

    if (touchesRef.current.size === 0) {
      gestureStartRef.current = null;
      lastCenterRef.current = null;
      gestureTriggeredRef.current = false;
    }
  }, [callbacks, haptics]);

  // Desktop mouse fallback
  const mouseDownRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const mouseStartTimeRef = useRef(0);
  const mouseMoveDistRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    mouseStartTimeRef.current = Date.now();
    mouseMoveDistRef.current = 0;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!mouseDownRef.current) return;
    const deltaX = e.clientX - lastMouseRef.current.x;
    const deltaY = e.clientY - lastMouseRef.current.y;
    mouseMoveDistRef.current += Math.abs(deltaX) + Math.abs(deltaY);

    const accX = accelerate(deltaX, sensitivity);
    const accY = accelerate(deltaY, sensitivity);

    if (Math.abs(accX) > 0.5 || Math.abs(accY) > 0.5) {
      if (!pendingMoveRef.current) pendingMoveRef.current = { x: 0, y: 0 };
      pendingMoveRef.current.x += accX;
      pendingMoveRef.current.y += accY;

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingMoveRef.current) {
            callbacks.onMouseMove(pendingMoveRef.current.x, pendingMoveRef.current.y);
            pendingMoveRef.current = null;
          }
          rafRef.current = null;
        });
      }
    }
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, [callbacks, sensitivity]);

  const handleMouseUp = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingMoveRef.current = null;
    const elapsed = Date.now() - mouseStartTimeRef.current;
    if (elapsed < TAP_MAX_TIME && mouseMoveDistRef.current < TAP_MAX_MOVE) {
      haptics.tap();
      callbacks.onClick("left");
    }
    mouseDownRef.current = false;
  }, [callbacks, haptics]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey) {
      callbacks.onPinchZoom(-e.deltaY * 0.01);
    } else {
      callbacks.onScroll(e.deltaY);
    }
  }, [callbacks]);

  return {
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    mouseHandlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
    },
    wheelHandler: handleWheel,
    haptics,
    isDragging: isDraggingRef.current,
  };
}
