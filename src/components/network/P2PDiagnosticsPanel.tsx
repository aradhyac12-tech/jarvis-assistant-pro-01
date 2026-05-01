import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ConnectionMode } from "@/hooks/useP2PCommand";
import type { NetworkState } from "@/hooks/useNetworkMonitor";
import type { LocalP2PState } from "@/hooks/useLocalP2P";
import { supabase } from "@/integrations/supabase/client";

type Severity = "info" | "warn" | "error";

type Finding = {
  severity: Severity;
  title: string;
  detail?: string;
  hint?: string;
};

function getEnvironmentInfo() {
  const w = window as any;
  const isNative = !!(w?.Capacitor?.isNativePlatform?.() ?? w?.Capacitor);
  const isSecure = window.location.protocol === "https:";
  return { isNative, isSecure };
}

export function P2PDiagnosticsPanel({
  connectionMode,
  networkState,
  localP2PState,
  onAutoFix,
  className,
}: {
  connectionMode: ConnectionMode;
  networkState: NetworkState;
  localP2PState: LocalP2PState;
  onAutoFix?: () => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);
  const [autoFixLog, setAutoFixLog] = useState<string[]>([]);
  const { isNative, isSecure } = getEnvironmentInfo();

  const findings = useMemo((): Finding[] => {
    const phonePrefix = networkState.phone?.networkPrefix || "";
    const pcPrefix = networkState.pc?.networkPrefix || "";
    const sameNetwork = !!networkState.sameNetwork;

    const f: Finding[] = [];

    // Environment
    if (isSecure && !isNative) {
      f.push({
        severity: "warn",
        title: "Mobile browser may block Local P2P",
        detail: "Local P2P uses ws:// to your LAN IP. Many browsers block ws:// when the app is opened over https://.",
        hint: "Use the Capacitor APK for Local P2P, or run the app from a non-HTTPS origin on the LAN.",
      });
    } else {
      f.push({
        severity: "info",
        title: isNative ? "Native runtime detected" : "Browser runtime detected",
        detail: isNative ? "Native runtimes usually allow ws:// to LAN." : "Browser security rules apply.",
      });
    }

    // Network
    if (!phonePrefix) {
      f.push({
        severity: "warn",
        title: "Phone network prefix not detected",
        detail: "Without the phone LAN prefix, discovery can be slower or fail.",
        hint: "Toggle Wi‑Fi off/on, or reopen the app so it can re-detect the LAN IP.",
      });
    }

    if (!pcPrefix && !networkState.pc?.localIp) {
      f.push({
        severity: "info",
        title: "PC network info not detected yet",
        detail: "The app will still attempt LAN discovery using the phone prefix.",
      });
    }

    // Local P2P status
    if (sameNetwork) {
      if (!localP2PState.isConnected) {
        if (!localP2PState.pcIp) {
          f.push({
            severity: "error",
            title: "Agent not found on LAN",
            detail: "Discovery did not find an agent responding on port 9876 or 9877.",
            hint: "Click 'Fix Firewall' below to remotely open the ports on your PC, then retry.",
          });
        } else {
          f.push({
            severity: "warn",
            title: "Agent found, but not connected",
            detail: `Found PC IP ${localP2PState.pcIp}, but WebSocket handshake did not stay connected.`,
            hint: "This is commonly firewall/AV blocking, or ws:// blocked in the browser.",
          });
        }
      } else {
        f.push({
          severity: "info",
          title: "Local P2P connected",
          detail: `Latency: ${localP2PState.latency}ms`,
        });
      }
    } else {
      f.push({
        severity: "info",
        title: "Not on the same network",
        detail: "Local P2P only works when phone + PC share the same LAN prefix.",
        hint: "Connect both to the same Wi‑Fi (avoid VPN/hotspot isolation), then retry.",
      });
    }

    // Mode
    if (sameNetwork && connectionMode !== "local_p2p") {
      f.push({
        severity: "warn",
        title: "Same network, but not using Local P2P",
        detail: "The app will fall back to cloud mode if Local P2P can't connect.",
        hint: "Use 'Fix Firewall' then 'Retry P2P' to establish direct connection.",
      });
    }

    return f;
  }, [connectionMode, isNative, isSecure, localP2PState.isConnected, localP2PState.latency, localP2PState.pcIp, networkState.pc?.localIp, networkState.pc?.networkPrefix, networkState.phone?.networkPrefix, networkState.sameNetwork]);

  const summary = useMemo(() => {
    const worst = findings.some((x) => x.severity === "error")
      ? "error"
      : findings.some((x) => x.severity === "warn")
        ? "warn"
        : "info";
    return worst;
  }, [findings]);

  const summaryBadge =
    summary === "error"
      ? { variant: "destructive" as const, label: "Action needed" }
      : summary === "warn"
        ? { variant: "secondary" as const, label: "Needs attention" }
        : { variant: "outline" as const, label: "OK" };

  /** Send a command via cloud relay to the agent */
  const sendCloudCommand = async (commandType: string) => {
    const sessionToken = localStorage.getItem("jarvis_session_token") || "";
    const res = await supabase.functions.invoke("device-commands", {
      body: { action: "insert", commandType, payload: {} },
      headers: { "x-session-token": sessionToken },
    });
    if (res.error) throw new Error(res.error.message);
    const commandId = res.data?.commandId;
    if (!commandId) throw new Error("No command ID returned");

    // Poll for result
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await supabase.functions.invoke("device-commands", {
        body: { action: "poll", commandId },
        headers: { "x-session-token": sessionToken },
      });
      if (poll.data?.status === "completed") return poll.data.result;
    }
    throw new Error("Command timed out");
  };

  const handleFixFirewall = async () => {
    setAutoFixing(true);
    const log = (msg: string) => setAutoFixLog((prev) => [...prev, msg]);
    setAutoFixLog([]);

    try {
      log("🔧 Sending firewall fix command to PC via cloud...");
      // Use open_p2p_ports command (matches agent handler)
      const result = await sendCloudCommand("open_p2p_ports");
      const resultData = result?.result ?? result;
      if (resultData?.results && Array.isArray(resultData.results)) {
        for (const r of resultData.results) {
          log(`  ${r}`);
        }
      } else if (resultData?.success) {
        log("  ✅ Firewall rules applied");
      }
      if (resultData?.hint) log(`💡 ${resultData.hint}`);
      log("🔄 Retrying P2P connection in 2s...");
      await new Promise((r) => setTimeout(r, 2000));
      onAutoFix?.();
      await new Promise((r) => setTimeout(r, 4000));
      log(localP2PState.isConnected ? "✅ P2P connected!" : "⏳ Still connecting — try 'Retry P2P' button.");
    } catch (e: any) {
      log(`❌ ${e.message || "Failed to send command"}`);
      log("💡 Make sure agent is running. If fix fails, run agent as Administrator and click 'Fix Firewall' again.");
    }
    setAutoFixing(false);
  };

  const handleTestP2P = async () => {
    setAutoFixing(true);
    const log = (msg: string) => setAutoFixLog((prev) => [...prev, msg]);
    setAutoFixLog([]);

    try {
      log("🔍 Testing P2P server status on PC...");
      const result = await sendCloudCommand("test_p2p_server");
      log(`P2P Server: ${result?.p2p_running ? "✅ Running" : "❌ Not running"}`);
      log(`WS Port ${result?.ws_port}: ${result?.port_status?.[result?.ws_port] || "unknown"}`);
      log(`HTTP Port ${result?.http_port}: ${result?.port_status?.[result?.http_port] || "unknown"}`);
      if (result?.firewall_rules) {
        for (const [port, status] of Object.entries(result.firewall_rules)) {
          log(`Firewall rule for ${port}: ${status === "exists" ? "✅" : "❌ Missing"}`);
        }
      }
      log(`Local IPs: ${result?.local_ips?.join(", ") || "none"}`);
    } catch (e: any) {
      log(`❌ ${e.message || "Failed"}`);
    }
    setAutoFixing(false);
  };

  const handleAutoFix = async () => {
    setAutoFixing(true);
    setAutoFixLog([]);
    const log = (msg: string) => setAutoFixLog((prev) => [...prev, msg]);

    try {
      if (!networkState.sameNetwork) {
        log("⚠️ Devices not on same network - connect both to the same Wi-Fi");
      } else {
        log("🔄 Retrying P2P discovery...");
        onAutoFix?.();
        await new Promise((r) => setTimeout(r, 4000));
        log(localP2PState.isConnected ? "✅ P2P connected!" : "❌ Still can't connect. Try 'Fix Firewall' first.");
      }
    } catch {
      log("❌ Auto-fix encountered an error");
    }
    setAutoFixing(false);
  };

  const handleCopy = async () => {
    const payload = {
      env: { isNative, isSecure, origin: window.location.origin },
      networkState,
      localP2PState,
      connectionMode,
      findings,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // ignore
    }
  };

  return (
    <Card className={cn("border-border/50 bg-card/40 max-w-full overflow-hidden", className)}>
      <CardContent className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">Local P2P Diagnostics</p>
              <Badge variant={summaryBadge.variant} className="text-[10px]">
                {summaryBadge.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              Phone: {networkState.phone?.localIp || "—"} • PC: {networkState.pc?.localIp || localP2PState.pcIp || "—"} • Port: {localP2PState.port}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <Button variant="secondary" size="sm" className="h-7 text-xs px-2" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Hide" : "Details"}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 space-y-2">
            {findings.map((x, idx) => (
              <div
                key={idx}
                className={cn(
                  "rounded-md border border-border/50 p-2",
                  x.severity === "error" && "bg-destructive/10",
                  x.severity === "warn" && "bg-muted/50",
                  x.severity === "info" && "bg-muted/30"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{x.title}</p>
                  <Badge
                    variant={x.severity === "error" ? "destructive" : x.severity === "warn" ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    {x.severity.toUpperCase()}
                  </Badge>
                </div>
                {x.detail && <p className="mt-1 text-[11px] text-muted-foreground">{x.detail}</p>}
                {x.hint && <p className="mt-1 text-[11px]">Hint: <span className="text-muted-foreground">{x.hint}</span></p>}
              </div>
            ))}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button variant="default" size="sm" className="h-7 text-xs px-3" onClick={handleFixFirewall} disabled={autoFixing}>
                🔧 Fix Firewall
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs px-3" onClick={handleAutoFix} disabled={autoFixing}>
                🔄 Retry P2P
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs px-3" onClick={handleTestP2P} disabled={autoFixing}>
                🔍 Test P2P
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={handleCopy}>
                📋 Copy
              </Button>
            </div>

            {autoFixLog.length > 0 && (
              <div className="rounded-md border border-border/50 bg-muted/20 p-2 space-y-1">
                <p className="text-[10px] font-medium">Log</p>
                {autoFixLog.map((msg, i) => (
                  <p key={i} className="text-[11px] text-muted-foreground">{msg}</p>
                ))}
              </div>
            )}

            <div className="pt-1">
              <p className="text-[11px] text-muted-foreground">
                Last probe: {localP2PState.lastCheckTime ? new Date(localP2PState.lastCheckTime).toLocaleTimeString() : "—"}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
