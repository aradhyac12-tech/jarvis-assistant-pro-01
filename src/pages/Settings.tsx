import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronRight, Palette, Mic, Bell, Shield, Monitor, Phone, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useCapacitorPlugins } from "@/hooks/useCapacitorPlugins";
import { useNavigate } from "react-router-dom";
import { BackButton } from "@/components/BackButton";
import { isAppLockEnabled, getAppLockMethod, getAppPin, setAppLockSettings } from "@/components/AppLockScreen";
import { cn } from "@/lib/utils";

import { ThemeSettingsCard } from "@/components/settings/ThemeSettingsCard";
import { VoiceSettingsCard } from "@/components/settings/VoiceSettingsCard";
import { NotificationsCard } from "@/components/settings/NotificationsCard";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { DeviceConnectionCard } from "@/components/settings/DeviceConnectionCard";
import { CallDetectionCard } from "@/components/settings/CallDetectionCard";
import { StreamingDiagnostics } from "@/components/StreamingDiagnostics";
import { SystemDiagnosticsPanel } from "@/components/SystemDiagnosticsPanel";
import { BoostPC } from "@/components/BoostPC";
import { OTAUpdateCard } from "@/components/OTAUpdateCard";

type SettingsPane = null | "theme" | "voice" | "notifications" | "security" | "device" | "calls" | "system";

/* ── iOS-style row inside a grouped card ── */
function SettingsRow({ icon: Icon, label, subtitle, onClick, iconBg, trailing, isLast }: {
  icon: React.ElementType;
  label: string;
  subtitle?: string;
  onClick: () => void;
  iconBg: string;
  trailing?: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3 hover:bg-muted/40 active:bg-muted/60 transition-colors duration-100"
    >
      <div className={cn("w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 shadow-sm", iconBg)}>
        <Icon className="h-[18px] w-[18px] text-white" />
      </div>
      <div className={cn(
        "flex-1 flex items-center justify-between min-w-0 py-0.5",
        !isLast && "border-b border-border/10"
      )}>
        <div className="text-left min-w-0 flex-1">
          <p className="text-[14px] font-normal text-foreground leading-tight">{label}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {trailing}
          <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
        </div>
      </div>
    </button>
  );
}

/* ── Section header ── */
function SectionHeader({ children }: { children: string }) {
  return (
    <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground/60 px-5 pb-1.5 pt-1">
      {children}
    </p>
  );
}

/* ── Grouped card container ── */
function GroupCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card/60 border border-border/8 overflow-hidden backdrop-blur-sm">
      {children}
    </div>
  );
}

