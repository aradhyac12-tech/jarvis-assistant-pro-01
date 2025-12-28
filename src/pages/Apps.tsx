import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, AppWindow, Chrome, Code, FileText, Image, Music, Video, Mail, Calculator, Terminal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceCommands } from "@/hooks/useDeviceCommands";

interface App {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  color: string;
}

const defaultApps: App[] = [
  { id: "chrome", name: "Google Chrome", icon: Chrome, category: "Browser", color: "text-neon-blue" },
  { id: "vscode", name: "VS Code", icon: Code, category: "Development", color: "text-neon-blue" },
  { id: "notepad", name: "Notepad", icon: FileText, category: "Productivity", color: "text-neon-cyan" },
  { id: "photos", name: "Photos", icon: Image, category: "Media", color: "text-neon-pink" },
  { id: "spotify", name: "Spotify", icon: Music, category: "Media", color: "text-neon-green" },
  { id: "vlc", name: "VLC Player", icon: Video, category: "Media", color: "text-neon-orange" },
  { id: "outlook", name: "Outlook", icon: Mail, category: "Productivity", color: "text-neon-blue" },
  { id: "calculator", name: "Calculator", icon: Calculator, category: "Utilities", color: "text-neon-purple" },
  { id: "terminal", name: "Terminal", icon: Terminal, category: "Development", color: "text-foreground" },
];

const categories = ["All", "Browser", "Development", "Productivity", "Media", "Utilities"];

export default function Apps() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [isOpening, setIsOpening] = useState<string | null>(null);
  const { toast } = useToast();
  const { sendCommand } = useDeviceCommands();

  const filteredApps = defaultApps.filter((app) => {
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || app.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleOpenApp = async (app: App) => {
    setIsOpening(app.id);
    
    const result = await sendCommand("open_app", { app_name: app.name });
    
    if (result.success) {
      toast({ title: "Opening App", description: `Launching ${app.name}...` });
    }
    
    setIsOpening(null);
  };

  return (
    <DashboardLayout>
      <ScrollArea className="h-[calc(100vh-6rem)]">
        <div className="space-y-6 animate-fade-in pr-4">
          {/* Header */}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold neon-text">Apps</h1>
            <p className="text-muted-foreground text-sm md:text-base">Launch applications on your PC</p>
          </div>

          {/* Search and Filter */}
          <Card className="glass-dark border-border/50">
            <CardContent className="p-3 md:p-4">
              <div className="flex flex-col md:flex-row gap-3 md:gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search apps..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {categories.map((category) => (
                    <Button
                      key={category}
                      variant={selectedCategory === category ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setSelectedCategory(category)}
                      className={cn(
                        "text-xs md:text-sm",
                        selectedCategory === category && "gradient-primary"
                      )}
                    >
                      {category}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Apps Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
            {filteredApps.map((app) => (
              <Card
                key={app.id}
                className="glass-dark border-border/50 hover:border-primary/50 transition-all cursor-pointer hover-scale group"
                onClick={() => handleOpenApp(app)}
              >
                <CardContent className="p-4 md:p-6 text-center">
                  <div className="w-12 h-12 md:w-16 md:h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mx-auto mb-3 md:mb-4 group-hover:bg-primary/10 transition-colors">
                    {isOpening === app.id ? (
                      <Loader2 className="h-6 w-6 md:h-8 md:w-8 animate-spin text-primary" />
                    ) : (
                      <app.icon className={cn("h-6 w-6 md:h-8 md:w-8", app.color)} />
                    )}
                  </div>
                  <p className="font-medium truncate text-sm md:text-base">{app.name}</p>
                  <Badge variant="secondary" className="mt-2 text-xs">
                    {app.category}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredApps.length === 0 && (
            <Card className="glass-dark border-border/50">
              <CardContent className="p-8 md:p-12 text-center">
                <AppWindow className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No apps found matching your search.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </DashboardLayout>
  );
}
