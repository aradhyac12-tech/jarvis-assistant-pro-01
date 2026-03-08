import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useCapacitorPlugins } from "@/hooks/useCapacitorPlugins";
import { useNavigate } from "react-router-dom";
import { BackButton } from "@/components/BackButton";
import { isAppLockEnabled, getAppLockMethod, getAppPin, setAppLockSettings } from "@/components/AppLockScreen";
import { cn } from "@/lib/utils";

import { VoiceSettingsCard } from "@/components/settings/VoiceSettingsCard";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { DeviceConnectionCard } from "@/components/settings/DeviceConnectionCard";
import { NotificationsCard } from "@/components/settings/NotificationsCard";
import { CallDetectionCard } from "@/components/settings/CallDetectionCard";
import { ThemeSettingsCard } from "@/components/settings/ThemeSettingsCard";
import { StreamingDiagnostics } from "@/components/StreamingDiagnostics";
import { SystemDiagnosticsPanel } from "@/components/SystemDiagnosticsPanel";
import { BoostPC } from "@/components/BoostPC";
import { OTAUpdateCard } from "@/components/OTAUpdateCard";

/** Collapsible section wrapper */
function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full px-1 py-1.5 group"
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {title}
        </h2>
        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-muted-foreground/40 transition-transform duration-200",
          open && "rotate-180"
        )} />
      </button>
      {open && <div className="space-y-3 mt-1 animate-fade-in">{children}</div>}
    </section>
  );
}

export default function Settings() {
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-4 pb-1">
          <BackButton />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            <p className="text-[10px] text-muted-foreground">Configure Jarvis</p>
          </div>
        </div>

        <Section title="Appearance">
          <ThemeSettingsCard />
        </Section>

        <Section title="General">
          <VoiceSettingsCard wakeWord={wakeWord} onWakeWordChange={setWakeWord} />
          <NotificationsCard
            notifEnabled={notifEnabled}
            pushEnabled={notifications}
            onNotifChange={setNotifEnabled}
            onPushChange={setNotifications}
          />
        </Section>

        <Section title="Privacy & Security">
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
        </Section>

        <Section title="Device & Connection">
          <DeviceConnectionCard
            deviceName={selectedDevice?.name || session?.device_name || "My PC"}
            isConnected={isConnected}
            onUnpair={handleUnpair}
          />
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
        </Section>

        <Section title="System" defaultOpen={false}>
          <StreamingDiagnostics />
          <SystemDiagnosticsPanel className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl" />
          <BoostPC className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl" />
          <OTAUpdateCard />
        </Section>

        {/* Save */}
        <Button
          onClick={() => toast({ title: "Settings Saved", description: "Preferences updated" })}
          className="w-full h-11 text-sm font-medium rounded-xl shadow-lg shadow-primary/10"
        >
          <Check className="h-4 w-4 mr-2" /> Save Settings
        </Button>

        <div className="h-6" />
      </div>
    </div>
  );
}
