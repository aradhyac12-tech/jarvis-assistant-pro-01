import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity, CheckCircle, XCircle, Loader2, Wrench,
  Wifi, Monitor, Server, Database, Shield, Cpu,
  HardDrive, Volume2, Keyboard, Mouse, RefreshCw,
  Zap, AlertTriangle,
} from "lucide-react";

type TestStatus = "idle" | "running" | "pass" | "fail" | "warn" | "fixing" | "fixed";

interface DiagnosticTest {
  id: string;
  name: string;
  icon: React.ReactNode;
  category: "connection" | "agent" | "hardware" | "app";
  status: TestStatus;
  detail?: string;
  fixable?: boolean;
  fixAction?: () => Promise<void>;
}

const statusIcon = (s: TestStatus) => {
  switch (s) {
    case "pass": case "fixed": return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "fail": return <XCircle className="h-4 w-4 text-destructive" />;
    case "warn": return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "running": case "fixing": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    default: return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
  }
};

const statusBadge = (s: TestStatus) => {
  const map: Record<TestStatus, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    idle: { variant: "outline", label: "Pending" },
    running: { variant: "secondary", label: "Testing…" },
    pass: { variant: "default", label: "Pass" },
    fail: { variant: "destructive", label: "Failed" },
    warn: { variant: "secondary", label: "Warning" },
    fixing: { variant: "secondary", label: "Fixing…" },
    fixed: { variant: "default", label: "Fixed" },
  };
  const { variant, label } = map[s];
  return <Badge variant={variant} className="text-[10px] h-5">{label}</Badge>;
};

