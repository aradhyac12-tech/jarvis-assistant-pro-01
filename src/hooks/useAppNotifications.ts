import { useCallback, useRef, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

/**
 * App notification service — uses native Capacitor local notifications
 * when available, falls back to Web Notification API.
 */

const isNative = Capacitor.isNativePlatform();

async function requestPermission(): Promise<boolean> {
  if (isNative) {
    try {
      const result = await LocalNotifications.requestPermissions();
      return result.display === "granted";
    } catch {
      return false;
    }
  }

  if ("Notification" in window) {
    const result = await Notification.requestPermission();
    return result === "granted";
  }
  return false;
}

async function sendNotification(title: string, body: string, tag?: string) {
  if (isNative) {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          title,
          body,
          id: Math.floor(Math.random() * 100000),
          schedule: { at: new Date(Date.now() + 100) },
          sound: undefined,
          smallIcon: "ic_notification",
          largeIcon: "ic_launcher",
        }],
      });
      return;
    } catch {
      // fall through to web
    }
  }

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

  useEffect(() => {
    requestPermission().then(granted => {
      permissionGranted.current = granted;
    });
  }, []);

  const notify = useCallback((id: string, title: string, body: string, cooldownMs = 10000) => {
    const now = Date.now();
    const lastSent = cooldowns.current.get(id) || 0;
    if (now - lastSent < cooldownMs) return;

    cooldowns.current.set(id, now);
    sendNotification(title, body, id);
  }, []);

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
