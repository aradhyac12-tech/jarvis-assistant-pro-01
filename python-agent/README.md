# JARVIS PC Agent

Python agent that connects your PC to the Jarvis web dashboard for remote control.

## Quick Start

### 1. Install Python
Download Python 3.8+ from [python.org](https://python.org)

### 2. Install Dependencies

**Windows (recommended):**
- **One-click:** double-click `run_agent_windows.bat` (installs deps + runs agent)
- **Manual:**
```bash
pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip mss pyaudio opencv-python websockets
```

**macOS:**
```bash
pip install supabase pyautogui pillow psutil keyboard pyperclip mss websockets
brew install brightness  # For brightness control
```

**Linux:**
```bash
pip install supabase pyautogui pillow psutil keyboard pyperclip mss websockets
sudo apt-get install python3-tk python3-dev scrot  # For GUI automation
```

### 3. Run

```bash
python jarvis_agent.py
```

> The agent already includes the correct backend connection for this project.

**Optional override (if you need to point the agent somewhere else):**

- **Windows (Command Prompt):**
```cmd
set JARVIS_SUPABASE_URL=https://YOUR_BACKEND_URL
set JARVIS_SUPABASE_KEY=YOUR_PUBLISHABLE_KEY
python jarvis_agent.py
```

- **macOS/Linux:**
```bash
export JARVIS_SUPABASE_URL="https://YOUR_BACKEND_URL"
export JARVIS_SUPABASE_KEY="YOUR_PUBLISHABLE_KEY"
python jarvis_agent.py
```

### 4. Open the Dashboard
Your PC will appear in the Jarvis web dashboard within seconds!
Local dashboard also available at http://localhost:8765

## Features

| Feature | Description |
|---------|-------------|
| 🔊 **Volume Control** | Adjust system volume remotely |
| ☀️ **Brightness** | Control screen brightness |
| 🔒 **Lock/Unlock** | Lock screen with PIN verification (1212) |
| ⚡ **Power Controls** | Shutdown, restart, sleep, hibernate |
| ⌨️ **Virtual Keyboard** | Type text and press keys remotely |
| 🖱️ **Mouse Control** | Move, click, and scroll remotely |
| 📋 **Clipboard Sync** | Copy/paste between devices |
| 📸 **Screenshot** | View your PC screen remotely |
| 🚀 **App Launcher** | Open and close applications |
| 📁 **File Browser** | Navigate and open files |
| 🎵 **Music Control** | Search and play music |
| 📊 **System Stats** | Monitor CPU, RAM, disk usage |
| 🎤 **Audio Relay** | Stream audio between phone and PC |
| 📷 **Camera Stream** | Stream PC camera to phone |
| 🌐 **Local P2P** | Ultra-low latency (~2-5ms) when on same network |

## Local P2P (Same Network Mode)

When your phone and PC are on the same network, the agent starts a local WebSocket server on **port 9876** for ultra-low latency connections:

- **Latency:** ~2-5ms (vs ~50-100ms through cloud)
- **Auto-detection:** The phone app automatically detects and connects to the local server
- **Fallback:** If local P2P fails, it seamlessly falls back to cloud relay

The local P2P server is enabled by default and runs on `0.0.0.0:9876`.

## Command Reference

| Command | Payload | Description |
|---------|---------|-------------|
| `set_volume` | `{level: 0-100}` | Set volume percentage |
| `set_brightness` | `{level: 0-100}` | Set brightness percentage |
| `shutdown` | - | Shutdown in 5 seconds |
| `restart` | - | Restart in 5 seconds |
| `sleep` | - | Put PC to sleep |
| `hibernate` | - | Hibernate (Windows only) |
| `lock` | - | Lock the screen |
| `unlock` | `{pin: "1212"}` | Verify unlock PIN |
| `screenshot` | - | Capture screen |
| `type_text` | `{text: "hello"}` | Type text |
| `press_key` | `{key: "enter"}` | Press a key |
| `key_combo` | `{keys: ["ctrl","c"]}` | Key combination |
| `mouse_move` | `{x, y, relative}` | Move cursor |
| `mouse_click` | `{button, clicks}` | Click mouse |
| `open_app` | `{app_name: "chrome"}` | Open application |
| `play_music` | `{query: "song"}` | Search YouTube Music |

## Configuration

Edit these values at the top of `jarvis_agent.py`:

```python
DEVICE_NAME = "My PC"      # Name shown in dashboard
UNLOCK_PIN = "1212"        # PIN for unlock feature
POLL_INTERVAL = 0.5        # Seconds between checks
```

## Connectivity Self-Test

The agent automatically runs a connectivity self-test on startup that checks:
1. ✅ DNS resolution of your backend hostname
2. ✅ TCP connection to port 443
3. ✅ TLS/SSL handshake
4. ✅ Supabase REST API health

If any test fails, you'll see specific remediation steps.

## Run at Startup

### Windows (Task Scheduler)

1. Press `Win+R`, type `taskschd.msc`
2. Click "Create Basic Task"
3. Name: "Jarvis Agent"
4. Trigger: "When I log on"
5. Action: "Start a program"
   - Program: `pythonw.exe`
   - Arguments: `C:\path\to\jarvis_agent.py`

### macOS (Login Items)

1. Open System Preferences → Users & Groups
2. Click your user → Login Items
3. Click + and add a script that runs `python jarvis_agent.py`

### Linux (systemd)

```bash
# Create service file
sudo nano /etc/systemd/system/jarvis.service
```

```ini
[Unit]
Description=Jarvis PC Agent
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/python-agent
Environment="JARVIS_SUPABASE_URL=https://YOUR_BACKEND_URL"
Environment="JARVIS_SUPABASE_KEY=YOUR_PUBLISHABLE_KEY"
ExecStart=/usr/bin/python3 jarvis_agent.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable jarvis
sudo systemctl start jarvis
```

## Troubleshooting

### "Missing dependency" error
Install all required packages:
```bash
pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip mss pyaudio opencv-python websockets
```

### DNS Resolution Failed (Error 11001)
- Check your internet connection
- Disable VPN/proxy if active
- Run `ipconfig /flushdns` (Windows) to clear DNS cache
- Try changing DNS to 8.8.8.8 or 1.1.1.1

### Volume/brightness not working (Windows)
Run the agent as Administrator.

### Mouse/keyboard not working (macOS)
Grant accessibility permissions:
1. System Preferences → Security & Privacy → Privacy
2. Enable for Terminal or Python

### Screenshot not working (macOS)
Grant screen recording permissions in System Preferences.

### Agent not connecting
1. Run the connectivity self-test (automatic on startup)
2. Check firewall settings
3. Verify environment variables are set correctly

## Security Notes

- The agent runs locally on your PC
- Commands are authenticated via your device's unique key
- The unlock PIN is verified locally
- No passwords or sensitive data are transmitted
