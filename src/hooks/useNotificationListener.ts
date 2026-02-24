import { useState, useCallback, useEffect, useRef } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

/**
 * KDE Connect-style notification listener.
 * 
 * On Android (Capacitor): Uses NotificationListenerService via
 * @posx/capacitor-notifications-listener to intercept ALL phone notifications
 * from ALL apps in real-time — exactly how KDE Connect does it.
 * 
 * On Web: Falls back to polling the PC agent for any queued notifications.
 * 
 * Flow: Phone notification → intercepted → forwarded to PC agent → Windows toast
 */

export interface PhoneNotification {
  id: string;
  appName: string;
  packageName: string;
  title: string;
  text: string;
  textLines: string[];
  timestamp: number;
  dismissed?: boolean;
}

// Well-known Android package → friendly name + emoji icon mapping
const APP_ICONS: Record<string, { name: string; emoji: string; color: string }> = {
  "com.whatsapp": { name: "WhatsApp", emoji: "💬", color: "hsl(142, 70%, 45%)" },
  "com.instagram.android": { name: "Instagram", emoji: "📸", color: "hsl(330, 70%, 50%)" },
  "com.facebook.katana": { name: "Facebook", emoji: "👤", color: "hsl(220, 70%, 50%)" },
  "com.facebook.orca": { name: "Messenger", emoji: "💭", color: "hsl(250, 70%, 55%)" },
  "com.twitter.android": { name: "X", emoji: "🐦", color: "hsl(200, 80%, 50%)" },
  "com.google.android.gm": { name: "Gmail", emoji: "📧", color: "hsl(5, 70%, 50%)" },
  "com.google.android.apps.messaging": { name: "Messages", emoji: "💬", color: "hsl(210, 70%, 50%)" },
  "com.google.android.dialer": { name: "Phone", emoji: "📞", color: "hsl(142, 60%, 45%)" },
  "com.google.android.calendar": { name: "Calendar", emoji: "📅", color: "hsl(210, 70%, 50%)" },
  "com.google.android.youtube": { name: "YouTube", emoji: "▶️", color: "hsl(0, 80%, 50%)" },
  "com.spotify.music": { name: "Spotify", emoji: "🎵", color: "hsl(142, 70%, 45%)" },
  "com.snapchat.android": { name: "Snapchat", emoji: "👻", color: "hsl(55, 90%, 55%)" },
  "org.telegram.messenger": { name: "Telegram", emoji: "✈️", color: "hsl(200, 70%, 50%)" },
  "com.discord": { name: "Discord", emoji: "🎮", color: "hsl(235, 85%, 65%)" },
  "com.linkedin.android": { name: "LinkedIn", emoji: "💼", color: "hsl(210, 80%, 45%)" },
  "com.amazon.mShop.android.shopping": { name: "Amazon", emoji: "📦", color: "hsl(30, 90%, 50%)" },
  "com.zhiliaoapp.musically": { name: "TikTok", emoji: "🎵", color: "hsl(340, 80%, 50%)" },
  "com.slack": { name: "Slack", emoji: "💼", color: "hsl(280, 50%, 45%)" },
  "com.microsoft.teams": { name: "Teams", emoji: "👥", color: "hsl(250, 60%, 50%)" },
  "com.microsoft.office.outlook": { name: "Outlook", emoji: "📮", color: "hsl(210, 80%, 50%)" },
};

export function getAppInfo(packageName: string, appTitle?: string) {
  const known = APP_ICONS[packageName];
  if (known) return known;
  // Fallback: derive name from package or appTitle
  const name = appTitle || packageName.split(".").pop() || "App";
  return { name, emoji: "📱", color: "hsl(var(--muted-foreground))" };
}

