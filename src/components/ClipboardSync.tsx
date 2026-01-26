import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
  RefreshCw,
  Check,
  Smartphone,
  Monitor,
  ArrowLeftRight,
  History,
  Trash2,
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

interface ClipboardSyncProps {
  className?: string;
}

export function ClipboardSync({ className }: ClipboardSyncProps) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();

  const [autoSync, setAutoSync] = useState(true);
  const [syncInterval, setSyncInterval] = useState(1000); // 1 second for instant feel
  const [pcClipboard, setPcClipboard] = useState<string>("");
  const [phoneClipboard, setPhoneClipboard] = useState<string>("");
  const [history, setHistory] = useState<ClipboardEntry[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  
  const lastPcContentRef = useRef<string>("");
  const lastPhoneContentRef = useRef<string>("");
  const syncTimerRef = useRef<number | null>(null);

  const isConnected = selectedDevice?.is_online || false;

  // Read phone clipboard (browser Clipboard API)
  const readPhoneClipboard = useCallback(async (): Promise<string> => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        return text || "";
      }
    } catch (err) {
      // Permission denied or not supported
      console.debug("Clipboard read failed:", err);
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
      console.error("Clipboard write failed:", err);
    }
    return false;
  }, []);

  // Fetch PC clipboard
  const fetchPcClipboard = useCallback(async () => {
    if (!isConnected) return;
    
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
      console.error("PC clipboard write failed:", err);
    }
    return false;
  }, [isConnected, sendCommand]);

  // Add to history
  const addToHistory = useCallback((content: string, source: "phone" | "pc") => {
    if (!content.trim()) return;
    
    setHistory(prev => {
      // Avoid duplicates
      const existing = prev.find(e => e.content === content);
      if (existing) return prev;
      
      const entry: ClipboardEntry = {
        id: crypto.randomUUID(),
        content,
        source,
        timestamp: new Date(),
      };
      return [entry, ...prev].slice(0, 50); // Keep last 50
    });
  }, []);

  // Sync clipboards bidirectionally
  const syncClipboards = useCallback(async () => {
    if (!isConnected || isSyncing) return;
    
    setIsSyncing(true);
    try {
      // Get both clipboards
      const [phoneContent, pcContent] = await Promise.all([
        readPhoneClipboard(),
        fetchPcClipboard(),
      ]);

      // Check for changes
      const phoneChanged = phoneContent !== lastPhoneContentRef.current && phoneContent.trim();
      const pcChanged = pcContent !== lastPcContentRef.current && pcContent.trim();

      if (phoneChanged && phoneContent !== pcContent) {
        // Phone has new content - send to PC
        await sendToPcClipboard(phoneContent);
        lastPhoneContentRef.current = phoneContent;
        lastPcContentRef.current = phoneContent;
        addToHistory(phoneContent, "phone");
      } else if (pcChanged && pcContent !== phoneContent) {
        // PC has new content - send to phone
        await writePhoneClipboard(pcContent);
        lastPhoneContentRef.current = pcContent;
        lastPcContentRef.current = pcContent;
        addToHistory(pcContent, "pc");
      }

      setLastSync(new Date());
    } catch (err) {
      console.error("Clipboard sync error:", err);
    } finally {
      setIsSyncing(false);
    }
  }, [isConnected, isSyncing, readPhoneClipboard, fetchPcClipboard, sendToPcClipboard, writePhoneClipboard, addToHistory]);

  // Auto-sync timer
  useEffect(() => {
    if (autoSync && isConnected) {
      // Initial sync
      syncClipboards();
      
      // Set up interval
      syncTimerRef.current = window.setInterval(syncClipboards, syncInterval);
      
      return () => {
        if (syncTimerRef.current) {
          clearInterval(syncTimerRef.current);
          syncTimerRef.current = null;
        }
      };
    } else {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    }
  }, [autoSync, isConnected, syncInterval, syncClipboards]);

  // Copy from history
  const copyFromHistory = useCallback(async (entry: ClipboardEntry) => {
    await writePhoneClipboard(entry.content);
    await sendToPcClipboard(entry.content);
    toast({ title: "Copied to both devices" });
  }, [writePhoneClipboard, sendToPcClipboard, toast]);

  // Clear history
  const clearHistory = useCallback(() => {
    setHistory([]);
    toast({ title: "History cleared" });
  }, [toast]);

  // Manual sync button
  const handleManualSync = useCallback(async () => {
    await syncClipboards();
    toast({ title: "Clipboards synced" });
  }, [syncClipboards, toast]);

  return (
    <Card className={cn("border-border/40", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Clipboard className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Clipboard Sync</CardTitle>
              <CardDescription className="text-xs">Instant copy & paste between devices</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={autoSync && isConnected ? "default" : "secondary"} className="text-xs">
              {isSyncing ? "Syncing..." : autoSync ? "Auto" : "Manual"}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleManualSync}
              disabled={!isConnected || isSyncing}
            >
              <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Auto-sync toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="auto-sync" className="text-sm">Auto-sync clipboard</Label>
          </div>
          <Switch
            id="auto-sync"
            checked={autoSync}
            onCheckedChange={setAutoSync}
            disabled={!isConnected}
          />
        </div>

        {/* Current clipboard status */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/50 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Smartphone className="h-3 w-3" />
              Phone
            </div>
            <p className="text-xs truncate font-mono">
              {phoneClipboard ? phoneClipboard.slice(0, 50) + (phoneClipboard.length > 50 ? "..." : "") : "Empty"}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Monitor className="h-3 w-3" />
              PC
            </div>
            <p className="text-xs truncate font-mono">
              {pcClipboard ? pcClipboard.slice(0, 50) + (pcClipboard.length > 50 ? "..." : "") : "Empty"}
            </p>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={async () => {
              const content = await readPhoneClipboard();
              if (content) {
                await sendToPcClipboard(content);
                toast({ title: "Sent to PC" });
              }
            }}
            disabled={!isConnected}
          >
            <ClipboardCopy className="h-3 w-3 mr-1.5" />
            Phone → PC
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={async () => {
              const content = await fetchPcClipboard();
              if (content) {
                await writePhoneClipboard(content);
                toast({ title: "Copied from PC" });
              }
            }}
            disabled={!isConnected}
          >
            <ClipboardPaste className="h-3 w-3 mr-1.5" />
            PC → Phone
          </Button>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <History className="h-3 w-3" />
                Recent clips
              </div>
              <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={clearHistory}>
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </Button>
            </div>
            <ScrollArea className="h-24">
              <div className="space-y-1">
                {history.slice(0, 5).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2 p-2 rounded-md bg-secondary/30 hover:bg-secondary/50 cursor-pointer text-xs"
                    onClick={() => copyFromHistory(entry)}
                  >
                    {entry.source === "phone" ? (
                      <Smartphone className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <Monitor className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <span className="truncate flex-1 font-mono">{entry.content}</span>
                    <Check className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Status */}
        {lastSync && (
          <p className="text-[10px] text-muted-foreground text-center">
            Last sync: {lastSync.toLocaleTimeString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
