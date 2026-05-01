import { useEffect, useState, useCallback, useRef } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

/**
 * Hook for Capacitor-specific mobile features.
 * Uses capacitor-plugin-incoming-call for real Android call detection
 * (KDE Connect-style TelephonyManager / PhoneStateListener approach).
 * In web browser, falls back to manual test triggers.
 */

type PhoneStateType = "RINGING" | "OUTGOING" | "IDLE" | "ON_CALL" | "ON_HOLD";

interface CallState {
  isInCall: boolean;
  callerNumber?: string;
  callerName?: string;
  callType?: "incoming" | "outgoing" | "missed";
  phoneState?: PhoneStateType;
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
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(() => localStorage.getItem("auto_pause_call") !== "false");
  const [autoMuteEnabled, setAutoMuteEnabled] = useState(() => localStorage.getItem("auto_mute_call") !== "false");
  const [callDetectionActive, setCallDetectionActive] = useState(false);
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
  const listenerRef = useRef<any>(null);

  // Persist settings
  useEffect(() => localStorage.setItem("auto_pause_call", String(autoPauseEnabled)), [autoPauseEnabled]);
  useEffect(() => localStorage.setItem("auto_mute_call", String(autoMuteEnabled)), [autoMuteEnabled]);

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

    // getUserMedia requires a secure context (https: or capacitor://localhost)
    const isSecureContext = window.isSecureContext ||
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost";

