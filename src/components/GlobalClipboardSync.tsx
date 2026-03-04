import { useEffect, useRef, useCallback } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useSharedBluetooth } from "@/contexts/BluetoothContext";

/**
 * Headless global clipboard sync — runs at App level.
 * Phone → PC: Listens for copy/cut events and pushes instantly.
 * PC → Phone: Polls every 1s using clipboard_check (hash-based, lightweight).
 * 
 * When WiFi is unavailable but BLE is connected, clipboard sync
 * routes through the Bluetooth GATT clipboard characteristic instead.
 * No UI — purely background sync like KDE Connect.
 */
export function GlobalClipboardSync() {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const bluetooth = useSharedBluetooth();

  const isWifiConnected = selectedDevice?.is_online || false;
  const isBleConnected = bluetooth.isReady;
  const isConnected = isWifiConnected || isBleConnected;

  const lastSentRef = useRef("");
  const lastReceivedRef = useRef("");
  const pollRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  // Push clipboard text to PC via best available transport
  const pushToPc = useCallback(async (text: string) => {
    if (!text.trim() || text === lastSentRef.current) return;
    lastSentRef.current = text;
    try {
      // Prefer BLE clipboard characteristic when WiFi is down
      if (!isWifiConnected && isBleConnected) {
        await bluetooth.sendClipboard(text);
      } else {
        await sendCommand("set_clipboard", { content: text }, { awaitResult: false });
      }
    } catch { /* silent */ }
  }, [sendCommand, isWifiConnected, isBleConnected, bluetooth]);

  // Phone → PC: instant on copy/cut
  useEffect(() => {
    if (!isConnected) return;

    const handler = async () => {
      await new Promise(r => setTimeout(r, 50));
      try {
        const text = await navigator.clipboard?.readText();
        if (text?.trim()) pushToPc(text);
      } catch { /* permission denied */ }
    };

    document.addEventListener("copy", handler);
    document.addEventListener("cut", handler);
    return () => {
      document.removeEventListener("copy", handler);
      document.removeEventListener("cut", handler);
    };
  }, [isConnected, pushToPc]);

  // PC → Phone: BLE notification listener (push-based, instant)
  useEffect(() => {
    if (!isBleConnected) return;

    bluetooth.onClipboardChange((text: string) => {
      if (text && text !== lastSentRef.current && text !== lastReceivedRef.current) {
        lastReceivedRef.current = text;
        navigator.clipboard.writeText(text).catch(() => {});
      }
    });

    return () => {
      bluetooth.onClipboardChange(() => {}); // unregister
    };
  }, [isBleConnected, bluetooth]);

  // PC → Phone: poll every 1s over WiFi (hash-based, lightweight)
  useEffect(() => {
    // Only poll over WiFi; BLE uses push notifications above
    if (!isWifiConnected) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    const check = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const result = await sendCommand("clipboard_check", {}, { awaitResult: true, timeoutMs: 2000 });
        if (result?.success && "result" in result && result.result) {
          const data = result.result as { changed?: boolean; content?: string };
          if (data.changed && data.content && data.content !== lastSentRef.current && data.content !== lastReceivedRef.current) {
            lastReceivedRef.current = data.content;
            try { await navigator.clipboard.writeText(data.content); } catch { /* silent */ }
          }
        }
      } catch { /* silent */ }
      busyRef.current = false;
    };

    check();
    pollRef.current = window.setInterval(check, 1000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [isWifiConnected, sendCommand]);

  return null; // headless
}
