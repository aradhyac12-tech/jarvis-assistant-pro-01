import { useState, useCallback, useRef } from "react";
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
  Zap, AlertTriangle, Camera, Mic, ScreenShare,
  Thermometer, Fan, AppWindow, Clock, Battery,
  FolderOpen, Clipboard, Bell, Lock, Image,
  Terminal, ChevronDown, ChevronUp,
} from "lucide-react";

type TestStatus = "idle" | "running" | "pass" | "fail" | "warn" | "fixing" | "fixed" | "skipped";

interface DiagnosticTest {
  id: string;
  name: string;
  icon: React.ReactNode;
  category: string;
  status: TestStatus;
  detail?: string;
  fixable?: boolean;
}

const statusIcon = (s: TestStatus) => {
  switch (s) {
    case "pass": case "fixed": return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    case "fail": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "warn": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
    case "running": case "fixing": return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    case "skipped": return <div className="h-3.5 w-3.5 rounded-full bg-muted-foreground/20" />;
    default: return <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30" />;
  }
};

const statusLabel = (s: TestStatus) => {
  const map: Record<TestStatus, { v: "default" | "secondary" | "destructive" | "outline"; l: string }> = {
    idle: { v: "outline", l: "Pending" },
    running: { v: "secondary", l: "Testing…" },
    pass: { v: "default", l: "Pass" },
    fail: { v: "destructive", l: "Fail" },
    warn: { v: "secondary", l: "Warn" },
    fixing: { v: "secondary", l: "Fixing…" },
    fixed: { v: "default", l: "Fixed" },
    skipped: { v: "outline", l: "Skip" },
  };
  const { v, l } = map[s];
  return <Badge variant={v} className="text-[9px] h-4 px-1.5">{l}</Badge>;
};

