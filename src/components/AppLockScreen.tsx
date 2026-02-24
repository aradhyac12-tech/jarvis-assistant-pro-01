import { useState, useEffect, useCallback } from "react";
import { Lock, Fingerprint, KeyRound, Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LOCK_ENABLED_KEY = "app_lock_enabled";
const LOCK_METHOD_KEY = "app_lock_method"; // "biometric" | "pin" | "both"
const APP_PIN_KEY = "app_lock_pin";
const LOCK_TIMEOUT_KEY = "app_lock_timeout"; // ms of inactivity before locking

type LockMethod = "biometric" | "pin" | "both";

interface AppLockScreenProps {
  onUnlock: () => void;
}

export function isAppLockEnabled(): boolean {
  return localStorage.getItem(LOCK_ENABLED_KEY) === "true";
}

export function getAppLockMethod(): LockMethod {
  return (localStorage.getItem(LOCK_METHOD_KEY) as LockMethod) || "both";
}

export function getAppPin(): string {
  return localStorage.getItem(APP_PIN_KEY) || "1212";
}

export function getLockTimeout(): number {
  const v = localStorage.getItem(LOCK_TIMEOUT_KEY);
  return v ? parseInt(v, 10) : 0; // 0 = lock immediately on background
}

export function setAppLockSettings(enabled: boolean, method: LockMethod, pin: string, timeout: number) {
  localStorage.setItem(LOCK_ENABLED_KEY, String(enabled));
  localStorage.setItem(LOCK_METHOD_KEY, method);
  localStorage.setItem(APP_PIN_KEY, pin);
  localStorage.setItem(LOCK_TIMEOUT_KEY, String(timeout));
}

export function AppLockScreen({ onUnlock }: AppLockScreenProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricType, setBiometricType] = useState<string>("Biometric");
  const correctPin = getAppPin();
  const method = getAppLockMethod();

  // Check biometric availability
  useEffect(() => {
    const checkBiometric = async () => {
      try {
        const { NativeBiometric } = await import("@capgo/capacitor-native-biometric");
        const result = await NativeBiometric.isAvailable({ useFallback: true });
        setBiometricAvailable(result.isAvailable);
        
        // Determine type name
        const { BiometryType } = await import("@capgo/capacitor-native-biometric");
        switch (result.biometryType) {
          case BiometryType.TOUCH_ID: setBiometricType("Touch ID"); break;
          case BiometryType.FACE_ID: setBiometricType("Face ID"); break;
          case BiometryType.FINGERPRINT: setBiometricType("Fingerprint"); break;
          case BiometryType.FACE_AUTHENTICATION: setBiometricType("Face Unlock"); break;
          case BiometryType.IRIS_AUTHENTICATION: setBiometricType("Iris"); break;
          default: setBiometricType("Biometric"); break;
        }

        // Auto-trigger biometric on mount if method allows
        if (result.isAvailable && (method === "biometric" || method === "both")) {
          triggerBiometric();
        }
      } catch {
        setBiometricAvailable(false);
      }
    };
    checkBiometric();
  }, []);

  const triggerBiometric = useCallback(async () => {
    setBiometricLoading(true);
    try {
      const { NativeBiometric } = await import("@capgo/capacitor-native-biometric");
      await NativeBiometric.verifyIdentity({
        reason: "Unlock Jarvis",
        title: "Jarvis Unlock",
        subtitle: "Verify your identity",
        description: "Use biometrics to unlock the app",
        negativeButtonText: "Use PIN",
        maxAttempts: 3,
      });
      // Success
      onUnlock();
    } catch (err: any) {
      console.log("[AppLock] Biometric failed:", err);
      // User cancelled or failed - they can use PIN
    } finally {
      setBiometricLoading(false);
    }
  }, [onUnlock]);

  const handlePinDigit = (digit: string) => {
    setError(false);
    const newPin = pin + digit;
    setPin(newPin);

    if (newPin.length === correctPin.length) {
      if (newPin === correctPin) {
        onUnlock();
      } else {
        setError(true);
        setTimeout(() => {
          setPin("");
          setError(false);
        }, 500);
      }
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setError(false);
  };

  const showBiometric = biometricAvailable && (method === "biometric" || method === "both");
  const showPin = method === "pin" || method === "both" || !biometricAvailable;

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center p-6">
      {/* Lock icon */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Shield className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-xl font-bold">Jarvis Locked</h1>
        <p className="text-sm text-muted-foreground">
          {showBiometric && showPin 
            ? `Use ${biometricType} or enter PIN` 
            : showBiometric 
              ? `Use ${biometricType} to unlock`
              : "Enter your PIN"}
        </p>
      </div>

      {/* PIN dots */}
      {showPin && (
        <>
          <div className="flex gap-3 mb-8">
            {Array.from({ length: correctPin.length }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "w-4 h-4 rounded-full border-2 transition-all duration-200",
                  i < pin.length 
                    ? error 
                      ? "bg-destructive border-destructive scale-110" 
                      : "bg-primary border-primary scale-110"
                    : "border-muted-foreground/40"
                )}
              />
            ))}
          </div>

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                onClick={() => handlePinDigit(d)}
                className="w-16 h-16 rounded-full bg-secondary/50 hover:bg-secondary active:bg-primary/20 flex items-center justify-center text-xl font-semibold transition-colors"
              >
                {d}
              </button>
            ))}
            {/* Bottom row */}
            {showBiometric ? (
              <button
                onClick={triggerBiometric}
                disabled={biometricLoading}
                className="w-16 h-16 rounded-full bg-secondary/50 hover:bg-secondary flex items-center justify-center transition-colors"
              >
                {biometricLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                ) : (
                  <Fingerprint className="w-6 h-6 text-primary" />
                )}
              </button>
            ) : (
              <div className="w-16 h-16" />
            )}
            <button
              onClick={() => handlePinDigit("0")}
              className="w-16 h-16 rounded-full bg-secondary/50 hover:bg-secondary active:bg-primary/20 flex items-center justify-center text-xl font-semibold transition-colors"
            >
              0
            </button>
            <button
              onClick={handleDelete}
              className="w-16 h-16 rounded-full bg-secondary/50 hover:bg-secondary flex items-center justify-center transition-colors"
            >
              <KeyRound className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
        </>
      )}

      {/* Biometric only mode (no PIN pad) */}
      {showBiometric && !showPin && (
        <Button
          onClick={triggerBiometric}
          disabled={biometricLoading}
          size="lg"
          className="gap-2"
        >
          {biometricLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Fingerprint className="w-5 h-5" />
          )}
          Unlock with {biometricType}
        </Button>
      )}
    </div>
  );
}
