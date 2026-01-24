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

  const handleMainClick = () => {
    if (window.innerWidth < 768 && sidebarOpen) {
      setSidebarOpen(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
        <main 
          className="flex-1 overflow-auto h-screen"
          onClick={handleMainClick}
        >
          <div className="p-4 md:p-6 h-full">{children}</div>
        </main>

        {/* Floating Debug Button */}
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "fixed bottom-4 right-4 z-50 h-10 w-10 rounded-full shadow-md border-border/50 bg-card hover:bg-secondary transition-all",
            issueLogOpen && "hidden"
          )}
          onClick={() => setIssueLogOpen(true)}
        >
          <Bug className="h-4 w-4 text-muted-foreground" />
        </Button>

        {/* Issue Log Panel */}
        {issueLogOpen && (
          <div className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] animate-slide-in">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute -top-2 -right-2 z-10 h-7 w-7 rounded-full bg-card border border-border shadow-sm"
                onClick={() => setIssueLogOpen(false)}
              >
                <X className="h-3 w-3" />
              </Button>
              <IssueLog className="shadow-lg" />
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
