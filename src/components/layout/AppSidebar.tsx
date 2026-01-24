import { NavLink, useLocation } from "react-router-dom";
import {
  Home,
  Mic,
  Settings2,
  FolderOpen,
  AppWindow,
  ChevronLeft,
  ChevronRight,
  Bot,
  LogOut,
  Menu,
  X,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

const navItems = [
  { title: "Hub", url: "/hub", icon: Home },
  { title: "Voice AI", url: "/voice", icon: Mic },
  { title: "Apps", url: "/apps", icon: AppWindow },
  { title: "Files", url: "/files", icon: FolderOpen },
  { title: "Camera", url: "/miccamera", icon: Camera },
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
    toast({ title: "Signed out" });
  };

  const handleNavClick = () => {
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
        className="fixed top-3 left-3 z-50 md:hidden bg-background/80 backdrop-blur-sm"
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
          "fixed md:sticky top-0 left-0 h-screen flex flex-col bg-card border-r border-border/50 transition-all duration-200 ease-out z-40",
          isOpen ? "w-56 translate-x-0" : "w-14 -translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo Header */}
        <div className="h-14 flex items-center justify-between px-3 border-b border-border/50 shrink-0">
          {isOpen && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">JARVIS</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={cn("hover:bg-secondary/50 hidden md:flex h-8 w-8", !isOpen && "mx-auto")}
          >
            {isOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className="p-2 space-y-0.5">
            {navItems.map((item) => {
              const isActive = location.pathname === item.url;
              const linkContent = (
                <NavLink
                  to={item.url}
                  onClick={handleNavClick}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm",
                    "hover:bg-secondary/50",
                    isActive && "bg-primary/10 text-primary font-medium",
                    !isOpen && "justify-center px-2"
                  )}
                >
                  <item.icon className={cn("h-4 w-4 flex-shrink-0", isActive && "text-primary")} />
                  {isOpen && <span>{item.title}</span>}
                </NavLink>
              );

              if (!isOpen) {
                return (
                  <Tooltip key={item.url} delayDuration={0}>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">{item.title}</TooltipContent>
                  </Tooltip>
                );
              }

              return <div key={item.url}>{linkContent}</div>;
            })}
          </nav>
        </ScrollArea>

        {/* Sign Out */}
        <div className="p-2 border-t border-border/50 shrink-0">
          {!isOpen ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSignOut}
                  className="w-full h-8 hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Sign Out</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full justify-start gap-3 text-sm h-9 hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          )}
        </div>
      </aside>
    </>
  );
}
