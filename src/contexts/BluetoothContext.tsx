import React, { createContext, useContext } from "react";
import { useBluetooth } from "@/hooks/useBluetooth";

type BluetoothContextType = ReturnType<typeof useBluetooth>;

const BluetoothContext = createContext<BluetoothContextType | null>(null);

export function BluetoothProvider({ children }: { children: React.ReactNode }) {
  const bluetooth = useBluetooth();
  return (
    <BluetoothContext.Provider value={bluetooth}>
      {children}
    </BluetoothContext.Provider>
  );
}

export function useSharedBluetooth(): BluetoothContextType {
  const ctx = useContext(BluetoothContext);
  if (!ctx) {
    throw new Error("useSharedBluetooth must be used within BluetoothProvider");
  }
  return ctx;
}
