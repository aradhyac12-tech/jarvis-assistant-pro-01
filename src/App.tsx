import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { DeviceSessionProvider, useDeviceSession } from "@/hooks/useDeviceSession";
import { DeviceProvider } from "@/hooks/useDeviceContext";
import { GlobalPiPProvider } from "@/contexts/GlobalPiPContext";
import { GlobalFloatingPiP } from "@/components/GlobalFloatingPiP";
import { GlobalClipboardSync } from "@/components/GlobalClipboardSync";
import { LazyLoadErrorBoundary } from "@/components/LazyLoadErrorBoundary";
import { AppLockScreen, isAppLockEnabled } from "@/components/AppLockScreen";
import { useAppStatePersistence, getLastRoute } from "@/hooks/useAppState";
import { useBackgroundPersistence } from "@/hooks/useBackgroundPersistence";
import { Loader2 } from "lucide-react";
import React, { lazy, Suspense, forwardRef, useState, useEffect, useCallback } from "react";

// Lazy load pages
const Pair = lazy(() => import("./pages/Pair"));
const Hub = lazy(() => import("./pages/Hub"));
const VoiceAI = lazy(() => import("./pages/VoiceAI"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
const Files = lazy(() => import("./pages/Files"));
const MicCamera = lazy(() => import("./pages/MicCamera"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const LoadingFallback = forwardRef<HTMLDivElement>(function LoadingFallback(_, ref) {
  return (
    <div ref={ref} className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useDeviceSession();

  if (isLoading) {
    return <LoadingFallback />;
  }

  if (!session) {
    return <Navigate to="/pair" replace />;
  }

  return <>{children}</>;
}

/** Saves current route to localStorage for state remembering */
function StatePersistence() {
  useAppStatePersistence();
  useBackgroundPersistence();
  return null;
}

/** Smart redirect: go to last visited page or /hub */
function SmartRedirect() {
  const lastRoute = getLastRoute();
  return <Navigate to={lastRoute || "/hub"} replace />;
}

/** App lock gate — locks the entire app when returning from background */
function AppLockGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  const backgroundTimeRef = React.useRef<number>(0);

  useEffect(() => {
    if (!isAppLockEnabled()) return;

    const handleVisibility = () => {
      if (document.hidden) {
        // App going to background — record time
        backgroundTimeRef.current = Date.now();
      } else {
        // App coming to foreground — check if we should lock
        if (backgroundTimeRef.current > 0) {
          const elapsed = Date.now() - backgroundTimeRef.current;
          // Lock if gone for more than 2 seconds (prevents locking on quick tab switches)
          if (elapsed > 2000) {
            setLocked(true);
          }
          backgroundTimeRef.current = 0;
        }
      }
    };

    // Also handle Capacitor app state
    const initAppListener = async () => {
      try {
        const { App } = await import("@capacitor/app");
        App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) {
            backgroundTimeRef.current = Date.now();
          } else if (backgroundTimeRef.current > 0) {
            const elapsed = Date.now() - backgroundTimeRef.current;
            if (elapsed > 2000) {
              setLocked(true);
            }
            backgroundTimeRef.current = 0;
          }
        });
      } catch {
        // Not in Capacitor — visibility API is enough
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    initAppListener();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Check on initial mount if lock is enabled
  useEffect(() => {
    if (isAppLockEnabled()) {
      setLocked(true);
    }
  }, []);

  const handleUnlock = useCallback(() => {
    setLocked(false);
  }, []);

  if (locked) {
    return <AppLockScreen onUnlock={handleUnlock} />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <LazyLoadErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <StatePersistence />
        <Routes>
          <Route path="/pair" element={<Pair />} />
          <Route path="/" element={<SmartRedirect />} />
          
          {/* Main Hub */}
          <Route path="/hub" element={<ProtectedRoute><Hub /></ProtectedRoute>} />
          
          {/* Redirect old routes */}
          <Route path="/dashboard" element={<Navigate to="/hub" replace />} />
          <Route path="/controls" element={<Navigate to="/hub" replace />} />
          <Route path="/music" element={<Navigate to="/hub" replace />} />
          <Route path="/remote" element={<Navigate to="/hub" replace />} />
          <Route path="/apps" element={<Navigate to="/hub" replace />} />
          
          {/* Specialized pages */}
          <Route path="/assistant" element={<Navigate to="/voice" replace />} />
          <Route path="/voice" element={<ProtectedRoute><VoiceAI /></ProtectedRoute>} />
          <Route path="/files" element={<ProtectedRoute><Files /></ProtectedRoute>} />
          <Route path="/miccamera" element={<ProtectedRoute><MicCamera /></ProtectedRoute>} />
          <Route path="/webcam" element={<Navigate to="/miccamera" replace />} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </LazyLoadErrorBoundary>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DeviceSessionProvider>
        <DeviceProvider>
          <GlobalPiPProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AppLockGate>
                <AppRoutes />
                <GlobalFloatingPiP />
                <GlobalClipboardSync />
              </AppLockGate>
            </BrowserRouter>
          </GlobalPiPProvider>
        </DeviceProvider>
      </DeviceSessionProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
