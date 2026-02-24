import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Clipboard,
  Check,
  Smartphone,
  Monitor,
  ArrowLeftRight,
  Loader2,
  Send,
  ClipboardCopy,
  ClipboardPaste,
  Trash2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";

interface ClipboardEntry {
  id: string;
  content: string;
  source: "phone" | "pc";
  timestamp: Date;
}

interface AutoClipboardSyncProps {
  className?: string;
  compact?: boolean;
}

/**
 * KDE Connect / Windows Phone Link style clipboard sync.
 * 
 * Phone → PC: INSTANT via document copy/cut event listeners (zero polling).
 * PC → Phone: Fast polling with hash-based change detection (agent returns content only when changed).
 * Manual: "Send Clipboard" buttons for both directions as fallback.
 */
export const AutoClipboardSync = memo(function AutoClipboardSync({
  className,
  compact = false,
}: AutoClipboardSyncProps) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();

  const [phoneClipboard, setPhoneClipboard] = useState("");
  const [pcClipboard, setPcClipboard] = useState("");
  const [history, setHistory] = useState<ClipboardEntry[]>([]);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "phone-to-pc" | "pc-to-phone" | "synced">("idle");

  const lastSentToPcRef = useRef("");
  const lastReceivedFromPcRef = useRef("");
  const pcPollTimerRef = useRef<number | null>(null);
  const isConnected = selectedDevice?.is_online || false;

  // ─── Add to history ───
  const addToHistory = useCallback((content: string, source: "phone" | "pc") => {
    if (!content.trim()) return;
    setHistory(prev => {
      if (prev[0]?.content === content) return prev; // Skip duplicate at top
      const entry: ClipboardEntry = {
        id: crypto.randomUUID(),
        content,
        source,
        timestamp: new Date(),
      };
      return [entry, ...prev].slice(0, 30);
    });
  }, []);

  // ─── Send text to PC clipboard (fire-and-forget for speed) ───
  const pushToPc = useCallback(async (text: string) => {
    if (!isConnected || !text.trim() || text === lastSentToPcRef.current) return;
    lastSentToPcRef.current = text;
    setSyncStatus("phone-to-pc");
    try {
      await sendCommand("set_clipboard", { content: text }, { awaitResult: true, timeoutMs: 2000 });
      setPcClipboard(text);
      addToHistory(text, "phone");
    } catch {
      // Silent fail - clipboard sync shouldn't interrupt user
    }
    setSyncStatus("synced");
    setTimeout(() => setSyncStatus("idle"), 1500);
  }, [isConnected, sendCommand, addToHistory]);

  // ─── INSTANT Phone → PC: Listen for copy/cut events ───
  useEffect(() => {
    if (!isConnected) return;

    const handleCopyOrCut = async () => {
      // Small delay to let browser update clipboard
      await new Promise(r => setTimeout(r, 50));
      try {
        if (navigator.clipboard?.readText) {
          const text = await navigator.clipboard.readText();
          if (text?.trim()) {
            setPhoneClipboard(text);
            pushToPc(text);
          }
        }
      } catch {
        // Clipboard permission denied - silent
      }
    };

    document.addEventListener("copy", handleCopyOrCut);
    document.addEventListener("cut", handleCopyOrCut);

    return () => {
      document.removeEventListener("copy", handleCopyOrCut);
      document.removeEventListener("cut", handleCopyOrCut);
    };
  }, [isConnected, pushToPc]);

  // ─── PC → Phone: Fast polling with hash-based change detection ───
  useEffect(() => {
    if (!isConnected) {
      if (pcPollTimerRef.current) {
        clearInterval(pcPollTimerRef.current);
        pcPollTimerRef.current = null;
      }
      return;
    }

    const checkPcClipboard = async () => {
      try {
        const result = await sendCommand("clipboard_check", {}, { awaitResult: true, timeoutMs: 2000 });
        if (result?.success && "result" in result && result.result) {
          const data = result.result as { changed?: boolean; content?: string; hash?: string };
          if (data.changed && data.content) {
            const content = data.content;
            // Don't echo back what we just sent
            if (content !== lastSentToPcRef.current && content !== lastReceivedFromPcRef.current) {
              lastReceivedFromPcRef.current = content;
              setPcClipboard(content);
              // Write to phone clipboard instantly
              setSyncStatus("pc-to-phone");
              try {
                await navigator.clipboard.writeText(content);
                setPhoneClipboard(content);
                addToHistory(content, "pc");
              } catch {
                // Browser may block - still show in UI
                addToHistory(content, "pc");
              }
              setSyncStatus("synced");
              setTimeout(() => setSyncStatus("idle"), 1500);
            }
          }
        }
      } catch {
        // Silent - don't spam errors
      }
    };

    // Initial check
    checkPcClipboard();
    // Poll every 800ms (fast enough to feel instant, light enough with hash check)
    pcPollTimerRef.current = window.setInterval(checkPcClipboard, 800);

    return () => {
      if (pcPollTimerRef.current) {
        clearInterval(pcPollTimerRef.current);
        pcPollTimerRef.current = null;
      }
    };
  }, [isConnected, sendCommand, addToHistory]);

  // ─── Manual: Send phone clipboard to PC ───
  const handleSendPhoneToPc = useCallback(async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (text?.trim()) {
        setPhoneClipboard(text);
        await pushToPc(text);
        toast({ title: "📋 Sent to PC", description: text.slice(0, 60) });
      } else {
        toast({ title: "Clipboard empty", variant: "destructive" });
      }
    } catch {
      toast({ title: "Clipboard permission denied", description: "Tap to allow clipboard access", variant: "destructive" });
    }
  }, [pushToPc, toast]);

  // ─── Manual: Get PC clipboard to phone ───
  const handleGetPcToPhone = useCallback(async () => {
    if (!isConnected) return;
    setSyncStatus("pc-to-phone");
    try {
      const result = await sendCommand("get_clipboard", {}, { awaitResult: true, timeoutMs: 3000 });
      if (result?.success && "result" in result && result.result) {
        const content = (result.result as { content?: string }).content || "";
        if (content.trim()) {
          setPcClipboard(content);
          lastReceivedFromPcRef.current = content;
          try {
            await navigator.clipboard.writeText(content);
            setPhoneClipboard(content);
          } catch { /* silent */ }
          addToHistory(content, "pc");
          toast({ title: "📋 Copied from PC", description: content.slice(0, 60) });
        } else {
          toast({ title: "PC clipboard empty" });
        }
      }
    } catch {
      toast({ title: "Failed to get PC clipboard", variant: "destructive" });
    }
    setSyncStatus("idle");
  }, [isConnected, sendCommand, addToHistory, toast]);

  // ─── Copy from history to both devices ───
  const copyFromHistory = useCallback(async (entry: ClipboardEntry) => {
    try {
      await navigator.clipboard.writeText(entry.content);
      setPhoneClipboard(entry.content);
    } catch { /* silent */ }
    if (isConnected) {
      await sendCommand("set_clipboard", { content: entry.content }, { awaitResult: false });
      setPcClipboard(entry.content);
    }
    toast({ title: "Copied to both devices" });
  }, [isConnected, sendCommand, toast]);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  // ─── Status badge ───
  const statusInfo = (() => {
    if (!isConnected) return { label: "Disconnected", color: "" };
    switch (syncStatus) {
      case "phone-to-pc": return { label: "Phone → PC", color: "border-blue-500/30 text-blue-400" };
      case "pc-to-phone": return { label: "PC → Phone", color: "border-blue-500/30 text-blue-400" };
      case "synced": return { label: "Synced ✓", color: "border-green-500/30 text-green-400" };
      case "syncing": return { label: "Syncing...", color: "border-yellow-500/30 text-yellow-400" };
      default: return { label: "Auto-sync", color: "border-muted-foreground/30 text-muted-foreground" };
    }
  })();

  // ─── Compact view ───
  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 p-2 rounded-lg bg-muted/30", className)}>
        <Clipboard className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium">Clipboard</span>
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-1 ml-auto", statusInfo.color)}>
          {syncStatus === "phone-to-pc" || syncStatus === "pc-to-phone" ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          ) : syncStatus === "synced" ? (
            <Check className="w-2.5 h-2.5" />
          ) : (
            <ArrowLeftRight className="w-2.5 h-2.5" />
          )}
          {statusInfo.label}
        </Badge>
      </div>
    );
  }

  // ─── Full view ───
  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clipboard className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Clipboard Sync</span>
        </div>
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-1", statusInfo.color)}>
          {syncStatus === "phone-to-pc" || syncStatus === "pc-to-phone" ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          ) : syncStatus === "synced" ? (
            <Check className="w-2.5 h-2.5" />
          ) : (
            <ArrowLeftRight className="w-2.5 h-2.5" />
          )}
          {statusInfo.label}
        </Badge>
      </div>

      {/* How it works hint */}
      <p className="text-[10px] text-muted-foreground leading-tight">
        Copy on either device — it appears on the other instantly. No clicks needed.
      </p>

      {/* Current clipboard status */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg bg-muted/30 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Smartphone className="h-3 w-3" />
            Phone
          </div>
          <p className="text-[11px] truncate font-mono min-h-[1rem]">
            {phoneClipboard ? phoneClipboard.slice(0, 40) + (phoneClipboard.length > 40 ? "…" : "") : "—"}
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-muted/30 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Monitor className="h-3 w-3" />
            PC
          </div>
          <p className="text-[11px] truncate font-mono min-h-[1rem]">
            {pcClipboard ? pcClipboard.slice(0, 40) + (pcClipboard.length > 40 ? "…" : "") : "—"}
          </p>
        </div>
      </div>

      {/* Manual send buttons (fallback) */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-8 gap-1.5"
          onClick={handleSendPhoneToPc}
          disabled={!isConnected}
        >
          <Send className="h-3 w-3" />
          Send to PC
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-8 gap-1.5"
          onClick={handleGetPcToPhone}
          disabled={!isConnected}
        >
          <ClipboardPaste className="h-3 w-3" />
          Get from PC
        </Button>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Recent clips</span>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={clearHistory}>
              <Trash2 className="h-2.5 w-2.5 mr-0.5" />
              Clear
            </Button>
          </div>
          <ScrollArea className="h-24">
            <div className="space-y-1">
              {history.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 p-1.5 rounded-md bg-secondary/20 hover:bg-secondary/40 cursor-pointer text-[11px] group"
                  onClick={() => copyFromHistory(entry)}
                >
                  {entry.source === "phone" ? (
                    <Smartphone className="h-3 w-3 text-muted-foreground shrink-0" />
                  ) : (
                    <Monitor className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate flex-1 font-mono">{entry.content}</span>
                  <Copy className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
});
