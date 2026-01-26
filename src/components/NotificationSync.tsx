import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  BellOff,
  Smartphone,
  Monitor,
  Trash2,
  Phone,
  MessageSquare,
  Mail,
  Calendar,
  Settings,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useToast } from "@/hooks/use-toast";

interface Notification {
  id: string;
  app: string;
  title: string;
  body: string;
  time: Date;
  icon?: string;
  category: "message" | "call" | "email" | "calendar" | "system" | "other";
}

const categoryIcons: Record<string, React.ElementType> = {
  message: MessageSquare,
  call: Phone,
  email: Mail,
  calendar: Calendar,
  system: Settings,
  other: Bell,
};

export function NotificationSync({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();
  
  const [isEnabled, setIsEnabled] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [blockedApps, setBlockedApps] = useState<string[]>([]);
  const [showOnlyUnread, setShowOnlyUnread] = useState(true);

  // Start/stop notification sync
  const toggleSync = useCallback(async () => {
    if (!isEnabled) {
      // Request notification permission on mobile
      if ("Notification" in window && Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast({
            title: "Permission Denied",
            description: "Enable notifications in browser settings",
            variant: "destructive",
          });
          return;
        }
      }

      const result = await sendCommand("start_notification_sync", {}, { awaitResult: true, timeoutMs: 10000 });
      if (result?.success) {
        setIsEnabled(true);
        toast({ title: "Notification Sync Enabled" });
      }
    } else {
      await sendCommand("stop_notification_sync", {});
      setIsEnabled(false);
      toast({ title: "Notification Sync Disabled" });
    }
  }, [isEnabled, sendCommand, toast]);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
    toast({ title: "Notifications Cleared" });
  }, [toast]);

  // Dismiss single notification
  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Block app notifications
  const toggleBlockApp = useCallback((app: string) => {
    setBlockedApps(prev => 
      prev.includes(app) 
        ? prev.filter(a => a !== app)
        : [...prev, app]
    );
  }, []);

  // Format time
  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  // Demo notifications for preview
  useEffect(() => {
    if (!isEnabled) return;
    
    // Simulate receiving notifications
    const demoNotifications: Notification[] = [
      {
        id: "1",
        app: "Messages",
        title: "John Doe",
        body: "Hey, are you coming to the meeting?",
        time: new Date(Date.now() - 120000),
        category: "message",
      },
      {
        id: "2",
        app: "Gmail",
        title: "New email from Team",
        body: "Weekly report is ready for review",
        time: new Date(Date.now() - 3600000),
        category: "email",
      },
    ];
    
    setNotifications(demoNotifications);
  }, [isEnabled]);

  const filteredNotifications = notifications.filter(n => 
    !blockedApps.includes(n.app)
  );

  const uniqueApps = [...new Set(notifications.map(n => n.app))];

  return (
    <Card className={cn("border-border/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Notification Sync
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={toggleSync}
          />
        </CardTitle>
        <CardDescription>
          Mirror phone notifications to your PC as Windows toast
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isEnabled ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <BellOff className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground mb-4">
              Enable to sync notifications from your phone to PC
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
          </div>
        ) : (
          <>
            {/* Filter controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="unread" className="text-xs">Show unread only</Label>
                <Switch
                  id="unread"
                  checked={showOnlyUnread}
                  onCheckedChange={setShowOnlyUnread}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={notifications.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>

            {/* Blocked apps */}
            {uniqueApps.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {uniqueApps.map(app => (
                  <Badge
                    key={app}
                    variant={blockedApps.includes(app) ? "outline" : "secondary"}
                    className={cn(
                      "cursor-pointer",
                      blockedApps.includes(app) && "opacity-50"
                    )}
                    onClick={() => toggleBlockApp(app)}
                  >
                    {app}
                    {blockedApps.includes(app) && " (blocked)"}
                  </Badge>
                ))}
              </div>
            )}

            {/* Notification list */}
            <ScrollArea className="h-64">
              {filteredNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Bell className="h-8 w-8 mb-2" />
                  <p className="text-sm">No notifications</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredNotifications.map((notif) => {
                    const Icon = categoryIcons[notif.category] || Bell;
                    return (
                      <div
                        key={notif.id}
                        className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 border border-border/50 group"
                      >
                        <div className="p-2 rounded-lg bg-primary/10">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm truncate">{notif.title}</p>
                            <span className="text-xs text-muted-foreground">{formatTime(notif.time)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{notif.body}</p>
                          <Badge variant="outline" className="text-[10px] mt-1">
                            {notif.app}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => dismissNotification(notif.id)}
                        >
                          <XCircle className="h-4 w-4" />
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
