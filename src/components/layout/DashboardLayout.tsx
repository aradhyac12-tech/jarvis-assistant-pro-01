import { ReactNode, useEffect, useState } from "react";
import { AppSidebar } from "./AppSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
      </div>
    </TooltipProvider>
  );
}
