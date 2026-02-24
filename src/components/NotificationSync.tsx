import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  BellOff,
  Smartphone,
  Monitor,
  Trash2,
  X,
  Shield,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotificationListener, getAppInfo } from "@/hooks/useNotificationListener";

export function NotificationSync({ className }: { className?: string }) {
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
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const activeNotifications = notifications.filter(n => !n.dismissed);

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Notification Sync
            {activeNotifications.length > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                {activeNotifications.length}
              </Badge>
            )}
          </div>
          <Switch
            checked={isListening}
            onCheckedChange={handleToggle}
            disabled={toggling}
          />
        </CardTitle>
        <CardDescription>
          {isNative
            ? "Intercepts all phone notifications via Android NotificationListenerService and mirrors them to your PC as Windows toast — like KDE Connect"
            : "Mirror phone notifications to your PC as Windows toast"
          }
        </CardDescription>
        {isListening && isNative && !permissionGranted && (
          <div className="flex items-center gap-2 text-xs text-amber-500 mt-2">
            <Shield className="h-3.5 w-3.5" />
            <span>Open Android Settings → Apps → Special Access → Notification Access and enable this app</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!isListening ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <BellOff className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground mb-4">
              {isNative
                ? "Enable to intercept all phone notifications in real-time"
                : "Enable to sync notifications from your phone to PC"
              }
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Smartphone className="h-4 w-4" />
                Phone
              </div>
              <span>→</span>
              <div className="flex items-center gap-1">
                <Monitor className="h-4 w-4" />
                PC
              </div>
            </div>
            {toggling && <Loader2 className="h-4 w-4 animate-spin mt-3 text-primary" />}
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {isNative ? "🟢 Live — Android NotificationListener" : "Synced via agent"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={activeNotifications.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>

            {/* Notification list */}
            <ScrollArea className="h-64">
              {activeNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Bell className="h-8 w-8 mb-2" />
                  <p className="text-sm">Waiting for notifications...</p>
                  <p className="text-[10px] mt-1 opacity-70">
                    They will appear here instantly when received
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeNotifications.map((notif) => {
                    const appInfo = getAppInfo(notif.packageName, notif.appName);
                    return (
                      <div
                        key={notif.id}
                        className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 border border-border/50 group"
                      >
                        {/* App icon */}
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-xl"
                          style={{ backgroundColor: `${appInfo.color}20` }}
                        >
                          {appInfo.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm truncate">
                              {notif.title || appInfo.name}
                            </p>
                            <span className="text-xs text-muted-foreground">
                              {formatTime(notif.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{notif.text}</p>
                          {notif.textLines.length > 1 && (
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                              +{notif.textLines.length - 1} more lines
                            </p>
                          )}
                          <Badge variant="outline" className="text-[10px] mt-1">
                            {appInfo.name}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => dismissNotification(notif.id)}
                        >
                          <X className="h-4 w-4" />
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
