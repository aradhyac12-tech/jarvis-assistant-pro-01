# Converting JARVIS to Android APK

This guide walks you through converting the JARVIS web app into a native Android APK.

## Prerequisites

1. **Node.js** (v18 or later)
2. **Android Studio** (latest stable version)
3. **Java JDK 17+** (required by Android Studio)
4. **Git** (for cloning the project)

## Step-by-Step Instructions

### 1. Export and Clone the Project

1. In Lovable, click **"Export to GitHub"** to push your project to a GitHub repository
2. Clone the repository to your local machine:
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   cd YOUR_REPO_NAME
   ```

### 2. Install Dependencies

```bash
npm install
```

### 3. Initialize Capacitor (Already Done)

The project already has Capacitor configured. If you need to re-initialize:
```bash
npx cap init aradhya-jarvis app.lovable.2d26560bb2f346af9b149a760aa78340
```

### 4. Add Android Platform

```bash
npx cap add android
```

### 5. Build the Web App

```bash
npm run build
```

### 6. Sync to Android

```bash
npx cap sync android
```

### 7. Open in Android Studio

```bash
npx cap open android
```

### 8. Configure Android Permissions

Edit `android/app/src/main/AndroidManifest.xml` and add these permissions:

```xml
<!-- Internet access (already included) -->
<uses-permission android:name="android.permission.INTERNET" />

<!-- Camera and Microphone -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

<!-- Phone state for call detection (KDE Connect-style) -->
<uses-permission android:name="android.permission.READ_PHONE_STATE" />
<uses-permission android:name="android.permission.READ_CALL_LOG" />
<uses-permission android:name="android.permission.ANSWER_PHONE_CALLS" />

<!-- Notifications -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.VIBRATE" />

<!-- Network -->
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

<!-- Storage (for file transfers) -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />

<!-- Contacts (for call/SMS features) -->
<uses-permission android:name="android.permission.READ_CONTACTS" />

<!-- Calendar -->
<uses-permission android:name="android.permission.READ_CALENDAR" />
<uses-permission android:name="android.permission.WRITE_CALENDAR" />

<!-- Foreground service for background operation -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

### 9. Configure Network Security

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

Reference it in AndroidManifest.xml:
```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ...>
```

### 10. Build Debug APK

In Android Studio:
1. Go to **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. Wait for the build to complete
3. Find the APK at `android/app/build/outputs/apk/debug/app-debug.apk`

Or from command line:
```bash
cd android
./gradlew assembleDebug
```

### 11. Install on Device

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

Or transfer the APK to your phone and install it.

## Development Workflow

### Hot Reload (Live Development)

The `capacitor.config.ts` is configured to point to the live Lovable preview. This means:

1. Your APK connects to the live preview server for development
2. Changes you make in Lovable are reflected immediately in the app
3. No need to rebuild the APK for code changes

### For Production

Update `capacitor.config.ts` to use the built files:
```typescript
const config: CapacitorConfig = {
  appId: 'app.lovable.2d26560bb2f346af9b149a760aa78340',
  appName: 'aradhya-jarvis',
  webDir: 'dist',
  // Remove or comment out the server block for production:
  // server: {
  //   url: "...",
  //   cleartext: true
  // },
};
```

Then rebuild:
```bash
npm run build
npx cap sync android
npx cap open android
# Build release APK in Android Studio
```

## Signing for Play Store

1. Generate a keystore:
   ```bash
   keytool -genkey -v -keystore jarvis-release-key.keystore -alias jarvis -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Configure signing in `android/app/build.gradle`:
   ```gradle
   android {
       signingConfigs {
           release {
               storeFile file('jarvis-release-key.keystore')
               storePassword 'YOUR_PASSWORD'
               keyAlias 'jarvis'
               keyPassword 'YOUR_KEY_PASSWORD'
           }
       }
       buildTypes {
           release {
               signingConfig signingConfigs.release
           }
       }
   }
   ```

3. Build release APK:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

## Troubleshooting

### WebSocket Connection Issues
The APK can use `ws://` connections directly (no HTTPS restrictions), enabling ultra-low latency P2P connections to the PC agent.

### Camera/Microphone Not Working
Ensure permissions are granted in Android Settings → Apps → JARVIS → Permissions.

### Build Fails
- Run `npx cap sync android` after any code changes
- Make sure Android Studio has downloaded all SDK components
- Check that JAVA_HOME points to JDK 17+

## Features Available in APK

- ✅ Direct WebSocket connections (bypasses mixed-content restrictions)
- ✅ Native push notifications
- ✅ Call detection and auto-mute
- ✅ Camera and microphone access
- ✅ File transfers
- ✅ Background operation
- ✅ Local P2P with 2-5ms latency
