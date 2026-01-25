import { useEffect, useState, useCallback, useRef } from "react";

/**
 * Hook for Capacitor-specific mobile features.
 * These features only work when the app is running as a native mobile app via Capacitor.
 * In the web browser, they gracefully degrade to no-ops.
 */

interface CallState {
  isInCall: boolean;
  callerNumber?: string;
  callerName?: string;
}

interface NotificationData {
  id: string;
  title: string;
  body: string;
  app?: string;
  timestamp: Date;
}

export function useCapacitorPlugins() {
  const [isNative, setIsNative] = useState(false);
  const [callState, setCallState] = useState<CallState>({ isInCall: false });
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(true);
  const [autoMuteEnabled, setAutoMuteEnabled] = useState(true);
  
  // Callbacks for when call comes in
  const onCallStartRef = useRef<(() => void) | null>(null);
  const onCallEndRef = useRef<(() => void) | null>(null);

  // Check if running in Capacitor native environment
  useEffect(() => {
    const checkNative = async () => {
      try {
        // Check if Capacitor is available
        const { Capacitor } = await import("@capacitor/core");
        setIsNative(Capacitor.isNativePlatform());
      } catch {
        setIsNative(false);
      }
    };
    checkNative();
  }, []);

  // Initialize call detection (requires native plugin)
  const initCallDetection = useCallback(async () => {
    if (!isNative) {
      console.log("[Capacitor] Call detection not available in web mode");
      return false;
    }

    try {
      // Note: This requires a Capacitor plugin like @nickvidal/capacitor-call-interceptor
      // or similar. The plugin needs to be installed and configured in the native project.
      console.log("[Capacitor] Call detection would be initialized here");
      
      // Placeholder for actual plugin integration:
      // const { CallInterceptor } = await import('@nickvidal/capacitor-call-interceptor');
      // await CallInterceptor.addListener('callStateChanged', (state) => {
      //   setCallState({
      //     isInCall: state.callActive,
      //     callerNumber: state.number,
      //     callerName: state.name,
      //   });
      //   if (state.callActive && autoPauseEnabled) {
      //     onCallStartRef.current?.();
      //   } else if (!state.callActive) {
      //     onCallEndRef.current?.();
      //   }
      // });
      
      return true;
    } catch (err) {
      console.error("[Capacitor] Failed to init call detection:", err);
      return false;
    }
  }, [isNative, autoPauseEnabled]);

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
      setCallState({ isInCall: true, callerNumber: "+1234567890", callerName: "Test Caller" });
      if (autoPauseEnabled) {
        onCallStartRef.current?.();
      }
    } else {
      setCallState({ isInCall: false });
      onCallEndRef.current?.();
    }
  }, [autoPauseEnabled]);

  return {
    // State
    isNative,
    callState,
    notifications,
    autoPauseEnabled,
    autoMuteEnabled,
    
    // Settings
    setAutoPauseEnabled,
    setAutoMuteEnabled,
    
    // Initialize functions
    initCallDetection,
    initPushNotifications,
    
    // Callbacks
    onCallStart,
    onCallEnd,
    
    // Actions
    clearNotifications,
    simulateCall, // For testing
  };
}
