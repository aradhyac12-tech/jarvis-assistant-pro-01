import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.d1b9acd5529c476184e67717f3667310",
  appName: "JARVIS Remote",
  webDir: "dist",
  server: {
    url: "https://d1b9acd5-529c-4761-84e6-7717f3667310.lovableproject.com?forceHideBadge=true",
    cleartext: true,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#3B82F6",
      sound: "beep.wav",
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
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: "#000000",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    CapacitorHttp: {
      enabled: true,
    },
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    backgroundColor: "#000000",
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
    // Keep app alive in background like KDE Connect
    webContentsDebuggingEnabled: true,
  },
  ios: {
    allowsLinkPreview: false,
    backgroundColor: "#000000",
    contentInset: "always",
  },
};

export default config;
