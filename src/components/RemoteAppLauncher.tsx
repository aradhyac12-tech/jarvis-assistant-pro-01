import { useState, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AppWindow,
  Search,
  Loader2,
  RefreshCw,
  Play,
  Grid3X3,
  List,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface InstalledApp {
  name: string;
  app_id?: string | null;
  source?: string;
}

interface RemoteAppLauncherProps {
  isConnected: boolean;
  className?: string;
}

export function RemoteAppLauncher({ isConnected, className }: RemoteAppLauncherProps) {
  const { sendCommand } = useDeviceCommands();
  const { toast } = useToast();

  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [openingApp, setOpeningApp] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const fetchApps = useCallback(async () => {
    if (!isConnected) return;
    setIsLoading(true);
    try {
      const result = await sendCommand("get_installed_apps", {}, { awaitResult: true, timeoutMs: 20000 });
      if (result?.success && "result" in result && result.result) {
        const data = result.result as { apps?: InstalledApp[] };
        if (data.apps) {
          setApps(data.apps);
        }
      }
    } catch {
      toast({ title: "Failed to load apps", variant: "destructive" });
    }
    setIsLoading(false);
  }, [isConnected, sendCommand, toast]);

  useEffect(() => {
    if (isConnected && apps.length === 0) {
      fetchApps();
    }
  }, [isConnected]); // eslint-disable-line

  const filteredApps = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return apps;
    return apps.filter((a) => a.name.toLowerCase().includes(q));
  }, [apps, search]);

  const launchApp = useCallback(async (app: InstalledApp) => {
    const key = app.app_id ?? app.name;
    setOpeningApp(key);
    try {
      const result = await sendCommand(
        "open_app",
        { app_name: app.name, app_id: app.app_id ?? null },
        { awaitResult: true, timeoutMs: 15000 }
      );
      if (result?.success) {
        toast({ title: "App launched", description: app.name });
      } else {
        toast({ title: "Launch failed", description: (result as any)?.error || app.name, variant: "destructive" });
      }
    } catch {
      toast({ title: "Launch failed", variant: "destructive" });
    }
    setOpeningApp(null);
  }, [sendCommand, toast]);

  // Color hash for app icons
  const getAppColor = (name: string) => {
    const colors = [
      "bg-blue-500/15 text-blue-400",
      "bg-green-500/15 text-green-400",
      "bg-purple-500/15 text-purple-400",
      "bg-orange-500/15 text-orange-400",
      "bg-pink-500/15 text-pink-400",
      "bg-cyan-500/15 text-cyan-400",
      "bg-amber-500/15 text-amber-400",
      "bg-indigo-500/15 text-indigo-400",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <Card className={cn("border-border/20 bg-card/50", className)}>
      <CardContent className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AppWindow className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">App Launcher</span>
            {apps.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {apps.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            >
              {viewMode === "grid" ? <List className="w-3 h-3" /> : <Grid3X3 className="w-3 h-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={fetchApps}
              disabled={isLoading}
            >
              <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>

        {/* App Grid/List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="py-6 text-center">
            <AppWindow className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-[10px] text-muted-foreground">
              {apps.length === 0 ? "No apps loaded. Tap refresh." : "No matching apps"}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[40vh]">
            {viewMode === "grid" ? (
              <div className="grid grid-cols-3 gap-2 pr-2">
                {filteredApps.slice(0, 150).map((app) => {
                  const key = app.app_id ?? app.name;
                  const isOpening = openingApp === key;
                  return (
                    <button
                      key={key}
                      className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg bg-secondary/20 hover:bg-secondary/40 active:bg-secondary/60 transition-all"
                      onClick={() => launchApp(app)}
                      disabled={isOpening}
                    >
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", getAppColor(app.name))}>
                        {isOpening ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <AppWindow className="w-4 h-4" />
                        )}
                      </div>
                      <span className="text-[10px] font-medium text-center leading-tight line-clamp-2 w-full">
                        {app.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-0.5 pr-2">
                {filteredApps.slice(0, 200).map((app) => {
                  const key = app.app_id ?? app.name;
                  const isOpening = openingApp === key;
                  return (
                    <button
                      key={key}
                      className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-secondary/30 active:bg-secondary/50 transition-colors text-left"
                      onClick={() => launchApp(app)}
                      disabled={isOpening}
                    >
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", getAppColor(app.name))}>
                        {isOpening ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <AppWindow className="w-3.5 h-3.5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{app.name}</p>
                        {app.source && (
                          <p className="text-[10px] text-muted-foreground truncate">{app.source}</p>
                        )}
                      </div>
                      <Play className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
