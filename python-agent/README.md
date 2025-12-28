# JARVIS PC Agent

Python agent that connects your PC to the Jarvis web dashboard for remote control.

## Quick Start

### 1. Install Python
Download Python 3.8+ from [python.org](https://python.org)

### 2. Install Dependencies

**Windows:**
```bash
pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip
```

**macOS:**
```bash
pip install supabase pyautogui pillow psutil keyboard pyperclip
brew install brightness  # For brightness control
```

**Linux:**
```bash
pip install supabase pyautogui pillow psutil keyboard pyperclip
sudo apt-get install python3-tk python3-dev scrot  # For GUI automation
```

### 3. Run the Agent

```bash
python jarvis_agent.py
```

That's it! Your PC will appear in the Jarvis dashboard within seconds.

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
POLL_INTERVAL = 2          # Seconds between checks
```

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
pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip
```

### Volume/brightness not working (Windows)
Run the agent as Administrator.

### Mouse/keyboard not working (macOS)
Grant accessibility permissions:
1. System Preferences → Security & Privacy → Privacy
2. Enable for Terminal or Python

### Screenshot not working (macOS)
Grant screen recording permissions in System Preferences.

### Agent not connecting
Check your internet connection and firewall settings.

## Security Notes

- The agent runs locally on your PC
- Commands are authenticated via your device's unique key
- The unlock PIN is verified locally
- No passwords or sensitive data are transmitted
