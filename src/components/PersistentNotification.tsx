/**
 * Persistent Android notification with quick action buttons.
 * Shows an always-on notification like KDE Connect with:
 * - Send Clipboard
 * - Send Files
 * Works in background via Capacitor Local Notifications.
 */

import { useEffect, useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";

const PERSISTENT_ID = 99999;
const isNative = Capacitor.isNativePlatform();

export function PersistentNotification() {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const isConnected = selectedDevice?.is_online || false;
  const shownRef = useRef(false);

  const showPersistentNotification = useCallback(async () => {
    if (!isNative || shownRef.current) return;
    try {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== "granted") return;

      await LocalNotifications.schedule({
        notifications: [
          {
            id: PERSISTENT_ID,
            title: "JARVIS Remote",
            body: isConnected
              ? `Connected to ${selectedDevice?.name || "PC"}`
              : "Waiting for PC connection...",
            ongoing: true,
            autoCancel: false,
            smallIcon: "ic_notification",
            largeIcon: "ic_launcher",
            actionTypeId: "JARVIS_ACTIONS",
            extra: { persistent: true },
          },
        ],
      });

      shownRef.current = true;
    } catch (e) {
      console.debug("[PersistentNotif] Error:", e);
    }
  }, [isConnected, selectedDevice?.name]);

  // Register action types and listener
  useEffect(() => {
    if (!isNative) return;

    const setup = async () => {
      try {
        await LocalNotifications.registerActionTypes({
          types: [
            {
              id: "JARVIS_ACTIONS",
              actions: [
                {
                  id: "send_clipboard",
                  title: "📋 Send Clipboard",
                },
                {
                  id: "send_files",
                  title: "📁 Send Files",
                },
              ],
            },
          ],
        });
      } catch (e) {
        console.debug("[PersistentNotif] Action types error:", e);
      }

      // Listen for action button clicks
      await LocalNotifications.addListener(
        "localNotificationActionPerformed",
        async (action) => {
          const actionId = action.actionId;
          if (actionId === "send_clipboard") {
            try {
              const text = await navigator.clipboard?.readText();
              if (text?.trim()) {
                await sendCommand("set_clipboard", { content: text });
              }
            } catch {
              /* permission denied */
            }
          } else if (actionId === "send_files") {
            // Open the app to file transfer tab
            window.location.hash = "#/hub";
          }
        }
      );
    };

    setup();
  }, [sendCommand]);

  // Show/update the persistent notification
  useEffect(() => {
    if (!isNative) return;
    
    // Re-show when connection state changes
    shownRef.current = false;
    showPersistentNotification();
  }, [isConnected, showPersistentNotification]);

  // Cancel on unmount (app destroy)
  useEffect(() => {
    return () => {
      if (isNative && shownRef.current) {
        LocalNotifications.cancel({ notifications: [{ id: PERSISTENT_ID }] }).catch(() => {});
      }
    };
  }, []);

  return null; // headless
}
