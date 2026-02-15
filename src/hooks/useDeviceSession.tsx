import { createContext, useContext, useEffect, useCallback, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DeviceSession {
  id: string;
  device_id: string;
  session_token: string;
  device_name?: string;
  remember_device?: boolean;
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
  pairDevice: (pairingCode: string, rememberDevice?: boolean) => Promise<{ success: boolean; error?: string }>;
  autoPair: () => Promise<{ success: boolean; error?: string }>;
  unpair: () => void;
  refreshDeviceInfo: () => Promise<void>;
}

const DeviceSessionContext = createContext<DeviceSessionContextType | undefined>(undefined);

const SESSION_KEY = "jarvis_device_session";
const SESSION_KEY_TEMP = "jarvis_device_session_temp"; // sessionStorage key
const RECONNECT_INTERVAL = 5000;
// LIFETIME PAIRING: Extended to 365 days for remembered devices
const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 365 days (lifetime)
const SESSION_SHORT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for temp sessions

// Helper to get storage based on remember preference
const getStorage = (remember: boolean) => remember ? localStorage : sessionStorage;

export function DeviceSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

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

  // Resilient session validation - pings backend and extends TTL if valid
  const validateSession = useCallback(async (token: string): Promise<{ valid: boolean; remember?: boolean }> => {
    try {
      const { data, error } = await supabase
        .from("device_sessions")
        .select("id, device_id, expires_at, remember_device")
        .eq("session_token", token)
        .maybeSingle();

      if (error || !data) return { valid: false };

      // Check if session expired
      const expiresAt = new Date(data.expires_at).getTime();
      if (Date.now() > expiresAt) {
        // Session expired - clean up
        await supabase.from("device_sessions").delete().eq("session_token", token);
        return { valid: false };
      }

      // Ensure device still exists
      const { data: device } = await supabase
        .from("devices")
        .select("id")
        .eq("id", data.device_id)
        .maybeSingle();

      if (!device) return { valid: false };

      // Extend session TTL on validation (keep-alive)
      const newExpiry = data.remember_device 
        ? new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString()
        : new Date(Date.now() + SESSION_SHORT_TTL_MS).toISOString();
      
      await supabase
        .from("device_sessions")
        .update({ last_active: new Date().toISOString(), expires_at: newExpiry })
        .eq("session_token", token);

      return { valid: true, remember: data.remember_device };
    } catch {
      return { valid: false };
    }
  }, []);

  const persistSession = useCallback((s: DeviceSession, remember: boolean = true) => {
    const storage = getStorage(remember);
    const otherStorage = getStorage(!remember);
    
    // Clear from the other storage
    otherStorage.removeItem(remember ? SESSION_KEY_TEMP : SESSION_KEY);
    
    // Save to appropriate storage
    storage.setItem(remember ? SESSION_KEY : SESSION_KEY_TEMP, JSON.stringify(s));
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

      // Create a persistent session (remember_device=true, 365 days TTL) so user never needs access code again
      const sessionToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
      
      const { data: sessionData, error: sessionError } = await supabase
        .from("device_sessions")
        .insert({ 
          device_id: device.id, 
          session_token: sessionToken,
          remember_device: true,
          expires_at: expiresAt
        })
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
        remember_device: true,
      };

      // Persist to localStorage so it survives browser restarts
      persistSession(newSession, true);

      const info = await fetchDeviceInfo(device.id);
      if (info) setDeviceInfo(info);

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Auto-connect failed" };
    }
  }, [fetchDeviceInfo, persistSession]);

  const pairDevice = useCallback(async (pairingCode: string, rememberDevice: boolean = true): Promise<{ success: boolean; error?: string }> => {
    setError(null);

    const code = pairingCode.trim().toUpperCase();
    if (!code || code.length < 4) {
      return { success: false, error: "Invalid pairing code" };
    }

    try {
      const { data: device, error: deviceError } = await supabase
        .from("devices")
        .select("id, name, pairing_code, pairing_expires_at")
        .eq("pairing_code", code)
        .maybeSingle();

      if (deviceError || !device) {
        return { success: false, error: "Device not found. Check the code and try again." };
      }

      if (device.pairing_expires_at && new Date(device.pairing_expires_at) < new Date()) {
        return { success: false, error: "Pairing code has expired. Restart the agent to get a new code." };
      }

      // Calculate expiry based on remember preference
      const expiresAt = rememberDevice
        ? new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString()
        : new Date(Date.now() + SESSION_SHORT_TTL_MS).toISOString();

      const sessionToken = crypto.randomUUID();
      const { data: sessionData, error: sessionError } = await supabase
        .from("device_sessions")
        .insert({ 
          device_id: device.id, 
          session_token: sessionToken,
          remember_device: rememberDevice,
          expires_at: expiresAt
        })
        .select("id")
        .single();

      if (sessionError || !sessionData) {
        console.error("Session creation error:", sessionError);
        return { success: false, error: "Failed to create session" };
      }

      // Clear pairing code after successful pairing
      await supabase
        .from("devices")
        .update({ pairing_code: null, pairing_expires_at: null })
        .eq("id", device.id);

      const newSession: DeviceSession = {
        id: sessionData.id,
        device_id: device.id,
        session_token: sessionToken,
        device_name: device.name,
        remember_device: rememberDevice,
      };

      persistSession(newSession, rememberDevice);

      const info = await fetchDeviceInfo(device.id);
      if (info) setDeviceInfo(info);

      return { success: true };
    } catch (err) {
      console.error("Pairing error:", err);
      return { success: false, error: "Pairing failed. Please try again." };
    }
  }, [fetchDeviceInfo, persistSession]);

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
    // Clear from both storages
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY_TEMP);
    setSession(null);
    setDeviceInfo(null);
  }, [session]);

  // Load session from storage on mount (check both localStorage and sessionStorage)
  useEffect(() => {
    const run = async () => {
      // Try localStorage first (remembered sessions), then sessionStorage (temporary)
      let stored = localStorage.getItem(SESSION_KEY);
      let isRemembered = true;
      
      if (!stored) {
        stored = sessionStorage.getItem(SESSION_KEY_TEMP);
        isRemembered = false;
      }
      
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as DeviceSession;
          const result = await validateSession(parsed.session_token);
          
          if (result.valid) {
            // Update remember preference from backend if different
            const updatedSession = { ...parsed, remember_device: result.remember };
            setSession(updatedSession);
            
            // Re-persist to correct storage if remember preference changed
            if (result.remember !== isRemembered) {
              persistSession(updatedSession, result.remember ?? false);
            }
            
            const info = await fetchDeviceInfo(parsed.device_id);
            if (info) setDeviceInfo(info);
          } else {
            // Session invalid - clear both storages
            localStorage.removeItem(SESSION_KEY);
            sessionStorage.removeItem(SESSION_KEY_TEMP);
          }
        } catch {
          localStorage.removeItem(SESSION_KEY);
          sessionStorage.removeItem(SESSION_KEY_TEMP);
        }
      }

      setIsLoading(false);
    };

    run();
  }, [validateSession, fetchDeviceInfo, persistSession]);

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
