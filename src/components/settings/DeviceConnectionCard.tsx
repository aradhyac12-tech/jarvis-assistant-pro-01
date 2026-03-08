import { Monitor, Link2Off } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface DeviceConnectionCardProps {
  deviceName: string;
  isConnected: boolean;
  onUnpair: () => void;
}

export function DeviceConnectionCard({ deviceName, isConnected, onUnpair }: DeviceConnectionCardProps) {
  return (
    <Card className="border-border/10 bg-card/40 backdrop-blur-sm rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="flex items-center gap-3 text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          <div className="w-8 h-8 rounded-xl bg-accent-blue/10 flex items-center justify-center">
            <Monitor className="h-4 w-4 text-primary" />
          </div>
          Device
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-1 space-y-3">
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 border border-border/5">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-[hsl(var(--success))] shadow-[0_0_8px_hsl(var(--success)/0.5)]' : 'bg-muted-foreground'}`} />
            <div>
              <p className="text-sm font-medium">{deviceName}</p>
              <p className="text-xs text-muted-foreground">{isConnected ? "Connected" : "Offline"}</p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] rounded-lg px-2 ${isConnected ? "bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.2)]" : ""}`}
          >
            {isConnected ? "Online" : "Offline"}
          </Badge>
        </div>
        <Button variant="outline" className="w-full h-9 text-sm rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20" onClick={onUnpair}>
          <Link2Off className="h-3.5 w-3.5 mr-2" /> Unpair Device
        </Button>
      </CardContent>
    </Card>
  );
}
