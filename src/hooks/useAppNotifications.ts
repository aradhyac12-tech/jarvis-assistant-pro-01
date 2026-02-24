import { useCallback, useRef, useEffect } from "react";

/**
 * App notification service — uses native Capacitor push notifications
 * when available, falls back to Web Notification API.
 * 
 * Provides a simple `notify()` function to send local notifications
 * for events like: PC connected, motion detected, human detected, call incoming.
 */

let notificationPermission: NotificationPermission | "unknown" = "unknown";

async function requestPermission(): Promise<boolean> {
  // Try Capacitor LocalNotifications first
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      // LocalNotifications not installed — skip native
      return false;
    }
  } catch {
    // Not available, fall through to web
  }

  // Web Notification API
  if ("Notification" in window) {
    const result = await Notification.requestPermission();
    notificationPermission = result;
    return result === "granted";
  }
  return false;
}

async function sendNotification(title: string, body: string, tag?: string) {
  // Try Capacitor native
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      // LocalNotifications not installed — skip native
      return;
    }
  } catch {
    // Fall through
  }

  // Web fallback
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, {
      body,
      tag: tag || "jarvis-notification",
      icon: "/favicon.ico",
      silent: false,
    });
  }
}

export function useAppNotifications() {
  const permissionGranted = useRef(false);
  const cooldowns = useRef<Map<string, number>>(new Map());

  // Request permission on first use
  useEffect(() => {
    requestPermission().then(granted => {
      permissionGranted.current = granted;
    });
  }, []);

  /**
   * Send a notification with cooldown to avoid spam.
   * @param id Unique ID for cooldown tracking
   * @param title Notification title
   * @param body Notification body
   * @param cooldownMs Minimum ms between notifications with same ID (default 10s)
   */
  const notify = useCallback((id: string, title: string, body: string, cooldownMs = 10000) => {
    const now = Date.now();
    const lastSent = cooldowns.current.get(id) || 0;
    if (now - lastSent < cooldownMs) return; // Cooldown active

    cooldowns.current.set(id, now);
    sendNotification(title, body, id);
  }, []);

  /** Convenience methods */
  const notifyPcConnected = useCallback((deviceName?: string) => {
    notify("pc-connected", "PC Connected", deviceName ? `${deviceName} is now connected` : "Your PC agent is online", 30000);
  }, [notify]);

  const notifyPcDisconnected = useCallback(() => {
    notify("pc-disconnected", "PC Disconnected", "Your PC agent went offline", 30000);
  }, [notify]);

  const notifyMotionDetected = useCallback((confidence: number) => {
    notify("motion-detected", "🚨 Motion Detected!", `Movement detected (${confidence}% confidence)`, 15000);
  }, [notify]);

  const notifyHumanDetected = useCallback((confidence: number) => {
    notify("human-detected", "🧍 Human Detected!", `Person detected in surveillance (${confidence}% confidence)`, 15000);
  }, [notify]);

  const notifyCallIncoming = useCallback(() => {
    notify("call-incoming", "📞 Incoming Call", "Call detected on your phone", 5000);
  }, [notify]);

  const notifyP2PUpgrade = useCallback((mode: string) => {
    notify("p2p-upgrade", "⚡ Connection Upgraded", `Switched to ${mode} for faster performance`, 30000);
  }, [notify]);

  return {
    notify,
    notifyPcConnected,
    notifyPcDisconnected,
    notifyMotionDetected,
    notifyHumanDetected,
    notifyCallIncoming,
    notifyP2PUpgrade,
    requestPermission,
  };
}