export function useNotificationListener() {
  const { sendCommand } = useDeviceCommands();
  const [notifications, setNotifications] = useState<PhoneNotification[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const listenerRefsCleanup = useRef<(() => void) | null>(null);

  // Check native platform
  useEffect(() => {
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        setIsNative(Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android");
      } catch {
        setIsNative(false);
      }
    })();
  }, []);

  // Forward notification to PC agent as Windows toast
  const forwardToPC = useCallback(async (notif: PhoneNotification) => {
    const appInfo = getAppInfo(notif.packageName, notif.appName);
    try {
      await sendCommand("show_notification", {
        title: `${appInfo.emoji} ${appInfo.name}`,
        message: notif.title ? `${notif.title}: ${notif.text}` : notif.text,
        app: appInfo.name,
        package: notif.packageName,
      }, { awaitResult: false });
    } catch {
      // Silent - don't block notification display
    }
  }, [sendCommand]);

  // Start listening (native Android via NotificationListenerService)
  const startListening = useCallback(async () => {
    if (isListening) return true;

    if (isNative) {
      try {
        const { NotificationsListener } = await import("@posx/capacitor-notifications-listener");

        // Check if we have permission
        const listening = await NotificationsListener.isListening();
        if (!listening.value) {
          // Open Android notification access settings
          await NotificationsListener.requestPermission();
          setPermissionGranted(false);
          return false;
        }

        setPermissionGranted(true);

        // Start the native NotificationListenerService
        await NotificationsListener.startListening({ cacheNotifications: true });

        // Restore any cached notifications from when app was killed
        await NotificationsListener.restoreCachedNotifications();

        // Listen for new notifications (real-time, like KDE Connect)
        const receivedHandle = await NotificationsListener.addListener(
          "notificationReceivedEvent",
          (notification) => {
            const newNotif: PhoneNotification = {
              id: `${notification.package}_${notification.time}_${Math.random().toString(36).slice(2, 6)}`,
              appName: notification.apptitle || "",
              packageName: notification.package || "",
              title: notification.title || "",
              text: notification.text || "",
              textLines: notification.textlines || [],
              timestamp: notification.time || Date.now(),
            };

            setNotifications(prev => {
              // Deduplicate by checking recent notifications from same package with same title
              const isDuplicate = prev.some(
                p => p.packageName === newNotif.packageName &&
                     p.title === newNotif.title &&
                     p.text === newNotif.text &&
                     Math.abs(p.timestamp - newNotif.timestamp) < 2000
              );
              if (isDuplicate) return prev;
              return [newNotif, ...prev].slice(0, 100);
            });

            // Forward to PC as Windows toast notification
            forwardToPC(newNotif);
          }
        );

        const removedHandle = await NotificationsListener.addListener(
          "notificationRemovedEvent",
          (notification) => {
            // Mark as dismissed when user clears on phone
            setNotifications(prev =>
              prev.map(n =>
                n.packageName === notification.package &&
                n.title === notification.title
                  ? { ...n, dismissed: true }
                  : n
              )
            );
          }
        );

        listenerRefsCleanup.current = () => {
          receivedHandle.remove();
          removedHandle.remove();
          NotificationsListener.stopListening();
        };

        setIsListening(true);
        return true;
      } catch (err) {
        console.error("[NotificationListener] Native init failed:", err);
        // Fall through to web mode
      }
    }

    // Web fallback - just enable the sync command on PC agent
    try {
      await sendCommand("start_notification_sync", {}, { awaitResult: true, timeoutMs: 5000 });
    } catch {}
    setIsListening(true);
    setPermissionGranted(true);
    return true;
  }, [isListening, isNative, sendCommand, forwardToPC]);

  // Stop listening
  const stopListening = useCallback(async () => {
    if (listenerRefsCleanup.current) {
      listenerRefsCleanup.current();
      listenerRefsCleanup.current = null;
    }
    if (!isNative) {
      try {
        await sendCommand("stop_notification_sync", {});
      } catch {}
    }
    setIsListening(false);
  }, [isNative, sendCommand]);

  // Dismiss a notification
  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (listenerRefsCleanup.current) {
        listenerRefsCleanup.current();
      }
    };
  }, []);

  return {
    notifications,
    isListening,
    isNative,
    permissionGranted,
    startListening,
    stopListening,
    dismissNotification,
    clearAll,
  };
}
