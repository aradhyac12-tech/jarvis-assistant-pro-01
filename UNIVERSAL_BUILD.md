# JARVIS Remote — Universal Build Guide

Complete instructions to build and deploy JARVIS on every supported platform.

---

## 📱 Mobile App (iOS + Android)

### Prerequisites

| Tool | Version | Required For |
|------|---------|--------------|
| Node.js | 18+ | All mobile builds |
| npm / bun | Latest | Dependency install |
| Android Studio | Hedgehog+ | Android APK/AAB |
| JDK | 17+ | Android build |
| Xcode | 15+ | iOS IPA |
| macOS | Ventura+ | iOS builds only |
| CocoaPods | 1.13+ | iOS native deps |

---

### Step 1 — Install & Build Web Assets

```bash
npm install
npm run build
```

---

### Step 2 — Android APK / AAB

```bash
# Add Android platform (first time only)
npx cap add android

# Sync web assets + native plugins
npx cap sync android

# Apply required permissions to AndroidManifest.xml (see below)
# Then open in Android Studio:
npx cap open android
```

**Required `AndroidManifest.xml` permissions:**

```xml
<!-- Network -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />

<!-- Camera & Microphone -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

<!-- Notifications (Android 13+) -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

<!-- Background / Foreground Service (for persistent P2P) -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />

<!-- Bluetooth (Android 12+) -->
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<!-- Legacy Bluetooth (Android 11 and below) -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />

<!-- Notification listener (mirror PC notifications) -->
<uses-permission android:name="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" />

<!-- Vibration for haptic feedback -->
<uses-permission android:name="android.permission.VIBRATE" />
```

**Network Security Config** — create `android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Allow cleartext HTTP to local P2P agent on private network IPs -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">192.168.0.0</domain>
        <domain includeSubdomains="true">10.0.0.0</domain>
        <domain includeSubdomains="true">172.16.0.0</domain>
    </domain-config>
    <!-- Everything else requires HTTPS -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

Reference it in `AndroidManifest.xml`:

```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ...>
```

**Build APK (debug):**

```bash
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

**Build APK (release, unsigned):**

```bash
./gradlew assembleRelease
```

**Build AAB for Google Play:**

```bash
./gradlew bundleRelease
```

**Minimum SDK:** Android 6.0 (API 23) — covers ~99% of active devices  
**Target SDK:** Android 14 (API 34)

---

### Step 3 — iOS IPA (macOS + Xcode required)

```bash
# Add iOS platform (first time only)
npx cap add ios

# Sync
npx cap sync ios

# Install CocoaPods dependencies
cd ios/App && pod install && cd ../..

# Open in Xcode
npx cap open ios
```

**Required capabilities in Xcode (Signing & Capabilities):**
- Background Modes → `Audio, AirPlay, and Picture in Picture`, `Background fetch`, `Remote notifications`
- Push Notifications
- Bluetooth
- Camera Usage Description
- Microphone Usage Description

**Add to `ios/App/App/Info.plist`:**

```xml
<key>NSCameraUsageDescription</key>
<string>JARVIS uses the camera to stream video to your PC and for face recognition.</string>

<key>NSMicrophoneUsageDescription</key>
<string>JARVIS uses the microphone for voice commands and audio relay.</string>

<key>NSBluetoothAlwaysUsageDescription</key>
<string>JARVIS uses Bluetooth for low-latency offline connection to your PC.</string>

<key>NSLocalNetworkUsageDescription</key>
<string>JARVIS connects to your PC on the local network for ultra-low latency control.</string>

<!-- Allow HTTP to local P2P agent (iOS 14+) -->
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
    <key>NSExceptionDomains</key>
    <dict>
        <key>192.168.0.0</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
            <key>NSIncludesSubdomains</key>
            <true/>
        </dict>
        <key>10.0.0.0</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
            <key>NSIncludesSubdomains</key>
            <true/>
        </dict>
    </dict>
</dict>
```

**Minimum deployment target:** iOS 14.0  
**Build for device:** Select your device → Product → Archive → Distribute

---

## 🖥️ PC Agent — All Platforms

### Windows 7 / 8 / 10 / 11

**Requirements:**
- Python 3.8–3.11 (3.8 for Win7 compatibility)
- Python 3.8 download: https://www.python.org/downloads/release/python-3810/

```bat
cd python-agent

:: Install dependencies
pip install -r requirements.txt

:: Windows-only audio control
pip install pycaw comtypes pywin32

:: Optional: Windows 10/11 toast notifications
pip install win10toast-click

:: Run with GUI (recommended)
python jarvis_agent.py --gui

:: Or headless (no window)
python jarvis_agent.py --headless
```

**Install as auto-start service (runs on boot):**

