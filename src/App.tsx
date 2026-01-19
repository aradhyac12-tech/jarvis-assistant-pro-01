import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { DeviceSessionProvider, useDeviceSession } from "@/hooks/useDeviceSession";
import { DeviceProvider } from "@/hooks/useDeviceContext";
import { Loader2 } from "lucide-react";

import Pair from "./pages/Pair";
import Dashboard from "./pages/Dashboard";
import ControlHub from "./pages/ControlHub";
import VoiceAI from "./pages/VoiceAI";
import SystemControls from "./pages/SystemControls";
import MusicPlayer from "./pages/MusicPlayer";
import Apps from "./pages/Apps";
import Files from "./pages/Files";
import RemoteControl from "./pages/RemoteControl";
import MicCamera from "./pages/MicCamera";
import Samsung from "./pages/Samsung";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useDeviceSession();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/pair" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
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
