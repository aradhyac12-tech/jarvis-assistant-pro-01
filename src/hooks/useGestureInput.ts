import { useCallback, useRef } from "react";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

/**
 * Advanced gesture detection for multi-touch trackpad.
 * Handles:
 * - 1 finger: Mouse movement (60fps RAF-based)
 * - 2 fingers: Scroll (vertical/horizontal) + Pinch-to-zoom
 * - 3 fingers: Minimize all (Win+D)
 * - 4 fingers left/right: Virtual desktop switch (Ctrl+Win+Left/Right)
 * 
 * Includes haptic feedback for gestures via Vibration API.
 */

export interface GestureState {
  type: "move" | "scroll" | "pinch" | "gesture_3" | "gesture_4_left" | "gesture_4_right" | null;
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
  onClick: (button: "left" | "right") => void;
}

// Thresholds for gesture detection (optimized for smoothness)
const MOVE_THRESHOLD = 1.5; // Lower threshold for smoother response
const SCROLL_THRESHOLD = 4;
const PINCH_THRESHOLD = 0.04;
const SWIPE_THRESHOLD = 80;
const GESTURE_3_THRESHOLD = 60;
const TAP_MAX_TIME = 180;
const TAP_MAX_MOVE = 12;

export function useGestureInput(callbacks: GestureCallbacks) {
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

  // Calculate center point of all touches
  const getCenter = useCallback((touches: Map<number, TouchPoint>) => {
    if (touches.size === 0) return { x: 0, y: 0 };
    let sumX = 0, sumY = 0;
    touches.forEach(t => {
      sumX += t.x;
      sumY += t.y;
    });
    return { x: sumX / touches.size, y: sumY / touches.size };
  }, []);

  // Calculate average distance from center (for pinch detection)
  const getAverageDistance = useCallback((touches: Map<number, TouchPoint>, center: { x: number; y: number }) => {
    if (touches.size < 2) return 0;
    let sumDist = 0;
    touches.forEach(t => {
      sumDist += Math.hypot(t.x - center.x, t.y - center.y);
    });
    return sumDist / touches.size;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touches = e.touches;
    touchesRef.current.clear();
    
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      touchesRef.current.set(t.identifier, {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        startX: t.clientX,
        startY: t.clientY,
      });
    }

    const center = getCenter(touchesRef.current);
    const distance = getAverageDistance(touchesRef.current, center);
    
    gestureStartRef.current = {
      time: Date.now(),
      centerX: center.x,
      centerY: center.y,
      distance,
    };
    lastCenterRef.current = center;
    lastDistanceRef.current = distance;
    gestureTriggeredRef.current = false;
    touchStartTimeRef.current = Date.now();
    totalMovementRef.current = 0;
  }, [getCenter, getAverageDistance]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touches = e.touches;
    const fingerCount = touches.length;

    // Update touch positions
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const existing = touchesRef.current.get(t.identifier);
      if (existing) {
        existing.x = t.clientX;
        existing.y = t.clientY;
      }
    }

    const center = getCenter(touchesRef.current);
    const lastCenter = lastCenterRef.current;
    
    if (!lastCenter) {
      lastCenterRef.current = center;
      return;
    }

    const deltaX = center.x - lastCenter.x;
    const deltaY = center.y - lastCenter.y;
    totalMovementRef.current += Math.abs(deltaX) + Math.abs(deltaY);

    if (fingerCount === 1) {
      // Single finger: Mouse movement with RAF for 60fps smoothness
      if (Math.abs(deltaX) > MOVE_THRESHOLD / 2 || Math.abs(deltaY) > MOVE_THRESHOLD / 2) {
        // Accumulate movement for RAF batch
        if (!pendingMoveRef.current) {
          pendingMoveRef.current = { x: 0, y: 0 };
        }
        pendingMoveRef.current.x += deltaX * 2.5;
        pendingMoveRef.current.y += deltaY * 2.5;
        
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
      // Two fingers: Scroll OR Pinch-to-zoom
      const currentDistance = getAverageDistance(touchesRef.current, center);
      const distanceDelta = currentDistance - lastDistanceRef.current;
      
      // Determine if pinching or scrolling based on distance change
      if (Math.abs(distanceDelta) > PINCH_THRESHOLD * 50) {
        // Pinch gesture detected
        const scaleFactor = distanceDelta / 100;
        callbacks.onPinchZoom(scaleFactor);
        lastDistanceRef.current = currentDistance;
      } else if (Math.abs(deltaY) > SCROLL_THRESHOLD / 3) {
        // Scroll gesture - smoother response
        callbacks.onScroll(deltaY * 2.5);
      }
    } else if (fingerCount === 3 && !gestureTriggeredRef.current) {
      // Three fingers: Minimize all (Win+D) on downward swipe
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
      // Four fingers: Virtual desktop switch
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
  }, [callbacks, getCenter, getAverageDistance, haptics]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const elapsed = Date.now() - touchStartTimeRef.current;
    const fingerCount = touchesRef.current.size;
    
    // Cancel any pending RAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingMoveRef.current = null;
    
    // Detect tap (quick touch with minimal movement)
    if (elapsed < TAP_MAX_TIME && totalMovementRef.current < TAP_MAX_MOVE) {
      if (fingerCount === 1) {
        haptics.tap();
        callbacks.onClick("left");
      } else if (fingerCount === 2) {
        haptics.doubleTap();
        callbacks.onClick("right");
      }
    }

    // Clean up finished touches
    const remainingTouches = e.touches;
    touchesRef.current.clear();
    for (let i = 0; i < remainingTouches.length; i++) {
      const t = remainingTouches[i];
      touchesRef.current.set(t.identifier, {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        startX: t.clientX,
        startY: t.clientY,
      });
    }

    if (touchesRef.current.size === 0) {
      gestureStartRef.current = null;
      lastCenterRef.current = null;
      gestureTriggeredRef.current = false;
    }
  }, [callbacks, haptics]);

  // Mouse event handlers for desktop (fallback)
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
    
    // Use RAF for smooth desktop mouse handling too
    if (Math.abs(deltaX) > MOVE_THRESHOLD / 2 || Math.abs(deltaY) > MOVE_THRESHOLD / 2) {
      if (!pendingMoveRef.current) {
        pendingMoveRef.current = { x: 0, y: 0 };
      }
      pendingMoveRef.current.x += deltaX * 2.5;
      pendingMoveRef.current.y += deltaY * 2.5;
      
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
  }, [callbacks]);

  const handleMouseUp = useCallback(() => {
    // Cancel pending RAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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
    
    // Check for pinch-to-zoom (Ctrl + wheel)
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
    haptics, // Expose haptics for external use
  };
}
