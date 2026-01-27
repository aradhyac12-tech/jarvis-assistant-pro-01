import { useCallback } from "react";

/**
 * Haptic feedback hook using the Vibration API.
 * Provides different vibration patterns for various gestures.
 */
export function useHapticFeedback() {
  const isSupported = typeof navigator !== "undefined" && "vibrate" in navigator;

  // Light tap - for clicks
  const tap = useCallback(() => {
    if (isSupported) {
      navigator.vibrate(10);
    }
  }, [isSupported]);

  // Double tap - for right click
  const doubleTap = useCallback(() => {
    if (isSupported) {
      navigator.vibrate([10, 30, 10]);
    }
  }, [isSupported]);

  // Scroll feedback - very subtle
  const scroll = useCallback(() => {
    if (isSupported) {
      navigator.vibrate(5);
    }
  }, [isSupported]);

  // Zoom feedback - medium intensity
  const zoom = useCallback(() => {
    if (isSupported) {
      navigator.vibrate(15);
    }
  }, [isSupported]);

  // Gesture recognized - 3 finger
  const gesture3Finger = useCallback(() => {
    if (isSupported) {
      navigator.vibrate([20, 50, 20]);
    }
  }, [isSupported]);

  // Gesture recognized - 4 finger swipe
  const gesture4Finger = useCallback(() => {
    if (isSupported) {
      navigator.vibrate([15, 30, 15, 30, 15]);
    }
  }, [isSupported]);

  // Success feedback
  const success = useCallback(() => {
    if (isSupported) {
      navigator.vibrate([10, 50, 30]);
    }
  }, [isSupported]);

  // Error feedback
  const error = useCallback(() => {
    if (isSupported) {
      navigator.vibrate([50, 30, 50, 30, 50]);
    }
  }, [isSupported]);

  return {
    isSupported,
    tap,
    doubleTap,
    scroll,
    zoom,
    gesture3Finger,
    gesture4Finger,
    success,
    error,
  };
}
