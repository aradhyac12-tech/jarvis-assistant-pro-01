import { useEffect, useRef, useCallback } from "react";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";

/**
 * Headless global clipboard sync — runs at App level.
 * Phone → PC: Listens for copy/cut events and pushes instantly.
 * PC → Phone: Polls every 1s using clipboard_check (hash-based, lightweight).
 * No UI — purely background sync like KDE Connect.
 */
export function GlobalClipboardSync() {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const isConnected = selectedDevice?.is_online || false;

  const lastSentRef = useRef("");
  const lastReceivedRef = useRef("");
  const pollRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  // Phone → PC: instant on copy/cut
  const pushToPc = useCallback(async (text: string) => {
    if (!text.trim() || text === lastSentRef.current) return;
    lastSentRef.current = text;
    try {
      await sendCommand("set_clipboard", { content: text }, { awaitResult: false });
    } catch { /* silent */ }
  }, [sendCommand]);

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

  // PC → Phone: poll every 1s
  useEffect(() => {
    if (!isConnected) {
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
  }, [isConnected, sendCommand]);

  return null; // headless
}
