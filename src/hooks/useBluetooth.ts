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

  // ---- Chunked BLE framing protocol ----
  // Each chunk: "[index/total]<payload_bytes>"
  // Header is ASCII, payload is raw UTF-8 fragment.
  // Max chunk = 500 bytes total (header + payload).
  const CHUNK_SIZE = 500;
  const HEADER_OVERHEAD = 10; // e.g. "[99/99]" max 10 chars

  // Encode string into framed BLE chunks
  const encodeChunked = useCallback((data: string): ArrayBuffer[] => {
    const encoded = new TextEncoder().encode(data);
    const payloadMax = CHUNK_SIZE - HEADER_OVERHEAD;
    const totalChunks = Math.max(1, Math.ceil(encoded.length / payloadMax));
    const chunks: ArrayBuffer[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * payloadMax;
      const slice = encoded.slice(start, start + payloadMax);
      const header = new TextEncoder().encode(`[${i}/${totalChunks}]`);
      const combined = new Uint8Array(header.length + slice.length);
      combined.set(header, 0);
      combined.set(slice, header.length);
      chunks.push(combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength));
    }
    return chunks;
  }, []);

  // Reassembly accumulator for incoming chunked notifications
  const reassemblyRef = useRef<{ chunks: Map<number, Uint8Array>; total: number; timer: number | null }>({
    chunks: new Map(),
    total: 0,
    timer: null,
  });
  const clipReassemblyRef = useRef<{ chunks: Map<number, Uint8Array>; total: number; timer: number | null }>({
    chunks: new Map(),
    total: 0,
    timer: null,
  });

  // Parse "[index/total]" header from raw bytes, return { index, total, payload }
  const parseChunkHeader = useCallback((raw: Uint8Array): { index: number; total: number; payload: Uint8Array } | null => {
    // Find closing bracket
    const maxScan = Math.min(raw.length, HEADER_OVERHEAD + 2);
    let bracketEnd = -1;
    for (let i = 0; i < maxScan; i++) {
      if (raw[i] === 0x5D) { // ']'
        bracketEnd = i;
        break;
      }
    }
    if (bracketEnd < 3 || raw[0] !== 0x5B) return null; // must start with '['

    const headerStr = new TextDecoder().decode(raw.slice(1, bracketEnd)); // "index/total"
    const parts = headerStr.split("/");
    if (parts.length !== 2) return null;
    const index = parseInt(parts[0], 10);
    const total = parseInt(parts[1], 10);
    if (isNaN(index) || isNaN(total) || total < 1) return null;

    return { index, total, payload: raw.slice(bracketEnd + 1) };
  }, []);

  // Accumulate chunks; returns full message string when complete, or null
  const accumulateChunk = useCallback((
    accRef: React.MutableRefObject<{ chunks: Map<number, Uint8Array>; total: number; timer: number | null }>,
    raw: Uint8Array
  ): string | null => {
    const parsed = parseChunkHeader(raw);

    // If no framing header, treat as single complete message (backward compat)
    if (!parsed) {
      return new TextDecoder().decode(raw);
    }

    const { index, total, payload } = parsed;

    // New message started (different total or reset)
    if (total !== accRef.current.total) {
      accRef.current.chunks.clear();
      accRef.current.total = total;
      if (accRef.current.timer) { clearTimeout(accRef.current.timer); accRef.current.timer = null; }
    }

    accRef.current.chunks.set(index, payload);

    // Reset stale accumulator after 10s
    if (accRef.current.timer) clearTimeout(accRef.current.timer);
    accRef.current.timer = window.setTimeout(() => {
      accRef.current.chunks.clear();
      accRef.current.total = 0;
      accRef.current.timer = null;
    }, 10000);

    // Check if all chunks received
    if (accRef.current.chunks.size === total) {
      // Reassemble in order
      let totalLen = 0;
      for (let i = 0; i < total; i++) totalLen += (accRef.current.chunks.get(i)?.length || 0);
      const assembled = new Uint8Array(totalLen);
      let offset = 0;
      for (let i = 0; i < total; i++) {
        const chunk = accRef.current.chunks.get(i);
        if (chunk) { assembled.set(chunk, offset); offset += chunk.length; }
      }
      // Clear
      accRef.current.chunks.clear();
      accRef.current.total = 0;
      if (accRef.current.timer) { clearTimeout(accRef.current.timer); accRef.current.timer = null; }
      return new TextDecoder().decode(assembled);
    }

    return null; // Waiting for more chunks
  }, [parseChunkHeader]);

  // Handle response notifications from RESPONSE characteristic (with reassembly)
  const handleResponseNotification = useCallback((event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    if (!characteristic.value) return;

    const raw = new Uint8Array(characteristic.value.buffer, characteristic.value.byteOffset, characteristic.value.byteLength);
    const text = accumulateChunk(reassemblyRef, raw);
    if (!text) return; // Waiting for more chunks

    try {
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
  }, [accumulateChunk]);

  // Handle clipboard notifications from CLIPBOARD_READ characteristic (with reassembly)
  const handleClipboardNotification = useCallback((event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    if (!characteristic.value) return;

    const raw = new Uint8Array(characteristic.value.buffer, characteristic.value.byteOffset, characteristic.value.byteLength);
    const text = accumulateChunk(clipReassemblyRef, raw);
    if (!text) return; // Waiting for more chunks

    if (text.trim() && clipboardCallbackRef.current) {
      clipboardCallbackRef.current(text);
    }
  }, [accumulateChunk]);

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
