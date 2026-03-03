import { useCallback, useRef, useState, useEffect } from "react";

// JARVIS-PC BLE GATT service/characteristic UUIDs (must match Python agent)
const JARVIS_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const COMMAND_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1";
const CLIPBOARD_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef2";
const RESPONSE_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef3";

export interface BluetoothState {
  isAvailable: boolean;
  isConnected: boolean;
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
 * Bandwidth limit: ~20KB/s — streaming features disabled in BLE mode.
 */
export function useBluetooth() {
  const [state, setState] = useState<BluetoothState>({
    isAvailable: typeof navigator !== "undefined" && !!navigator.bluetooth,
    isConnected: false,
    deviceName: null,
    lastError: null,
    latency: 0,
  });

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null);
  const commandCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const clipboardCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const responseCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const pendingRef = useRef<Map<string, PendingBleRequest>>(new Map());
  const reconnectTimerRef = useRef<number | null>(null);
  const clipboardCallbackRef = useRef<((text: string) => void) | null>(null);

  const isBluetoothSupported = typeof navigator !== "undefined" && !!navigator.bluetooth;

  // Encode string to BLE-safe chunks (max 512 bytes per write)
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

  // Handle clipboard notifications
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
    clipboardCharRef.current = null;
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

    const commandChar = await service.getCharacteristic(COMMAND_CHAR_UUID);
    commandCharRef.current = commandChar;

    try {
      const clipboardChar = await service.getCharacteristic(CLIPBOARD_CHAR_UUID);
      clipboardCharRef.current = clipboardChar;
      await clipboardChar.startNotifications();
      clipboardChar.addEventListener("characteristicvaluechanged", handleClipboardNotification);
    } catch {
      console.log("[BLE] Clipboard characteristic not available");
    }

    try {
      const responseChar = await service.getCharacteristic(RESPONSE_CHAR_UUID);
      responseCharRef.current = responseChar;
      await responseChar.startNotifications();
      responseChar.addEventListener("characteristicvaluechanged", handleResponseNotification);
    } catch {
      console.log("[BLE] Response characteristic not available");
    }

    setState(prev => ({
      ...prev,
      isConnected: true,
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
      setState(prev => ({ ...prev, lastError: msg, isConnected: false }));
      return false;
    }
  }, [isBluetoothSupported, handleDisconnect, setupCharacteristics]);

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
    clipboardCharRef.current = null;
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
      // Write sequentially (BLE requires one write at a time)
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

  // Send clipboard text
  const sendClipboard = useCallback(async (text: string): Promise<boolean> => {
    if (!clipboardCharRef.current) return false;
    try {
      const chunks = encodeChunked(text);
      for (const chunk of chunks) {
        await clipboardCharRef.current.writeValueWithResponse(chunk);
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
    sendCommand,
    invokeCommand,
    sendClipboard,
    onClipboardChange,
    sendPing,
    isReady: state.isConnected && !!commandCharRef.current,
    isSupported: isBluetoothSupported,
  };
}
