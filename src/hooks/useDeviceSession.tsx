import { createContext, useContext, useEffect, useCallback, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DeviceSession {
  id: string;
  device_id: string;
  session_token: string;
  device_name?: string;
  remember?: boolean;
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
  rememberDevice: boolean;
  setRememberDevice: (v: boolean) => void;
  pairDevice: (pairingCode: string) => Promise<{ success: boolean; error?: string }>;
  autoPair: () => Promise<{ success: boolean; error?: string }>;
  unpair: () => void;
  refreshDeviceInfo: () => Promise<void>;
}

const DeviceSessionContext = createContext<DeviceSessionContextType | undefined>(undefined);

const SESSION_KEY = "jarvis_device_session";
const REMEMBER_KEY = "jarvis_remember_device";
const RECONNECT_INTERVAL = 5000; // Check device status every 5 seconds
const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days for remembered devices
const SESSION_SOFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days refresh threshold

export function DeviceSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberDevice, setRememberDeviceState] = useState(() => {
    return localStorage.getItem(REMEMBER_KEY) === "true";
  });
  const reconnectTimerRef = useRef<number | null>(null);
  
  const setRememberDevice = useCallback((v: boolean) => {
    setRememberDeviceState(v);
    localStorage.setItem(REMEMBER_KEY, v ? "true" : "false");
  }, []);

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

  const refreshDeviceInfo = useCallback(async () => {
    if (!session) return;
    const info = await fetchDeviceInfo(session.device_id);
    if (info) setDeviceInfo(info);
  }, [session, fetchDeviceInfo]);

  const validateSession = useCallback(async (token: string, shouldRefresh = false): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from("device_sessions")
        .select("id, device_id, last_active")
        .eq("session_token", token)
        .maybeSingle();

      if (error || !data) return false;

      const lastActive = new Date(data.last_active).getTime();
      const now = Date.now();
      
      // Check expiry - use longer TTL for remembered devices
      const maxAge = rememberDevice ? SESSION_MAX_AGE_MS : 7 * 24 * 60 * 60 * 1000;
      if (Number.isFinite(lastActive) && now - lastActive > maxAge) {
        return false;
      }

      // Ensure device still exists
      const { data: device } = await supabase
        .from("devices")
        .select("id")
        .eq("id", data.device_id)
        .maybeSingle();

      if (!device) return false;
      
      // Refresh session activity if within soft TTL (prevents expiration while active)
      if (shouldRefresh && now - lastActive > SESSION_SOFT_TTL_MS / 7) {
        await supabase
          .from("device_sessions")
          .update({ last_active: new Date().toISOString() })
          .eq("session_token", token);
      }

      return true;
    } catch {
      return false;
    }
  }, [rememberDevice]);

  const persistSession = useCallback((s: DeviceSession) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const autoPair = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setError(null);

    try {
      const { data: device, error: deviceError } = await supabase
        .from("devices")
        .select("id, name, is_online, last_seen")
        .order("last_seen", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (deviceError) {
        return { success: false, error: deviceError.message };
      }

      if (!device) {
        return { success: false, error: "No PC found. Start the PC agent first." };
      }

      // Create a fresh session
      const sessionToken = crypto.randomUUID();
      const { data: sessionData, error: sessionError } = await supabase
        .from("device_sessions")
        .insert({ device_id: device.id, session_token: sessionToken })
        .select("id")
        .single();

      if (sessionError || !sessionData) {
        return { success: false, error: sessionError?.message || "Failed to create session" };
      }

      const newSession: DeviceSession = {
        id: sessionData.id,
        device_id: device.id,
        session_token: sessionToken,
        device_name: device.name,
      };

      persistSession(newSession);

      const info = await fetchDeviceInfo(device.id);
      if (info) setDeviceInfo(info);

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Auto-connect failed" };
    }
  }, [fetchDeviceInfo, persistSession]);

  const pairDevice = useCallback(async (pairingCode: string): Promise<{ success: boolean; error?: string }> => {
    setError(null);

    const code = pairingCode.trim().toUpperCase();
    if (!code || code.length < 2) {
      return { success: false, error: "Invalid pairing code" };
    }

    try {
      // Strategy 1: Try exact pairing_code match
      let device: { id: string; name: string; pairing_code: string | null; pairing_expires_at: string | null; device_key: string } | null = null;
      
      const { data: codeMatch } = await supabase
        .from("devices")
        .select("id, name, pairing_code, pairing_expires_at, device_key")
        .eq("pairing_code", code)
        .maybeSingle();
      
      if (codeMatch) {
        // Check if code is expired
        if (codeMatch.pairing_expires_at && new Date(codeMatch.pairing_expires_at) < new Date()) {
          // Code expired but device exists - still allow connection
          console.log("Pairing code expired, but connecting to device anyway");
        }
        device = codeMatch;
      }

      // Strategy 2: Try device_key match (for persistent pairing)
      if (!device) {
        const { data: keyMatch } = await supabase
          .from("devices")
          .select("id, name, pairing_code, pairing_expires_at, device_key")
          .eq("device_key", code.toLowerCase())
          .maybeSingle();
        
        if (keyMatch) {
          device = keyMatch;
        }
      }

      // Strategy 3: Fallback to most recent online device if code looks like a partial match
      if (!device && code.length >= 4) {
        const { data: recentDevices } = await supabase
          .from("devices")
          .select("id, name, pairing_code, pairing_expires_at, device_key")
          .order("last_seen", { ascending: false })
          .limit(5);
        
        if (recentDevices && recentDevices.length > 0) {
          // Check if any device's pairing_code contains the entered code or vice versa
          device = recentDevices.find(d => 
            d.pairing_code?.includes(code) || 
            code.includes(d.pairing_code || '') ||
            d.device_key?.toUpperCase().startsWith(code)
          ) || null;
          
          // Last resort: just use the most recent device if only one exists
          if (!device && recentDevices.length === 1) {
            console.log("Single device found, auto-connecting");
            device = recentDevices[0];
          }
        }
      }

      if (!device) {
        return { success: false, error: "Device not found. Ensure PC agent is running and try the code shown on screen." };
      }

      const sessionToken = crypto.randomUUID();
      const { data: sessionData, error: sessionError } = await supabase
        .from("device_sessions")
        .insert({ device_id: device.id, session_token: sessionToken })
        .select("id")
        .single();

      if (sessionError || !sessionData) {
        console.error("Session creation error:", sessionError);
        return { success: false, error: "Failed to create session" };
      }

      // Clear pairing code after successful pair
      await supabase
        .from("devices")
        .update({ pairing_code: null, pairing_expires_at: null })
        .eq("id", device.id);

      const newSession: DeviceSession = {
        id: sessionData.id,
        device_id: device.id,
        session_token: sessionToken,
        device_name: device.name,
        remember: rememberDevice,
      };

      persistSession(newSession);

      const info = await fetchDeviceInfo(device.id);
      if (info) setDeviceInfo(info);

      return { success: true };
    } catch (err) {
      console.error("Pairing error:", err);
      return { success: false, error: "Pairing failed. Please try again." };
    }
  }, [fetchDeviceInfo, persistSession, rememberDevice]);

  const unpair = useCallback(() => {
    if (session) {
      supabase
        .from("device_sessions")
        .delete()
        .eq("session_token", session.session_token)
        .then(() => {
          // no-op
        });
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setDeviceInfo(null);
  }, [session]);

  // Load session from localStorage on mount - NO auto-connect, user must pair manually
  useEffect(() => {
    const run = async () => {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as DeviceSession;
          const valid = await validateSession(parsed.session_token);
          if (valid) {
            setSession(parsed);
            const info = await fetchDeviceInfo(parsed.device_id);
            if (info) setDeviceInfo(info);
          } else {
            localStorage.removeItem(SESSION_KEY);
          }
        } catch {
          localStorage.removeItem(SESSION_KEY);
        }
      }

      setIsLoading(false);
    };

    run();
  }, [validateSession, fetchDeviceInfo]);

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
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setDeviceInfo(null);
      }
    };

    checkConnection();
    reconnectTimerRef.current = window.setInterval(checkConnection, RECONNECT_INTERVAL);

    return () => {
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [session, fetchDeviceInfo]);

  return (
    <DeviceSessionContext.Provider
      value={{
        session,
        deviceInfo,
        isLoading,
        isReconnecting,
        error,
        rememberDevice,
        setRememberDevice,
        pairDevice,
        autoPair,
        unpair,
        refreshDeviceInfo,
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
