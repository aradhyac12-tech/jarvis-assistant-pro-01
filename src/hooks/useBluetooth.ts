import { useCallback, useRef, useState, useEffect } from "react";

// JARVIS-PC BLE GATT service/characteristic UUIDs (must match Python agent exactly)
const JARVIS_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const COMMAND_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1";    // Phone writes commands
const RESPONSE_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef2";   // PC notifies responses
const CLIPBOARD_WRITE_UUID = "12345678-1234-5678-1234-56789abcdef3"; // Phone writes clipboard
const CLIPBOARD_READ_UUID = "12345678-1234-5678-1234-56789abcdef4";  // PC notifies clipboard

export interface BluetoothState {
  isAvailable: boolean;
  isConnected: boolean;
  isScanning: boolean;
  deviceName: string | null;
  lastError: string | null;
  latency: number;
}

type PendingBleRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: number;
};

/**
 * Web Bluetooth BLE client that auto-discovers JARVIS-PC when WiFi is unavailable.
 * Routes commands and clipboard sync through BLE GATT characteristics.
 * 
 * Auto-requests Bluetooth permission via Web Bluetooth API (no system settings needed).
 * For Capacitor APK, uses android.permission.BLUETOOTH_CONNECT + NEARBY_DEVICES.
 * 
 * Bandwidth limit: ~20KB/s — streaming features disabled in BLE mode.
 */
