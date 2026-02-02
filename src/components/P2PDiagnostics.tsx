import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  Stethoscope,
  Wifi,
  Zap,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectionMode } from "@/hooks/useP2PCommand";
import { NetworkState } from "@/hooks/useNetworkMonitor";
import { LocalP2PState } from "@/hooks/useLocalP2P";

interface DiagStep {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error" | "warning";
  message?: string;
  fix?: string;
}

interface P2PDiagnosticsProps {
  connectionMode: ConnectionMode;
  networkState: NetworkState;
  localP2PState: LocalP2PState;
  onForceLocalP2P: () => void;
  className?: string;
}

export function P2PDiagnostics({
  connectionMode,
  networkState,
  localP2PState,
  onForceLocalP2P,
  className,
}: P2PDiagnosticsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<DiagStep[]>([]);

  const updateStep = useCallback((id: string, update: Partial<DiagStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...update } : s)));
  }, []);

  const runDiagnostics = useCallback(async () => {
    const diagSteps: DiagStep[] = [
      { id: "phone_ip", name: "Phone IP Detection", status: "pending" },
      { id: "pc_ip", name: "PC IP Detection", status: "pending" },
      { id: "same_net", name: "Same Network Check", status: "pending" },
      { id: "https_block", name: "HTTPS Mixed Content", status: "pending" },
      { id: "p2p_probe", name: "P2P Port Probe", status: "pending" },
    ];
    setSteps(diagSteps);
    setIsRunning(true);

    // Step 1: Phone IP
    updateStep("phone_ip", { status: "running" });
    await new Promise((r) => setTimeout(r, 300));
    const phoneIp = networkState.phone?.localIp;
    if (phoneIp) {
      updateStep("phone_ip", { status: "success", message: phoneIp });
    } else {
      updateStep("phone_ip", {
        status: "error",
        message: "Not detected",
        fix: "Ensure WiFi is connected and WebRTC is not blocked",
      });
    }

    // Step 2: PC IP
    updateStep("pc_ip", { status: "running" });
    await new Promise((r) => setTimeout(r, 300));
    const pcIp = networkState.pc?.localIp || localP2PState.pcIp;
    if (pcIp) {
      updateStep("pc_ip", { status: "success", message: pcIp });
    } else {
      updateStep("pc_ip", {
        status: "warning",
        message: "Not received yet",
        fix: "Ensure PC agent is running and connected",
      });
    }

    // Step 3: Same network
    updateStep("same_net", { status: "running" });
    await new Promise((r) => setTimeout(r, 200));
    const phonePrefix = networkState.phone?.networkPrefix || "";
    const pcPrefix = networkState.pc?.networkPrefix || "";
    if (phonePrefix && pcPrefix && phonePrefix === pcPrefix) {
      updateStep("same_net", { status: "success", message: `${phonePrefix}.*` });
    } else if (phonePrefix && pcPrefix) {
      updateStep("same_net", {
        status: "error",
        message: `${phonePrefix}.* ≠ ${pcPrefix}.*`,
        fix: "Connect phone and PC to the same WiFi network",
      });
    } else {
      updateStep("same_net", {
        status: "warning",
        message: "Cannot compare",
        fix: "Waiting for IP detection",
      });
    }

    // Step 4: HTTPS mixed content
    updateStep("https_block", { status: "running" });
    await new Promise((r) => setTimeout(r, 200));
    const isHttps = window.location.protocol === "https:";
    if (isHttps) {
      updateStep("https_block", {
        status: "warning",
        message: "HTTPS blocks ws://",
        fix: "Local WebSocket (ws://) is blocked on HTTPS sites. Using WebRTC P2P instead.",
      });
    } else {
      updateStep("https_block", { status: "success", message: "HTTP - no block" });
    }

    // Step 5: P2P port probe
    updateStep("p2p_probe", { status: "running" });
    if (localP2PState.isConnected) {
      updateStep("p2p_probe", {
        status: "success",
        message: `Connected (${localP2PState.latency}ms)`,
      });
    } else if (pcIp) {
      // Try to probe
      try {
        const ws = new WebSocket(`ws://${pcIp}:9876/p2p`);
        const result = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => {
            ws.close();
            resolve(false);
          }, 2000);
          ws.onopen = () => {
            clearTimeout(t);
            ws.close();
            resolve(true);
          };
          ws.onerror = () => {
            clearTimeout(t);
            resolve(false);
          };
        });
        if (result) {
          updateStep("p2p_probe", { status: "success", message: "Port 9876 reachable" });
        } else {
          updateStep("p2p_probe", {
            status: "error",
            message: "Port 9876 unreachable",
            fix: isHttps
              ? "HTTPS blocks local ws:// connections"
              : "Check firewall or PC agent status",
          });
        }
      } catch {
        updateStep("p2p_probe", {
          status: "error",
          message: "Probe failed",
          fix: "Browser blocked the connection attempt",
        });
      }
    } else {
      updateStep("p2p_probe", {
        status: "warning",
        message: "No PC IP to probe",
      });
    }

    setIsRunning(false);
  }, [networkState, localP2PState, updateStep]);

  const getStatusIcon = (status: DiagStep["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case "error":
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "warning":
        return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
      case "running":
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
      default:
        return <div className="h-3.5 w-3.5 rounded-full border border-muted" />;
    }
  };

  const getModeIcon = () => {
    switch (connectionMode) {
      case "local_p2p":
        return <Zap className="h-4 w-4 text-emerald-500" />;
      case "p2p":
        return <Zap className="h-4 w-4 text-green-500" />;
      case "websocket":
        return <Wifi className="h-4 w-4 text-blue-500" />;
      default:
        return <Globe className="h-4 w-4 text-yellow-500" />;
    }
  };

  const overallStatus =
    steps.length === 0
      ? "pending"
      : steps.every((s) => s.status === "success")
      ? "success"
      : steps.some((s) => s.status === "error")
      ? "error"
      : steps.some((s) => s.status === "warning")
      ? "warning"
      : "pending";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between h-9 px-3 bg-secondary/30 hover:bg-secondary/50"
        >
          <div className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            <span className="text-sm">P2P Diagnostics</span>
          </div>
          <div className="flex items-center gap-2">
            {getModeIcon()}
            {steps.length > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  "text-xs px-1.5 py-0",
                  overallStatus === "success" && "border-emerald-500 text-emerald-500",
                  overallStatus === "error" && "border-destructive text-destructive",
                  overallStatus === "warning" && "border-yellow-500 text-yellow-500"
                )}
              >
                {overallStatus === "success"
                  ? "OK"
                  : overallStatus === "error"
                  ? "Issues"
                  : overallStatus === "warning"
                  ? "Warnings"
                  : "..."}
              </Badge>
            )}
            <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <Card className="border-border/30 bg-secondary/10">
          <CardContent className="p-3 space-y-3">
            {/* Current Status */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-md bg-muted/30">
                <p className="text-muted-foreground">Phone</p>
                <p className="font-mono truncate">{networkState.phone?.localIp || "—"}</p>
              </div>
              <div className="p-2 rounded-md bg-muted/30">
                <p className="text-muted-foreground">PC</p>
                <p className="font-mono truncate">
                  {networkState.pc?.localIp || localP2PState.pcIp || "—"}
                </p>
              </div>
            </div>

            {/* Run button */}
            <div className="flex gap-2">
              <Button
                onClick={runDiagnostics}
                disabled={isRunning}
                size="sm"
                className="flex-1"
                variant={overallStatus === "success" ? "outline" : "default"}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Stethoscope className="h-4 w-4 mr-2" />
                    {steps.length === 0 ? "Run Diagnostics" : "Run Again"}
                  </>
                )}
              </Button>
              {connectionMode !== "local_p2p" && networkState.sameNetwork && (
                <Button onClick={onForceLocalP2P} size="sm" variant="outline">
                  <Zap className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Results */}
            {steps.length > 0 && (
              <div className="space-y-1.5">
                {steps.map((step) => (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-start gap-2 p-2 rounded-md text-xs",
                      step.status === "success" && "bg-emerald-500/5",
                      step.status === "error" && "bg-destructive/5",
                      step.status === "warning" && "bg-yellow-500/5",
                      step.status === "running" && "bg-primary/5"
                    )}
                  >
                    {getStatusIcon(step.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{step.name}</span>
                        {step.message && (
                          <span className="text-muted-foreground truncate ml-2">{step.message}</span>
                        )}
                      </div>
                      {step.fix && <p className="text-primary mt-0.5 text-[10px]">💡 {step.fix}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
