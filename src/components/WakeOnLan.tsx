import { useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Power, Loader2, Wifi, WifiOff, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface WakeOnLanProps {
  isConnected: boolean;
  deviceId?: string;
  systemInfo?: Record<string, any> | null;
  className?: string;
}

export function WakeOnLan({ isConnected, deviceId, systemInfo, className }: WakeOnLanProps) {
  const { toast } = useToast();
  const [macAddress, setMacAddress] = useState(() => {
    return localStorage.getItem("wol_mac") || "";
  });
  const [broadcastIp, setBroadcastIp] = useState(() => {
    return localStorage.getItem("wol_broadcast") || "255.255.255.255";
  });
  const [isSending, setIsSending] = useState(false);

  // Auto-detect MAC from system_info if available
  useEffect(() => {
    if (systemInfo && !macAddress) {
      const mac = (systemInfo as any)?.mac_address || (systemInfo as any)?.network?.mac;
      if (mac) {
        setMacAddress(mac);
        localStorage.setItem("wol_mac", mac);
      }
    }
  }, [systemInfo, macAddress]);

  const saveMac = useCallback(() => {
    localStorage.setItem("wol_mac", macAddress);
    localStorage.setItem("wol_broadcast", broadcastIp);
    toast({ title: "Settings saved" });
  }, [macAddress, broadcastIp, toast]);

  const sendWakePacket = useCallback(async () => {
    if (!macAddress.trim()) {
      toast({ title: "Enter MAC address", variant: "destructive" });
      return;
    }
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("wake-on-lan", {
        body: { mac_address: macAddress.trim(), broadcast_ip: broadcastIp.trim() },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: "⚡ Wake packet sent!", description: `Magic packet sent to ${macAddress}` });
      } else {
        toast({ title: "Wake failed", description: data?.error || "Unknown error", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Wake failed", description: err.message, variant: "destructive" });
    }
    setIsSending(false);
  }, [macAddress, broadcastIp, toast]);

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardContent className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Power className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Wake-on-LAN</span>
          </div>
          <Badge
            variant="outline"
            className={cn("text-[10px] px-1.5 py-0",
              isConnected ? "text-emerald-400 border-emerald-500/20" : "text-muted-foreground"
            )}
          >
            {isConnected ? (
              <><Wifi className="w-2.5 h-2.5 mr-1" /> Online</>
            ) : (
              <><WifiOff className="w-2.5 h-2.5 mr-1" /> Offline</>
            )}
          </Badge>
        </div>

        {/* MAC Address */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground">MAC Address</label>
          <div className="flex gap-1.5">
            <Input
              placeholder="AA:BB:CC:DD:EE:FF"
              value={macAddress}
              onChange={(e) => setMacAddress(e.target.value)}
              className="h-8 text-xs font-mono"
            />
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={saveMac}>
              <Save className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Broadcast IP (advanced) */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-muted-foreground">Broadcast IP (optional)</label>
          <Input
            placeholder="255.255.255.255"
            value={broadcastIp}
            onChange={(e) => setBroadcastIp(e.target.value)}
            className="h-8 text-xs font-mono"
          />
        </div>

        {/* Wake Button */}
        <Button
          className="w-full gap-2"
          onClick={sendWakePacket}
          disabled={isSending || !macAddress.trim()}
          variant={isConnected ? "outline" : "default"}
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Power className="w-4 h-4" />
          )}
          {isSending ? "Sending..." : isConnected ? "PC is Online — Send Anyway" : "Wake Up PC"}
        </Button>

        <p className="text-[9px] text-muted-foreground text-center">
          Sends a magic packet via your network to power on the PC
        </p>
      </CardContent>
    </Card>
  );
}
