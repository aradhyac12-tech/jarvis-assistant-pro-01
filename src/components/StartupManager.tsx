import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Rocket, Loader2, RefreshCw, Search, Trash2, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";
import { useDeviceContext } from "@/hooks/useDeviceContext";
import { useToast } from "@/hooks/use-toast";

interface StartupItem {
  name: string;
  command: string;
  location: string;
  enabled: boolean;
  publisher?: string;
  impact?: "high" | "medium" | "low" | "none" | string;
}

const impactColor: Record<string, string> = {
  high: "text-destructive",
  medium: "text-amber-500",
  low: "text-muted-foreground",
  none: "text-muted-foreground",
};

export function StartupManager({ className }: { className?: string }) {
  const { sendCommand } = useDeviceCommands();
  const { selectedDevice } = useDeviceContext();
  const { toast } = useToast();
  const isConnected = selectedDevice?.is_online || false;

  const [items, setItems] = useState<StartupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchStartup = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const result = await sendCommand("get_startup_items", {}, { awaitResult: true, timeoutMs: 10000 });
      if (result.success && "result" in result) {
        const r = result.result as any;
        const list = r.items || r.startup_items || [];
        setItems(list.map((i: any) => ({
          name: i.name || i.label || "Unknown",
          command: i.command || i.path || "",
          location: i.location || i.source || "Registry",
          enabled: i.enabled !== false,
          publisher: i.publisher || null,
          impact: (i.impact || i.startup_impact || "none").toLowerCase(),
        })));
        setFetched(true);
      }
    } catch {
      toast({ title: "Failed to fetch startup items", variant: "destructive" });
    }
    setLoading(false);
  }, [isConnected, sendCommand, toast]);

  const toggleItem = useCallback(async (item: StartupItem) => {
    setToggling(item.name);
    try {
      const result = await sendCommand(
        "toggle_startup_item",
        { name: item.name, command: item.command, location: item.location, enabled: !item.enabled },
        { awaitResult: true, timeoutMs: 8000 }
      );
      if (result.success) {
        setItems(prev => prev.map(i =>
          i.name === item.name ? { ...i, enabled: !i.enabled } : i
        ));
        toast({ title: `${item.name} ${!item.enabled ? "enabled" : "disabled"}` });
      } else {
        toast({ title: "Toggle failed", description: String((result as any).error), variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Toggle failed", variant: "destructive" });
    }
    setToggling(null);
  }, [sendCommand, toast]);

  if (!isConnected) return null;

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.publisher || "").toLowerCase().includes(search.toLowerCase())
  );

  const enabledCount = items.filter(i => i.enabled).length;
  const highImpact = items.filter(i => i.enabled && i.impact === "high").length;

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardHeader className="pb-1.5 pt-3 px-3">
        <CardTitle className="text-xs flex items-center gap-2">
          <Rocket className="h-3.5 w-3.5 text-primary" />
          Startup Manager
          <div className="ml-auto flex items-center gap-1.5">
            {fetched && (
              <Badge variant="secondary" className="text-[8px] h-4 px-1.5">
                {enabledCount}/{items.length}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={fetchStartup}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 text-muted-foreground" />}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {!fetched ? (
          <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5" onClick={fetchStartup} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
            Load Startup Items
          </Button>
        ) : (
          <>
            {highImpact > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span className="text-[10px] text-amber-500 font-medium">
                  {highImpact} high-impact {highImpact === 1 ? "app" : "apps"} slowing boot
                </span>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Search startup items..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-7 text-[10px] pl-7 pr-2 bg-secondary/10 border-border/20"
              />
            </div>

            <ScrollArea className="max-h-52">
              <div className="divide-y divide-border/10">
                {filtered.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-3">
                    {search ? "No matches" : "No startup items found"}
                  </p>
                ) : (
                  filtered.map(item => (
                    <div
                      key={item.name}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 transition-colors",
                        !item.enabled && "opacity-50"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium truncate">{item.name}</p>
                        <div className="flex items-center gap-1.5">
                          {item.publisher && (
                            <span className="text-[8px] text-muted-foreground truncate max-w-[100px]">{item.publisher}</span>
                          )}
                          {item.impact && item.impact !== "none" && (
                            <Badge variant="outline" className={cn("text-[7px] h-3 px-1 border-0", impactColor[item.impact] || "text-muted-foreground")}>
                              {item.impact}
                            </Badge>
                          )}
                          <span className="text-[8px] text-muted-foreground">{item.location}</span>
                        </div>
                      </div>
                      <Switch
                        checked={item.enabled}
                        onCheckedChange={() => toggleItem(item)}
                        disabled={toggling === item.name}
                        className="scale-75"
                      />
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}
