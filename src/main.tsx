import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Capacitor: handle Android back button — minimize instead of exit
(async () => {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { App: CapApp } = await import("@capacitor/app");
      CapApp.addListener("backButton", ({ canGoBack }: { canGoBack: boolean }) => {
        if (canGoBack) {
          window.history.back();
        } else {
          CapApp.minimizeApp();
        }
      });
    }
  } catch {
    // Not native or plugin not available
  }
})();

// Apply stored theme before render to prevent flash
(() => {
  try {
    const raw = localStorage.getItem("jarvis_theme");
    if (raw) {
      const { mode } = JSON.parse(raw);
      if (mode === "dark") document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark"); // default dark
    }
  } catch {
    document.documentElement.classList.add("dark");
  }
})();

createRoot(document.getElementById("root")!).render(<App />);
