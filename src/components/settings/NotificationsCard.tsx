import { Bell, Smartphone, ArrowRight, Monitor, Copy, FileUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
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
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center gap-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className="w-8 h-8 rounded-xl bg-accent-orange/10 flex items-center justify-center">
            <Bell className="h-4 w-4 text-[hsl(var(--accent-orange))]" />
          </div>
          Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 space-y-4">
        {/* Notification Sync */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Notification Sync</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
              <Smartphone className="w-3 h-3" />
              <ArrowRight className="w-2.5 h-2.5" />
              <Monitor className="w-3 h-3" />
              <span>{notifEnabled ? "Mirroring active" : "Disabled"}</span>
            </div>
          </div>
          <Switch checked={notifEnabled} onCheckedChange={(v) => {
            onNotifChange(v);
            sendCommand(v ? "start_notification_sync" : "stop_notification_sync", {});
            toast({ title: v ? "Sync Active" : "Sync Disabled" });
          }} />
        </div>

        {notifEnabled && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5 rounded-xl flex-1" onClick={() => {
              sendCommand("get_clipboard", {}, { awaitResult: true, timeoutMs: 3000 }).then(r => {
                if (r.success && 'result' in r) {
                  const content = (r.result as any)?.content;
                  if (content) {
                    navigator.clipboard.writeText(content);
                    toast({ title: "Clipboard synced" });
                  }
                }
              });
            }}>
              <Copy className="w-3 h-3" /> Clipboard
            </Button>
            <Link to="/files" className="flex-1">
              <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5 rounded-xl w-full">
                <FileUp className="w-3 h-3" /> Files
              </Button>
            </Link>
          </div>
        )}

        <div className="border-t border-border/10 pt-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Push Notifications</p>
            <p className="text-xs text-muted-foreground">Alerts from your PC</p>
          </div>
          <Switch checked={pushEnabled} onCheckedChange={onPushChange} />
        </div>
      </CardContent>
    </Card>
  );
}
