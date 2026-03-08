import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronRight, Palette, Mic, Bell, Shield, Monitor, Phone, Activity, Settings as SettingsIcon } from "lucide-react";
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

/** Minimal settings row item */
function SettingsRow({ icon: Icon, label, subtitle, onClick, iconBg, trailing }: {
  icon: React.ElementType;
  label: string;
  subtitle?: string;
  onClick: () => void;
  iconBg: string;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl bg-card/40 border border-border/5 backdrop-blur-sm hover:bg-card/60 active:scale-[0.99] transition-all duration-150"
    >
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", iconBg)}>
        <Icon className="h-4.5 w-4.5 text-white" />
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
      </div>
      {trailing || <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />}
    </button>
  );
}

/** Section label */
function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 px-1 pt-2 pb-0.5">
      {children}
    </p>
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

  // If a sub-pane is active, show it with a back button
  if (activePane) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-4 animate-fade-in">
          <div className="flex items-center gap-3 pb-1">
            <button
              onClick={() => setActivePane(null)}
              className="w-8 h-8 rounded-xl bg-card/60 border border-border/10 flex items-center justify-center hover:bg-card/80 transition-colors"
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground rotate-180" />
            </button>
            <h1 className="text-lg font-semibold tracking-tight capitalize">
              {activePane === "theme" ? "Appearance" : activePane === "calls" ? "Call Detection" : activePane}
            </h1>
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

  // Main settings menu
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-2 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 pb-3">
          <BackButton />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            <p className="text-[11px] text-muted-foreground">Configure Jarvis</p>
          </div>
        </div>

        {/* Appearance */}
        <SectionLabel>Appearance</SectionLabel>
        <SettingsRow
          icon={Palette}
          label="Theme & Colors"
          subtitle="Dark mode, presets, custom colors"
          onClick={() => setActivePane("theme")}
          iconBg="bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))]"
        />

        {/* General */}
        <SectionLabel>General</SectionLabel>
        <div className="space-y-1.5">
          <SettingsRow
            icon={Mic}
            label="Voice"
            subtitle={`Wake word: "${wakeWord}"`}
            onClick={() => setActivePane("voice")}
            iconBg="bg-[hsl(262,83%,58%)]"
          />
          <SettingsRow
            icon={Bell}
            label="Notifications"
            subtitle={notifEnabled ? "Sync active" : "Off"}
            onClick={() => setActivePane("notifications")}
            iconBg="bg-[hsl(25,95%,53%)]"
          />
        </div>

        {/* Privacy */}
        <SectionLabel>Privacy & Security</SectionLabel>
        <SettingsRow
          icon={Shield}
          label="App Lock"
          subtitle={appLockEnabled ? `${lockMethod} lock enabled` : "Disabled"}
          onClick={() => setActivePane("security")}
          iconBg="bg-[hsl(142,71%,45%)]"
        />

        {/* Device */}
        <SectionLabel>Device & Connection</SectionLabel>
        <div className="space-y-1.5">
          <SettingsRow
            icon={Monitor}
            label={selectedDevice?.name || session?.device_name || "My PC"}
            subtitle={isConnected ? "Connected" : "Offline"}
            onClick={() => setActivePane("device")}
            iconBg="bg-[hsl(var(--primary))]"
            trailing={
              <div className={cn(
                "w-2.5 h-2.5 rounded-full shrink-0",
                isConnected
                  ? "bg-[hsl(var(--success))] shadow-[0_0_8px_hsl(var(--success)/0.5)]"
                  : "bg-muted-foreground/40"
              )} />
            }
          />
          <SettingsRow
            icon={Phone}
            label="Call Detection"
            subtitle={callDetectionActive ? "Monitoring active" : "Off"}
            onClick={() => setActivePane("calls")}
            iconBg="bg-[hsl(186,94%,42%)]"
          />
        </div>

        {/* System */}
        <SectionLabel>Advanced</SectionLabel>
        <SettingsRow
          icon={Activity}
          label="System & Diagnostics"
          subtitle="Streaming, boost, updates"
          onClick={() => setActivePane("system")}
          iconBg="bg-muted-foreground/60"
        />

        {/* Save */}
        <div className="pt-4">
          <Button
            onClick={() => toast({ title: "Settings Saved", description: "Preferences updated" })}
            className="w-full h-11 text-sm font-medium rounded-2xl shadow-lg shadow-primary/10"
          >
            <Check className="h-4 w-4 mr-2" /> Save Settings
          </Button>
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}
