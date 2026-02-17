import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.2d26560bb2f346af9b149a760aa78340",
  appName: "JARVIS Remote",
  webDir: "dist",
  server: {
    // Enable hot-reload from the sandbox preview
    url: "https://2d26560b-b2f3-46af-9b14-9a760aa78340.lovableproject.com?forceHideBadge=true",
    cleartext: true,
  },
  plugins: {
    // LocalNotifications plugin config
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#3B82F6",
    },
    // PushNotifications for remote notifications
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    // Camera permissions
    Camera: {
      presentationStyle: "fullscreen",
    },
  },
  android: {
    // Allow mixed content for WebSocket connections
    allowMixedContent: true,
    // Capture input (prevents keyboard issues)
    captureInput: true,
    // WebView settings
    webContentsDebuggingEnabled: true,
  },
  ios: {
    // Allow inline media playback
    allowsLinkPreview: false,
  },
};

export default config;
