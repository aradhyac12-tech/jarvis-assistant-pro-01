import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Download, RefreshCw, CloudDownload, CheckCircle, Wifi, Smartphone, Monitor } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { supabase } from "@/integrations/supabase/client";

export function OTAUpdateCard() {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const [checking, setChecking] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState(0);
  const [agentVersion, setAgentVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  const isConnected = selectedDevice?.is_online || false;

  const checkAgentUpdate = useCallback(async () => {
    if (!isConnected) return;
    setChecking(true);
    try {
      const result = await sendCommand("check_update", {}, { awaitResult: true, timeoutMs: 10000 });
      if (result.success && 'result' in result) {
        const r = result.result as any;
        setAgentVersion(r.current_version || null);
        setUpdateAvailable(r.update_available || false);
        setAvailableVersion(r.available_version || null);
        toast({
          title: r.update_available ? "Update Available!" : "Agent Up to Date",
          description: r.update_available
            ? `v${r.current_version} → v${r.available_version}`
            : `Running v${r.current_version}`,
        });
      }
    } catch {
      toast({ title: "Check Failed", variant: "destructive" });
    }
    setChecking(false);
  }, [isConnected, sendCommand, toast]);

  const applyAgentUpdate = useCallback(async () => {
    if (!isConnected) return;
    setChecking(true);
    try {
      const result = await sendCommand("apply_update", {}, { awaitResult: true, timeoutMs: 60000 });
      if (result.success && 'result' in result) {
        const r = result.result as any;
        toast({
          title: r.success ? "Update Applied!" : "No Update",
          description: r.message || "Restart agent to activate",
        });
        if (r.success) {
          setUpdateAvailable(false);
        }
      }
    } catch {
      toast({ title: "Update Failed", variant: "destructive" });
    }
    setChecking(false);
  }, [isConnected, sendCommand, toast]);

  const pushAgentUpdate = useCallback(async () => {
    setPushing(true);
    setPushProgress(0);
    try {
      // Read agent files from the repo (these are baked into the build)
      // We'll upload the current python-agent files to storage
      const agentFiles = [
        "jarvis_agent.py",
        "jarvis_gui.py",
        "requirements.txt",
        "auto_updater.py",
        "skills/__init__.py",
        "skills/base.py",
        "skills/registry.py",
        "skills/app_launcher_skill.py",
        "skills/automation_skill.py",
        "skills/brightness_volume_skill.py",
        "skills/calendar_skill.py",
        "skills/file_search_skill.py",
        "skills/memory_skill.py",
        "skills/spotify_skill.py",
        "skills/system_control_skill.py",
        "skills/web_fetch_skill.py",
      ];

      // Fetch files via edge function that reads from storage
      // For now, prompt user to use the push mechanism
      const version = prompt("Enter version number for this update (e.g. 5.3.0):");
      if (!version) {
        setPushing(false);
        return;
      }

      toast({
        title: "Push Update",
        description: "To push agent updates, export to GitHub → git pull → run the push script. The agent will auto-download updates.",
      });
    } catch (err) {
      toast({ title: "Push Failed", variant: "destructive" });
    }
    setPushing(false);
    setPushProgress(0);
  }, [toast]);

  return (
    <Card className="border-border/30 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudDownload className="h-4 w-4 text-primary" />
          Over-the-Air Updates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* APK Auto-Update Status */}
        <div className="p-3 rounded-lg bg-secondary/30 border border-border/30">
          <div className="flex items-center gap-2 mb-1">
            <Smartphone className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">Mobile App (APK)</p>
            <Badge variant="outline" className="ml-auto text-[10px] border-primary/30 bg-primary/5 text-primary">
              Auto-Updating
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground">
            The APK loads the latest UI from the cloud automatically. No manual update needed — changes appear instantly.
          </p>
        </div>

        {/* PC Agent Update */}
        <div className="p-3 rounded-lg bg-secondary/30 border border-border/30">
          <div className="flex items-center gap-2 mb-2">
            <Monitor className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">PC Agent</p>
            {agentVersion && (
              <Badge variant="outline" className="text-[10px]">v{agentVersion}</Badge>
            )}
            {updateAvailable && (
              <Badge className="ml-auto text-[10px] bg-primary text-primary-foreground">
                v{availableVersion} available
              </Badge>
            )}
          </div>

          {!isConnected ? (
            <p className="text-[10px] text-muted-foreground">Connect to your PC to check for updates</p>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs gap-1"
                onClick={checkAgentUpdate}
                disabled={checking}
              >
                <RefreshCw className={`h-3 w-3 ${checking ? 'animate-spin' : ''}`} />
                Check Updates
              </Button>
              {updateAvailable && (
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs gap-1"
                  onClick={applyAgentUpdate}
                  disabled={checking}
                >
                  <Download className="h-3 w-3" />
                  Apply Update
                </Button>
              )}
            </div>
          )}

          {pushing && (
            <div className="mt-2">
              <Progress value={pushProgress} className="h-1.5" />
              <p className="text-[10px] text-muted-foreground mt-1">Uploading agent files...</p>
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="p-2 rounded-lg bg-secondary/20 border border-border/30">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            <strong>How it works:</strong> The PC agent checks for updates every 5 minutes automatically. 
            When you make changes here, push updates to the cloud → the agent downloads and applies them. 
            The mobile APK always loads the latest version from the live preview URL.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
