import { Shield, Fingerprint, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SecurityCardProps {
  appLockEnabled: boolean;
  lockMethod: "biometric" | "pin" | "both";
  appPin: string;
  biometricAvail: boolean;
  biometricTypeName: string;
  onToggleLock: (v: boolean) => void;
  onSetLockMethod: (m: "biometric" | "pin" | "both") => void;
  onSetPin: (v: string) => void;
}

export function SecurityCard({
  appLockEnabled, lockMethod, appPin,
  biometricAvail, biometricTypeName,
  onToggleLock, onSetLockMethod, onSetPin,
}: SecurityCardProps) {
  return (
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center gap-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className="w-8 h-8 rounded-xl bg-accent-green/10 flex items-center justify-center">
            <Shield className="h-4 w-4 text-[hsl(var(--accent-green))]" />
          </div>
          Security
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">App Lock</p>
            <p className="text-xs text-muted-foreground">Lock when backgrounded</p>
          </div>
          <Switch checked={appLockEnabled} onCheckedChange={onToggleLock} />
        </div>

        {appLockEnabled && (
          <div className="space-y-3 pt-3 border-t border-border/10">
            <Label className="text-xs text-muted-foreground">Unlock Method</Label>
            <div className="flex gap-2">
              {(biometricAvail ? ["biometric", "pin", "both"] as const : ["pin"] as const).map((m) => (
                <Button
                  key={m}
                  variant={lockMethod === m ? "default" : "outline"}
                  size="sm"
                  className="flex-1 h-9 text-xs gap-1.5 rounded-xl"
                  onClick={() => onSetLockMethod(m)}
                >
                  {m === "biometric" && <><Fingerprint className="h-3.5 w-3.5" />{biometricTypeName}</>}
                  {m === "pin" && <><Lock className="h-3.5 w-3.5" />PIN</>}
                  {m === "both" && <><Fingerprint className="h-3.5 w-3.5" />Both</>}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {biometricAvail
                ? `${biometricTypeName} detected on this device`
                : "No biometric hardware — install as APK for fingerprint/face unlock"}
            </p>

            {(lockMethod === "pin" || lockMethod === "both") && (
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs text-muted-foreground">App PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  value={appPin}
                  onChange={(e) => onSetPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  className="h-9 text-sm rounded-xl bg-secondary/30 border-border/10"
                  placeholder="4-6 digit PIN"
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
