import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, AppWindow, Chrome, Code, FileText, Image, Music, Video, Mail, Calculator, Terminal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

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
  const { user } = useAuth();

  const filteredApps = defaultApps.filter((app) => {
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || app.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleOpenApp = async (app: App) => {
    setIsOpening(app.id);
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis-command`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            commandType: "app_open",
            payload: { name: app.name },
            userId: user?.id,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to open app");
      
      toast({ title: "Opening App", description: `Launching ${app.name}...` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to open app", variant: "destructive" });
    } finally {
      setIsOpening(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold neon-text">Apps</h1>
          <p className="text-muted-foreground">Launch applications on your PC</p>
        </div>

        {/* Search and Filter */}
        <Card className="glass-dark border-border/50">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
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
                    className={cn(selectedCategory === category && "gradient-primary")}
                  >
                    {category}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Apps Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredApps.map((app) => (
            <Card
              key={app.id}
              className="glass-dark border-border/50 hover:border-primary/50 transition-all cursor-pointer hover-scale group"
              onClick={() => handleOpenApp(app)}
            >
              <CardContent className="p-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/10 transition-colors">
                  {isOpening === app.id ? (
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  ) : (
                    <app.icon className={cn("h-8 w-8", app.color)} />
                  )}
                </div>
                <p className="font-medium truncate">{app.name}</p>
                <Badge variant="secondary" className="mt-2 text-xs">
                  {app.category}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredApps.length === 0 && (
          <Card className="glass-dark border-border/50">
            <CardContent className="p-12 text-center">
              <AppWindow className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No apps found matching your search.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
