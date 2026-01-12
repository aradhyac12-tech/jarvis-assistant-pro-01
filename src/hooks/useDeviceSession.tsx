import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DeviceSession {
  id: string;
  device_id: string;
  session_token: string;
  device_name?: string;
}

interface DeviceSessionContextType {
  session: DeviceSession | null;
  isLoading: boolean;
  error: string | null;
  pairDevice: (pairingCode: string) => Promise<{ success: boolean; error?: string }>;
  unpair: () => void;
}

const DeviceSessionContext = createContext<DeviceSessionContextType | undefined>(undefined);

const SESSION_KEY = "jarvis_device_session";

export function DeviceSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      // Store in localStorage
      localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
      setSession(newSession);

      return { success: true };
    } catch (err) {
      console.error("Pairing error:", err);
      return { success: false, error: "Pairing failed. Please try again." };
    }
  }, []);

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
  }, [session]);

  return (
    <DeviceSessionContext.Provider value={{ session, isLoading, error, pairDevice, unpair }}>
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
