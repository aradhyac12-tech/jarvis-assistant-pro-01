import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { DeviceSessionProvider, useDeviceSession } from "@/hooks/useDeviceSession";
import { AuthProvider } from "@/hooks/useAuth";
import { DeviceProvider } from "@/hooks/useDeviceContext";
import { GlobalPiPProvider } from "@/contexts/GlobalPiPContext";
import { BluetoothProvider } from "@/contexts/BluetoothContext";
import { GlobalFloatingPiP } from "@/components/GlobalFloatingPiP";
import { GlobalClipboardSync } from "@/components/GlobalClipboardSync";
import { PersistentNotification } from "@/components/PersistentNotification";
import { LazyLoadErrorBoundary } from "@/components/LazyLoadErrorBoundary";
import { AppLockScreen, isAppLockEnabled } from "@/components/AppLockScreen";
import { useAppStatePersistence, getLastRoute } from "@/hooks/useAppState";
import { useBackgroundPersistence } from "@/hooks/useBackgroundPersistence";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
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
const Notifications = lazy(() => import("./pages/Notifications"));
const AgentHealth = lazy(() => import("./pages/AgentHealth"));


const LoadingFallback = forwardRef<HTMLDivElement>(function LoadingFallback(_, ref) {
  return (
    <div ref={ref} className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-2 border-primary/20 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
        <div className="absolute inset-0 rounded-full border border-primary/10 animate-ping" />
      </div>
      <p className="text-[11px] text-muted-foreground tracking-widest uppercase font-mono">JARVIS</p>
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
  useAutoUpdate(); // Global auto-update check (APK + web)
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
        // App going to background — record time in localStorage for cross-reload persistence
        backgroundTimeRef.current = Date.now();
        localStorage.setItem("jarvis_backgrounded_at", String(backgroundTimeRef.current));
      } else {
        // App coming to foreground — check if we should lock
        if (backgroundTimeRef.current > 0) {
          const elapsed = Date.now() - backgroundTimeRef.current;
          // Lock if gone for more than 2 seconds (prevents locking on quick tab switches)
          if (elapsed > 2000) {
            setLocked(true);
          }
          backgroundTimeRef.current = 0;
          localStorage.removeItem("jarvis_backgrounded_at");
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
            localStorage.setItem("jarvis_backgrounded_at", String(backgroundTimeRef.current));
          } else if (backgroundTimeRef.current > 0) {
            const elapsed = Date.now() - backgroundTimeRef.current;
            if (elapsed > 2000) {
              setLocked(true);
            }
            backgroundTimeRef.current = 0;
            localStorage.removeItem("jarvis_backgrounded_at");
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

  // Only lock on initial mount if the app was previously backgrounded
  // (not on every fresh page load / cold start)
  useEffect(() => {
    if (!isAppLockEnabled()) return;
    const backgroundedAt = Number(localStorage.getItem("jarvis_backgrounded_at") || "0");
    if (backgroundedAt > 0) {
      const elapsed = Date.now() - backgroundedAt;
      // Only lock if it was backgrounded more than 2 seconds ago
      if (elapsed > 2000) {
        setLocked(true);
      }
      localStorage.removeItem("jarvis_backgrounded_at");
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
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="/health" element={<ProtectedRoute><AgentHealth /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </LazyLoadErrorBoundary>
  );
}

const App = () => {
  // Create QueryClient inside the component so it's not shared across
  // hot-reloads in dev and can be properly garbage-collected
  const [queryClient] = React.useState(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          retry: 2,
          staleTime: 30_000,
        },
      },
    })
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
        <DeviceSessionProvider>
          <DeviceProvider>
            <BluetoothProvider>
            <GlobalPiPProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <AppLockGate>
                  <AppRoutes />
                  <GlobalFloatingPiP />
                  <GlobalClipboardSync />
                  <PersistentNotification />
                </AppLockGate>
              </BrowserRouter>
            </GlobalPiPProvider>
            </BluetoothProvider>
          </DeviceProvider>
        </DeviceSessionProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