export function useBluetooth() {
  const [state, setState] = useState<BluetoothState>({
    isAvailable: typeof navigator !== "undefined" && !!navigator.bluetooth,
    isConnected: false,
    isScanning: false,
    deviceName: null,
    lastError: null,
    latency: 0,
  });

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null);
  const commandCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const clipboardWriteCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const clipboardReadCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const responseCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const pendingRef = useRef<Map<string, PendingBleRequest>>(new Map());
  const reconnectTimerRef = useRef<number | null>(null);
  const clipboardCallbackRef = useRef<((text: string) => void) | null>(null);

  const isBluetoothSupported = typeof navigator !== "undefined" && !!navigator.bluetooth;

  // Request Capacitor BLE permissions (Android 12+ needs BLUETOOTH_CONNECT + NEARBY_DEVICES)
  const requestCapacitorPermissions = useCallback(async (): Promise<boolean> => {
    try {
      // Check if running in Capacitor
      const isCapacitor = typeof (window as any).Capacitor !== "undefined";
      if (!isCapacitor) return true; // Web — permissions handled by requestDevice()

      // Try Capacitor permissions API
      const { Permissions } = await import("@capacitor/core").then(m => (m as any));
      if (!Permissions) return true;

      // Android 12+ requires BLUETOOTH_CONNECT and BLUETOOTH_SCAN
      const permissionsToRequest = [
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.ACCESS_FINE_LOCATION",
      ];

      for (const perm of permissionsToRequest) {
        try {
          await (Permissions as any).request({ name: perm });
        } catch {
          // Some permissions may not exist on older Android
        }
      }
      return true;
    } catch {
      // Not in Capacitor or permissions API not available
      return true;
    }
  }, []);

  // Encode string to BLE-safe chunks (max 500 bytes per write)
  const encodeChunked = useCallback((data: string): ArrayBuffer[] => {
    const encoded = new TextEncoder().encode(data);
    const CHUNK_SIZE = 500;
    const chunks: ArrayBuffer[] = [];
    for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
      const slice = encoded.slice(i, i + CHUNK_SIZE);
      chunks.push(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength));
    }
    return chunks;
  }, []);

  // Handle response notifications from RESPONSE characteristic
  const handleResponseNotification = useCallback((event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    if (!characteristic.value) return;
    try {
      const decoder = new TextDecoder();
      const text = decoder.decode(characteristic.value);
      const data = JSON.parse(text);

      if (data.requestId && pendingRef.current.has(data.requestId)) {
        const pending = pendingRef.current.get(data.requestId)!;
        clearTimeout(pending.timeoutId);
        pendingRef.current.delete(data.requestId);
        if (data.error) {
          pending.reject(new Error(data.error));
        } else {
          pending.resolve(data.result);
        }
      }

      if (data.type === "pong" && data.t) {
        setState(prev => ({ ...prev, latency: Date.now() - data.t }));
      }
    } catch {
      // Non-JSON response, ignore
    }
  }, []);

  // Handle clipboard notifications from CLIPBOARD_READ characteristic
  const handleClipboardNotification = useCallback((event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    if (!characteristic.value) return;
    try {
      const text = new TextDecoder().decode(characteristic.value);
      if (clipboardCallbackRef.current) {
        clipboardCallbackRef.current(text);
      }
    } catch {}
  }, []);

  // Handle device disconnect
  const handleDisconnect = useCallback(() => {
    console.log("[BLE] Device disconnected");
    commandCharRef.current = null;
    clipboardWriteCharRef.current = null;
    clipboardReadCharRef.current = null;
    responseCharRef.current = null;
    serverRef.current = null;
    setState(prev => ({ ...prev, isConnected: false }));

    // Auto-reconnect after 5s
    if (deviceRef.current && !reconnectTimerRef.current) {
      reconnectTimerRef.current = window.setTimeout(async () => {
        reconnectTimerRef.current = null;
        if (deviceRef.current?.gatt) {
          console.log("[BLE] Attempting auto-reconnect...");
          try {
            const server = await deviceRef.current.gatt.connect();
            await setupCharacteristics(server);
          } catch (err) {
            console.log("[BLE] Auto-reconnect failed:", err);
          }
        }
      }, 5000);
    }
  }, []);

  // Setup GATT characteristics after connection
  const setupCharacteristics = useCallback(async (server: BluetoothRemoteGATTServer) => {
    serverRef.current = server;

    const service = await server.getPrimaryService(JARVIS_SERVICE_UUID);

    // Command write characteristic (phone -> PC)
    const commandChar = await service.getCharacteristic(COMMAND_CHAR_UUID);
    commandCharRef.current = commandChar;

    // Response notify characteristic (PC -> phone)
    try {
      const responseChar = await service.getCharacteristic(RESPONSE_CHAR_UUID);
      responseCharRef.current = responseChar;
      await responseChar.startNotifications();
      responseChar.addEventListener("characteristicvaluechanged", handleResponseNotification);
    } catch {
      console.log("[BLE] Response characteristic not available");
    }

    // Clipboard write characteristic (phone -> PC)
    try {
      const clipWriteChar = await service.getCharacteristic(CLIPBOARD_WRITE_UUID);
      clipboardWriteCharRef.current = clipWriteChar;
    } catch {
      console.log("[BLE] Clipboard write characteristic not available");
    }

    // Clipboard read/notify characteristic (PC -> phone)
    try {
      const clipReadChar = await service.getCharacteristic(CLIPBOARD_READ_UUID);
      clipboardReadCharRef.current = clipReadChar;
      await clipReadChar.startNotifications();
      clipReadChar.addEventListener("characteristicvaluechanged", handleClipboardNotification);
    } catch {
      console.log("[BLE] Clipboard read characteristic not available");
    }

    setState(prev => ({
      ...prev,
      isConnected: true,
      isScanning: false,
      deviceName: deviceRef.current?.name || "JARVIS-PC",
      lastError: null,
    }));

    console.log("[BLE] ✅ All characteristics connected!");
  }, [handleClipboardNotification, handleResponseNotification]);

  // Scan and connect to JARVIS-PC
  const connect = useCallback(async () => {
    if (!isBluetoothSupported) {
      setState(prev => ({ ...prev, lastError: "Web Bluetooth not supported" }));
      return false;
    }

    try {
      // Request Capacitor permissions first (Android BT + Nearby Devices)
      await requestCapacitorPermissions();

      setState(prev => ({ ...prev, isScanning: true, lastError: null }));
      console.log("[BLE] Requesting JARVIS-PC device...");

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "JARVIS" }],
        optionalServices: [JARVIS_SERVICE_UUID],
      });

      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", handleDisconnect);

      console.log("[BLE] Connecting to GATT server...");
      const server = await device.gatt!.connect();
      await setupCharacteristics(server);

      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      console.error("[BLE] Connection error:", msg);
      setState(prev => ({ ...prev, lastError: msg, isConnected: false, isScanning: false }));
      return false;
    }
  }, [isBluetoothSupported, handleDisconnect, setupCharacteristics, requestCapacitorPermissions]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
    deviceRef.current = null;
    commandCharRef.current = null;
    clipboardWriteCharRef.current = null;
    clipboardReadCharRef.current = null;
    responseCharRef.current = null;
    serverRef.current = null;
    setState(prev => ({ ...prev, isConnected: false, deviceName: null }));
  }, []);

  // Send command (fire-and-forget)
  const sendCommand = useCallback((commandType: string, payload: Record<string, unknown> = {}): boolean => {
    if (!commandCharRef.current) return false;
    try {
      const data = JSON.stringify({ type: "command", commandType, payload });
      const chunks = encodeChunked(data);
      let chain = Promise.resolve();
      for (const chunk of chunks) {
        chain = chain.then(() => commandCharRef.current?.writeValueWithoutResponse(chunk) || Promise.resolve());
      }
      return true;
    } catch {
      return false;
    }
  }, [encodeChunked]);

  // Send command with response
  const invokeCommand = useCallback(async (
    commandType: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 15000
  ): Promise<any> => {
    if (!commandCharRef.current) throw new Error("BLE not connected");

    const requestId = crypto.randomUUID();
    const data = JSON.stringify({ type: "command", requestId, commandType, payload });
    const chunks = encodeChunked(data);

    const promise = new Promise<any>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error("BLE command timeout"));
      }, timeoutMs);
      pendingRef.current.set(requestId, { resolve, reject, timeoutId });
    });

    for (const chunk of chunks) {
      await commandCharRef.current.writeValueWithoutResponse(chunk);
    }

    return promise;
  }, [encodeChunked]);

  // Send clipboard text via dedicated clipboard write characteristic
  const sendClipboard = useCallback(async (text: string): Promise<boolean> => {
    if (!clipboardWriteCharRef.current) return false;
    try {
      const chunks = encodeChunked(text);
      for (const chunk of chunks) {
        await clipboardWriteCharRef.current.writeValueWithResponse(chunk);
      }
      return true;
    } catch {
      return false;
    }
  }, [encodeChunked]);

  // Register clipboard change listener
  const onClipboardChange = useCallback((callback: (text: string) => void) => {
    clipboardCallbackRef.current = callback;
  }, []);

  // Reconnect to a previously paired device without user gesture
  // Uses getDevices() API (Chrome 85+) to find already-authorized devices
  const reconnectExisting = useCallback(async (): Promise<boolean> => {
    if (!isBluetoothSupported) return false;
    // Already connected
    if (deviceRef.current?.gatt?.connected) return true;

    try {
      // If we have a cached device ref from a previous session, try reconnecting
      if (deviceRef.current?.gatt) {
        console.log("[BLE] Reconnecting to cached device...");
        setState(prev => ({ ...prev, isScanning: true, lastError: null }));
        const server = await deviceRef.current.gatt.connect();
        await setupCharacteristics(server);
        return true;
      }

      // Try getDevices() to find previously authorized devices (no picker needed)
      if (typeof (navigator.bluetooth as any).getDevices === "function") {
        const devices: BluetoothDevice[] = await (navigator.bluetooth as any).getDevices();
        const jarvis = devices.find(d => d.name?.startsWith("JARVIS"));
        if (jarvis?.gatt) {
          console.log("[BLE] Found previously paired device:", jarvis.name);
          deviceRef.current = jarvis;
          jarvis.addEventListener("gattserverdisconnected", handleDisconnect);
          setState(prev => ({ ...prev, isScanning: true, lastError: null }));
          const server = await jarvis.gatt.connect();
          await setupCharacteristics(server);
          return true;
        }
      }
    } catch (err) {
      console.log("[BLE] Auto-reconnect failed:", err);
      setState(prev => ({ ...prev, isScanning: false }));
    }
    return false;
  }, [isBluetoothSupported, handleDisconnect, setupCharacteristics]);

  // Ping for latency measurement
  const sendPing = useCallback(() => {
    if (!commandCharRef.current) return;
    const t = Date.now();
    const encoded = new TextEncoder().encode(JSON.stringify({ type: "ping", t }));
    const buf = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    commandCharRef.current.writeValueWithoutResponse(buf).catch(() => {});
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    reconnectExisting,
    sendCommand,
    invokeCommand,
    sendClipboard,
    onClipboardChange,
    sendPing,
    isReady: state.isConnected && !!commandCharRef.current,
    isSupported: isBluetoothSupported,
  };
}
