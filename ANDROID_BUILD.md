# Converting JARVIS Remote to Android APK

Complete guide to build the JARVIS Remote Android APK with all native plugins and permissions.

## Prerequisites

1. **Node.js** v18+
2. **Android Studio** (latest stable)
3. **Java JDK 17+**
4. **Git**

## Quick Start

```bash
# 1. Export from Lovable → GitHub, then clone
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# 2. Install dependencies
npm install

# 3. Add Android platform
npx cap add android

# 4. Build web assets
npm run build

# 5. Sync to Android
npx cap sync android

# 6. Open in Android Studio
npx cap open android
```

## Android Permissions

After `npx cap add android`, edit `android/app/src/main/AndroidManifest.xml` and add these permissions **inside `<manifest>`** before `<application>`:

```xml
<!-- Core -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

<!-- Camera & Microphone (streaming, surveillance, calls) -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

<!-- Phone state detection (KDE Connect-style auto-pause) -->
<uses-permission android:name="android.permission.READ_PHONE_STATE" />
<uses-permission android:name="android.permission.READ_CALL_LOG" />
<uses-permission android:name="android.permission.ANSWER_PHONE_CALLS" />

<!-- Notifications -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

<!-- Storage (file transfers, clip downloads) -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />

<!-- Contacts & Calendar -->
<uses-permission android:name="android.permission.READ_CONTACTS" />
<uses-permission android:name="android.permission.READ_CALENDAR" />
<uses-permission android:name="android.permission.WRITE_CALENDAR" />

<!-- Foreground service (background streaming, surveillance) -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />

<!-- Biometric unlock -->
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
<uses-permission android:name="android.permission.USE_FINGERPRINT" />

<!-- Notification listener (sync phone notifications to PC) -->
<uses-permission android:name="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" />

<!-- Haptics -->
<uses-permission android:name="android.permission.VIBRATE" />
```

Also add inside `<application>`:

```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    android:usesCleartextTraffic="true"
    ...>

    <!-- Media session for persistent notification controls -->
    <service
        android:name="androidx.media.MediaBrowserServiceCompat"
        android:exported="false" />
</application>
```

## Network Security Config

Create `android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">192.168.0.0</domain>
        <domain includeSubdomains="true">192.168.1.0</domain>
        <domain includeSubdomains="true">10.0.0.0</domain>
        <domain includeSubdomains="true">localhost</domain>
    </domain-config>
</network-security-config>
```

## Installed Capacitor Plugins

These are already in `package.json` and ready to use:

| Plugin | Purpose |
|--------|---------|
| `@capacitor/core` | Core runtime |
| `@capacitor/app` | App state (background/foreground) |
| `@capacitor/haptics` | Haptic feedback on controls |
| `@capacitor/keyboard` | Keyboard management |
| `@capacitor/local-notifications` | Local alerts for surveillance |
| `@capacitor/push-notifications` | Push notification sync |
| `@capacitor/status-bar` | Status bar styling |
| `@capgo/capacitor-native-biometric` | Biometric/fingerprint unlock |
| `capacitor-plugin-incoming-call` | Call detection (auto-pause media) |
| `@posx/capacitor-notifications-listener` | Read phone notifications |

## Build APK

### Debug APK (for testing)

```bash
# From project root
cd android
./gradlew assembleDebug
```

APK location: `android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK (for distribution)

```bash
# Generate signing key (one time)
keytool -genkey -v -keystore jarvis-release.keystore -alias jarvis -keyalg RSA -keysize 2048 -validity 10000

# Add to android/app/build.gradle
# signingConfigs {
#     release {
#         storeFile file('jarvis-release.keystore')
#         storePassword 'YOUR_PASSWORD'
#         keyAlias 'jarvis'
#         keyPassword 'YOUR_KEY_PASSWORD'
#     }
# }

cd android
./gradlew assembleRelease
```

## Development Workflow

### Hot Reload (Live Development)

The app points to the live Lovable preview URL. Changes in Lovable appear instantly in the APK — no rebuild needed.

### Production Build

For a standalone APK (no server dependency):

1. Edit `capacitor.config.ts` — comment out the `server` block
2. Run `npm run build && npx cap sync android`
3. Build APK in Android Studio

## After Every Code Change

```bash
git pull
npx cap sync android
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| WebSocket fails | Ensure `allowMixedContent: true` in capacitor config |
| Camera/Mic denied | Check Android Settings → Apps → JARVIS → Permissions |
| Build fails | Run `npx cap sync android`, check JDK 17+ |
| White screen | Clear app cache, or check `npx cap sync` was run |
| Notifications not showing | Ensure `POST_NOTIFICATIONS` permission granted (Android 13+) |
| Call detection not working | Grant `READ_PHONE_STATE` permission |
| Biometric fails | Ensure fingerprint is enrolled on device |

## Features in APK

- ✅ WebSocket streaming (camera, screen, audio)
- ✅ PiP (Picture-in-Picture) floating player
- ✅ CSS fullscreen (no page refresh)
- ✅ Surveillance with auto-recording clips
- ✅ Push & local notifications
- ✅ Call detection → auto-pause PC media
- ✅ Biometric/PIN app lock
- ✅ Haptic feedback on all controls
- ✅ Notification sync (phone → PC)
- ✅ Media controls with persistent notification
- ✅ File transfers
- ✅ Clipboard sync
- ✅ Background operation via foreground service
