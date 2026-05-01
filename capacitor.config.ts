import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.jarvis.remote",
  appName: "JARVIS Remote",
  webDir: "dist",

  // ── Production: use bundled assets (offline-capable, no server dependency)
  // ── Development: uncomment the server block below and comment out this line
  // webDir: "dist",

  server: {
    // For local development only — comment out for release builds
    // url: "http://192.168.1.X:5173",
    cleartext: true,           // Allow HTTP to local P2P agent (192.168.x.x)
    hostname: "jarvis.app",
    androidScheme: "https",
    iosScheme: "https",
    allowNavigation: [
      // Local P2P agent on any private IP
      "192.168.*.*",
      "10.*.*.*",
      "172.16.*.*",
      "172.17.*.*",
      "172.18.*.*",
      "172.19.*.*",
      "172.20.*.*",
      // Supabase backend
      "*.supabase.co",
      // ElevenLabs voice
      "*.elevenlabs.io",
    ],
  },

  plugins: {
    // ── Notifications ──────────────────────────────────────────────────────
    LocalNotifications: {
      smallIcon: "ic_stat_jarvis",
      iconColor: "#3B82F6",
      sound: "beep.wav",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },

    // ── Camera ─────────────────────────────────────────────────────────────
    Camera: {
      presentationStyle: "fullscreen",
    },

    // ── Keyboard ───────────────────────────────────────────────────────────
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },

    // ── Status Bar ─────────────────────────────────────────────────────────
    StatusBar: {
      style: "dark",
      backgroundColor: "#000000",
      overlaysWebView: false,
    },

    // ── Splash Screen ──────────────────────────────────────────────────────
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1200,
      backgroundColor: "#000000",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      // iOS: use LaunchScreen.storyboard
    },

    // ── Keep Awake (prevents screen sleep during active P2P sessions) ──────
    KeepAwake: {},

    // ── HTTP (bypass CORS/cleartext for local P2P agent) ──────────────────
    CapacitorHttp: {
      enabled: true,
    },
  },

  // ── Android ──────────────────────────────────────────────────────────────
  android: {
    allowMixedContent: true,      // Allow HTTP to local agent from HTTPS context
    captureInput: true,
    webContentsDebuggingEnabled: false,  // Set true for debug builds only
    backgroundColor: "#000000",
    // Minimum SDK: 23 (Android 6.0) for BLE + WebSockets + Notifications
    // Target  SDK: 34 (Android 14) for latest notification permissions
    buildOptions: {
      keystorePath: undefined,    // Set in local.properties or CI secret
      keystoreAlias: undefined,
    },
  },

  // ── iOS ───────────────────────────────────────────────────────────────────
  ios: {
    allowsLinkPreview: false,
    backgroundColor: "#000000",
    contentInset: "always",
    // Minimum deployment target: iOS 14.0
    // Requires: Xcode 15+, macOS Ventura+
  },
};

export default config;