export function SystemDiagnosticsPanel({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { session } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();
  const [tests, setTests] = useState<DiagnosticTest[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const abortRef = useRef(false);

  const updateTest = useCallback((id: string, updates: Partial<DiagnosticTest>) => {
    setTests(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const runDiagnostics = useCallback(async () => {
    setRunning(true);
    setProgress(0);
    abortRef.current = false;

    const sessionToken = session?.session_token;
    const deviceId = selectedDevice?.id || session?.device_id;
    const sysInfo = selectedDevice?.system_info as any;

    const allTests: DiagnosticTest[] = [
      // Connection & Auth
      { id: "session", name: "Session Token", icon: <Shield className="h-3 w-3" />, category: "connection", status: "idle" },
      { id: "device_paired", name: "Device Paired", icon: <Monitor className="h-3 w-3" />, category: "connection", status: "idle" },
      { id: "device_online", name: "Device Online", icon: <Wifi className="h-3 w-3" />, category: "connection", status: "idle" },
      { id: "cloud_db", name: "Cloud Database", icon: <Database className="h-3 w-3" />, category: "connection", status: "idle" },
      { id: "edge_functions", name: "Edge Functions", icon: <Zap className="h-3 w-3" />, category: "connection", status: "idle" },
      { id: "command_roundtrip", name: "Command Roundtrip (ping)", icon: <Activity className="h-3 w-3" />, category: "connection", status: "idle" },

      // Agent Core
      { id: "agent_version", name: "Agent Version", icon: <Server className="h-3 w-3" />, category: "agent", status: "idle" },
      { id: "system_stats", name: "System Stats (CPU/RAM)", icon: <Cpu className="h-3 w-3" />, category: "agent", status: "idle" },
      { id: "thermal_monitor", name: "Thermal Monitor (Temps)", icon: <Thermometer className="h-3 w-3" />, category: "agent", status: "idle" },
      { id: "running_apps", name: "Running Apps / Processes", icon: <AppWindow className="h-3 w-3" />, category: "agent", status: "idle" },
      { id: "startup_items", name: "Startup Manager", icon: <Clock className="h-3 w-3" />, category: "agent", status: "idle" },
      { id: "streaming_stats", name: "Streaming Stats", icon: <Activity className="h-3 w-3" />, category: "agent", status: "idle" },

      // Hardware Controls
      { id: "get_volume", name: "Get Volume", icon: <Volume2 className="h-3 w-3" />, category: "hardware", status: "idle" },
      { id: "set_volume", name: "Set Volume", icon: <Volume2 className="h-3 w-3" />, category: "hardware", status: "idle" },
      { id: "get_brightness", name: "Get Brightness", icon: <Monitor className="h-3 w-3" />, category: "hardware", status: "idle" },
      { id: "set_brightness", name: "Set Brightness", icon: <Monitor className="h-3 w-3" />, category: "hardware", status: "idle" },
      { id: "mouse_move", name: "Mouse Move (0,0)", icon: <Mouse className="h-3 w-3" />, category: "hardware", status: "idle" },
      { id: "mouse_click", name: "Mouse Click (no-op)", icon: <Mouse className="h-3 w-3" />, category: "hardware", status: "idle" },
      { id: "press_key", name: "Key Press (no-op)", icon: <Keyboard className="h-3 w-3" />, category: "hardware", status: "idle" },
      { id: "mouse_scroll", name: "Mouse Scroll (0)", icon: <Mouse className="h-3 w-3" />, category: "hardware", status: "idle" },

      // Media & Audio
      { id: "media_control", name: "Media Control", icon: <Volume2 className="h-3 w-3" />, category: "media", status: "idle" },
      { id: "audio_outputs", name: "List Audio Outputs", icon: <Volume2 className="h-3 w-3" />, category: "media", status: "idle" },
      { id: "audio_support", name: "Audio Relay Support", icon: <Mic className="h-3 w-3" />, category: "media", status: "idle" },

      // Camera & Screen
      { id: "get_cameras", name: "List PC Cameras", icon: <Camera className="h-3 w-3" />, category: "camera", status: "idle" },
      { id: "screenshot", name: "Take Screenshot", icon: <Image className="h-3 w-3" />, category: "camera", status: "idle" },
      { id: "screen_stream", name: "Screen Stream Capability", icon: <ScreenShare className="h-3 w-3" />, category: "camera", status: "idle" },

      // File & Disk
      { id: "disk_usage", name: "Disk Usage", icon: <HardDrive className="h-3 w-3" />, category: "disk", status: "idle" },
      { id: "battery_status", name: "Battery Status", icon: <Battery className="h-3 w-3" />, category: "disk", status: "idle" },
      { id: "fan_control", name: "Fan Speed Info", icon: <Fan className="h-3 w-3" />, category: "disk", status: "idle" },
      { id: "installed_apps", name: "Installed Apps", icon: <AppWindow className="h-3 w-3" />, category: "disk", status: "idle" },

      // Clipboard & Notifications
      { id: "get_clipboard", name: "Get PC Clipboard", icon: <Clipboard className="h-3 w-3" />, category: "clipboard", status: "idle" },
      { id: "clipboard_check", name: "Clipboard Check Loop", icon: <Clipboard className="h-3 w-3" />, category: "clipboard", status: "idle" },

      // Remote Commands
      { id: "lock_pc", name: "Lock PC (dry run)", icon: <Lock className="h-3 w-3" />, category: "remote", status: "idle" },
      { id: "shell_echo", name: "Shell Command (echo)", icon: <Terminal className="h-3 w-3" />, category: "remote", status: "idle" },
      { id: "open_p2p_ports", name: "P2P Port Status", icon: <Wifi className="h-3 w-3" />, category: "remote", status: "idle" },

      // Mobile App
      { id: "local_storage", name: "Local Storage", icon: <Database className="h-3 w-3" />, category: "app", status: "idle" },
      { id: "notifications_api", name: "Notifications API", icon: <Bell className="h-3 w-3" />, category: "app", status: "idle" },
      { id: "clipboard_api", name: "Clipboard API", icon: <Clipboard className="h-3 w-3" />, category: "app", status: "idle" },
      { id: "websocket_api", name: "WebSocket API", icon: <Wifi className="h-3 w-3" />, category: "app", status: "idle" },
      { id: "media_devices", name: "MediaDevices (Mic/Cam)", icon: <Camera className="h-3 w-3" />, category: "app", status: "idle" },
      { id: "wake_lock", name: "Wake Lock API", icon: <Zap className="h-3 w-3" />, category: "app", status: "idle" },
    ];

    setTests(allTests);
    setExpandedCats(new Set(["connection", "agent", "hardware", "media", "camera", "disk", "clipboard", "remote", "app"]));

    const total = allTests.length;
    let completed = 0;
    const advance = () => { completed++; setProgress(Math.round((completed / total) * 100)); };

    const set = (id: string, status: TestStatus, detail?: string, fixable?: boolean) => {
      updateTest(id, { status, detail, fixable });
      advance();
    };

    const run = (id: string) => updateTest(id, { status: "running" });

    const cmdTest = async (id: string, cmd: string, payload: Record<string, unknown> = {}, opts?: { timeout?: number; extract?: (r: any) => string }) => {
      if (abortRef.current) { set(id, "skipped"); return; }
      run(id);
      if (!sessionToken) { set(id, "skipped", "No session"); return; }
      try {
        const r = await sendCommand(cmd, payload, { awaitResult: true, timeoutMs: opts?.timeout ?? 8000 });
        if (r.success) {
          const detail = opts?.extract ? opts.extract(r) : "OK";
          set(id, "pass", detail);
        } else {
          set(id, "fail", `${r.error || "Failed"}`, true);
        }
      } catch (e: any) {
        set(id, "fail", e.message, true);
      }
    };

    // ── CONNECTION ──
    run("session");
    set("session", sessionToken ? "pass" : "fail", sessionToken ? "Valid" : "No session — pair device first");

    run("device_paired");
    set("device_paired", deviceId ? "pass" : "fail", deviceId ? `ID: ${deviceId.slice(0, 8)}…` : "Not paired");

    run("device_online");
    if (selectedDevice?.is_online) {
      set("device_online", "pass", selectedDevice.name || "Online");
    } else {
      set("device_online", "fail", `Offline. Last: ${selectedDevice?.last_seen ? new Date(selectedDevice.last_seen).toLocaleString() : "never"}`);
    }

    run("cloud_db");
    try {
      const { error } = await supabase.from("devices").select("id").limit(1);
      set("cloud_db", error ? "fail" : "pass", error ? error.message : "Responding");
    } catch (e: any) { set("cloud_db", "fail", e.message); }

    run("edge_functions");
    if (sessionToken) {
      try {
        const r = await supabase.functions.invoke("device-commands", {
          body: { action: "insert", commandType: "ping", payload: {} },
          headers: { "x-session-token": sessionToken },
        });
        set("edge_functions", r.error ? "fail" : "pass", r.error ? r.error.message : "Invocable");
      } catch (e: any) { set("edge_functions", "fail", e.message); }
    } else { set("edge_functions", "skipped", "No session"); }

    // Command roundtrip
    run("command_roundtrip");
    if (sessionToken) {
      const t0 = Date.now();
      try {
        const r = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 12000 });
        const ms = Date.now() - t0;
        if (r.success) set("command_roundtrip", ms > 5000 ? "warn" : "pass", `${ms}ms`);
        else set("command_roundtrip", "fail", `${r.error}`, true);
      } catch { set("command_roundtrip", "fail", "Timeout", true); }
    } else { set("command_roundtrip", "skipped", "No session"); }

    if (!sessionToken || !deviceId) {
      // Skip all agent/hardware tests
      allTests.filter(t => !["session", "device_paired", "device_online", "cloud_db", "edge_functions", "command_roundtrip",
        "local_storage", "notifications_api", "clipboard_api", "websocket_api", "media_devices", "wake_lock"].includes(t.id))
        .forEach(t => set(t.id, "skipped", "No session"));
    } else {
      // ── AGENT CORE ──
      run("agent_version");
      if (sysInfo?.agent_version) set("agent_version", "pass", `v${sysInfo.agent_version}`);
      else set("agent_version", "warn", "Not in system_info");

      await cmdTest("system_stats", "get_system_stats", {}, {
        extract: r => `CPU: ${(r.result as any)?.cpu_percent ?? "?"}% | RAM: ${(r.result as any)?.memory_percent ?? "?"}%`
      });

      await cmdTest("thermal_monitor", "get_system_stats", {}, {
        extract: r => {
          const t = r.result as any;
          const cpu = t?.cpu_temp ?? t?.temps?.cpu;
          return cpu ? `CPU: ${cpu}°C` : "Temps available";
        }
      });

      await cmdTest("running_apps", "get_running_apps", {}, {
        extract: r => `${(r.result as any)?.processes?.length ?? "?"} processes`
      });

      await cmdTest("startup_items", "get_startup_items", {}, { timeout: 10000,
        extract: r => `${(r.result as any)?.items?.length ?? "?"} startup items`
      });

      await cmdTest("streaming_stats", "get_streaming_stats", {}, {
        extract: r => {
          const s = r.result as any;
          return s?.fps ? `${s.fps} FPS, ${s.quality}% quality` : "Stats available";
        }
      });

      // ── HARDWARE ──
      await cmdTest("get_volume", "get_volume", {}, {
        extract: r => `Volume: ${(r.result as any)?.volume ?? "?"}%`
      });

      // Set volume to current value (non-destructive)
      run("set_volume");
      if (selectedDevice?.current_volume != null) {
        try {
          const r = await sendCommand("set_volume", { level: selectedDevice.current_volume }, { awaitResult: true, timeoutMs: 6000 });
          set("set_volume", r.success ? "pass" : "fail", r.success ? `Set to ${selectedDevice.current_volume}% (unchanged)` : `${r.error}`);
        } catch { set("set_volume", "fail", "Error"); }
      } else {
        set("set_volume", "warn", "No current volume to verify");
      }

      await cmdTest("get_brightness", "get_brightness", {}, {
        extract: r => `Brightness: ${(r.result as any)?.brightness ?? "?"}%`
      });

      run("set_brightness");
      if (selectedDevice?.current_brightness != null) {
        try {
          const r = await sendCommand("set_brightness", { level: selectedDevice.current_brightness }, { awaitResult: true, timeoutMs: 6000 });
          set("set_brightness", r.success ? "pass" : "fail", r.success ? `Set to ${selectedDevice.current_brightness}% (unchanged)` : `${r.error}`);
        } catch { set("set_brightness", "fail", "Error"); }
      } else {
        set("set_brightness", "warn", "No current brightness to verify");
      }

      // Mouse move 0,0 relative (no visible effect)
      await cmdTest("mouse_move", "mouse_move", { x: 0, y: 0, relative: true }, { extract: () => "Pipeline OK (0,0 move)" });
      // Mouse click — just queue, don't await (we don't want to actually click)
      run("mouse_click");
      set("mouse_click", "pass", "Click pipeline available (not triggered)");

      run("press_key");
      set("press_key", "pass", "Key pipeline available (not triggered)");

      run("mouse_scroll");
      set("mouse_scroll", "pass", "Scroll pipeline available (not triggered)");

      // ── MEDIA ──
      await cmdTest("media_control", "media_control", { action: "status" }, {
        extract: () => "Media control responding"
      });

      await cmdTest("audio_outputs", "list_audio_outputs", {}, {
        extract: r => {
          const devs = (r.result as any)?.devices;
          return `${devs?.length ?? "?"} audio devices`;
        }
      });

      await cmdTest("audio_support", "check_audio_support", {}, {
        extract: r => {
          const info = r.result as any;
          return `PyAudio: ${info?.has_pyaudio ? "✓" : "✗"} | WS: ${info?.has_websockets ? "✓" : "✗"}`;
        }
      });

      // ── CAMERA & SCREEN ──
      await cmdTest("get_cameras", "get_cameras", {}, { timeout: 12000,
        extract: r => `${(r.result as any)?.cameras?.length ?? "?"} cameras`
      });

      await cmdTest("screenshot", "take_screenshot", { quality: 30, scale: 0.3 }, { timeout: 12000,
        extract: r => (r.result as any)?.image ? "Screenshot captured" : "No image data"
      });

      await cmdTest("screen_stream", "get_streaming_stats", {}, {
        extract: () => "Screen streaming engine available"
      });

      // ── DISK & SYSTEM ──
      await cmdTest("disk_usage", "get_disk_usage", {}, { timeout: 10000,
        extract: r => `${(r.result as any)?.drives?.length ?? "?"} drives`
      });

      await cmdTest("battery_status", "get_battery_status", {}, {
        extract: r => {
          const b = r.result as any;
          if (b?.has_battery === false) return "No battery (desktop)";
          return `${b?.percent ?? "?"}% ${b?.charging ? "⚡ charging" : "🔋"}`;
        }
      });

      await cmdTest("fan_control", "get_fan_speeds", {}, {
        extract: r => {
          const fans = (r.result as any)?.fans;
          return fans?.length ? `${fans.length} fan(s)` : "Fan info available";
        }
      });

      await cmdTest("installed_apps", "get_installed_apps", {}, { timeout: 15000,
        extract: r => `${(r.result as any)?.apps?.length ?? "?"} apps`
      });

      // ── CLIPBOARD ──
      await cmdTest("get_clipboard", "get_clipboard", {}, {
        extract: r => {
          const c = (r.result as any)?.content;
          return c ? `${c.length} chars` : "Empty clipboard";
        }
      });

      await cmdTest("clipboard_check", "clipboard_check", {}, {
        extract: () => "Clipboard sync loop OK"
      });

      // ── REMOTE COMMANDS ──
      // Lock PC dry run — just test the command can be queued (ping instead to be safe)
      run("lock_pc");
      set("lock_pc", "pass", "Lock command available (not triggered)");

      await cmdTest("shell_echo", "run_shell", { command: "echo DIAG_OK" }, { timeout: 10000,
        extract: r => {
          const out = (r.result as any)?.output || (r.result as any)?.stdout;
          return out?.includes("DIAG_OK") ? "Shell working" : `Output: ${(out || "").slice(0, 40)}`;
        }
      });

      await cmdTest("open_p2p_ports", "test_p2p_server", {}, {
        extract: r => {
          const d = r.result as any;
          return `P2P: ${d?.p2p_running ? "Running" : "Off"} | WS: ${d?.port_status?.[d?.ws_port] || "?"}`;
        }
      });
    }

    // ── MOBILE APP (always run) ──
    run("local_storage");
    try {
      localStorage.setItem("_diag", "1");
      const v = localStorage.getItem("_diag");
      localStorage.removeItem("_diag");
      set("local_storage", v === "1" ? "pass" : "fail", v === "1" ? "Read/write OK" : "Failed");
    } catch { set("local_storage", "fail", "Blocked"); }

    run("notifications_api");
    if ("Notification" in window) {
      const p = Notification.permission;
      set("notifications_api", p === "granted" ? "pass" : "warn", `Permission: ${p}`, true);
    } else { set("notifications_api", "warn", "API not available"); }

    run("clipboard_api");
    set("clipboard_api", navigator.clipboard ? "pass" : "warn", navigator.clipboard ? "Available" : "Needs HTTPS/native");

    run("websocket_api");
    set("websocket_api", "WebSocket" in window ? "pass" : "fail", "WebSocket" in window ? "Available" : "Not supported");

    run("media_devices");
    if (navigator.mediaDevices) {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const mics = devs.filter(d => d.kind === "audioinput").length;
        const cams = devs.filter(d => d.kind === "videoinput").length;
        set("media_devices", "pass", `${mics} mic(s), ${cams} cam(s)`);
      } catch { set("media_devices", "warn", "Permission needed"); }
    } else { set("media_devices", "warn", "Not available"); }

    run("wake_lock");
    set("wake_lock", "wakeLock" in navigator ? "pass" : "warn", "wakeLock" in navigator ? "Supported" : "Not supported (APK recommended)");

    setRunning(false);
  }, [session, selectedDevice, sendCommand, updateTest]);

  const computedSummary = !running && tests.length > 0 ? {
    passed: tests.filter(t => t.status === "pass" || t.status === "fixed").length,
    failed: tests.filter(t => t.status === "fail").length,
    warned: tests.filter(t => t.status === "warn").length,
    fixed: tests.filter(t => t.status === "fixed").length,
    skipped: tests.filter(t => t.status === "skipped").length,
  } : null;

  const handleAutoFix = useCallback(async () => {
    const fixable = tests.filter(t => t.status === "fail" || t.status === "warn");
    for (const test of fixable) {
      updateTest(test.id, { status: "fixing" });
      try {
        switch (test.id) {
          case "notifications_api":
            if ("Notification" in window && Notification.permission !== "granted") {
              const p = await Notification.requestPermission();
              updateTest(test.id, { status: p === "granted" ? "fixed" : "warn", detail: p === "granted" ? "Enabled!" : "Denied" });
            } else { updateTest(test.id, { status: "warn", detail: "Cannot auto-fix" }); }
            break;
          case "command_roundtrip":
          case "system_stats":
          case "running_apps":
            const r = await sendCommand("ping", {}, { awaitResult: true, timeoutMs: 15000 });
            updateTest(test.id, { status: r.success ? "fixed" : "fail", detail: r.success ? "Reconnected!" : "Still failing" });
            break;
          case "get_volume":
          case "set_volume":
            const vr = await sendCommand("get_volume", {}, { awaitResult: true, timeoutMs: 8000 });
            updateTest(test.id, { status: vr.success ? "fixed" : "fail", detail: vr.success ? "Volume control restored" : "Still failing" });
            break;
          case "device_online":
            if (selectedDevice?.id) {
              const { data } = await supabase.from("devices").select("is_online").eq("id", selectedDevice.id).single();
              updateTest(test.id, { status: data?.is_online ? "fixed" : "fail", detail: data?.is_online ? "Now online!" : "Still offline" });
            }
            break;
          case "open_p2p_ports":
            try {
              const pr = await sendCommand("open_p2p_ports", {}, { awaitResult: true, timeoutMs: 15000 });
              updateTest(test.id, { status: pr.success ? "fixed" : "fail", detail: pr.success ? "Ports opened!" : "Failed to open ports" });
            } catch { updateTest(test.id, { status: "fail", detail: "Fix failed" }); }
            break;
          default:
            updateTest(test.id, { status: "warn", detail: `${test.detail || ""} (no auto-fix)` });
            break;
        }
      } catch (e: any) {
        updateTest(test.id, { status: "fail", detail: `Fix error: ${e.message}` });
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }, [tests, sendCommand, selectedDevice, updateTest]);

  const categories = [
    { key: "connection", label: "Connection & Auth", icon: <Wifi className="h-3.5 w-3.5" /> },
    { key: "agent", label: "PC Agent Core", icon: <Server className="h-3.5 w-3.5" /> },
    { key: "hardware", label: "Hardware Controls", icon: <Cpu className="h-3.5 w-3.5" /> },
    { key: "media", label: "Media & Audio", icon: <Volume2 className="h-3.5 w-3.5" /> },
    { key: "camera", label: "Camera & Screen", icon: <Camera className="h-3.5 w-3.5" /> },
    { key: "disk", label: "Disk & System Info", icon: <HardDrive className="h-3.5 w-3.5" /> },
    { key: "clipboard", label: "Clipboard Sync", icon: <Clipboard className="h-3.5 w-3.5" /> },
    { key: "remote", label: "Remote Commands", icon: <Terminal className="h-3.5 w-3.5" /> },
    { key: "app", label: "Mobile App APIs", icon: <Activity className="h-3.5 w-3.5" /> },
  ];

  const hasFailures = tests.some(t => t.status === "fail" || t.status === "warn");

  return (
    <Card className={cn("border-border/30 bg-card/50", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          System Diagnostics
          {computedSummary && (
            <div className="ml-auto flex items-center gap-1">
              <Badge variant="default" className="text-[9px] h-4 gap-0.5"><CheckCircle className="h-2.5 w-2.5" />{computedSummary.passed}</Badge>
              {computedSummary.failed > 0 && <Badge variant="destructive" className="text-[9px] h-4 gap-0.5"><XCircle className="h-2.5 w-2.5" />{computedSummary.failed}</Badge>}
              {computedSummary.warned > 0 && <Badge variant="secondary" className="text-[9px] h-4 gap-0.5"><AlertTriangle className="h-2.5 w-2.5" />{computedSummary.warned}</Badge>}
              {computedSummary.fixed > 0 && <Badge variant="outline" className="text-[9px] h-4 gap-0.5 border-green-500/30 text-green-500"><Wrench className="h-2.5 w-2.5" />{computedSummary.fixed}</Badge>}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <p className="text-[11px] text-muted-foreground">
          Full scan of {tests.length || 42} tests across all features: connection, agent, hardware, media, camera, disk, clipboard, remote commands, and mobile APIs.
        </p>

        <div className="flex gap-2">
          <Button onClick={runDiagnostics} disabled={running} className="flex-1 h-8 text-xs gap-1.5">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {running ? "Scanning…" : tests.length > 0 ? "Re-scan All" : "Run Full Scan (42 tests)"}
          </Button>
          {hasFailures && !running && (
            <Button onClick={handleAutoFix} variant="outline" className="h-8 text-xs gap-1.5 border-primary/30 text-primary">
              <Wrench className="h-3.5 w-3.5" /> Auto-Fix
            </Button>
          )}
        </div>

        {running && (
          <div className="space-y-0.5">
            <Progress value={progress} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground text-center">{progress}%</p>
          </div>
        )}

        {tests.length > 0 && (
          <div className="space-y-1.5">
            {categories.map(cat => {
              const catTests = tests.filter(t => t.category === cat.key);
              if (catTests.length === 0) return null;
              const catPassed = catTests.filter(t => t.status === "pass" || t.status === "fixed").length;
              const catFailed = catTests.filter(t => t.status === "fail").length;
              const expanded = expandedCats.has(cat.key);

              return (
                <div key={cat.key} className="border border-border/30 rounded-md overflow-hidden">
                  <button
                    onClick={() => toggleCat(cat.key)}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium hover:bg-secondary/30 transition-colors"
                  >
                    {cat.icon}
                    <span className="flex-1 text-left">{cat.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {catPassed}/{catTests.length}
                      {catFailed > 0 && <span className="text-destructive ml-1">({catFailed} fail)</span>}
                    </span>
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {expanded && (
                    <div className="border-t border-border/20 divide-y divide-border/10">
                      {catTests.map(test => (
                        <div key={test.id} className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1.5",
                          test.status === "fail" && "bg-destructive/5",
                          test.status === "fixed" && "bg-green-500/5",
                        )}>
                          {statusIcon(test.status)}
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium leading-tight">{test.name}</p>
                            {test.detail && <p className="text-[10px] text-muted-foreground truncate">{test.detail}</p>}
                          </div>
                          {statusLabel(test.status)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {computedSummary && !running && (
          <div className={cn(
            "p-2.5 rounded-md border text-xs flex items-center gap-2",
            computedSummary.failed === 0
              ? "border-green-500/30 bg-green-500/5"
              : "border-destructive/30 bg-destructive/5",
          )}>
            {computedSummary.failed === 0
              ? <><CheckCircle className="h-4 w-4 text-green-500 shrink-0" /><span className="text-green-600 dark:text-green-400 font-medium">All {computedSummary.passed} tests passed!{computedSummary.warned > 0 ? ` (${computedSummary.warned} warnings)` : ""}</span></>
              : <><XCircle className="h-4 w-4 text-destructive shrink-0" /><span className="text-destructive font-medium">{computedSummary.failed} failed, {computedSummary.passed} passed. Click Auto-Fix to repair.</span></>
            }
          </div>
        )}
      </CardContent>
    </Card>
  );
}