    if (!isSecureContext) {
      console.warn("[Capacitor] getUserMedia requires secure context — skipping camera/mic check");
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        newPermissions.camera = "granted";
      } catch {
        newPermissions.camera = "denied";
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        newPermissions.microphone = "granted";
      } catch {
        newPermissions.microphone = "denied";
      }
    }

    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const result = await PushNotifications.requestPermissions();
      newPermissions.notifications = result.receive === "granted" ? "granted" : "denied";
    } catch {
      newPermissions.notifications = "denied";
    }

    setPermissions(newPermissions);
    return newPermissions;
  }, [isNative, permissions]);

  // Handle call state change from native plugin
  const handleNativeCallStateChange = useCallback(async (state: { callActive: boolean; callState: PhoneStateType }) => {
    console.log("[CallDetection] State change:", state);

    const wasInCall = callState.isInCall;
    const isNowInCall = state.callActive || state.callState === "RINGING" || state.callState === "ON_CALL" || state.callState === "OUTGOING";

    if (isNowInCall && !wasInCall) {
      // Call started
      const callType = state.callState === "RINGING" ? "incoming" : state.callState === "OUTGOING" ? "outgoing" : "incoming";
      
      setCallState({
        isInCall: true,
        callType,
        phoneState: state.callState,
      });

      console.log(`[CallDetection] Call started (${callType}), auto-mute: ${autoMuteEnabled}, auto-pause: ${autoPauseEnabled}`);

      if (autoPauseEnabled) {
        try {
          await sendCommand("media_control", { action: "pause" }, { awaitResult: false });
          console.log("[CallDetection] PC media paused");
        } catch (e) {
          console.warn("[CallDetection] Failed to pause PC media:", e);
        }
      }

      if (autoMuteEnabled) {
        try {
          await sendCommand("mute_pc", {}, { awaitResult: false });
          console.log("[CallDetection] PC muted");
        } catch (e) {
          console.warn("[CallDetection] Failed to mute PC:", e);
        }
      }

      onCallStartRef.current?.();
    } else if (!isNowInCall && wasInCall) {
      // Call ended
      setCallState({ isInCall: false, phoneState: "IDLE" });

      console.log("[CallDetection] Call ended");

      if (autoMuteEnabled) {
        try {
          await sendCommand("unmute_pc", {}, { awaitResult: false });
          console.log("[CallDetection] PC unmuted");
        } catch (e) {
          console.warn("[CallDetection] Failed to unmute PC:", e);
        }
      }

      onCallEndRef.current?.();
    } else {
      // Update state (e.g., RINGING -> ON_CALL)
      setCallState(prev => ({
        ...prev,
        phoneState: state.callState,
      }));
    }
  }, [callState.isInCall, autoMuteEnabled, autoPauseEnabled, sendCommand]);

  // Initialize call detection using native Android plugin (KDE Connect approach)
  const initCallDetection = useCallback(async () => {
    if (callDetectionActive) {
      console.log("[CallDetection] Already active");
      return true;
    }

    // Try native Capacitor plugin first
    if (isNative && platform === "android") {
      try {
        const { CallDetector } = await import("capacitor-plugin-incoming-call");

        // Activate the native TelephonyManager listener
        await CallDetector.detectCallState({ action: "ACTIVATE" });
        console.log("[CallDetection] Native Android TelephonyManager activated");

        // Listen for call state changes
        const listener = await CallDetector.addListener("callStateChange", (res: { callActive: boolean; callState: PhoneStateType }) => {
          handleNativeCallStateChange(res);
        });

        listenerRef.current = listener;
        setCallDetectionActive(true);
        return true;
      } catch (err) {
        console.error("[CallDetection] Native plugin failed:", err);
      }
    }

    // Web fallback: use visibilitychange + audio context heuristic
    if (!isNative) {
      console.log("[CallDetection] Web mode - using visibility-based detection");
      
      // On mobile web, when a call comes in the page loses visibility
      const handleVisibility = () => {
        if (document.hidden) {
          // Page hidden - could be a call on mobile
          console.log("[CallDetection] Page hidden (possible call)");
        }
      };
      document.addEventListener("visibilitychange", handleVisibility);
      setCallDetectionActive(true);
      return true;
    }

    return false;
  }, [isNative, platform, callDetectionActive, handleNativeCallStateChange]);

  // Stop call detection
  const stopCallDetection = useCallback(async () => {
    if (listenerRef.current) {
      try {
        await listenerRef.current.remove();
        listenerRef.current = null;
      } catch {}
    }

    if (isNative && platform === "android") {
      try {
        const { CallDetector } = await import("capacitor-plugin-incoming-call");
        await CallDetector.detectCallState({ action: "DEACTIVATE" });
      } catch {}
    }

    setCallDetectionActive(false);
    console.log("[CallDetection] Stopped");
  }, [isNative, platform]);

  // Auto-init call detection on native Android
  useEffect(() => {
    if (isNative && platform === "android" && !callDetectionActive) {
      initCallDetection().catch(err =>
        console.warn("[Capacitor] Auto-init call detection failed:", err)
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, platform]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        try { listenerRef.current.remove(); } catch {}
      }
    };
  }, []);

  // Initialize push notifications
  const initPushNotifications = useCallback(async () => {
    if (!isNative) {
      console.log("[Capacitor] Push notifications not available in web mode");
      return false;
    }

    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      const permResult = await PushNotifications.requestPermissions();
      if (permResult.receive !== "granted") {
        console.warn("[Capacitor] Push notification permission denied");
        return false;
      }

      await PushNotifications.register();

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

  // Handle incoming call - for manual/external triggers
  const handleIncomingCall = useCallback(async (callerInfo: { number?: string; name?: string }) => {
    setCallState({
      isInCall: true,
      callerNumber: callerInfo.number,
      callerName: callerInfo.name,
      callType: "incoming",
      phoneState: "RINGING",
    });

    if (autoPauseEnabled) {
      try {
        await sendCommand("media_control", { action: "pause" }, { awaitResult: false });
      } catch (e) {
        console.warn("[Capacitor] Failed to pause PC media:", e);
      }
    }

    if (autoMuteEnabled) {
      try {
        await sendCommand("mute_pc", {}, { awaitResult: false });
      } catch (e) {
        console.warn("[Capacitor] Failed to mute PC:", e);
      }
    }

    onCallStartRef.current?.();
  }, [autoPauseEnabled, autoMuteEnabled, sendCommand]);

  // Handle call ended
  const handleCallEnded = useCallback(async () => {
    setCallState({ isInCall: false, phoneState: "IDLE" });

    if (autoMuteEnabled) {
      try {
        await sendCommand("unmute_pc", {}, { awaitResult: false });
      } catch (e) {
        console.warn("[Capacitor] Failed to unmute PC:", e);
      }
    }

    onCallEndRef.current?.();
  }, [autoMuteEnabled, sendCommand]);

  // Register callbacks
  const onCallStart = useCallback((callback: () => void) => {
    onCallStartRef.current = callback;
  }, []);

  const onCallEnd = useCallback((callback: () => void) => {
    onCallEndRef.current = callback;
  }, []);

  // Clear notifications
  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Simulate a call for testing
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
    callDetectionActive,

    // Settings
    setAutoPauseEnabled,
    setAutoMuteEnabled,

    // Initialize functions
    initCallDetection,
    stopCallDetection,
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
