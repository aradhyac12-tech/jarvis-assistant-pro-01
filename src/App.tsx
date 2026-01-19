import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { DeviceSessionProvider, useDeviceSession } from "@/hooks/useDeviceSession";
import { DeviceProvider } from "@/hooks/useDeviceContext";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

// Lazy load pages to avoid ref warnings with React Router
const Pair = lazy(() => import("./pages/Pair"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ControlHub = lazy(() => import("./pages/ControlHub"));
const VoiceAI = lazy(() => import("./pages/VoiceAI"));
const SystemControls = lazy(() => import("./pages/SystemControls"));
const MusicPlayer = lazy(() => import("./pages/MusicPlayer"));
const Apps = lazy(() => import("./pages/Apps"));
const Files = lazy(() => import("./pages/Files"));
const RemoteControl = lazy(() => import("./pages/RemoteControl"));
const MicCamera = lazy(() => import("./pages/MicCamera"));
const Samsung = lazy(() => import("./pages/Samsung"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

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

function AppRoutes() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/pair" element={<Pair />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hub"
          element={
            <ProtectedRoute>
              <ControlHub />
            </ProtectedRoute>
          }
        />
        <Route
          path="/voice"
          element={
            <ProtectedRoute>
              <VoiceAI />
            </ProtectedRoute>
          }
        />
        <Route
          path="/controls"
          element={
            <ProtectedRoute>
              <SystemControls />
            </ProtectedRoute>
          }
        />
        <Route
          path="/music"
          element={
            <ProtectedRoute>
              <MusicPlayer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/apps"
          element={
            <ProtectedRoute>
              <Apps />
            </ProtectedRoute>
          }
        />
        <Route
          path="/files"
          element={
            <ProtectedRoute>
              <Files />
            </ProtectedRoute>
          }
        />
        <Route
          path="/remote"
          element={
            <ProtectedRoute>
              <RemoteControl />
            </ProtectedRoute>
          }
        />
        <Route
          path="/miccamera"
          element={
            <ProtectedRoute>
              <MicCamera />
            </ProtectedRoute>
          }
        />
        <Route
          path="/samsung"
          element={
            <ProtectedRoute>
              <Samsung />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DeviceSessionProvider>
        <DeviceProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </DeviceProvider>
      </DeviceSessionProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
