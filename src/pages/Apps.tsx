import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  AppWindow,
  Chrome,
  Code,
  FileText,
  Image,
  Music,
  Video,
  Mail,
  Calculator,
  Terminal,
  Loader2,
  RefreshCw,
  Play,
  Square,
  X,
  Cpu,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface QuickApp {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  color: string;
}

interface RunningApp {
  pid: number;
  name: string;
  memory: number;
  cpu: number;
}

type InstalledApp = {
  name: string;
  app_id?: string | null;
  source?: string;
};

const quickApps: QuickApp[] = [
  { id: "chrome", name: "Google Chrome", icon: Chrome, category: "Browser", color: "text-neon-blue" },
  { id: "firefox", name: "Firefox", icon: Chrome, category: "Browser", color: "text-neon-orange" },
  { id: "edge", name: "Microsoft Edge", icon: Chrome, category: "Browser", color: "text-neon-cyan" },
  { id: "vscode", name: "VS Code", icon: Code, category: "Development", color: "text-neon-blue" },
  { id: "notepad", name: "Notepad", icon: FileText, category: "Productivity", color: "text-neon-cyan" },
  { id: "spotify", name: "Spotify", icon: Music, category: "Media", color: "text-neon-green" },
  { id: "vlc", name: "VLC Player", icon: Video, category: "Media", color: "text-neon-orange" },
  { id: "discord", name: "Discord", icon: AppWindow, category: "Communication", color: "text-neon-purple" },
  { id: "outlook", name: "Outlook", icon: Mail, category: "Productivity", color: "text-neon-blue" },
  { id: "calculator", name: "Calculator", icon: Calculator, category: "Utilities", color: "text-neon-purple" },
  { id: "terminal", name: "Terminal", icon: Terminal, category: "Development", color: "text-foreground" },
  { id: "explorer", name: "File Explorer", icon: AppWindow, category: "Utilities", color: "text-neon-orange" },
  { id: "task manager", name: "Task Manager", icon: Cpu, category: "Utilities", color: "text-neon-green" },
  { id: "settings", name: "Settings", icon: AppWindow, category: "Utilities", color: "text-muted-foreground" },
  { id: "paint", name: "Paint", icon: Image, category: "Media", color: "text-neon-pink" },
  { id: "steam", name: "Steam", icon: AppWindow, category: "Gaming", color: "text-neon-blue" },
];

const categories = [
  "All",
  "Browser",
  "Development",
  "Productivity",
  "Media",
  "Utilities",
  "Communication",
  "Gaming",
];

