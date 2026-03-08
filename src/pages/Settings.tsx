import { useState, useEffect } from "react";
import { ChevronRight, Palette, Mic, Bell, Shield, Monitor, Phone, Activity, User, ChevronLeft } from "lucide-react";
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

/* ── iOS-style settings row ── */
function SettingsRow({ icon: Icon, label, subtitle, onClick, iconBg, trailing, isFirst, isLast }: {
  icon: React.ElementType;
  label: string;
  subtitle?: string;
  onClick: () => void;
  iconBg: string;
  trailing?: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3.5 w-full px-4 py-[13px] active:bg-foreground/[0.04] transition-colors duration-75",
        "hover:bg-foreground/[0.03]"
      )}
    >
      <div className={cn("w-[30px] h-[30px] rounded-[7px] flex items-center justify-center shrink-0", iconBg)}>
        <Icon className="h-[16px] w-[16px] text-white" strokeWidth={2.2} />
      </div>
      <div className={cn(
        "flex-1 flex items-center justify-between min-w-0",
        !isLast && "border-b border-foreground/[0.06]",
        "pb-0",
        !isLast && "pb-[13px] -mb-[13px]"
      )}>
        <div className="text-left min-w-0 flex-1">
          <p className="text-[15px] font-normal text-foreground leading-snug">{label}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {trailing}
          <ChevronRight className="h-[14px] w-[14px] text-muted-foreground/40" strokeWidth={2.5} />
        </div>
      </div>
    </button>
  );
}

/* ── Section label ── */
function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[13px] font-normal text-muted-foreground px-5 pb-[6px] pt-1">
      {children}
    </p>
  );
}

/* ── Grouped card ── */
function GroupedCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] bg-card border border-foreground/[0.06] overflow-hidden">
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
        <div className="max-w-lg mx-auto px-4 pt-3 pb-8 animate-fade-in">
          {/* iOS-style nav bar */}
          <div className="flex items-center gap-1 mb-5">
            <button
              onClick={() => setActivePane(null)}
              className="flex items-center gap-0.5 text-primary text-[15px] font-normal -ml-1 px-1 py-1 rounded-lg active:bg-foreground/[0.04] transition-colors"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2} />
              <span>Settings</span>
            </button>
          </div>
          <h1 className="text-[34px] font-bold tracking-tight leading-tight mb-5">{titles[activePane]}</h1>

          <div className="space-y-4">
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
                <SystemDiagnosticsPanel className="border-foreground/[0.06] bg-card rounded-[12px]" />
                <BoostPC className="border-foreground/[0.06] bg-card rounded-[12px]" />
                <OTAUpdateCard />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Main Settings menu ── */
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 pt-3 pb-10 animate-fade-in">
        {/* iOS large title header */}
        <div className="flex items-center mb-1">
          <BackButton showHome={false} />
        </div>
        <h1 className="text-[34px] font-bold tracking-tight leading-tight mb-6">Settings</h1>

        <div className="space-y-7">
          {/* ── Profile / Device section ── */}
          <div>
            <GroupedCard>
              <button
                onClick={() => setActivePane("device")}
                className="flex items-center gap-3.5 w-full px-4 py-3.5 active:bg-foreground/[0.04] hover:bg-foreground/[0.03] transition-colors"
              >
                <div className="w-[52px] h-[52px] rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shrink-0">
                  <Monitor className="h-6 w-6 text-primary-foreground" strokeWidth={1.8} />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[17px] font-semibold text-foreground leading-snug truncate">
                    {selectedDevice?.name || session?.device_name || "My PC"}
                  </p>
                  <p className="text-[13px] text-muted-foreground leading-snug mt-0.5">
                    {isConnected ? "Connected" : "Offline"} · Device Settings
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full",
                    isConnected
                      ? "bg-[hsl(var(--accent-green))] shadow-[0_0_8px_hsl(var(--accent-green)/0.5)]"
                      : "bg-muted-foreground/30"
                  )} />
                  <ChevronRight className="h-[14px] w-[14px] text-muted-foreground/40" strokeWidth={2.5} />
                </div>
              </button>
            </GroupedCard>
          </div>

          {/* ── Appearance ── */}
          <div>
            <GroupedCard>
              <SettingsRow
                icon={Palette}
                label="Appearance"
                subtitle="Theme, colors, dark mode"
                onClick={() => setActivePane("theme")}
                iconBg="bg-gradient-to-br from-[hsl(var(--accent-purple))] to-[hsl(var(--accent-pink))]"
                isLast
              />
            </GroupedCard>
          </div>

          {/* ── General ── */}
          <div>
            <SectionLabel>General</SectionLabel>
            <GroupedCard>
              <SettingsRow
                icon={Mic}
                label="Voice"
                subtitle={`"${wakeWord}"`}
                onClick={() => setActivePane("voice")}
                iconBg="bg-[hsl(var(--accent-purple))]"
              />
              <SettingsRow
                icon={Bell}
                label="Notifications"
                subtitle={notifEnabled ? "Active" : "Off"}
                onClick={() => setActivePane("notifications")}
                iconBg="bg-[hsl(var(--destructive))]"
                isLast
              />
            </GroupedCard>
          </div>

          {/* ── Privacy ── */}
          <div>
            <SectionLabel>Privacy</SectionLabel>
            <GroupedCard>
              <SettingsRow
                icon={Shield}
                label="App Lock"
                subtitle={appLockEnabled ? `${lockMethod === "both" ? "Biometric + PIN" : lockMethod === "biometric" ? biometricTypeName : "PIN"}` : "Off"}
                onClick={() => setActivePane("security")}
                iconBg="bg-[hsl(var(--accent-green))]"
                isLast
              />
            </GroupedCard>
          </div>

          {/* ── Connections ── */}
          <div>
            <SectionLabel>Connections</SectionLabel>
            <GroupedCard>
              <SettingsRow
                icon={Phone}
                label="Call Detection"
                subtitle={callDetectionActive ? "Active" : "Off"}
                onClick={() => setActivePane("calls")}
                iconBg="bg-[hsl(var(--accent-cyan))]"
                isLast
              />
            </GroupedCard>
          </div>

          {/* ── Advanced ── */}
          <div>
            <SectionLabel>Advanced</SectionLabel>
            <GroupedCard>
              <SettingsRow
                icon={Activity}
                label="System & Diagnostics"
                subtitle="Streaming, boost, updates"
                onClick={() => setActivePane("system")}
                iconBg="bg-muted-foreground"
                isLast
              />
            </GroupedCard>
          </div>
        </div>
      </div>
    </div>
  );
}
