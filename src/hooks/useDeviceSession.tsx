import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DeviceSession {
  id: string;
  device_id: string;
  session_token: string;
  device_name?: string;
}

interface DeviceInfo {
  id: string;
  name: string;
  is_online: boolean;
  last_seen: string | null;
}

interface DeviceSessionContextType {
  session: DeviceSession | null;
  deviceInfo: DeviceInfo | null;
  isLoading: boolean;
  isReconnecting: boolean;
  error: string | null;
  pairDevice: (pairingCode: string) => Promise<{ success: boolean; error?: string }>;
  unpair: () => void;
  refreshDeviceInfo: () => Promise<void>;
}

const DeviceSessionContext = createContext<DeviceSessionContextType | undefined>(undefined);

const SESSION_KEY = "jarvis_device_session";
const RECONNECT_INTERVAL = 5000; // Check device status every 5 seconds

export function DeviceSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch device info
  const fetchDeviceInfo = useCallback(async (deviceId: string): Promise<DeviceInfo | null> => {
    try {
      const { data, error } = await supabase
        .from("devices")
        .select("id, name, is_online, last_seen")
        .eq("id", deviceId)
        .maybeSingle();

      if (error || !data) return null;
      return data as DeviceInfo;
    } catch {
      return null;
    }
  }, []);

  // Refresh device info
  const refreshDeviceInfo = useCallback(async () => {
    if (!session) return;
    const info = await fetchDeviceInfo(session.device_id);
    if (info) {
      setDeviceInfo(info);
    }
  }, [session, fetchDeviceInfo]);

  // Auto-reconnect: periodically check device status
  useEffect(() => {
    if (!session) {
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      return;
    }

    const checkConnection = async () => {
      const info = await fetchDeviceInfo(session.device_id);
      if (info) {
        setDeviceInfo(info);
        setIsReconnecting(!info.is_online);
      } else {
        // Device was deleted - clear session
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setDeviceInfo(null);
      }
    };

    // Initial check
    checkConnection();

    // Set up periodic checks
    reconnectTimerRef.current = setInterval(checkConnection, RECONNECT_INTERVAL);

    return () => {
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [session, fetchDeviceInfo]);

  // Load session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as DeviceSession;
        // Validate session still exists
        validateSession(parsed.session_token).then((valid) => {
          if (valid) {
            setSession(parsed);
          } else {
            localStorage.removeItem(SESSION_KEY);
          }
          setIsLoading(false);
        });
      } catch {
        localStorage.removeItem(SESSION_KEY);
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, []);

  const validateSession = async (token: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from("device_sessions")
        .select("id, device_id")
        .eq("session_token", token)
        .maybeSingle();

      if (error || !data) return false;

      // Check if device still exists and is valid
      const { data: device } = await supabase
        .from("devices")
        .select("id")
        .eq("id", data.device_id)
        .maybeSingle();

      return !!device;
    } catch {
      return false;
    }
  };

  const pairDevice = useCallback(async (pairingCode: string): Promise<{ success: boolean; error?: string }> => {
    setError(null);
    
    const code = pairingCode.trim().toUpperCase();
    if (!code || code.length < 4) {
      return { success: false, error: "Invalid pairing code" };
    }

    try {
      // Find device with this pairing code
      const { data: device, error: deviceError } = await supabase
        .from("devices")
        .select("id, name, pairing_code, pairing_expires_at")
        .eq("pairing_code", code)
        .maybeSingle();

      if (deviceError || !device) {
        return { success: false, error: "Device not found. Check the code and try again." };
      }

      // Check if code has expired
      if (device.pairing_expires_at && new Date(device.pairing_expires_at) < new Date()) {
        return { success: false, error: "Pairing code has expired. Restart the agent to get a new code." };
      }

      // Create a session for this device
      const sessionToken = crypto.randomUUID();
      const { data: sessionData, error: sessionError } = await supabase
        .from("device_sessions")
        .insert({
          device_id: device.id,
          session_token: sessionToken,
        })
        .select()
        .single();

      if (sessionError || !sessionData) {
        console.error("Session creation error:", sessionError);
        return { success: false, error: "Failed to create session" };
      }

      // Clear the pairing code (one-time use)
      await supabase
        .from("devices")
        .update({ pairing_code: null, pairing_expires_at: null })
        .eq("id", device.id);

      const newSession: DeviceSession = {
        id: sessionData.id,
        device_id: device.id,
        session_token: sessionToken,
        device_name: device.name,
      };

      // Store in localStorage (persists across sessions)
      localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
      setSession(newSession);

      // Fetch initial device info
      const info = await fetchDeviceInfo(device.id);
      if (info) {
        setDeviceInfo(info);
      }

      return { success: true };
    } catch (err) {
      console.error("Pairing error:", err);
      return { success: false, error: "Pairing failed. Please try again." };
    }
  }, [fetchDeviceInfo]);

  const unpair = useCallback(() => {
    if (session) {
      // Delete the session from database
      supabase
        .from("device_sessions")
        .delete()
        .eq("session_token", session.session_token)
        .then(() => {
          console.log("Session deleted from database");
        });
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setDeviceInfo(null);
  }, [session]);

  return (
    <DeviceSessionContext.Provider 
      value={{ 
        session, 
        deviceInfo,
        isLoading, 
        isReconnecting,
        error, 
        pairDevice, 
        unpair,
        refreshDeviceInfo 
      }}
    >
      {children}
    </DeviceSessionContext.Provider>
  );
}

export function useDeviceSession() {
  const context = useContext(DeviceSessionContext);
  if (!context) {
    throw new Error("useDeviceSession must be used within a DeviceSessionProvider");
  }
  return context;
}
