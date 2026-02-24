import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  BellOff,
  Smartphone,
  ArrowRight,
  Monitor,
  X,
  Trash2,
  Shield,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotificationListener, getAppInfo } from "@/hooks/useNotificationListener";

export function NotificationSyncMinimal({ className }: { className?: string }) {
  const {
    notifications,
    isListening,
    isNative,
    permissionGranted,
    startListening,
    stopListening,
    dismissNotification,
    clearAll,
  } = useNotificationListener();

  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (isListening) {
        await stopListening();
      } else {
        await startListening();
      }
    } finally {
      setToggling(false);
    }
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const activeNotifications = notifications.filter(n => !n.dismissed);
  const unreadCount = activeNotifications.length;

  return (
    <Card className={cn("border-border/50 overflow-hidden", className)}>
      <CardHeader className="pb-2 space-y-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className={cn(
              "p-1.5 rounded-lg relative",
              isListening ? "bg-primary/10" : "bg-muted"
            )}>
              <Bell className={cn(
                "h-4 w-4",
                isListening ? "text-primary" : "text-muted-foreground"
              )} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </div>
            Notifications
          </CardTitle>

          <Switch
            checked={isListening}
            onCheckedChange={handleToggle}
            disabled={toggling}
          />
        </div>

        {!isListening && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
            <Smartphone className="h-3 w-3" />
            <ArrowRight className="h-3 w-3" />
            <Monitor className="h-3 w-3" />
            <span>Mirror phone notifications to PC</span>
          </div>
        )}

        {isListening && isNative && !permissionGranted && (
          <div className="flex items-center gap-2 text-xs text-amber-500 pt-2">
            <Shield className="h-3 w-3" />
            <span>Grant notification access in Android Settings</span>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {!isListening ? (
          <div className="px-4 pb-4 pt-2">
            <div className="p-4 rounded-xl bg-muted/50 flex flex-col items-center text-center">
              <BellOff className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">
                {isNative
                  ? "Enable to intercept all phone notifications and mirror them to your PC as Windows toast notifications — like KDE Connect"
                  : "Enable to sync notifications between phone and PC"
                }
              </p>
              {toggling && <Loader2 className="h-4 w-4 animate-spin mt-2 text-primary" />}
            </div>
          </div>
        ) : (
          <>
            {activeNotifications.length > 0 && (
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {isNative ? "Live from Android" : "Synced"} • {activeNotifications.length} notification{activeNotifications.length !== 1 ? "s" : ""}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={clearAll}
                >
                  <Trash2 className="h-3 w-3" />
                  Clear
                </Button>
              </div>
            )}

            <ScrollArea className="h-52">
              {activeNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Bell className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-xs">Waiting for notifications...</p>
                  <p className="text-[10px] mt-1 opacity-70">
                    {isNative
                      ? "Notifications will appear here instantly"
                      : "Send a test notification from your phone"
                    }
                  </p>
                </div>
              ) : (
                <div className="px-3 pb-3 space-y-2">
                  {activeNotifications.map((notif) => {
                    const appInfo = getAppInfo(notif.packageName, notif.appName);

                    return (
                      <div
                        key={notif.id}
                        className="group flex items-start gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors relative"
                      >
                        {/* App icon */}
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-lg"
                          style={{ backgroundColor: `${appInfo.color}20` }}
                        >
                          {appInfo.emoji}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-medium text-sm truncate">
                                {notif.title || appInfo.name}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatTime(notif.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {notif.text}
                          </p>
                          {notif.textLines.length > 1 && (
                            <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                              +{notif.textLines.length - 1} more lines
                            </p>
                          )}
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 mt-1.5 font-normal"
                          >
                            {appInfo.name}
                          </Badge>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 absolute top-2 right-2"
                          onClick={() => dismissNotification(notif.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}
