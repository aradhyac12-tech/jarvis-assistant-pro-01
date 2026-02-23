import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { DeviceSessionProvider, useDeviceSession } from "@/hooks/useDeviceSession";
import { DeviceProvider } from "@/hooks/useDeviceContext";
import { GlobalPiPProvider } from "@/contexts/GlobalPiPContext";
import { GlobalFloatingPiP } from "@/components/GlobalFloatingPiP";
import { LazyLoadErrorBoundary } from "@/components/LazyLoadErrorBoundary";
import { Loader2 } from "lucide-react";
import React, { lazy, Suspense, forwardRef } from "react";

// Lazy load pages
const Pair = lazy(() => import("./pages/Pair"));
const Hub = lazy(() => import("./pages/Hub"));
const VoiceAI = lazy(() => import("./pages/VoiceAI"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
// Apps route redirects to Hub now
const Files = lazy(() => import("./pages/Files"));
const MicCamera = lazy(() => import("./pages/MicCamera"));
// Webcam merged into MicCamera
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
  const { session, isLoading, autoPair } = useDeviceSession();
  const [autoPairing, setAutoPairing] = React.useState(false);
  const attemptedRef = React.useRef(false);

  React.useEffect(() => {
    // Zero-access-code auto-connect: if no session & first load, auto-pair to first online device
    if (!isLoading && !session && !autoPairing && !attemptedRef.current) {
      attemptedRef.current = true;
      setAutoPairing(true);
      autoPair().finally(() => setAutoPairing(false));
    }
  }, [isLoading, session, autoPairing, autoPair]);

  if (isLoading || autoPairing) {
    return <LoadingFallback />;
  }

  if (!session) {
    return <Navigate to="/pair" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <LazyLoadErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/pair" element={<Pair />} />
          <Route path="/" element={<Navigate to="/hub" replace />} />
          
          {/* Main Hub - unified control panel (no sidebar) */}
          <Route path="/hub" element={<ProtectedRoute><Hub /></ProtectedRoute>} />
          
          {/* Redirect old routes to Hub */}
          <Route path="/dashboard" element={<Navigate to="/hub" replace />} />
          <Route path="/controls" element={<Navigate to="/hub" replace />} />
          <Route path="/music" element={<Navigate to="/hub" replace />} />
          <Route path="/remote" element={<Navigate to="/hub" replace />} />
          <Route path="/apps" element={<Navigate to="/hub" replace />} />
          
          {/* Specialized pages - no sidebar wrapper */}
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
              <AppRoutes />
              <GlobalFloatingPiP />
            </BrowserRouter>
          </GlobalPiPProvider>
        </DeviceProvider>
      </DeviceSessionProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
