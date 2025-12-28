# JARVIS PC Agent

Python agent that runs on your PC to receive and execute commands from the Jarvis web dashboard.

## Features

- **System Controls**: Volume, brightness, shutdown, sleep, hibernate, restart
- **Lock/Unlock**: Lock screen with PIN protection (1212)
- **Remote Input**: Virtual keyboard and mouse/trackpad control
- **Screen Mirror**: Take screenshots for remote viewing
- **Clipboard Sync**: Read and write clipboard content
- **App Control**: Open/close applications
- **File Browser**: Navigate and open files
- **Music Player**: Search and play music via YouTube Music
- **System Stats**: CPU, memory, disk, battery monitoring

## Installation

### Windows

```bash
# Create virtual environment
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the agent
python jarvis_agent.py
```

### macOS

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# For brightness control, install additional tool
brew install brightness

# Run the agent
python jarvis_agent.py
```

### Linux

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# For GUI automation, you may need:
sudo apt-get install python3-tk python3-dev scrot

# Run the agent
python jarvis_agent.py
```

## Usage

1. Open the Jarvis web app and sign in
2. Go to Settings and copy your User ID
3. Run the Python agent: `python jarvis_agent.py`
4. Enter your User ID when prompted
5. The agent will connect and start listening for commands!

## Configuration

Edit the constants at the top of `jarvis_agent.py`:

```python
DEVICE_NAME = "My PC"      # Name shown in the web app
UNLOCK_PIN = "1212"        # PIN for unlock feature
POLL_INTERVAL = 2          # Seconds between command checks
```

## Command Types

| Command | Payload | Description |
|---------|---------|-------------|
| `set_volume` | `{level: 0-100}` | Set system volume |
| `set_brightness` | `{level: 0-100}` | Set screen brightness |
| `shutdown` | - | Shutdown PC |
| `restart` | - | Restart PC |
| `sleep` | - | Put PC to sleep |
| `hibernate` | - | Hibernate PC (Windows) |
| `lock` | - | Lock screen |
| `unlock` | `{pin: "1212"}` | Verify unlock PIN |
| `screenshot` | - | Take screenshot |
| `type_text` | `{text: "hello"}` | Type text |
| `press_key` | `{key: "enter"}` | Press keyboard key |
| `key_combo` | `{keys: ["ctrl", "c"]}` | Key combination |
| `mouse_move` | `{x, y, relative}` | Move mouse |
| `mouse_click` | `{button, clicks}` | Click mouse |
| `mouse_scroll` | `{amount}` | Scroll mouse |
| `get_clipboard` | - | Get clipboard content |
| `set_clipboard` | `{content: "text"}` | Set clipboard |
| `open_app` | `{app_name: "chrome"}` | Open application |
| `close_app` | `{app_name: "chrome"}` | Close application |
| `list_files` | `{path: "/home"}` | List directory |
| `open_file` | `{path: "/file.pdf"}` | Open file |
| `play_music` | `{query: "song name"}` | Search & play music |
| `media_control` | `{action: "play_pause"}` | Media playback control |
| `get_system_stats` | - | Get CPU, memory, disk stats |

## Running as a Service

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task → "Jarvis Agent"
3. Trigger: At startup
4. Action: Start a program
   - Program: `C:\path\to\venv\Scripts\python.exe`
   - Arguments: `C:\path\to\jarvis_agent.py`
5. Check "Run whether user is logged on or not"

### macOS (launchd)

Create `~/Library/LaunchAgents/com.jarvis.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jarvis.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/venv/bin/python</string>
        <string>/path/to/jarvis_agent.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load with: `launchctl load ~/Library/LaunchAgents/com.jarvis.agent.plist`

### Linux (systemd)

Create `/etc/systemd/system/jarvis-agent.service`:

```ini
[Unit]
Description=Jarvis PC Agent
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/python-agent
ExecStart=/path/to/venv/bin/python jarvis_agent.py
Restart=always
Environment=USER_ID=your-user-id

[Install]
WantedBy=multi-user.target
```

Enable with:
```bash
sudo systemctl enable jarvis-agent
sudo systemctl start jarvis-agent
```

## Troubleshooting

### "Missing dependency" error
Make sure all packages are installed: `pip install -r requirements.txt`

### Volume/brightness not working on Windows
Run as Administrator for full system access.

### Mouse/keyboard not working on macOS
Grant Accessibility permissions in System Preferences → Security & Privacy → Privacy → Accessibility.

### Screenshot permission on macOS
Grant Screen Recording permissions in System Preferences.

## Security Notes

- The agent connects to your Supabase database using the anon key
- Commands are only executed for your authenticated user ID
- The unlock PIN is stored locally and verified locally
- Consider running in a restricted user account for additional security
