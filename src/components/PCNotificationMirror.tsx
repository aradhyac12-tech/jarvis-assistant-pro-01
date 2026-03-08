import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  BellOff,
  Loader2,
  RefreshCw,
  Trash2,
  X,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface PCNotification {
  id: string;
  app_name: string;
  title: string;
  body: string;
  timestamp: string;
  icon?: string;
  dismissed?: boolean;
}

interface PCNotificationMirrorProps {
  isConnected: boolean;
  className?: string;
}

export function PCNotificationMirror({ isConnected, className }: PCNotificationMirrorProps) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  const [notifications, setNotifications] = useState<PCNotification[]>([]);
  const [isPolling, setIsPolling] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const pollRef = useRef<number | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!isConnected) return;
    setIsLoading(true);
    try {
      const result = await sendCommand(
        "get_pc_notifications",
        { since_minutes: 30 },
        { awaitResult: true, timeoutMs: 10000 }
      );
      if (result?.success && "result" in result && result.result) {
        const data = result.result as { notifications?: PCNotification[] };
        if (data.notifications) {
          setNotifications((prev) => {
            const existingIds = new Set(prev.map((n) => n.id));
            const newOnes = data.notifications!.filter((n) => !existingIds.has(n.id));
            if (newOnes.length > 0) {
              // Show toast for new notifications
              newOnes.slice(0, 3).forEach((n) => {
                toast({
                  title: `🖥️ ${n.app_name}`,
                  description: n.title || n.body,
                });
              });
            }
            const merged = [...newOnes, ...prev].slice(0, 100);
            return merged;
          });
        }
      }
    } catch {
      // silent
    }
    setIsLoading(false);
  }, [isConnected, sendCommand, toast]);

  // Auto-poll every 10s
  useEffect(() => {
    if (!isConnected || !isPolling) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    fetchNotifications();
    pollRef.current = window.setInterval(fetchNotifications, 10000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isConnected, isPolling, fetchNotifications]);

  const dismissNotification = useCallback(
    async (notif: PCNotification) => {
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
      sendCommand("dismiss_pc_notification", { notification_id: notif.id });
    },
    [sendCommand]
  );

  const clearAll = useCallback(() => {
    setNotifications([]);
    sendCommand("clear_pc_notifications", {});
  }, [sendCommand]);

  const activeNotifs = notifications.filter((n) => !n.dismissed);

  const getAppColor = (name: string) => {
    const colors = [
      "bg-blue-500/15 text-blue-400",
      "bg-green-500/15 text-green-400",
      "bg-purple-500/15 text-purple-400",
      "bg-orange-500/15 text-orange-400",
      "bg-pink-500/15 text-pink-400",
      "bg-cyan-500/15 text-cyan-400",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return colors[Math.abs(hash) % colors.length];
  };

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardContent className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">PC Notifications</span>
            {activeNotifs.length > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 min-w-[1rem] flex items-center justify-center">
                {activeNotifs.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsPolling((p) => !p)}
            >
              {isPolling ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3 text-muted-foreground" />}
            </Button>
            {activeNotifs.length > 0 && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearAll}>
                <Trash2 className="w-3 h-3 text-muted-foreground" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={fetchNotifications}
              disabled={isLoading}
            >
              <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Notification List */}
        {activeNotifs.length === 0 ? (
          <div className="py-6 text-center">
            <Monitor className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-[10px] text-muted-foreground">
              {isPolling ? "Listening for PC notifications..." : "Notification mirroring paused"}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[35vh]">
            <div className="space-y-1.5 pr-2">
              {activeNotifs.map((notif) => (
                <div
                  key={notif.id}
                  className="flex items-start gap-2.5 p-2.5 rounded-lg bg-secondary/20 hover:bg-secondary/30 transition-colors group"
                >
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5", getAppColor(notif.app_name))}>
                    <Bell className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-primary truncate">{notif.app_name}</span>
                      <span className="text-[9px] text-muted-foreground shrink-0">{formatTime(notif.timestamp)}</span>
                    </div>
                    {notif.title && <p className="text-xs font-medium leading-tight mt-0.5 line-clamp-1">{notif.title}</p>}
                    {notif.body && <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{notif.body}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => dismissNotification(notif)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