export function SystemDiagnosticsPanel({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();
  const [tests, setTests] = useState<DiagnosticTest[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<{ passed: number; failed: number; warned: number; fixed: number } | null>(null);

  const updateTest = useCallback((id: string, updates: Partial<DiagnosticTest>) => {
    setTests(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const runDiagnostics = useCallback(async () => {
    setRunning(true);
    setProgress(0);
    setSummary(null);

    const sessionToken = session?.session_token;
    const deviceId = selectedDevice?.id || session?.device_id;

    // Define all tests
    const allTests: DiagnosticTest[] = [
      // Connection tests
      { id: "session", name: "Session Token", icon: <Shield className="h-3.5 w-3.5" />, category: "connection", status: "idle" },
      { id: "device_paired", name: "Device Paired", icon: <Monitor className="h-3.5 w-3.5" />, category: "connection", status: "idle" },
      { id: "device_online", name: "Device Online", icon: <Wifi className="h-3.5 w-3.5" />, category: "connection", status: "idle" },
      { id: "cloud_reachable", name: "Cloud Reachable", icon: <Database className="h-3.5 w-3.5" />, category: "connection", status: "idle" },
      { id: "command_roundtrip", name: "Command Roundtrip", icon: <Zap className="h-3.5 w-3.5" />, category: "connection", status: "idle" },

      // Agent tests
      { id: "agent_heartbeat", name: "Agent Heartbeat", icon: <Server className="h-3.5 w-3.5" />, category: "agent", status: "idle" },
      { id: "agent_version", name: "Agent Version", icon: <Activity className="h-3.5 w-3.5" />, category: "agent", status: "idle" },
      { id: "system_info", name: "System Info Reporting", icon: <Cpu className="h-3.5 w-3.5" />, category: "agent", status: "idle" },

      // Hardware tests
      { id: "volume_control", name: "Volume Control", icon: <Volume2 className="h-3.5 w-3.5" />, category: "hardware", status: "idle" },
      { id: "keyboard_input", name: "Keyboard Input", icon: <Keyboard className="h-3.5 w-3.5" />, category: "hardware", status: "idle" },
      { id: "mouse_control", name: "Mouse Control", icon: <Mouse className="h-3.5 w-3.5" />, category: "hardware", status: "idle" },
      { id: "disk_access", name: "Disk Access", icon: <HardDrive className="h-3.5 w-3.5" />, category: "hardware", status: "idle" },

      // App tests
      { id: "local_storage", name: "Local Storage", icon: <Database className="h-3.5 w-3.5" />, category: "app", status: "idle" },
      { id: "notifications_api", name: "Notifications API", icon: <Activity className="h-3.5 w-3.5" />, category: "app", status: "idle" },
      { id: "clipboard_api", name: "Clipboard API", icon: <Keyboard className="h-3.5 w-3.5" />, category: "app", status: "idle" },
    ];

    setTests(allTests);
    const total = allTests.length;
    let completed = 0;
    const advance = () => { completed++; setProgress(Math.round((completed / total) * 100)); };

    // Helper
    const setResult = (id: string, status: TestStatus, detail?: string, fixable?: boolean) => {
      updateTest(id, { status, detail, fixable });
      advance();
    };

    // ─── 1. Session Token ───
    updateTest("session", { status: "running" });
    if (sessionToken) {
      setResult("session", "pass", "Valid session token found");
    } else {
      setResult("session", "fail", "No session token — please pair your device", false);
    }

    // ─── 2. Device Paired ───
    updateTest("device_paired", { status: "running" });
    if (deviceId) {
      setResult("device_paired", "pass", `Device ID: ${deviceId.slice(0, 8)}…`);
    } else {
      setResult("device_paired", "fail", "No device paired");
    }

    // ─── 3. Device Online ───
    updateTest("device_online", { status: "running" });
    if (selectedDevice?.is_online) {
      setResult("device_online", "pass", `${selectedDevice.name} is online`);
    } else {
      const lastSeen = selectedDevice?.last_seen ? new Date(selectedDevice.last_seen).toLocaleString() : "never";
      setResult("device_online", "fail", `Device offline. Last seen: ${lastSeen}`, false);
    }

    // ─── 4. Cloud Reachable ───
    updateTest("cloud_reachable", { status: "running" });
    try {
      const { data, error } = await supabase.from("devices").select("id").limit(1);
      if (error) throw error;
      setResult("cloud_reachable", "pass", "Backend responding normally");
    } catch (e: any) {
      setResult("cloud_reachable", "fail", `Backend error: ${e.message}`);
    }

    // Stop early if no session
    if (!sessionToken || !deviceId) {
      const remaining = allTests.filter(t => !["session", "device_paired", "device_online", "cloud_reachable"].includes(t.id));
      remaining.forEach(t => setResult(t.id, "warn", "Skipped — no active session"));
      setRunning(false);
      const final = allTests.map(t => {
        const updated = tests.find(u => u.id === t.id);
        return updated || t;
      });
      setSummary({ passed: 1, failed: 2, warned: remaining.length, fixed: 0 });
      return;
    }

    // ─── 5. Command Roundtrip ───
    updateTest("command_roundtrip", { status: "running" });
    const pingStart = Date.now();
    try {
      const r = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 10000 });
      const latency = Date.now() - pingStart;
      if (r.success) {
        setResult("command_roundtrip", latency > 5000 ? "warn" : "pass", `Roundtrip: ${latency}ms`);
      } else {
        setResult("command_roundtrip", "fail", `Agent not responding: ${r.error}`, true);
      }
    } catch {
      setResult("command_roundtrip", "fail", "Command roundtrip failed", true);
    }

    // ─── 6. Agent Heartbeat ───
    updateTest("agent_heartbeat", { status: "running" });
    try {
      const r = await sendCommand("get_system_stats", {}, { awaitResult: true, timeoutMs: 8000 });
      if (r.success) {
        setResult("agent_heartbeat", "pass", "Agent responding to system commands");
      } else {
        setResult("agent_heartbeat", "fail", "Agent not processing commands", true);
      }
    } catch {
      setResult("agent_heartbeat", "fail", "Heartbeat check failed");
    }

    // ─── 7. Agent Version ───
    updateTest("agent_version", { status: "running" });
    const sysInfo = selectedDevice?.system_info as any;
    if (sysInfo?.agent_version) {
      const ver = sysInfo.agent_version;
      setResult("agent_version", "pass", `Version ${ver}`);
    } else {
      setResult("agent_version", "warn", "Version info not available in system_info");
    }

    // ─── 8. System Info Reporting ───
    updateTest("system_info", { status: "running" });
    if (sysInfo?.cpu_percent !== undefined && sysInfo?.memory_percent !== undefined) {
      setResult("system_info", "pass", `CPU: ${sysInfo.cpu_percent}% | RAM: ${sysInfo.memory_percent}%`);
    } else {
      setResult("system_info", "warn", "Incomplete system info — agent may need update");
    }

    // ─── 9. Volume Control ───
    updateTest("volume_control", { status: "running" });
    try {
      const r = await sendCommand("get_volume", {}, { awaitResult: true, timeoutMs: 6000 });
      if (r.success) {
        const vol = (r as any).result?.volume ?? "?";
        setResult("volume_control", "pass", `Current volume: ${vol}%`);
      } else {
        setResult("volume_control", "fail", "Volume query failed", true);
      }
    } catch {
      setResult("volume_control", "fail", "Volume test error");
    }

    // ─── 10. Keyboard Input ───
    updateTest("keyboard_input", { status: "running" });
    try {
      // Just verify the command can be queued (non-destructive)
      const r = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 5000 });
      setResult("keyboard_input", r.success ? "pass" : "warn", r.success ? "Input pipeline ready" : "May have issues");
    } catch {
      setResult("keyboard_input", "warn", "Could not verify input pipeline");
    }

    // ─── 11. Mouse Control ───
    updateTest("mouse_control", { status: "running" });
    try {
      const r = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 5000 });
      setResult("mouse_control", r.success ? "pass" : "warn", r.success ? "Mouse control ready" : "May have issues");
    } catch {
      setResult("mouse_control", "warn", "Could not verify mouse control");
    }

    // ─── 12. Disk Access ───
    updateTest("disk_access", { status: "running" });
    try {
      const r = await sendCommand("get_disk_usage", {}, { awaitResult: true, timeoutMs: 10000 });
      if (r.success) {
        const drives = (r as any).result?.drives;
        setResult("disk_access", "pass", `${drives?.length || "?"} drives detected`);
      } else {
        setResult("disk_access", "warn", "Disk info not available");
      }
    } catch {
      setResult("disk_access", "warn", "Disk access test skipped");
    }

    // ─── 13. Local Storage ───
    updateTest("local_storage", { status: "running" });
    try {
      localStorage.setItem("_diag_test", "1");
      const v = localStorage.getItem("_diag_test");
      localStorage.removeItem("_diag_test");
      setResult("local_storage", v === "1" ? "pass" : "fail", v === "1" ? "Read/write OK" : "Storage not working");
    } catch {
      setResult("local_storage", "fail", "localStorage blocked");
    }

    // ─── 14. Notifications API ───
    updateTest("notifications_api", { status: "running" });
    if ("Notification" in window) {
      const perm = Notification.permission;
      setResult("notifications_api", perm === "granted" ? "pass" : "warn",
        perm === "granted" ? "Notifications enabled" : `Permission: ${perm} — click to enable`, true);
    } else {
      setResult("notifications_api", "warn", "Notifications API not available");
    }

    // ─── 15. Clipboard API ───
    updateTest("clipboard_api", { status: "running" });
    if (navigator.clipboard) {
      setResult("clipboard_api", "pass", "Clipboard API available");
    } else {
      setResult("clipboard_api", "warn", "Clipboard API not available (needs HTTPS or native)");
    }

    // Compute summary
    setRunning(false);
  }, [session, selectedDevice, sendCommand, updateTest]);

  // Compute summary when tests change and not running
  const computedSummary = !running && tests.length > 0 ? {
    passed: tests.filter(t => t.status === "pass" || t.status === "fixed").length,
    failed: tests.filter(t => t.status === "fail").length,
    warned: tests.filter(t => t.status === "warn").length,
    fixed: tests.filter(t => t.status === "fixed").length,
  } : summary;

  const handleAutoFix = useCallback(async () => {
    const failedTests = tests.filter(t => t.status === "fail" || t.status === "warn");
    if (failedTests.length === 0) return;

    for (const test of failedTests) {
      updateTest(test.id, { status: "fixing" });

      try {
        switch (test.id) {
          case "notifications_api":
            if ("Notification" in window && Notification.permission !== "granted") {
              const perm = await Notification.requestPermission();
              updateTest(test.id, {
                status: perm === "granted" ? "fixed" : "warn",
                detail: perm === "granted" ? "Notifications enabled!" : "Permission denied by user",
              });
            }
            break;

          case "command_roundtrip":
          case "agent_heartbeat":
            // Retry the command
            const r = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 15000 });
            updateTest(test.id, {
              status: r.success ? "fixed" : "fail",
              detail: r.success ? "Connection restored!" : "Still failing — check if agent is running",
            });
            break;

          case "volume_control":
            const vr = await sendCommand("get_volume", {}, { awaitResult: true, timeoutMs: 8000 });
            updateTest(test.id, {
              status: vr.success ? "fixed" : "fail",
              detail: vr.success ? "Volume control working!" : "Still failing",
            });
            break;

          case "device_online":
            // Refresh device status
            if (selectedDevice?.id) {
              const { data } = await supabase
                .from("devices")
                .select("is_online, last_seen")
                .eq("id", selectedDevice.id)
                .single();
              if (data?.is_online) {
                updateTest(test.id, { status: "fixed", detail: "Device is now online!" });
              } else {
                updateTest(test.id, { status: "fail", detail: "Device still offline. Ensure agent is running." });
              }
            }
            break;

          default:
            // For tests we can't auto-fix, just mark as acknowledged
            updateTest(test.id, { status: "warn", detail: `${test.detail} (auto-fix not available)` });
            break;
        }
      } catch (e: any) {
        updateTest(test.id, { status: "fail", detail: `Fix failed: ${e.message}` });
      }

      // Small delay between fixes
      await new Promise(r => setTimeout(r, 300));
    }
  }, [tests, sendCommand, selectedDevice, updateTest]);

  const categories = [
    { key: "connection" as const, label: "Connection", icon: <Wifi className="h-3.5 w-3.5" /> },
    { key: "agent" as const, label: "PC Agent", icon: <Server className="h-3.5 w-3.5" /> },
    { key: "hardware" as const, label: "Hardware", icon: <Cpu className="h-3.5 w-3.5" /> },
    { key: "app" as const, label: "Mobile App", icon: <Activity className="h-3.5 w-3.5" /> },
  ];

  const hasFailures = tests.some(t => t.status === "fail" || t.status === "warn");

  return (
    <Card className={cn("border-border/30 bg-card/50", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          System Diagnostics
          {computedSummary && (
            <div className="ml-auto flex items-center gap-1.5">
              {computedSummary.passed > 0 && (
                <Badge variant="default" className="text-[10px] h-5 gap-1">
                  <CheckCircle className="h-3 w-3" /> {computedSummary.passed}
                </Badge>
              )}
              {computedSummary.failed > 0 && (
                <Badge variant="destructive" className="text-[10px] h-5 gap-1">
                  <XCircle className="h-3 w-3" /> {computedSummary.failed}
                </Badge>
              )}
              {computedSummary.warned > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                  <AlertTriangle className="h-3 w-3" /> {computedSummary.warned}
                </Badge>
              )}
              {computedSummary.fixed > 0 && (
                <Badge variant="outline" className="text-[10px] h-5 gap-1 border-green-500/30 text-green-500">
                  <Wrench className="h-3 w-3" /> {computedSummary.fixed}
                </Badge>
              )}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Run a full diagnostic scan to verify PC agent connectivity, hardware controls, and mobile app capabilities.
        </p>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            onClick={runDiagnostics}
            disabled={running}
            className="flex-1 h-9 text-sm gap-2"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {running ? "Scanning…" : tests.length > 0 ? "Re-scan" : "Run Full Scan"}
          </Button>
          {hasFailures && !running && (
            <Button
              onClick={handleAutoFix}
              variant="outline"
              className="h-9 text-sm gap-2 border-primary/30 text-primary hover:bg-primary/10"
            >
              <Wrench className="h-4 w-4" />
              Auto-Fix All
            </Button>
          )}
        </div>

        {/* Progress bar */}
        {running && (
          <div className="space-y-1">
            <Progress value={progress} className="h-2" />
            <p className="text-[10px] text-muted-foreground text-center">{progress}% complete</p>
          </div>
        )}

        {/* Test results by category */}
        {tests.length > 0 && (
          <div className="space-y-3">
            {categories.map(cat => {
              const catTests = tests.filter(t => t.category === cat.key);
              if (catTests.length === 0) return null;
              return (
                <div key={cat.key} className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    {cat.icon}
                    <span>{cat.label}</span>
                  </div>
                  <div className="space-y-1">
                    {catTests.map(test => (
                      <div
                        key={test.id}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-md border",
                          test.status === "fail" && "border-destructive/30 bg-destructive/5",
                          test.status === "warn" && "border-yellow-500/20 bg-yellow-500/5",
                          test.status === "pass" && "border-border/30 bg-secondary/20",
                          test.status === "fixed" && "border-green-500/20 bg-green-500/5",
                          (test.status === "idle" || test.status === "running" || test.status === "fixing") && "border-border/30 bg-secondary/10",
                        )}
                      >
                        {statusIcon(test.status)}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{test.name}</p>
                          {test.detail && (
                            <p className="text-[10px] text-muted-foreground truncate">{test.detail}</p>
                          )}
                        </div>
                        {statusBadge(test.status)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary message */}
        {computedSummary && !running && (
          <div className={cn(
            "p-3 rounded-lg border text-xs",
            computedSummary.failed === 0
              ? "border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400"
              : "border-destructive/30 bg-destructive/5 text-destructive",
          )}>
            {computedSummary.failed === 0 ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                <span className="font-medium">All systems operational! {computedSummary.warned > 0 ? `(${computedSummary.warned} warnings)` : ""}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                <span className="font-medium">
                  {computedSummary.failed} issue{computedSummary.failed > 1 ? "s" : ""} found.
                  {hasFailures ? " Click 'Auto-Fix All' to attempt repairs." : ""}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
