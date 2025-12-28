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
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

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

interface AppSidebarProps {
  isOpen?: boolean;
  onToggle?: () => void;
}

export function AppSidebar({ isOpen = true, onToggle }: AppSidebarProps) {
  const location = useLocation();
  const { toast } = useToast();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({ title: "Signed out successfully" });
  };

  const handleNavClick = () => {
    // Auto-close sidebar on mobile after navigation
    if (window.innerWidth < 768 && onToggle) {
      onToggle();
    }
  };

  return (
    <>
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        className="fixed top-4 left-4 z-50 md:hidden bg-sidebar/80 backdrop-blur-sm"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 md:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={cn(
          "fixed md:sticky top-0 left-0 h-screen flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out z-40",
          isOpen ? "w-64 translate-x-0" : "w-16 -translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border shrink-0">
          {isOpen && (
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
            onClick={onToggle}
            className={cn("hover:bg-sidebar-accent hidden md:flex", !isOpen && "mx-auto")}
          >
            {isOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Navigation - fixed, not scrolling with page */}
        <ScrollArea className="flex-1">
          <nav className="p-2 space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.url;
              const linkContent = (
                <NavLink
                  to={item.url}
                  onClick={handleNavClick}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    isActive && "bg-primary/10 text-primary neon-glow",
                    !isOpen && "justify-center px-2"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-5 w-5 flex-shrink-0",
                      isActive && "text-primary"
                    )}
                  />
                  {isOpen && (
                    <span className={cn("font-medium", isActive && "text-primary")}>
                      {item.title}
                    </span>
                  )}
                </NavLink>
              );

              if (!isOpen) {
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
        </ScrollArea>

        {/* User Section */}
        <div className="p-2 border-t border-sidebar-border shrink-0">
          {!isOpen ? (
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
    </>
  );
}