export default function Settings() {
  const [activePane, setActivePane] = useState<SettingsPane>(null);

  const [wakeWord, setWakeWord] = useState(() => localStorage.getItem("settings_wake_word") || "Hey Jarvis");
  const [notifications, setNotifications] = useState(() => localStorage.getItem("settings_notifications") !== "false");
  const [notifEnabled, setNotifEnabled] = useState(() => localStorage.getItem("notif_enabled") === "true");

  useEffect(() => localStorage.setItem("settings_wake_word", wakeWord), [wakeWord]);
  useEffect(() => localStorage.setItem("settings_notifications", String(notifications)), [notifications]);
  useEffect(() => localStorage.setItem("notif_enabled", String(notifEnabled)), [notifEnabled]);

  const [appLockEnabled, setAppLockEnabled] = useState(isAppLockEnabled);
  const [lockMethod, setLockMethod] = useState<"biometric" | "pin" | "both">(getAppLockMethod);
  const [appPin, setAppPin] = useState(getAppPin);
  const [biometricAvail, setBiometricAvail] = useState(false);
  const [biometricTypeName, setBiometricTypeName] = useState("Biometric");

  const { toast } = useToast();
  const { session, unpair } = useDeviceSession();
  const { selectedDevice } = useDeviceContext();
  const navigate = useNavigate();

  const {
    isNative, callState, callDetectionActive,
    autoPauseEnabled, autoMuteEnabled,
    setAutoPauseEnabled, setAutoMuteEnabled,
    initCallDetection, stopCallDetection, simulateCall,
  } = useCapacitorPlugins();

  const isConnected = selectedDevice?.is_online || false;

  useEffect(() => {
    if (isNative && !callDetectionActive) initCallDetection();
  }, [isNative, callDetectionActive, initCallDetection]);

  useEffect(() => {
    (async () => {
      try {
        const { NativeBiometric, BiometryType } = await import("@capgo/capacitor-native-biometric");
        const result = await NativeBiometric.isAvailable({ useFallback: true });
        setBiometricAvail(result.isAvailable);
        switch (result.biometryType) {
          case BiometryType.TOUCH_ID: setBiometricTypeName("Touch ID"); break;
          case BiometryType.FACE_ID: setBiometricTypeName("Face ID"); break;
          case BiometryType.FINGERPRINT: setBiometricTypeName("Fingerprint"); break;
          case BiometryType.FACE_AUTHENTICATION: setBiometricTypeName("Face Unlock"); break;
          default: setBiometricTypeName("Biometric");
        }
      } catch { setBiometricAvail(false); }
    })();
  }, []);

  const handleUnpair = () => {
    unpair();
    toast({ title: "Device Unpaired", description: "Disconnected from your PC" });
    navigate("/pair", { replace: true });
  };

  const toggleCallDetection = async () => {
    if (callDetectionActive) {
      await stopCallDetection();
      toast({ title: "Call Detection Disabled" });
    } else {
      const success = await initCallDetection();
      toast({
        title: success ? "Call Detection Enabled" : "Call Detection Failed",
        variant: success ? "default" : "destructive",
      });
    }
  };

  /* ── Sub-pane view ── */
  if (activePane) {
    const titles: Record<string, string> = {
      theme: "Appearance",
      voice: "Voice",
      notifications: "Notifications",
      security: "Security",
      device: "Device",
      calls: "Call Detection",
      system: "System & Diagnostics",
    };

    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-4 animate-fade-in">
          {/* Sub-pane header */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActivePane(null)}
              className="w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors"
            >
              <ChevronRight className="h-4 w-4 text-foreground rotate-180" />
            </button>
            <h1 className="text-lg font-semibold">{titles[activePane]}</h1>
          </div>

          {activePane === "theme" && <ThemeSettingsCard />}
          {activePane === "voice" && <VoiceSettingsCard wakeWord={wakeWord} onWakeWordChange={setWakeWord} />}
          {activePane === "notifications" && (
            <NotificationsCard
              notifEnabled={notifEnabled}
              pushEnabled={notifications}
              onNotifChange={setNotifEnabled}
              onPushChange={setNotifications}
            />
          )}
          {activePane === "security" && (
            <SecurityCard
              appLockEnabled={appLockEnabled}
              lockMethod={lockMethod}
              appPin={appPin}
              biometricAvail={biometricAvail}
              biometricTypeName={biometricTypeName}
              onToggleLock={(v) => {
                setAppLockEnabled(v);
                setAppLockSettings(v, lockMethod, appPin, 0);
                toast({ title: v ? "App Lock Enabled" : "App Lock Disabled" });
              }}
              onSetLockMethod={(m) => {
                setLockMethod(m);
                setAppLockSettings(true, m, appPin, 0);
              }}
              onSetPin={(v) => {
                setAppPin(v);
                setAppLockSettings(true, lockMethod, v, 0);
              }}
            />
          )}
          {activePane === "device" && (
            <DeviceConnectionCard
              deviceName={selectedDevice?.name || session?.device_name || "My PC"}
              isConnected={isConnected}
              onUnpair={handleUnpair}
            />
          )}
          {activePane === "calls" && (
            <CallDetectionCard
              isNative={isNative}
              callState={callState}
              callDetectionActive={callDetectionActive}
              autoPauseEnabled={autoPauseEnabled}
              autoMuteEnabled={autoMuteEnabled}
              isConnected={isConnected}
              setAutoPauseEnabled={setAutoPauseEnabled}
              setAutoMuteEnabled={setAutoMuteEnabled}
              toggleCallDetection={toggleCallDetection}
              simulateCall={simulateCall}
            />
          )}
          {activePane === "system" && (
            <div className="space-y-3">
              <StreamingDiagnostics />
              <SystemDiagnosticsPanel className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl" />
              <BoostPC className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl" />
              <OTAUpdateCard />
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Main menu ── */
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3">
          <BackButton showHome={false} />
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        </div>

        {/* ── Appearance ── */}
        <div className="space-y-1.5">
          <SectionHeader>Appearance</SectionHeader>
          <GroupCard>
            <SettingsRow
              icon={Palette}
              label="Theme & Colors"
              subtitle="Dark mode, accents, presets"
              onClick={() => setActivePane("theme")}
              iconBg="bg-gradient-to-br from-violet-500 to-pink-500"
              isLast
            />
          </GroupCard>
        </div>

        {/* ── General ── */}
        <div className="space-y-1.5">
          <SectionHeader>General</SectionHeader>
          <GroupCard>
            <SettingsRow
              icon={Mic}
              label="Voice"
              subtitle={`Wake word: "${wakeWord}"`}
              onClick={() => setActivePane("voice")}
              iconBg="bg-violet-500"
            />
            <SettingsRow
              icon={Bell}
              label="Notifications"
              subtitle={notifEnabled ? "Sync active" : "Off"}
              onClick={() => setActivePane("notifications")}
              iconBg="bg-red-500"
              isLast
            />
          </GroupCard>
        </div>

        {/* ── Privacy ── */}
        <div className="space-y-1.5">
          <SectionHeader>Privacy & Security</SectionHeader>
          <GroupCard>
            <SettingsRow
              icon={Shield}
              label="App Lock"
              subtitle={appLockEnabled ? `${lockMethod} lock` : "Off"}
              onClick={() => setActivePane("security")}
              iconBg="bg-emerald-500"
              isLast
            />
          </GroupCard>
        </div>

        {/* ── Devices ── */}
        <div className="space-y-1.5">
          <SectionHeader>Devices</SectionHeader>
          <GroupCard>
            <SettingsRow
              icon={Monitor}
              label={selectedDevice?.name || session?.device_name || "My PC"}
              subtitle={isConnected ? "Connected" : "Offline"}
              onClick={() => setActivePane("device")}
              iconBg="bg-blue-500"
              trailing={
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  isConnected
                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                    : "bg-muted-foreground/30"
                )} />
              }
            />
            <SettingsRow
              icon={Phone}
              label="Call Detection"
              subtitle={callDetectionActive ? "Active" : "Off"}
              onClick={() => setActivePane("calls")}
              iconBg="bg-cyan-500"
              isLast
            />
          </GroupCard>
        </div>

        {/* ── Advanced ── */}
        <div className="space-y-1.5">
          <SectionHeader>Advanced</SectionHeader>
          <GroupCard>
            <SettingsRow
              icon={Activity}
              label="System & Diagnostics"
              subtitle="Streaming, boost, updates"
              onClick={() => setActivePane("system")}
              iconBg="bg-gray-500"
              isLast
            />
          </GroupCard>
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}
