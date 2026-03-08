# Building JARVIS Remote Android APK — Complete Guide

This document covers everything needed to build, configure, and deploy the JARVIS Remote Android APK with all native Capacitor plugins, permissions, background services, and P2P networking.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Android Permissions](#android-permissions)
4. [Network Security Config](#network-security-config)
5. [Capacitor Plugins Reference](#capacitor-plugins-reference)
6. [Build APK](#build-apk)
7. [Background Persistence](#background-persistence)
8. [P2P Direct Connection](#p2p-direct-connection)
9. [KDE Connect-Style Notifications](#kde-connect-style-notifications)
10. [Surveillance & Identity Verification](#surveillance--identity-verification)
11. [Features Checklist](#features-checklist)
12. [Development Workflow](#development-workflow)
13. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | v18+ | Build toolchain |
| Android Studio | Latest stable | Android SDK & emulator |
| Java JDK | 17+ | Android build system |
| Git | Any | Source control |
| Python | 3.10+ | PC Agent (separate) |

---

## Quick Start

```bash
# 1. Clone from GitHub (export from Lovable first)
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

# 6. Apply permissions (see below)
# Edit android/app/src/main/AndroidManifest.xml

# 7. Create network security config
# Create android/app/src/main/res/xml/network_security_config.xml

# 8. Open in Android Studio
npx cap open android

# 9. Build → Run on device/emulator
```

---

## Android Permissions

After `npx cap add android`, edit `android/app/src/main/AndroidManifest.xml`.

### Add inside `<manifest>` (before `<application>`):

```xml
<!-- ═══════════ CORE ═══════════ -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />

<!-- ═══════════ CAMERA & MICROPHONE ═══════════ -->
<!-- Used for: streaming, surveillance, calls -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

<!-- ═══════════ PHONE STATE ═══════════ -->
<!-- Used for: KDE Connect-style auto-pause on call -->
<uses-permission android:name="android.permission.READ_PHONE_STATE" />
<uses-permission android:name="android.permission.READ_CALL_LOG" />
<uses-permission android:name="android.permission.ANSWER_PHONE_CALLS" />

<!-- ═══════════ NOTIFICATIONS ═══════════ -->
<!-- Used for: persistent service notification, surveillance alerts -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

<!-- ═══════════ STORAGE ═══════════ -->
<!-- Used for: file transfers, surveillance clips, downloads -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />

<!-- ═══════════ CONTACTS & CALENDAR ═══════════ -->
<uses-permission android:name="android.permission.READ_CONTACTS" />
<uses-permission android:name="android.permission.READ_CALENDAR" />
<uses-permission android:name="android.permission.WRITE_CALENDAR" />

<!-- ═══════════ FOREGROUND SERVICES ═══════════ -->
<!-- Used for: background streaming, surveillance, persistent connection -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />

<!-- ═══════════ BLUETOOTH (BLE) ═══════════ -->
<!-- Used for: offline BLE fallback transport to PC agent -->
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />

<!-- ═══════════ BIOMETRIC ═══════════ -->
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
<uses-permission android:name="android.permission.USE_FINGERPRINT" />

<!-- ═══════════ NOTIFICATION LISTENER ═══════════ -->
<!-- Used for: mirroring phone notifications to PC -->
<uses-permission android:name="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" />
```

### Add/modify inside `<application>`:

```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    android:usesCleartextTraffic="true"
    android:requestLegacyExternalStorage="true"
    ...>

    <!-- Persistent foreground service for background connection -->
    <service
        android:name="com.getcapacitor.plugin.LocalNotificationsPlugin$ForegroundService"
        android:foregroundServiceType="dataSync"
        android:exported="false" />

    <!-- Boot receiver to auto-start -->
    <receiver
        android:name="com.getcapacitor.plugin.LocalNotificationsPlugin$BootReceiver"
        android:exported="false">
        <intent-filter>
            <action android:name="android.intent.action.BOOT_COMPLETED" />
        </intent-filter>
    </receiver>
</application>
```

### Capacitor Config (`capacitor.config.ts`):

The config is pre-configured with:
- **Live reload** pointing to the Lovable preview URL
- **Mixed content** enabled for P2P WebSocket connections
- **Background keep-alive** via Wake Lock + App minimization
- **Plugin configs** for notifications, camera, keyboard, status bar

---

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
    <!-- Allow cleartext for local P2P connections -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">192.168.0.0</domain>
        <domain includeSubdomains="true">192.168.1.0</domain>
        <domain includeSubdomains="true">10.0.0.0</domain>
        <domain includeSubdomains="true">172.16.0.0</domain>
        <domain includeSubdomains="true">localhost</domain>
    </domain-config>
</network-security-config>
```

---

## Capacitor Plugins Reference

| Plugin | Package | Purpose |
|--------|---------|---------|
| Core | `@capacitor/core` | Capacitor runtime |
| App | `@capacitor/app` | Background/foreground state, back button |
| Haptics | `@capacitor/haptics` | Haptic feedback on controls |
| Keyboard | `@capacitor/keyboard` | Keyboard management |
| Local Notifications | `@capacitor/local-notifications` | Persistent notification, surveillance alerts |
| Push Notifications | `@capacitor/push-notifications` | Remote push alerts |
| Status Bar | `@capacitor/status-bar` | Dark status bar styling |
| Native Biometric | `@capgo/capacitor-native-biometric` | Fingerprint/face unlock |
| Incoming Call | `capacitor-plugin-incoming-call` | Call detection → auto-pause media |
| Notification Listener | `@posx/capacitor-notifications-listener` | Mirror phone notifications to PC |

All plugins are already in `package.json`. After `npm install`, run `npx cap sync android`.

---

## Build APK

### Debug APK (for testing)

```bash
cd android
./gradlew assembleDebug
```

**Output:** `android/app/build/outputs/apk/debug/app-debug.apk`

Install directly via ADB:
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK (for distribution)

```bash
# 1. Generate signing key (one time only)
keytool -genkey -v \
  -keystore jarvis-release.keystore \
  -alias jarvis \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# 2. Add to android/app/build.gradle (inside android block)
# signingConfigs {
#     release {
#         storeFile file('jarvis-release.keystore')
#         storePassword 'YOUR_PASSWORD'
#         keyAlias 'jarvis'
#         keyPassword 'YOUR_KEY_PASSWORD'
#     }
# }
# buildTypes {
#     release {
#         signingConfig signingConfigs.release
#     }
# }

# 3. Build
cd android
./gradlew assembleRelease
```

**Output:** `android/app/build/outputs/apk/release/app-release.apk`

### AAB for Play Store

```bash
cd android
./gradlew bundleRelease
```

**Output:** `android/app/build/outputs/bundle/release/app-release.aab`

---

## Background Persistence

The APK is designed to stay alive in the background like KDE Connect:

### How it works:
1. **Wake Lock** — Prevents CPU from sleeping while app is in background
2. **Back button override** — Pressing back minimizes the app instead of closing it
3. **Persistent notification** — Shows "JARVIS Remote - Connected to PC" with quick action buttons (Send Clipboard, Send Files)
4. **Clipboard sync** — Runs continuously in background, syncing every 1 second
5. **Keep-alive heartbeat** — Touches localStorage every 30 seconds to keep JS engine alive
6. **Visibility change handler** — Re-acquires wake lock when returning to foreground

### Battery optimization:
Grant the app permission to ignore battery optimizations:
- Settings → Apps → JARVIS Remote → Battery → Unrestricted

### Auto-start (PC Agent side):
The PC agent has Ghost Mode that installs a Windows scheduled task to auto-start on boot.

---

## P2P Direct Connection

When phone and PC are on the same network:

1. PC agent runs local WebSocket server on port `9876`
2. HTTP API on port `9877` for command/probe
3. App auto-detects P2P availability and switches all traffic:
   - **Commands** → `ws://pcIp:9876/p2p`
   - **Camera** → `ws://pcIp:9876/camera`
   - **Screen** → `ws://pcIp:9876/screen`
   - **Audio** → `ws://pcIp:9876/audio`
4. Latency drops from ~200ms (cloud) to ~5ms (local)

### Firewall:
The PC agent auto-adds firewall rules. If blocked, manually run:
```
netsh advfirewall firewall add rule name="JARVIS P2P" dir=in action=allow protocol=TCP localport=9876-9877
```

---

## KDE Connect-Style Notifications

The app provides a full KDE Connect-style notification system that mirrors phone notifications to the PC and provides quick actions — accessible from a dedicated Notifications page, not embedded in the Hub.

### How it works:

1. **Notification Listener Service** — Uses `@posx/capacitor-notifications-listener` to capture all phone notifications in real-time
2. **Notification mirroring** — Phone notifications are forwarded to the PC agent, which displays them as Windows toast notifications
3. **Quick actions from notification panel**:
   - 📋 **Send Clipboard** — Instantly push phone clipboard to PC
   - 📁 **Send Files** — Open file transfer
   - 💬 **Reply** — Reply to messages directly from the panel
   - 🔗 **Open on PC** — Open notification URLs on the PC browser
4. **Persistent notification** — Always-on Android notification with "Send Clipboard" and "Send Files" action buttons (like KDE Connect)
5. **App grouping** — Notifications are grouped by source app with icons and color coding
6. **Dismissal sync** — Dismiss a notification on phone → dismisses on PC too

### Required Android permissions:

```xml
<!-- Already included in the manifest permissions above -->
<uses-permission android:name="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

### Enable Notification Access on device:

After installing the APK, the user must grant Notification Listener access:
- Settings → Apps → Special app access → Notification access → Enable for JARVIS Remote

---

## Surveillance & Identity Verification

The surveillance system uses the PC webcam to detect intruders and verify identity using face recognition. All events are persisted to the cloud database with full screenshots.

### Architecture:

1. **PC Agent** captures webcam frames and runs detection:
   - Motion detection (frame differencing)
   - Human detection (HOG + SVM via OpenCV)
   - Face recognition (multi-frame capture — 3 frames with 150ms gaps for accuracy)
2. **Events stored in database** — Every detection is saved to `surveillance_events` table with:
   - `event_type` (motion, human, face_recognized, intruder)
   - `confidence` score
   - `recognized` boolean + `recognized_label` (e.g., "admin")
   - `screenshot_url` — Full screenshot uploaded to `surveillance-screenshots` storage bucket
   - `recognition_confidence` — Face match score
3. **Device-owner-only access** — RLS policies enforce that only the user who paired the device (`devices.user_id = auth.uid()`) can view/manage surveillance events and screenshots
4. **Real-time push alerts** — Browser Push Notifications fire when an intruder (unrecognized human) is detected
5. **Events tab** — Scrollable history in the Surveillance panel showing all detections with timestamps and thumbnails

### Database tables:

```sql
-- surveillance_events (auto-created via migration)
-- Columns: id, user_id, device_id, event_type, confidence, 
--          recognized, recognized_label, recognition_confidence,
--          screenshot_url, metadata, created_at

-- Storage bucket: surveillance-screenshots
-- Path format: {user_id}/{device_id}/{timestamp}.jpg
-- RLS: Only device owner can read/write
```

### PC Agent commands for surveillance:

| Command | Payload | Description |
|---------|---------|-------------|
| `start_surveillance` | `{ sensitivity, detect_humans, sound_alarm }` | Start guard mode |
| `stop_surveillance` | — | Stop guard mode |
| `save_surveillance_event` | `{ event_type, confidence, recognized, recognized_label, recognition_confidence, screenshot_base64, device_id }` | Agent uploads detection event directly to cloud |
| `train_face` | `{ label }` | Capture face samples for recognition training |

### Face recognition improvements:

- **Multi-frame capture**: Takes 3 frames 150ms apart instead of 1, picks the best match
- **Confidence threshold**: Adjustable (default 0.6) — lower = more permissive, higher = stricter
- **Training flow**: Train via `train_face` command, stores encodings locally on the PC agent

### Required Python packages (PC agent):

```bash
pip install opencv-python face_recognition numpy
# face_recognition requires dlib (may need cmake + C++ build tools)
```

---

## Features Checklist

| Feature | Status | Details |
|---------|--------|---------|
| Camera streaming (PC → Phone) | ✅ | WebSocket with JPEG frames, P2P or cloud relay |
| Screen mirroring (PC → Phone) | ✅ | Full desktop mirror with quality/fps controls |
| Audio relay (bidirectional) | ✅ | 16kHz PCM with JS resampling, WASAPI loopback |
| Trackpad / Keyboard | ✅ | Multi-touch trackpad, full keyboard with special keys |
| Volume & Brightness control | ✅ | Slider with real-time PC state sync |
| File transfer (bidirectional) | ✅ | Chunked transfer with retry, share-to-phone support |
| Clipboard sync | ✅ | Always-on background sync, copy/cut instant push |
| KDE Connect notifications | ✅ | Full notification panel with reply, dismiss, quick actions |
| Notification mirroring | ✅ | Phone notifications → PC Windows toasts |
| Call detection | ✅ | Auto-pause PC media on incoming call |
| Surveillance / Guard mode | ✅ | Motion/human detection with alarm and clips |
| Surveillance event history | ✅ | Full history with screenshots saved to cloud database |
| Face recognition (multi-frame) | ✅ | 3-frame capture, best-match selection, adjustable threshold |
| Intruder push alerts | ✅ | Browser Push Notifications on unrecognized human |
| Device-owner-only access | ✅ | RLS enforced — only paired user can access surveillance |
| App management | ✅ | Open/kill/restart apps, services, task manager |
| Zoom meeting control | ✅ | Join, mic/camera toggle, screenshot |
| Biometric lock | ✅ | Fingerprint/face unlock for app security |
| PiP floating player | ✅ | CSS-based floating video |
| Ghost mode (PC agent) | ✅ | Hide agent, auto-start on boot |
| P2P direct connection | ✅ | Same-network ultra-low latency |
| Persistent notification | ✅ | Always-on with Send Clipboard / Send Files actions |
| Background persistence | ✅ | Wake lock, back-button minimize |
| AI Assistant | ✅ | Voice + text chat with Jarvis |

---

## Development Workflow

### Hot Reload (Live Development)

The APK points to the live Lovable preview URL. Changes in Lovable appear instantly — no rebuild needed.

### After Code Changes

```bash
git pull
npm install          # if dependencies changed
npm run build        # rebuild web assets
npx cap sync android # sync to Android
```

### Production Build (Standalone APK)

For an APK that works without the Lovable preview server:

1. Edit `capacitor.config.ts` — comment out the `server` block:
```typescript
// server: {
//   url: "https://...",
//   cleartext: true,
// },
```

2. Build and sync:
```bash
npm run build
npx cap sync android
```

3. Build APK in Android Studio

### Testing on Device

```bash
# List connected devices
adb devices

# Install debug APK
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# View logs
adb logcat | grep -i "capacitor\|jarvis\|webview"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **White screen on launch** | Run `npx cap sync android`, clear app cache |
| **WebSocket fails** | Ensure `allowMixedContent: true` in capacitor config |
| **Camera/Mic denied** | Settings → Apps → JARVIS → Permissions → Allow Camera & Mic |
| **Notifications not showing** | Grant `POST_NOTIFICATIONS` permission (Android 13+) |
| **Call detection not working** | Grant `READ_PHONE_STATE` permission |
| **Biometric fails** | Ensure fingerprint is enrolled on device |
| **P2P not connecting** | Check both devices on same WiFi, firewall allows port 9876-9877 |
| **App killed in background** | Disable battery optimization for the app |
| **Build fails with JDK error** | Ensure JDK 17+ is installed and `JAVA_HOME` is set |
| **Gradle sync fails** | Delete `android/.gradle` folder, re-sync |
| **Volume not updating** | Agent needs `pycaw` + `comtypes` installed (`pip install pycaw comtypes`) |
| **Clipboard sync not working** | Agent needs `pyperclip` installed (`pip install pyperclip`) |
| **File transfer fails** | Check PC agent has write access to `~/Downloads/Jarvis` |
| **Apps list empty** | Click Refresh button, agent needs `psutil` + `winreg` access |

### PC Agent Dependencies

```bash
pip install -r requirements.txt
# Includes: supabase, pyautogui, Pillow, psutil, pyperclip,
#   pycaw, comtypes, screen-brightness-control, keyboard,
#   websockets, pyaudio, opencv-python, mss, pystray
```
