import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  BellOff,
  Phone,
  MessageSquare,
  Mail,
  Calendar,
  X,
  Smartphone,
  ArrowRight,
  Monitor,
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
  category: "message" | "call" | "email" | "calendar" | "other";
  read?: boolean;
}

const categoryConfig = {
  message: { icon: MessageSquare, color: "text-blue-500" },
  call: { icon: Phone, color: "text-green-500" },
  email: { icon: Mail, color: "text-orange-500" },
  calendar: { icon: Calendar, color: "text-purple-500" },
  other: { icon: Bell, color: "text-muted-foreground" },
};

export function NotificationSyncMinimal({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  const [isEnabled, setIsEnabled] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const toggleSync = useCallback(async () => {
    if (!isEnabled) {
      if ("Notification" in window && Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast({
            title: "Permission Required",
            description: "Enable notifications in browser settings",
            variant: "destructive",
          });
          return;
        }
      }

      const result = await sendCommand("start_notification_sync", {}, { 
        awaitResult: true, 
        timeoutMs: 10000 
      });
      
      if (result?.success) {
        setIsEnabled(true);
        toast({ title: "Notification Sync Active" });
      }
    } else {
      await sendCommand("stop_notification_sync", {});
      setIsEnabled(false);
      toast({ title: "Sync Disabled" });
    }
  }, [isEnabled, sendCommand, toast]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);

    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  // Demo notifications
  useEffect(() => {
    if (!isEnabled) return;

    const demoNotifications: Notification[] = [
      {
        id: "1",
        app: "Messages",
        title: "Sarah",
        body: "Are you free for lunch?",
        time: new Date(Date.now() - 60000),
        category: "message",
      },
      {
        id: "2",
        app: "Gmail",
        title: "Weekly Report",
        body: "Your weekly summary is ready",
        time: new Date(Date.now() - 1800000),
        category: "email",
      },
      {
        id: "3",
        app: "Calendar",
        title: "Team Standup",
        body: "In 15 minutes",
        time: new Date(Date.now() - 300000),
        category: "calendar",
      },
    ];

    setNotifications(demoNotifications);
  }, [isEnabled]);

  const unreadCount = notifications.length;

  return (
    <Card className={cn("border-border/50 overflow-hidden", className)}>
      <CardHeader className="pb-2 space-y-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className={cn(
              "p-1.5 rounded-lg relative",
              isEnabled ? "bg-primary/10" : "bg-muted"
            )}>
              <Bell className={cn(
                "h-4 w-4",
                isEnabled ? "text-primary" : "text-muted-foreground"
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
            checked={isEnabled}
            onCheckedChange={toggleSync}
          />
        </div>
        
        {!isEnabled && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
            <Smartphone className="h-3 w-3" />
            <ArrowRight className="h-3 w-3" />
            <Monitor className="h-3 w-3" />
            <span>Mirror phone notifications</span>
          </div>
        )}
      </CardHeader>
      
      <CardContent className="p-0">
        {!isEnabled ? (
          <div className="px-4 pb-4 pt-2">
            <div className="p-4 rounded-xl bg-muted/50 flex flex-col items-center text-center">
              <BellOff className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">
                Enable to receive phone notifications on your PC
              </p>
            </div>
          </div>
        ) : (
          <>
            {notifications.length > 0 && (
              <div className="px-4 py-2 flex justify-end">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 text-xs"
                  onClick={clearAll}
                >
                  Clear All
                </Button>
              </div>
            )}
            
            <ScrollArea className="h-52">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Bell className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-xs">No notifications</p>
                </div>
              ) : (
                <div className="px-3 pb-3 space-y-2">
                  {notifications.map((notif) => {
                    const config = categoryConfig[notif.category];
                    const Icon = config.icon;
                    
                    return (
                      <div
                        key={notif.id}
                        className="group flex items-start gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors relative"
                      >
                        <div className={cn(
                          "p-2 rounded-lg bg-background/80 shrink-0",
                          config.color
                        )}>
                          <Icon className="h-4 w-4" />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium text-sm truncate">
                              {notif.title}
                            </p>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatTime(notif.time)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {notif.body}
                          </p>
                          <Badge 
                            variant="outline" 
                            className="text-[9px] px-1.5 py-0 mt-1.5 font-normal"
                          >
                            {notif.app}
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
