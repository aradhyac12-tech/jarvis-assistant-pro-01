import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDeviceSession } from "@/hooks/useDeviceSession";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useCapacitorPlugins } from "@/hooks/useCapacitorPlugins";
import { useNavigate } from "react-router-dom";
import { BackButton } from "@/components/BackButton";
import { isAppLockEnabled, getAppLockMethod, getAppPin, setAppLockSettings } from "@/components/AppLockScreen";

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

  // Auto-start call detection on mount if native
  useEffect(() => {
    if (isNative && !callDetectionActive) initCallDetection();
  }, [isNative, callDetectionActive, initCallDetection]);

  // Check biometric availability
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
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-4 pb-2">
          <BackButton />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            <p className="text-xs text-muted-foreground">Configure Jarvis</p>
          </div>
        </div>

        {/* Section: Appearance */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">Appearance</h2>
          <ThemeSettingsCard />
        </section>

        {/* Section: General */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">General</h2>
          <VoiceSettingsCard wakeWord={wakeWord} onWakeWordChange={setWakeWord} />
          <NotificationsCard
            notifEnabled={notifEnabled}
            pushEnabled={notifications}
            onNotifChange={setNotifEnabled}
            onPushChange={setNotifications}
          />
        </section>

        {/* Section: Privacy & Security */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">Privacy & Security</h2>
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
        </section>

        {/* Section: Device & Connection */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">Device & Connection</h2>
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
        </section>

        {/* Section: Diagnostics & System */}
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">System</h2>
          <StreamingDiagnostics />
          <SystemDiagnosticsPanel className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl" />
          <BoostPC className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl" />
          <OTAUpdateCard />
        </section>

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