export default function Apps() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [isOpening, setIsOpening] = useState<string | null>(null);

  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const [isLoadingRunning, setIsLoadingRunning] = useState(false);

  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [isLoadingInstalled, setIsLoadingInstalled] = useState(false);

  const [customAppName, setCustomAppName] = useState("");

  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();

  const filteredQuickApps = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return quickApps.filter((app) => {
      const matchesSearch = !q || app.name.toLowerCase().includes(q);
      const matchesCategory = selectedCategory === "All" || app.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  const filteredInstalledApps = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return installedApps;
    return installedApps.filter((a) => a.name.toLowerCase().includes(q));
  }, [installedApps, searchQuery]);

  const fetchRunningApps = async () => {
    setIsLoadingRunning(true);
    const res = await sendCommand("get_running_apps", {}, { awaitResult: true, timeoutMs: 10000 });

    const result = (res as any).result as Record<string, unknown> | undefined;
    if (res.success && result?.apps) {
      setRunningApps(result.apps as RunningApp[]);
    } else {
      toast({
        title: "Could not fetch running apps",
        description: typeof (res as any).error === "string" ? (res as any).error : "Try again.",
        variant: "destructive",
      });
    }

    setIsLoadingRunning(false);
  };

  const fetchInstalledApps = async () => {
    setIsLoadingInstalled(true);
    const res = await sendCommand("get_installed_apps", {}, { awaitResult: true, timeoutMs: 20000 });

    const result = (res as any).result as Record<string, unknown> | undefined;
    if (res.success && Array.isArray(result?.apps)) {
      setInstalledApps(result!.apps as InstalledApp[]);
    } else {
      toast({
        title: "Could not fetch installed apps",
        description: typeof (res as any).error === "string" ? (res as any).error : "Try again.",
        variant: "destructive",
      });
    }

    setIsLoadingInstalled(false);
  };

  const refreshAll = async () => {
    await Promise.all([fetchInstalledApps(), fetchRunningApps()]);
  };

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenApp = async (appName: string, opts?: { openKey?: string; appId?: string | null }) => {
    const openKey = opts?.openKey ?? appName;
    setIsOpening(openKey);

    try {
      const res = await sendCommand(
        "open_app",
        { app_name: appName, app_id: opts?.appId ?? null },
        { awaitResult: true, timeoutMs: 15000 }
      );

      const result = (res as any).result as Record<string, unknown> | undefined;

      if (res.success) {
        toast({
          title: "App opened",
          description: (result?.message as string) ?? `Opened ${appName}`,
        });
      } else {
        const errorMsg = typeof (res as any).error === "string" 
          ? (res as any).error 
          : (result?.error as string) || `Could not open ${appName}`;
        
        // Don't show error for session issues - just retry
        if (!errorMsg.includes("session")) {
          toast({
            title: "App failed to open",
            description: errorMsg,
            variant: "destructive",
          });
        }
      }
    } catch (err) {
      console.error("Open app error:", err);
    }

    setIsOpening(null);
  };

  const handleCloseApp = async (appName: string) => {
    const res = await sendCommand("close_app", { app_name: appName }, { awaitResult: true, timeoutMs: 12000 });

    if (res.success) {
      toast({ title: "Closing App", description: `Closing ${appName}...` });
      setTimeout(() => void fetchRunningApps(), 1200);
    } else {
      toast({
        title: "Close failed",
        description: typeof (res as any).error === "string" ? (res as any).error : `Could not close ${appName}`,
        variant: "destructive",
      });
    }
  };

  const handleOpenCustomApp = async () => {
    if (!customAppName.trim()) return;
    await handleOpenApp(customAppName.trim());
    setCustomAppName("");
  };

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-2rem)]">
        <main className="space-y-4 animate-fade-in pr-4 pt-12 md:pt-0">
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold neon-text">Apps</h1>
              <p className="text-muted-foreground text-sm">Launch and manage applications</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshAll()}
              disabled={isLoadingRunning || isLoadingInstalled}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4 mr-2",
                  (isLoadingRunning || isLoadingInstalled) && "animate-spin"
                )}
              />
              Refresh
            </Button>
          </header>

          <section aria-label="Launch custom app">
            <Card className="glass-dark border-border/50">
              <CardContent className="p-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter app name to launch (e.g., discord, steam, word)..."
                    value={customAppName}
                    onChange={(e) => setCustomAppName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleOpenCustomApp()}
                    className="flex-1"
                  />
                  <Button
                    onClick={() => void handleOpenCustomApp()}
                    disabled={!customAppName.trim()}
                    className="gradient-primary"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Launch
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

          <section aria-label="Apps tabs">
            <Tabs defaultValue="installed" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-4">
                <TabsTrigger value="installed">
                  Installed
                  {installedApps.length > 0 && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {installedApps.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="quick">Quick</TabsTrigger>
                <TabsTrigger value="running">
                  Running
                  {runningApps.length > 0 && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {runningApps.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <Card className="glass-dark border-border/50 mb-4">
                <CardContent className="p-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search apps..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </CardContent>
              </Card>

              <TabsContent value="installed">
                <Card className="glass-dark border-border/50">
                  <CardContent className="p-4">
                    {isLoadingInstalled ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      </div>
                    ) : filteredInstalledApps.length > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {filteredInstalledApps.slice(0, 200).map((app) => {
                          const openKey = app.app_id ?? app.name;
                          return (
                            <button
                              key={openKey}
                              type="button"
                              className="text-left"
                              onClick={() => void handleOpenApp(app.name, { openKey, appId: app.app_id ?? null })}
                            >
                              <div className="p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                                  {isOpening === openKey ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                  ) : (
                                    <AppWindow className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-sm truncate">{app.name}</p>
                                  {app.source && (
                                    <p className="text-xs text-muted-foreground truncate">{app.source}</p>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <Square className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">No installed apps detected</p>
                        <p className="text-xs text-muted-foreground mt-1">Click Refresh to fetch from your PC</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="quick">
                <Card className="glass-dark border-border/50 mb-4">
                  <CardContent className="p-3">
                    <div className="flex gap-2 flex-wrap">
                      {categories.slice(0, 6).map((category) => (
                        <Button
                          key={category}
                          variant={selectedCategory === category ? "default" : "secondary"}
                          size="sm"
                          onClick={() => setSelectedCategory(category)}
                          className={cn("text-xs", selectedCategory === category && "gradient-primary")}
                        >
                          {category}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {filteredQuickApps.map((app) => (
                    <Card
                      key={app.id}
                      className="glass-dark border-border/50 hover:border-primary/50 transition-all cursor-pointer hover-scale group"
                      onClick={() => void handleOpenApp(app.name, { openKey: app.id })}
                    >
                      <CardContent className="p-3 md:p-4 text-center">
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-secondary/50 flex items-center justify-center mx-auto mb-2 group-hover:bg-primary/10 transition-colors">
                          {isOpening === app.id ? (
                            <Loader2 className="h-5 w-5 md:h-6 md:w-6 animate-spin text-primary" />
                          ) : (
                            <app.icon className={cn("h-5 w-5 md:h-6 md:w-6", app.color)} />
                          )}
                        </div>
                        <p className="font-medium truncate text-xs md:text-sm">{app.name}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {filteredQuickApps.length === 0 && (
                  <Card className="glass-dark border-border/50">
                    <CardContent className="p-8 text-center">
                      <AppWindow className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No apps found.</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="running">
                <Card className="glass-dark border-border/50">
                  <CardContent className="p-4">
                    {isLoadingRunning ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      </div>
                    ) : runningApps.length > 0 ? (
                      <div className="space-y-2">
                        {runningApps.map((app, index) => (
                          <div
                            key={`${app.name}-${index}`}
                            className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                                <AppWindow className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-sm truncate">{app.name}</p>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Zap className="h-3 w-3" />
                                    {app.memory}% RAM
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Cpu className="h-3 w-3" />
                                    {app.cpu}% CPU
                                  </span>
                                </div>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                              onClick={() => void handleCloseApp(app.name)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <Square className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">No running apps detected</p>
                        <p className="text-xs text-muted-foreground mt-1">Click Refresh to fetch from your PC</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </section>
        </main>
      </ScrollArea>
    </DashboardLayout>
  );
}
