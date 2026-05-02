import { useEffect, useState, useCallback } from "react";
import { MapPin, Lock, Loader2, CloudOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useP2PCommand } from "@/hooks/useP2PCommand";
import { useOfflineCommandQueue } from "@/hooks/useOfflineCommandQueue";

const LS_ENABLED = "proximity_enabled";
const LS_AWAY = "proximity_away_threshold";
const LS_GRACE = "proximity_grace_period";
const LS_PIN = "proximity_unlock_pin";

export function ProximityCard() {
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();
  const { connectionMode } = useP2PCommand();

  const [enabled, setEnabled] = useState(() => localStorage.getItem(LS_ENABLED) !== "false");
  const [awayThreshold, setAwayThreshold] = useState(() => Number(localStorage.getItem(LS_AWAY)) || 30);
  const [gracePeriod, setGracePeriod] = useState(() => Number(localStorage.getItem(LS_GRACE)) || 15);
  const [pin, setPin] = useState(() => localStorage.getItem(LS_PIN) || "1212");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => localStorage.setItem(LS_ENABLED, String(enabled)), [enabled]);
  useEffect(() => localStorage.setItem(LS_AWAY, String(awayThreshold)), [awayThreshold]);
  useEffect(() => localStorage.setItem(LS_GRACE, String(gracePeriod)), [gracePeriod]);
  useEffect(() => localStorage.setItem(LS_PIN, pin), [pin]);

  // Adapter so the offline queue can call our sendCommand signature
  const queueSend = useCallback(
    async (type: string, payload: Record<string, unknown> = {}) => {
      const result = await sendCommand(type, payload);
      if (result?.success === false) {
        throw new Error((result as any)?.error || "Send failed");
      }
      return result;
    },
    [sendCommand]
  );

  const queue = useOfflineCommandQueue(connectionMode, queueSend);
  const isOffline = connectionMode === "disconnected";

  const pushToPC = async () => {
    setSyncing(true);
    const payload = {
      enabled,
      away_threshold: awayThreshold,
      grace_period: gracePeriod,
      pin,
    };

    try {
      if (isOffline) {
        // Buffer until connectivity returns. Use long TTL so the latest
        // settings still apply when the agent comes back hours later.
        await queue.enqueue("set_proximity_config", payload, 24 * 60 * 60 * 1000);
        toast({
          title: "Saved offline",
          description: "Will sync to your PC automatically when reconnected",
        });
      } else {
        const result = await sendCommand("set_proximity_config", payload);
        if (result?.success === false) throw new Error((result as any)?.error || "Failed");
        toast({ title: "Proximity settings synced", description: "Updated on your PC" });
      }
    } catch (e: any) {
      // Network error while we thought we were online — fall back to queue
      try {
        await queue.enqueue("set_proximity_config", payload, 24 * 60 * 60 * 1000);
        toast({
          title: "Queued for later",
          description: "Could not reach PC — will retry automatically",
        });
      } catch {
        toast({
          title: "Sync failed",
          description: e?.message || "Could not reach PC agent",
          variant: "destructive",
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center justify-between text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            Proximity Auto-Lock
          </div>
          {(queue.pendingCount > 0 || queue.isReplaying) && (
            <Badge variant="secondary" className="gap-1 text-[10px] normal-case font-medium">
              <CloudOff className="h-3 w-3" />
              {queue.isReplaying ? "Syncing…" : `${queue.pendingCount} queued`}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable Proximity Lock</p>
            <p className="text-xs text-muted-foreground">
              Auto-lock PC when you're away, unlock when nearby
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className={enabled ? "space-y-5 pt-3 border-t border-border/10" : "space-y-5 pt-3 border-t border-border/10 opacity-50 pointer-events-none"}>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Away Threshold</Label>
              <span className="text-xs font-medium tabular-nums">{awayThreshold}s</span>
            </div>
            <Slider
              value={[awayThreshold]}
              onValueChange={(v) => setAwayThreshold(v[0])}
              min={10}
              max={120}
              step={5}
            />
            <p className="text-[10px] text-muted-foreground">
              Time without presence signal before marking you as away
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Grace Period</Label>
              <span className="text-xs font-medium tabular-nums">{gracePeriod}s</span>
            </div>
            <Slider
              value={[gracePeriod]}
              onValueChange={(v) => setGracePeriod(v[0])}
              min={0}
              max={60}
              step={5}
            />
            <p className="text-[10px] text-muted-foreground">
              Wait this long after going away before locking
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Lock className="h-3 w-3" /> PC Unlock PIN
            </Label>
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              maxLength={8}
              className="h-9 text-sm rounded-xl bg-secondary/30 border-border/10"
              placeholder="4-8 digit PIN"
            />
            <p className="text-[10px] text-muted-foreground">
              Used to auto-unlock your PC when you return. Default: 1212
            </p>
          </div>
        </div>

        <Button
          onClick={pushToPC}
          disabled={syncing || (pin.length < 4)}
          className="w-full h-9 rounded-xl"
          size="sm"
        >
          {syncing ? (
            <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Syncing…</>
          ) : isOffline ? (
            "Save (offline — will sync later)"
          ) : (
            "Sync to PC"
          )}
        </Button>

        {queue.lastError && (
          <p className="text-[10px] text-destructive">Last queue error: {queue.lastError}</p>
        )}
      </CardContent>
    </Card>
  );
}
