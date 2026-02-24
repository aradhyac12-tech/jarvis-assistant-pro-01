import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.f4290e4201014af693cfbf0d2c89db92",
  appName: "JARVIS Remote",
  webDir: "dist",
  server: {
    url: "https://f4290e42-0101-4af6-93cf-bf0d2c89db92.lovableproject.com?forceHideBadge=true",
    cleartext: true,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#3B82F6",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    Camera: {
      presentationStyle: "fullscreen",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#000000",
    },
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    backgroundColor: "#000000",
  },
  ios: {
    allowsLinkPreview: false,
    backgroundColor: "#000000",
    contentInset: "always",
  },
};

export default config;
