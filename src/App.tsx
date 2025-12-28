import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import VoiceAI from "./pages/VoiceAI";
import SystemControls from "./pages/SystemControls";
import MusicPlayer from "./pages/MusicPlayer";
import Apps from "./pages/Apps";
import Files from "./pages/Files";
import RemoteControl from "./pages/RemoteControl";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isUnlocked = localStorage.getItem("jarvis_unlocked") === "true";
  
  if (!isUnlocked) {
    return <Navigate to="/auth" replace />;
  }
  
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/voice" element={<ProtectedRoute><VoiceAI /></ProtectedRoute>} />
      <Route path="/controls" element={<ProtectedRoute><SystemControls /></ProtectedRoute>} />
      <Route path="/music" element={<ProtectedRoute><MusicPlayer /></ProtectedRoute>} />
      <Route path="/apps" element={<ProtectedRoute><Apps /></ProtectedRoute>} />
      <Route path="/files" element={<ProtectedRoute><Files /></ProtectedRoute>} />
      <Route path="/remote" element={<ProtectedRoute><RemoteControl /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
