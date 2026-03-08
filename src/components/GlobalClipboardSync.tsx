import { useEffect, useRef, useCallback } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useSharedBluetooth } from "@/contexts/BluetoothContext";
import { toast } from "sonner";

/**
 * Headless global clipboard sync — runs at App level.
 * Phone → PC: Detects clipboard changes via focus/visibility events + copy/cut, pushes instantly.
 * PC → Phone: Polls every 5s using clipboard_check (hash-based, lightweight).
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

  const prevTransportRef = useRef<"none" | "wifi" | "ble">("none");
  const lastSentRef = useRef("");
  const lastReceivedRef = useRef("");
  const lastKnownClipboardRef = useRef("");
  const pollRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  const POLL_INTERVAL = 5000; // 5s poll for PC → Phone

  // Detect transport switches and show toast
  useEffect(() => {
    const current = isWifiConnected ? "wifi" : isBleConnected ? "ble" : "none";
    const prev = prevTransportRef.current;

    if (prev !== "none" && current !== "none" && prev !== current) {
      if (current === "wifi") {
        toast.success("Switched to WiFi", { description: "Using fast network connection", duration: 3000 });
      } else {
        toast.info("Switched to Bluetooth", { description: "Using BLE fallback (limited bandwidth)", duration: 3000 });
      }
    } else if (prev !== "none" && current === "none") {
      toast.error("Disconnected", { description: "No connection to PC", duration: 3000 });
    } else if (prev === "none" && current !== "none") {
      toast.success(current === "wifi" ? "Connected via WiFi" : "Connected via Bluetooth", { duration: 2000 });
    }

    prevTransportRef.current = current;
  }, [isWifiConnected, isBleConnected]);

  // Push clipboard text to PC via best available transport
  const pushToPc = useCallback(async (text: string) => {
    if (!text.trim() || text === lastSentRef.current) return;
    lastSentRef.current = text;
    lastKnownClipboardRef.current = text;
    try {
      if (!isWifiConnected && isBleConnected) {
        await bluetooth.sendClipboard(text);
      } else {
        await sendCommand("set_clipboard", { content: text }, { awaitResult: false });
      }
    } catch { /* silent */ }
  }, [sendCommand, isWifiConnected, isBleConnected, bluetooth]);

  // Read clipboard and push if changed — used by multiple triggers
  const detectAndPush = useCallback(async () => {
    if (!isConnected) return;
    try {
      const text = await navigator.clipboard?.readText();
      if (text?.trim() && text !== lastKnownClipboardRef.current && text !== lastReceivedRef.current) {
        pushToPc(text);
      }
    } catch { /* permission denied */ }
  }, [isConnected, pushToPc]);

  // Phone → PC: instant on copy/cut events
  useEffect(() => {
    if (!isConnected) return;

    const handler = async () => {
      await new Promise(r => setTimeout(r, 50)); // brief delay for clipboard to update
      detectAndPush();
    };

    document.addEventListener("copy", handler);
    document.addEventListener("cut", handler);
    return () => {
      document.removeEventListener("copy", handler);
      document.removeEventListener("cut", handler);
    };
  }, [isConnected, detectAndPush]);

  // Phone → PC: detect clipboard changes on focus/visibility (catches external app copies)
  useEffect(() => {
    if (!isConnected) return;

    const onFocus = () => {
      // Small delay to let clipboard update from other apps
      setTimeout(detectAndPush, 200);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setTimeout(detectAndPush, 200);
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isConnected, detectAndPush]);

  // PC → Phone: BLE notification listener (push-based, instant)
  useEffect(() => {
    if (!isBleConnected) return;

    bluetooth.onClipboardChange((text: string) => {
      if (text && text !== lastSentRef.current && text !== lastReceivedRef.current) {
        lastReceivedRef.current = text;
        lastKnownClipboardRef.current = text;
        navigator.clipboard.writeText(text).catch(() => {});
      }
    });

    return () => {
      bluetooth.onClipboardChange(null as any);
    };
  }, [isBleConnected, bluetooth]);

  // PC → Phone: poll over WiFi
  useEffect(() => {
    if (!isWifiConnected) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    const check = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const result = await sendCommand("clipboard_check", {}, { awaitResult: true, timeoutMs: 3000 });
        if (result?.success && "result" in result && result.result) {
          const data = result.result as { changed?: boolean; content?: string };
          if (data.changed && data.content && data.content !== lastSentRef.current && data.content !== lastReceivedRef.current) {
            lastReceivedRef.current = data.content;
            lastKnownClipboardRef.current = data.content;
            try { await navigator.clipboard.writeText(data.content); } catch { /* silent */ }
          }
        }
      } catch { /* silent */ }
      busyRef.current = false;
    };

    check();
    pollRef.current = window.setInterval(check, POLL_INTERVAL);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [isWifiConnected, sendCommand]);

  return null; // headless
}
