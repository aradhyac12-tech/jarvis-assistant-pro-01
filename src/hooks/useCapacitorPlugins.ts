import { useEffect, useState, useCallback, useRef } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

/**
 * Hook for Capacitor-specific mobile features.
 * These features only work when the app is running as a native mobile app via Capacitor.
 * In the web browser, they gracefully degrade to no-ops.
 */

interface CallState {
  isInCall: boolean;
  callerNumber?: string;
  callerName?: string;
  callType?: "incoming" | "outgoing" | "missed";
}

interface NotificationData {
  id: string;
  title: string;
  body: string;
  app?: string;
  timestamp: Date;
}

interface PermissionStatus {
  camera: "granted" | "denied" | "prompt";
  microphone: "granted" | "denied" | "prompt";
  notifications: "granted" | "denied" | "prompt";
  calendar: "granted" | "denied" | "prompt";
  contacts: "granted" | "denied" | "prompt";
}

export function useCapacitorPlugins() {
  const [isNative, setIsNative] = useState(false);
  const [platform, setPlatform] = useState<"web" | "android" | "ios">("web");
  const [callState, setCallState] = useState<CallState>({ isInCall: false });
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(true);
  const [autoMuteEnabled, setAutoMuteEnabled] = useState(true);
  const [permissions, setPermissions] = useState<PermissionStatus>({
    camera: "prompt",
    microphone: "prompt",
    notifications: "prompt",
    calendar: "prompt",
    contacts: "prompt",
  });
  
  const { sendCommand } = useDeviceCommands();
  
  // Callbacks for when call comes in
  const onCallStartRef = useRef<(() => void) | null>(null);
  const onCallEndRef = useRef<(() => void) | null>(null);

  // Check if running in Capacitor native environment
  useEffect(() => {
    const checkNative = async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        const native = Capacitor.isNativePlatform();
        setIsNative(native);
        setPlatform(native ? (Capacitor.getPlatform() as "android" | "ios") : "web");
      } catch {
        setIsNative(false);
        setPlatform("web");
      }
    };
    checkNative();
  }, []);

  // Request all necessary permissions
  const requestAllPermissions = useCallback(async () => {
    if (!isNative) {
      console.log("[Capacitor] Permissions not available in web mode");
      return permissions;
    }

    const newPermissions: PermissionStatus = { ...permissions };

    try {
      // Camera permission
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      newPermissions.camera = "granted";
    } catch {
      newPermissions.camera = "denied";
    }

    try {
      // Microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      newPermissions.microphone = "granted";
    } catch {
      newPermissions.microphone = "denied";
    }

    try {
      // Push notifications permission
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const result = await PushNotifications.requestPermissions();
      newPermissions.notifications = result.receive === "granted" ? "granted" : "denied";
    } catch {
      newPermissions.notifications = "denied";
    }

    setPermissions(newPermissions);
    return newPermissions;
  }, [isNative, permissions]);

  // Initialize call detection (requires native plugin)
  const initCallDetection = useCallback(async () => {
    if (!isNative) {
      console.log("[Capacitor] Call detection not available in web mode");
      return false;
    }

    try {
      // For Android, we use a custom Capacitor plugin or PhoneStateListener
      // This is a placeholder - actual implementation requires native code
      console.log("[Capacitor] Call detection initialized");
      
      // Simulate call detection using broadcast receiver pattern
      // In real implementation, this would be handled by native plugin
      if (platform === "android") {
        // Android uses TelephonyManager.PhoneStateListener
        // This requires PHONE_STATE permission in AndroidManifest.xml
        console.log("[Capacitor] Android call detection ready");
      } else if (platform === "ios") {
        // iOS uses CXCallObserver from CallKit
        console.log("[Capacitor] iOS call detection ready");
      }
      
      return true;
    } catch (err) {
      console.error("[Capacitor] Failed to init call detection:", err);
      return false;
    }
  }, [isNative, platform]);

  // Initialize push notifications
  const initPushNotifications = useCallback(async () => {
    if (!isNative) {
      console.log("[Capacitor] Push notifications not available in web mode");
      return false;
    }

    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      
      // Request permission
      const permResult = await PushNotifications.requestPermissions();
      if (permResult.receive !== "granted") {
        console.warn("[Capacitor] Push notification permission denied");
        return false;
      }

      // Register for push
      await PushNotifications.register();

      // Listen for notifications
      PushNotifications.addListener("pushNotificationReceived", (notification) => {
        const newNotification: NotificationData = {
          id: notification.id || crypto.randomUUID(),
          title: notification.title || "Notification",
          body: notification.body || "",
          timestamp: new Date(),
        };
        setNotifications((prev) => [newNotification, ...prev].slice(0, 50));
      });

      console.log("[Capacitor] Push notifications initialized");
      return true;
    } catch (err) {
      console.error("[Capacitor] Failed to init push notifications:", err);
      return false;
    }
  }, [isNative]);

  // Handle incoming call - pause PC media
  const handleIncomingCall = useCallback(async (callerInfo: { number?: string; name?: string }) => {
    setCallState({
      isInCall: true,
      callerNumber: callerInfo.number,
      callerName: callerInfo.name,
      callType: "incoming",
    });

    if (autoPauseEnabled) {
      // Pause PC media
      try {
        await sendCommand("media_control", { action: "pause" }, { awaitResult: true, timeoutMs: 3000 });
        console.log("[Capacitor] PC media paused for incoming call");
      } catch (e) {
        console.warn("[Capacitor] Failed to pause PC media:", e);
      }
    }

    if (autoMuteEnabled) {
      // Mute PC
      try {
        await sendCommand("mute", { mute: true }, { awaitResult: true, timeoutMs: 3000 });
        console.log("[Capacitor] PC muted for incoming call");
      } catch (e) {
        console.warn("[Capacitor] Failed to mute PC:", e);
      }
    }

    onCallStartRef.current?.();
  }, [autoPauseEnabled, autoMuteEnabled, sendCommand]);

  // Handle call ended - resume PC media
  const handleCallEnded = useCallback(async () => {
    setCallState({ isInCall: false });

    if (autoMuteEnabled) {
      // Unmute PC
      try {
        await sendCommand("mute", { mute: false }, { awaitResult: true, timeoutMs: 3000 });
        console.log("[Capacitor] PC unmuted after call ended");
      } catch (e) {
        console.warn("[Capacitor] Failed to unmute PC:", e);
      }
    }

    onCallEndRef.current?.();
  }, [autoMuteEnabled, sendCommand]);

  // Register callback for when a call starts (to pause/mute media)
  const onCallStart = useCallback((callback: () => void) => {
    onCallStartRef.current = callback;
  }, []);

  // Register callback for when a call ends
  const onCallEnd = useCallback((callback: () => void) => {
    onCallEndRef.current = callback;
  }, []);

  // Clear notifications
  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Simulate a call for testing (dev only)
  const simulateCall = useCallback((incoming: boolean) => {
    if (incoming) {
      handleIncomingCall({ number: "+1234567890", name: "Test Caller" });
    } else {
      handleCallEnded();
    }
  }, [handleIncomingCall, handleCallEnded]);

  // Open native dialer
  const openDialer = useCallback(async (number?: string) => {
    if (!isNative) {
      if (number) window.open(`tel:${number}`, "_self");
      return;
    }
    
    try {
      // Use window.location for tel: links on mobile
      window.location.href = `tel:${number || ""}`;
    } catch (e) {
      console.error("[Capacitor] Failed to open dialer:", e);
    }
  }, [isNative]);

  // Send SMS
  const sendSMS = useCallback(async (number: string, message: string) => {
    if (!isNative) {
      window.open(`sms:${number}?body=${encodeURIComponent(message)}`, "_self");
      return;
    }

    try {
      window.location.href = `sms:${number}?body=${encodeURIComponent(message)}`;
    } catch (e) {
      console.error("[Capacitor] Failed to open SMS:", e);
    }
  }, [isNative]);

  // Get device info
  const getDeviceInfo = useCallback(async () => {
    try {
      const { Capacitor } = await import("@capacitor/core");
      return {
        platform: Capacitor.getPlatform(),
        model: navigator.userAgent,
        operatingSystem: navigator.platform,
        isNative: Capacitor.isNativePlatform(),
      };
    } catch {
      return {
        platform: "web",
        model: navigator.userAgent,
        operatingSystem: navigator.platform,
        isNative: false,
      };
    }
  }, []);

  return {
    // State
    isNative,
    platform,
    callState,
    notifications,
    permissions,
    autoPauseEnabled,
    autoMuteEnabled,
    
    // Settings
    setAutoPauseEnabled,
    setAutoMuteEnabled,
    
    // Initialize functions
    initCallDetection,
    initPushNotifications,
    requestAllPermissions,
    
    // Callbacks
    onCallStart,
    onCallEnd,
    
    // Actions
    clearNotifications,
    simulateCall,
    openDialer,
    sendSMS,
    getDeviceInfo,
    
    // Call handlers (for native integration)
    handleIncomingCall,
    handleCallEnded,
  };
}
