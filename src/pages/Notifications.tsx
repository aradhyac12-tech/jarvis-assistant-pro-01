import { useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { KDENotificationPanel } from "@/components/KDENotificationPanel";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { Bell } from "lucide-react";

export default function Notifications() {
  const { selectedDevice } = useDeviceContext();
  const { sendCommand } = useDeviceCommands();
  const isConnected = selectedDevice?.is_online || false;

  const handleSendCommand = useCallback(
    (cmd: string, payload: Record<string, unknown>) => {
      sendCommand(cmd, payload);
    },
    [sendCommand]
  );

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Notifications</h1>
            <p className="text-xs text-muted-foreground">
              KDE Connect-style notification mirroring & quick actions
            </p>
          </div>
        </div>

        <KDENotificationPanel
          isConnected={isConnected}
          onSendCommand={handleSendCommand}
          className="min-h-[60vh]"
        />
      </div>
    </DashboardLayout>
  );
}
