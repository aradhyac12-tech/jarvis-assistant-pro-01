import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Clipboard,
  Check,
  Smartphone,
  Monitor,
  ArrowLeftRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

export const AutoClipboardSync = memo(function AutoClipboardSync({ 
  className,
  compact = false,
}: AutoClipboardSyncProps) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();

  const [phoneClipboard, setPhoneClipboard] = useState<string>("");
  const [pcClipboard, setPcClipboard] = useState<string>("");
  const [history, setHistory] = useState<ClipboardEntry[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced">("idle");
  
  const lastPcContentRef = useRef<string>("");
  const lastPhoneContentRef = useRef<string>("");
  const syncTimerRef = useRef<number | null>(null);
  const isMonitoringRef = useRef(false);

  const isConnected = selectedDevice?.is_online || false;

  // Read phone clipboard (browser Clipboard API)
  const readPhoneClipboard = useCallback(async (): Promise<string> => {
    try {
      // Check for clipboard permission
      if (navigator.clipboard && navigator.clipboard.readText) {
        const permissionStatus = await navigator.permissions.query({ 
          name: "clipboard-read" as PermissionName 
        }).catch(() => null);
        
        // Only read if we have permission
        if (permissionStatus?.state === "granted" || permissionStatus?.state === "prompt") {
          const text = await navigator.clipboard.readText();
          return text || "";
        }
      }
    } catch (err) {
      console.debug("Clipboard read silently failed:", err);
    }
    return phoneClipboard;
  }, [phoneClipboard]);

  // Write to phone clipboard
  const writePhoneClipboard = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setPhoneClipboard(text);
        return true;
      }
    } catch (err) {
      console.debug("Clipboard write silently failed:", err);
    }
    return false;
  }, []);

  // Fetch PC clipboard
  const fetchPcClipboard = useCallback(async () => {
    if (!isConnected) return "";
    
    try {
      const result = await sendCommand("get_clipboard", {}, { awaitResult: true, timeoutMs: 2000 });
      if (result?.success && "result" in result && result.result) {
        const content = (result.result as { content?: string }).content || "";
        setPcClipboard(content);
        return content;
      }
    } catch (err) {
      console.debug("PC clipboard fetch failed:", err);
    }
    return pcClipboard;
  }, [isConnected, sendCommand, pcClipboard]);

  // Send to PC clipboard
  const sendToPcClipboard = useCallback(async (text: string) => {
    if (!isConnected) return false;
    
    try {
      const result = await sendCommand("set_clipboard", { content: text }, { awaitResult: true, timeoutMs: 2000 });
      if (result?.success) {
        setPcClipboard(text);
        return true;
      }
    } catch (err) {
      console.debug("PC clipboard write failed:", err);
    }
    return false;
  }, [isConnected, sendCommand]);

  // Add to history
  const addToHistory = useCallback((content: string, source: "phone" | "pc") => {
    if (!content.trim()) return;
    
    setHistory(prev => {
      const existing = prev.find(e => e.content === content);
      if (existing) return prev;
      
      const entry: ClipboardEntry = {
        id: crypto.randomUUID(),
        content,
        source,
        timestamp: new Date(),
      };
      return [entry, ...prev].slice(0, 20);
    });
  }, []);

  // Auto-sync clipboards bidirectionally
  const syncClipboards = useCallback(async () => {
    if (!isConnected || isSyncing) return;
    
    setIsSyncing(true);
    setSyncStatus("syncing");
    
    try {
      const [phoneContent, pcContent] = await Promise.all([
        readPhoneClipboard(),
        fetchPcClipboard(),
      ]);

      const phoneChanged = phoneContent !== lastPhoneContentRef.current && phoneContent.trim();
      const pcChanged = pcContent !== lastPcContentRef.current && pcContent.trim();

      if (phoneChanged && phoneContent !== pcContent) {
        await sendToPcClipboard(phoneContent);
        lastPhoneContentRef.current = phoneContent;
        lastPcContentRef.current = phoneContent;
        addToHistory(phoneContent, "phone");
        setSyncStatus("synced");
      } else if (pcChanged && pcContent !== phoneContent) {
        await writePhoneClipboard(pcContent);
        lastPhoneContentRef.current = pcContent;
        lastPcContentRef.current = pcContent;
        addToHistory(pcContent, "pc");
        setSyncStatus("synced");
      } else {
        setSyncStatus("idle");
      }
    } catch (err) {
      console.debug("Clipboard sync error:", err);
      setSyncStatus("idle");
    } finally {
      setIsSyncing(false);
    }
  }, [isConnected, isSyncing, readPhoneClipboard, fetchPcClipboard, sendToPcClipboard, writePhoneClipboard, addToHistory]);

  // Auto-start continuous sync when connected
  useEffect(() => {
    if (isConnected && !isMonitoringRef.current) {
      isMonitoringRef.current = true;
      syncClipboards();
      
      // Fast polling for instant sync (500ms)
      syncTimerRef.current = window.setInterval(syncClipboards, 500);
    } else if (!isConnected && isMonitoringRef.current) {
      isMonitoringRef.current = false;
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    }

    return () => {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [isConnected, syncClipboards]);

  // Copy from history to both devices
  const copyFromHistory = useCallback(async (entry: ClipboardEntry) => {
    await writePhoneClipboard(entry.content);
    await sendToPcClipboard(entry.content);
  }, [writePhoneClipboard, sendToPcClipboard]);

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 p-2 rounded-lg bg-muted/30", className)}>
        <Clipboard className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium">Clipboard</span>
        <Badge 
          variant="outline" 
          className={cn(
            "text-[10px] px-1.5 py-0 gap-1 ml-auto",
            syncStatus === "synced" && "border-green-500/30 text-green-400",
            syncStatus === "syncing" && "border-blue-500/30 text-blue-400"
          )}
        >
          {isSyncing ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          ) : syncStatus === "synced" ? (
            <Check className="w-2.5 h-2.5" />
          ) : (
            <ArrowLeftRight className="w-2.5 h-2.5" />
          )}
          {isConnected ? "Auto" : "Off"}
        </Badge>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clipboard className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Clipboard Sync</span>
        </div>
        <Badge 
          variant="outline" 
          className={cn(
            "text-[10px] px-1.5 py-0 gap-1",
            syncStatus === "synced" && "border-green-500/30 text-green-400",
            syncStatus === "syncing" && "border-blue-500/30 text-blue-400"
          )}
        >
          {isSyncing ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          ) : (
            <ArrowLeftRight className="w-2.5 h-2.5" />
          )}
          {isConnected ? "Auto-sync Active" : "Disconnected"}
        </Badge>
      </div>

      {/* Current clipboard status */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg bg-muted/30 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Smartphone className="h-3 w-3" />
            Phone
          </div>
          <p className="text-[11px] truncate font-mono">
            {phoneClipboard ? phoneClipboard.slice(0, 40) + (phoneClipboard.length > 40 ? "..." : "") : "Empty"}
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-muted/30 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Monitor className="h-3 w-3" />
            PC
          </div>
          <p className="text-[11px] truncate font-mono">
            {pcClipboard ? pcClipboard.slice(0, 40) + (pcClipboard.length > 40 ? "..." : "") : "Empty"}
          </p>
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <ScrollArea className="h-20">
          <div className="space-y-1">
            {history.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 p-1.5 rounded-md bg-secondary/20 hover:bg-secondary/40 cursor-pointer text-[11px]"
                onClick={() => copyFromHistory(entry)}
              >
                {entry.source === "phone" ? (
                  <Smartphone className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : (
                  <Monitor className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <span className="truncate flex-1 font-mono">{entry.content}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
});
