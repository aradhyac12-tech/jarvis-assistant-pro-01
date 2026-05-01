import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // base "./" makes all asset paths relative — required for Capacitor APK (file:// protocol)
  base: "./",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Increase chunk warning limit — app is large by design
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Manual chunking to prevent single giant bundle
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-vendor": ["@radix-ui/react-tabs", "@radix-ui/react-dialog", "@radix-ui/react-slider"],
          "supabase": ["@supabase/supabase-js"],
          "capacitor": ["@capacitor/core", "@capacitor/app"],
        },
      },
    },
  },
}));
