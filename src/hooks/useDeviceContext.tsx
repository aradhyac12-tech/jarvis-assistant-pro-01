import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Device {
  id: string;
  name: string;
  is_online: boolean;
  last_seen: string | null;
  current_volume: number | null;
  current_brightness: number | null;
  system_info: Record<string, unknown> | null;
}

interface DeviceContextType {
  devices: Device[];
  selectedDevice: Device | null;
  selectDevice: (deviceId: string) => void;
  isLoading: boolean;
  refreshDevices: () => Promise<void>;
}

const DeviceContext = createContext<DeviceContextType | undefined>(undefined);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDevices = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("devices")
        .select("id, name, is_online, last_seen, current_volume, current_brightness, system_info")
        .order("is_online", { ascending: false })
        .order("last_seen", { ascending: false });

      if (error) throw error;

      const typedDevices = (data ?? []).map((d) => ({
        ...d,
        system_info: d.system_info as Record<string, unknown> | null,
      }));

      setDevices(typedDevices);

      // Auto-select first online device if none selected
      if (!selectedDeviceId && typedDevices.length > 0) {
        const online = typedDevices.find((d) => d.is_online);
        setSelectedDeviceId(online?.id ?? typedDevices[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch devices:", err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    fetchDevices();

    // Subscribe to realtime updates
    const channel = supabase
      .channel("devices-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices" },
        () => {
          fetchDevices();
        }
      )
      .subscribe();

    // Poll every 5 seconds as backup
    const interval = setInterval(fetchDevices, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [fetchDevices]);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;

  const selectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
  }, []);

  return (
    <DeviceContext.Provider
      value={{
        devices,
        selectedDevice,
        selectDevice,
        isLoading,
        refreshDevices: fetchDevices,
      }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

export function useDeviceContext() {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error("useDeviceContext must be used within a DeviceProvider");
  }
  return context;
}
