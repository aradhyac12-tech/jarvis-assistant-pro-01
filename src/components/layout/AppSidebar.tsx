import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Mic,
  Settings2,
  Monitor,
  Music,
  FolderOpen,
  Keyboard,
  AppWindow,
  ChevronLeft,
  ChevronRight,
  Bot,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Voice AI", url: "/voice", icon: Mic },
  { title: "System Controls", url: "/controls", icon: Monitor },
  { title: "Music Player", url: "/music", icon: Music },
  { title: "Apps", url: "/apps", icon: AppWindow },
  { title: "Files", url: "/files", icon: FolderOpen },
  { title: "Remote Control", url: "/remote", icon: Keyboard },
  { title: "Settings", url: "/settings", icon: Settings2 },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { toast } = useToast();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({ title: "Signed out successfully" });
  };

  return (
    <aside
      className={cn(
        "h-screen flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out relative",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center pulse-neon">
              <Bot className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg neon-text">JARVIS</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className={cn("hover:bg-sidebar-accent", collapsed && "mx-auto")}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => {
          const isActive = location.pathname === item.url;
          const linkContent = (
            <NavLink
              to={item.url}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive && "bg-primary/10 text-primary neon-glow",
                collapsed && "justify-center px-2"
              )}
            >
              <item.icon
                className={cn(
                  "h-5 w-5 flex-shrink-0",
                  isActive && "text-primary"
                )}
              />
              {!collapsed && (
                <span className={cn("font-medium", isActive && "text-primary")}>
                  {item.title}
                </span>
              )}
            </NavLink>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.url} delayDuration={0}>
                <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                <TooltipContent side="right" className="font-medium">
                  {item.title}
                </TooltipContent>
              </Tooltip>
            );
          }

          return <div key={item.url}>{linkContent}</div>;
        })}
      </nav>

      {/* User Section */}
      <div className="p-2 border-t border-sidebar-border">
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSignOut}
                className="w-full hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign Out</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            onClick={handleSignOut}
            className="w-full justify-start gap-3 hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </Button>
        )}
      </div>
    </aside>
  );
}
