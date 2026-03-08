import { Bell, Smartphone, ArrowRight, Monitor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface NotificationsCardProps {
  notifEnabled: boolean;
  pushEnabled: boolean;
  onNotifChange: (v: boolean) => void;
  onPushChange: (v: boolean) => void;
}

export function NotificationsCard({ notifEnabled, pushEnabled, onNotifChange, onPushChange }: NotificationsCardProps) {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();

  return (
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center gap-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className="w-8 h-8 rounded-xl bg-accent-orange/10 flex items-center justify-center">
            <Bell className="h-4 w-4 text-[hsl(var(--accent-orange))]" />
          </div>
          Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 space-y-3">
        {/* Notification Sync */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 border border-border/5">
          <div>
            <p className="text-xs font-medium">Notification Sync</p>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
              <Smartphone className="w-3 h-3" />
              <ArrowRight className="w-2.5 h-2.5" />
              <Monitor className="w-3 h-3" />
              <span>{notifEnabled ? "Mirroring active" : "Off"}</span>
            </div>
          </div>
          <Switch checked={notifEnabled} onCheckedChange={(v) => {
            onNotifChange(v);
            sendCommand(v ? "start_notification_sync" : "stop_notification_sync", {});
            toast({ title: v ? "Sync Active" : "Sync Disabled" });
          }} />
        </div>

        {/* Push Notifications */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 border border-border/5">
          <div>
            <p className="text-xs font-medium">Push Notifications</p>
            <p className="text-[10px] text-muted-foreground">Alerts from your PC</p>
          </div>
          <Switch checked={pushEnabled} onCheckedChange={onPushChange} />
        </div>
      </CardContent>
    </Card>
  );
}
