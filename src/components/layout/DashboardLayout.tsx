import { ReactNode, useEffect, useState } from "react";
import { AppSidebar } from "./AppSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IssueLog } from "@/components/IssueLog";
import { Button } from "@/components/ui/button";
import { Bug, X } from "lucide-react";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [issueLogOpen, setIssueLogOpen] = useState(false);

  // Force dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Close sidebar on mobile when clicking outside
  const handleMainClick = () => {
    if (window.innerWidth < 768 && sidebarOpen) {
      setSidebarOpen(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex min-h-screen w-full bg-background overflow-hidden">
        <AppSidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
        <main 
          className={cn(
            "flex-1 overflow-auto h-screen transition-all duration-300",
            sidebarOpen ? "md:ml-0" : "ml-0"
          )}
          onClick={handleMainClick}
        >
          <div className="p-4 md:p-6 h-full">{children}</div>
        </main>

        {/* Floating Issue Log Button */}
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg border-border/50 bg-background/80 backdrop-blur-sm hover:bg-destructive/10 hover:border-destructive/50 transition-all",
            issueLogOpen && "hidden"
          )}
          onClick={() => setIssueLogOpen(true)}
        >
          <Bug className="h-5 w-5 text-muted-foreground" />
        </Button>

        {/* Floating Issue Log Panel */}
        {issueLogOpen && (
          <div className="fixed bottom-4 right-4 z-50 w-[400px] max-w-[calc(100vw-2rem)] animate-fade-in">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute -top-2 -right-2 z-10 h-8 w-8 rounded-full bg-background border border-border shadow-md"
                onClick={() => setIssueLogOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
              <IssueLog className="shadow-2xl" />
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
