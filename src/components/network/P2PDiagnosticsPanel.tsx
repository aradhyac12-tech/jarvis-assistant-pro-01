import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ConnectionMode } from "@/hooks/useP2PCommand";
import type { NetworkState } from "@/hooks/useNetworkMonitor";
import type { LocalP2PState } from "@/hooks/useLocalP2P";

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
            detail: "Discovery did not find an agent responding on port 9876.",
            hint: "Confirm the agent is running, port 9876 is allowed in Windows Firewall, and both devices are on the same Wi‑Fi network.",
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
        detail: "The app will fall back to cloud mode if Local P2P can’t connect.",
        hint: "Use the findings above to fix discovery/handshake issues.",
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

  const handleAutoFix = async () => {
    setAutoFixing(true);
    setAutoFixLog([]);
    const log = (msg: string) => setAutoFixLog((prev) => [...prev, msg]);

    try {
      if (!networkState.sameNetwork) {
        log("⚠️ Devices not on same network - connect both to the same Wi-Fi");
      } else if (!localP2PState.pcIp) {
        log("🔍 Re-scanning LAN for agent...");
        onAutoFix?.();
        await new Promise((r) => setTimeout(r, 3000));
        log(localP2PState.isConnected ? "✅ Agent found!" : "❌ Agent not found. Check port 9876 in firewall.");
      } else if (!localP2PState.isConnected) {
        log("🔄 Retrying connection to " + localP2PState.pcIp + "...");
        onAutoFix?.();
        await new Promise((r) => setTimeout(r, 2000));
        log(localP2PState.isConnected ? "✅ Connected!" : "❌ Still failing. Check firewall or try APK.");
      } else {
        log("✅ P2P connection is healthy.");
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
    <Card className={cn("border-border/50 bg-card/40", className)}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Local P2P Diagnostics</p>
              <Badge variant={summaryBadge.variant} className="text-[10px]">
                {summaryBadge.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              Phone: {networkState.phone?.localIp || "—"} • PC: {networkState.pc?.localIp || localP2PState.pcIp || "—"} • Port: {localP2PState.port}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={handleAutoFix} disabled={autoFixing}>
              {autoFixing ? "Fixing..." : "Auto-Fix"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              Copy
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setExpanded((v) => !v)}>
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

            {autoFixLog.length > 0 && (
              <div className="rounded-md border border-border/50 bg-muted/20 p-2 space-y-1">
                <p className="text-[10px] font-medium">Auto-Fix Log</p>
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
