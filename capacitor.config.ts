import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.bb5b0a7ea3324605a1e8d4d1c437bc9f",
  appName: "JARVIS Remote",
  webDir: "dist",
  server: {
    // Enable hot-reload from the sandbox preview
    url: "https://bb5b0a7e-a332-4605-a1e8-d4d1c437bc9f.lovableproject.com?forceHideBadge=true",
    cleartext: true,
  },
  plugins: {
    // LocalNotifications plugin config (once added)
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#3B82F6",
    },
    // PushNotifications for remote notifications
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
