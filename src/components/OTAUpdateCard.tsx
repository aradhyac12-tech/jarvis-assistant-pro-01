import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download, RefreshCw, CloudDownload, CheckCircle, XCircle,
  Smartphone, Monitor, RotateCcw, ShieldCheck, ArrowUpCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";

export function OTAUpdateCard() {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const autoUpdate = useAutoUpdate();

  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [agentVersion, setAgentVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [firewallOk, setFirewallOk] = useState<boolean | null>(null);
  const [autoRestart, setAutoRestart] = useState(true);
  const [verification, setVerification] = useState<any>(null);
  const [restarting, setRestarting] = useState(false);

  const isConnected = selectedDevice?.is_online || false;

  // ── PC Agent Update ──
  const checkAgentUpdate = useCallback(async () => {
    if (!isConnected) return;
    setChecking(true);
    try {
      const result = await sendCommand("check_update", {}, { awaitResult: true, timeoutMs: 10000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        setAgentVersion(r.current_version || null);
        setUpdateAvailable(r.update_available || false);
        setAvailableVersion(r.available_version || null);
        setFirewallOk(r.firewall_configured ?? null);
        setAutoRestart(r.auto_restart ?? true);
        if (r.last_verification) setVerification(r.last_verification);
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
    setApplying(true);
    try {
      const result = await sendCommand("apply_update", {}, { awaitResult: true, timeoutMs: 60000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        if (r.success) {
          setVerification(r.verification || null);
          setUpdateAvailable(false);
          if (r.auto_restart) {
            setRestarting(true);
            toast({
              title: "Update Applied & Verified!",
              description: `v${r.version} — Agent auto-restarting in 3s...`,
            });
            setTimeout(async () => {
              setRestarting(false);
              try {
                const check = await sendCommand("get_agent_version", {}, { awaitResult: true, timeoutMs: 15000 });
                if (check.success && "result" in check) {
                  setAgentVersion((check.result as any).version);
                }
              } catch {}
            }, 10000);
          } else {
            toast({
              title: r.verification?.verified ? "Update Applied & Verified!" : "Update Applied",
              description: `${r.files_applied}/${r.files_total} files updated`,
            });
          }
        } else {
          toast({ title: "Update Failed", description: r.reason || "Unknown error", variant: "destructive" });
        }
      }
    } catch {
      toast({ title: "Update Failed", variant: "destructive" });
    }
    setApplying(false);
  }, [isConnected, sendCommand, toast]);

  return (
    <Card className="border-border/30 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudDownload className="h-4 w-4 text-primary" />
          Over-the-Air Updates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* ── APK / Web Auto-Update ── */}
        <div className="p-3 rounded-lg bg-secondary/30 border border-border/30">
          <div className="flex items-center gap-2 mb-1">
            <Smartphone className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">Mobile App (APK)</p>
            <Badge variant="outline" className="ml-auto text-[10px] border-primary/30 bg-primary/5 text-primary">
              v{autoUpdate.currentVersion}
            </Badge>
          </div>

          {autoUpdate.updateAvailable ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 rounded bg-primary/10 border border-primary/20">
                <ArrowUpCircle className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-primary">
                    v{autoUpdate.updateAvailable.version} available
                    {autoUpdate.updateAvailable.forceUpdate && " (required)"}
                  </p>
                  {autoUpdate.updateAvailable.releaseNotes && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {autoUpdate.updateAvailable.releaseNotes}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs gap-1"
                  onClick={() => autoUpdate.applyUpdate()}
                >
                  <Download className="h-3 w-3" />
                  Update & Restart
                </Button>
                {!autoUpdate.updateAvailable.forceUpdate && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={autoUpdate.dismissUpdate}
                  >
                    Later
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground">
                Auto-checks every 5 min. The APK loads latest UI from cloud — updates are instant.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => autoUpdate.checkForUpdate(false)}
                  disabled={autoUpdate.checking}
                >
                  <RefreshCw className={`h-3 w-3 ${autoUpdate.checking ? "animate-spin" : ""}`} />
                  Check Now
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => {
                    toast({ title: "Reloading App..." });
                    setTimeout(() => window.location.reload(), 500);
                  }}
                >
                  <RotateCcw className="h-3 w-3" />
                  Force Reload
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── PC Agent Update ── */}
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

          {firewallOk !== null && (
            <div className="flex items-center gap-3 mb-2 text-[10px]">
              <span className="flex items-center gap-1">
                <ShieldCheck className={`h-3 w-3 ${firewallOk ? "text-green-500" : "text-destructive"}`} />
                Firewall: {firewallOk ? "Configured" : "Not Set"}
              </span>
              <span className="flex items-center gap-1">
                <RotateCcw className="h-3 w-3 text-primary" />
                Auto-restart: {autoRestart ? "On" : "Off"}
              </span>
            </div>
          )}

          {restarting ? (
            <div className="flex items-center gap-2 py-2">
              <RefreshCw className="h-4 w-4 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Agent restarting with new version...</p>
            </div>
          ) : !isConnected ? (
            <p className="text-[10px] text-muted-foreground">Connect to your PC to check for updates</p>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs gap-1"
                onClick={checkAgentUpdate}
                disabled={checking || applying}
              >
                <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
                Check Updates
              </Button>
              {updateAvailable && (
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs gap-1"
                  onClick={applyAgentUpdate}
                  disabled={applying}
                >
                  {applying ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Apply & Restart
                </Button>
              )}
            </div>
          )}

          {verification && (
            <div className={`mt-2 p-2 rounded border text-[10px] ${
              verification.verified
                ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}>
              <div className="flex items-center gap-1 font-medium mb-1">
                {verification.verified
                  ? <><CheckCircle className="h-3 w-3" /> Update Verified</>
                  : <><XCircle className="h-3 w-3" /> Verification Failed</>}
              </div>
              <p>
                {verification.files?.filter((f: any) => f.ok).length}/{verification.files?.length} files OK
                {verification.errors?.length > 0 && ` • Issues: ${verification.errors.join(", ")}`}
              </p>
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="p-2 rounded-lg bg-secondary/20 border border-border/30">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            <strong>Auto-update:</strong> Both APK and PC agent check for updates every 5 min.
            APK reloads from cloud instantly. PC agent downloads, verifies SHA-256 hashes, and auto-restarts.
            Force updates are applied immediately without user intervention.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