```bat
:: Run as Administrator
python jarvis_service_installer.py install
```

**Windows 7 notes:**
- Use Python 3.8 (last version supporting Win7)
- `pip install pywin32==305` (last compatible version)
- BLE (bleak) requires Windows 10+ — on Win7, only LAN P2P and cloud fallback work
- `win10toast` won't work — notifications will be silent

**Windows 8/8.1 notes:**
- Python 3.9 works on Win8.1
- All features except BLE work (bleak needs Win10+)

---

### macOS 11+ (Big Sur and later)

```bash
cd python-agent

# Install dependencies
pip3 install -r requirements.txt

# Optional: backlight brightness control
brew install brightness

# Optional: audio device switching
brew install switchaudio-osx

# Run
python3 jarvis_agent.py --gui

# Or headless
python3 jarvis_agent.py --headless
```

**Install as auto-start LaunchAgent (no sudo needed):**

```bash
python3 jarvis_service_installer.py install
# Logs: ~/Library/Logs/jarvis_stdout.log
```

**macOS notes:**
- Accessibility permissions required for mouse/keyboard control:
  System Settings → Privacy & Security → Accessibility → Add Terminal/Python
- Screen Recording permission required for screenshots:
  System Settings → Privacy & Security → Screen Recording → Add Terminal/Python
- Camera/Microphone permissions prompted automatically on first use
- Apple Silicon (M1/M2/M3): works natively with Python 3.9+

---

### Linux — Ubuntu / Debian / Fedora / Arch

**Ubuntu / Debian:**

```bash
# System dependencies
sudo apt update
sudo apt install python3 python3-pip \
    libnotify-bin \       # notify-send for desktop notifications
    light \               # backlight control (sudo usermod -aG video $USER)
    x11-xserver-utils \   # xrandr for display brightness fallback
    portaudio19-dev \     # PyAudio dependency
    python3-gi \          # GLib/dbus notifications fallback
    python3-dbus          # dbus Python bindings

cd python-agent
pip3 install -r requirements.txt

# Allow brightness control without sudo
sudo usermod -aG video $USER
# Log out and back in, then test: light -G

# Run
python3 jarvis_agent.py --gui

# Or headless
python3 jarvis_agent.py --headless
```

**Install as systemd user service (auto-starts on login):**

```bash
python3 jarvis_service_installer.py install

# Check status
systemctl --user status jarvis-agent

# Live logs
journalctl --user -u jarvis-agent -f

# Enable lingering (starts even without active login — for headless servers)
loginctl enable-linger $USER
```

**Fedora / RHEL:**

```bash
sudo dnf install python3 python3-pip \
    libnotify \
    portaudio-devel \
    xrandr

pip3 install -r requirements.txt
python3 jarvis_service_installer.py install
```

**Arch Linux:**

```bash
sudo pacman -S python python-pip \
    libnotify \
    portaudio \
    xorg-xrandr \
    light

pip install -r requirements.txt
python jarvis_service_installer.py install
```

**Raspberry Pi / ARM Linux:**

Works on Raspberry Pi OS (64-bit recommended):

```bash
sudo apt install python3-pip portaudio19-dev libnotify-bin
pip3 install -r requirements.txt --no-binary :all:
python3 jarvis_agent.py --headless
```

Note: MediaPipe (face recognition) is not available on ARMv7. Use ARMv8/aarch64.

---

## 🔄 Updating the Agent

The agent includes an auto-updater that checks for new versions on startup and applies them automatically. To check manually:

```bash
# From the phone app: Hub → Agent Health → tap refresh
# Or trigger via command: get_agent_version / check_update
```

Manual update:
```bash
cd python-agent
git pull  # if using git
pip3 install -r requirements.txt --upgrade
```

---

## 🔧 Troubleshooting

| Issue | Platform | Fix |
|-------|----------|-----|
| "Accessibility not enabled" | macOS | System Settings → Privacy → Accessibility → Add Python |
| Volume control not working | Linux | Install `pactl` (`pulseaudio-utils`) or `amixer` (`alsa-utils`) |
| Brightness control fails | Linux | `sudo usermod -aG video $USER` then re-login |
| BLE not found | Windows 7/8 | BLE requires Windows 10+ — use LAN P2P or cloud only |
| Notifications silent | Linux | `sudo apt install libnotify-bin` |
| Agent won't start on boot | Linux | Run `loginctl enable-linger $USER` |
| Camera not detected | All | Install `opencv-python-headless`, ensure camera not in use |
| PyAudio build error | Linux | `sudo apt install portaudio19-dev` first |
| PyAudio build error | macOS | `brew install portaudio` first |
| `ModuleNotFoundError: pycaw` | Linux/macOS | pycaw is Windows-only; volume uses pactl/osascript instead |
