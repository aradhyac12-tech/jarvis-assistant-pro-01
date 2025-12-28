"""
JARVIS PC Agent - Python Client
================================
Runs on your PC to execute commands from the Jarvis web dashboard.

SETUP INSTRUCTIONS:
------------------
1. Install Python 3.8+ from https://python.org

2. Install dependencies:
   pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip

3. Run the agent:
   python jarvis_agent.py

4. Open the Jarvis web app and you'll see your PC connected!

FEATURES:
---------
- System Controls: Volume, brightness, shutdown, sleep, hibernate, restart
- Lock/Unlock: Lock screen with PIN protection (1212)
- Remote Input: Virtual keyboard and mouse/trackpad control
- Screen Mirror: Take screenshots for remote viewing
- Clipboard Sync: Read and write clipboard content
- App Control: Open/close applications
- File Browser: Navigate and open files
- Music Player: Search and play music via YouTube Music
- System Stats: CPU, memory, disk, battery monitoring
"""

import os
import sys
import json
import time
import asyncio
import subprocess
import platform
import ctypes
import threading
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import base64
import io
import uuid

# Third-party imports
try:
    from supabase import create_client, Client
    import pyautogui
    from PIL import ImageGrab
    import psutil
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("\n📦 Install required packages with:")
    print("   pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip")
    sys.exit(1)

# Optional imports for keyboard
try:
    import keyboard
    HAS_KEYBOARD = True
except ImportError:
    HAS_KEYBOARD = False
    print("⚠️  keyboard module not installed - some features limited")

# Windows-specific imports
if platform.system() == "Windows":
    try:
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        from comtypes import CLSCTX_ALL
        import screen_brightness_control as sbc
        HAS_WINDOWS_AUDIO = True
    except ImportError:
        HAS_WINDOWS_AUDIO = False
        print("⚠️  Windows audio/brightness modules not installed")
else:
    HAS_WINDOWS_AUDIO = False


# ============== CONFIGURATION ==============
# Supabase connection - connects to your Jarvis project
SUPABASE_URL = "https://pnndpactueqrbrwrxjjj.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBubmRwYWN0dWVxcmJyd3J4ampqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5Mzk4MTAsImV4cCI6MjA4MjUxNTgxMH0.w_w_mUfX1gnC9nj_UDXRA-JjY8fGYTK5O0YDl2tBX_8"

# Device settings
DEVICE_NAME = platform.node() or "My PC"
UNLOCK_PIN = "1212"
POLL_INTERVAL = 2  # seconds between command checks

# ============== SUPABASE CLIENT ==============
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


class JarvisAgent:
    def __init__(self):
        self.device_id: Optional[str] = None
        self.device_key = self._generate_device_key()
        self.is_locked = False
        self.running = True
        
    def _generate_device_key(self) -> str:
        """Generate a unique device key based on hardware."""
        import hashlib
        unique_string = f"{platform.node()}-{platform.machine()}-jarvis"
        return hashlib.sha256(unique_string.encode()).hexdigest()[:32]
    
    def _get_system_info(self) -> Dict[str, Any]:
        """Gather system information."""
        return {
            "os": platform.system(),
            "os_version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "hostname": platform.node(),
            "cpu_count": psutil.cpu_count(),
            "memory_total_gb": round(psutil.virtual_memory().total / (1024**3), 2),
        }
    
    async def register_device(self):
        """Register this device with Supabase."""
        print("📡 Registering device...")
        
        # Check if device already exists
        result = supabase.table("devices").select("*").eq("device_key", self.device_key).execute()
        
        if result.data:
            self.device_id = result.data[0]["id"]
            # Update device info
            supabase.table("devices").update({
                "name": DEVICE_NAME,
                "is_online": True,
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "system_info": self._get_system_info(),
                "current_volume": self._get_volume(),
                "current_brightness": self._get_brightness(),
                "is_locked": False,
            }).eq("id", self.device_id).execute()
            print(f"✅ Device reconnected: {DEVICE_NAME}")
        else:
            # Create new device with a placeholder user_id
            result = supabase.table("devices").insert({
                "user_id": str(uuid.uuid4()),  # Placeholder for PIN-based auth
                "device_key": self.device_key,
                "name": DEVICE_NAME,
                "is_online": True,
                "system_info": self._get_system_info(),
                "current_volume": self._get_volume(),
                "current_brightness": self._get_brightness(),
            }).execute()
            self.device_id = result.data[0]["id"]
            print(f"✅ Device registered: {DEVICE_NAME}")
        
        return self.device_id
    
    def _get_volume(self) -> int:
        """Get current system volume (0-100)."""
        if platform.system() == "Windows" and HAS_WINDOWS_AUDIO:
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = ctypes.cast(interface, ctypes.POINTER(IAudioEndpointVolume))
                return int(volume.GetMasterVolumeLevelScalar() * 100)
            except Exception:
                return 50
        elif platform.system() == "Darwin":  # macOS
            try:
                result = subprocess.run(
                    ["osascript", "-e", "output volume of (get volume settings)"],
                    capture_output=True, text=True
                )
                return int(result.stdout.strip())
            except Exception:
                return 50
        return 50
    
    def _set_volume(self, level: int):
        """Set system volume (0-100)."""
        level = max(0, min(100, level))
        if platform.system() == "Windows" and HAS_WINDOWS_AUDIO:
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = ctypes.cast(interface, ctypes.POINTER(IAudioEndpointVolume))
                volume.SetMasterVolumeLevelScalar(level / 100, None)
                print(f"🔊 Volume set to {level}%")
                return {"success": True, "volume": level}
            except Exception as e:
                return {"success": False, "error": str(e)}
        elif platform.system() == "Darwin":
            subprocess.run(["osascript", "-e", f"set volume output volume {level}"])
            print(f"🔊 Volume set to {level}%")
            return {"success": True, "volume": level}
        return {"success": False, "error": "Unsupported OS"}
    
    def _get_brightness(self) -> int:
        """Get current screen brightness (0-100)."""
        if platform.system() == "Windows" and HAS_WINDOWS_AUDIO:
            try:
                return sbc.get_brightness()[0]
            except Exception:
                return 75
        return 75
    
    def _set_brightness(self, level: int):
        """Set screen brightness (0-100)."""
        level = max(0, min(100, level))
        if platform.system() == "Windows" and HAS_WINDOWS_AUDIO:
            try:
                sbc.set_brightness(level)
                print(f"☀️ Brightness set to {level}%")
                return {"success": True, "brightness": level}
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": "Unsupported OS"}
    
    def _shutdown(self):
        """Shutdown the PC."""
        print("⚠️ SHUTDOWN command received!")
        if platform.system() == "Windows":
            os.system("shutdown /s /t 5")
        elif platform.system() == "Darwin":
            os.system("sudo shutdown -h +1")
        else:
            os.system("shutdown -h +1")
        return {"success": True, "message": "Shutdown initiated"}
    
    def _restart(self):
        """Restart the PC."""
        print("🔄 RESTART command received!")
        if platform.system() == "Windows":
            os.system("shutdown /r /t 5")
        elif platform.system() == "Darwin":
            os.system("sudo shutdown -r +1")
        else:
            os.system("shutdown -r +1")
        return {"success": True, "message": "Restart initiated"}
    
    def _sleep(self):
        """Put PC to sleep."""
        print("😴 SLEEP command received!")
        if platform.system() == "Windows":
            os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
        elif platform.system() == "Darwin":
            os.system("pmset sleepnow")
        return {"success": True, "message": "Sleep initiated"}
    
    def _hibernate(self):
        """Hibernate the PC."""
        print("❄️ HIBERNATE command received!")
        if platform.system() == "Windows":
            os.system("shutdown /h")
        else:
            return {"success": False, "error": "Hibernate not supported on this OS"}
        return {"success": True, "message": "Hibernate initiated"}
    
    def _lock_screen(self):
        """Lock the screen."""
        print("🔒 LOCK command received!")
        self.is_locked = True
        if platform.system() == "Windows":
            ctypes.windll.user32.LockWorkStation()
        elif platform.system() == "Darwin":
            os.system("/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend")
        return {"success": True, "message": "Screen locked"}
    
    def _unlock_screen(self, pin: str):
        """Unlock with PIN verification."""
        if pin == UNLOCK_PIN:
            self.is_locked = False
            print("🔓 UNLOCK verified!")
            return {"success": True, "message": "PIN verified"}
        print("❌ Invalid unlock PIN!")
        return {"success": False, "error": "Invalid PIN"}
    
    def _take_screenshot(self) -> Dict[str, Any]:
        """Take a screenshot and return as base64."""
        try:
            screenshot = ImageGrab.grab()
            screenshot.thumbnail((1280, 720))
            buffer = io.BytesIO()
            screenshot.save(buffer, format="JPEG", quality=70)
            base64_image = base64.b64encode(buffer.getvalue()).decode()
            print("📸 Screenshot captured")
            return {"success": True, "image": base64_image}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _type_text(self, text: str):
        """Type text using keyboard."""
        try:
            # Use keyboard module if available for better Unicode support
            if HAS_KEYBOARD:
                keyboard.write(text, delay=0.02)
            else:
                pyautogui.typewrite(text, interval=0.02)
            print(f"⌨️ Typed: {text[:20]}...")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _press_key(self, key: str):
        """Press a keyboard key."""
        try:
            # Map common key names
            key_map = {
                "win": "win",
                "windows": "win",
                "ctrl": "ctrl",
                "alt": "alt",
                "shift": "shift",
                "enter": "enter",
                "return": "enter",
                "escape": "esc",
                "esc": "esc",
                "tab": "tab",
                "space": "space",
                "backspace": "backspace",
                "delete": "delete",
                "del": "delete",
                "home": "home",
                "end": "end",
                "pageup": "pageup",
                "pagedown": "pagedown",
                "up": "up",
                "down": "down",
                "left": "left",
                "right": "right",
                "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
                "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
                "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
            }
            mapped_key = key_map.get(key.lower(), key)
            pyautogui.press(mapped_key)
            print(f"⌨️ Pressed: {key}")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _key_combo(self, keys: list):
        """Press a key combination."""
        try:
            # Map key names
            key_map = {
                "ctrl": "ctrl", "control": "ctrl",
                "alt": "alt",
                "shift": "shift",
                "win": "win", "windows": "win", "super": "win",
            }
            mapped_keys = [key_map.get(k.lower(), k.lower()) for k in keys]
            pyautogui.hotkey(*mapped_keys)
            print(f"⌨️ Combo: {'+'.join(mapped_keys)}")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_move(self, x: int, y: int, relative: bool = False):
        """Move mouse cursor."""
        try:
            if relative:
                pyautogui.moveRel(x, y, duration=0.1)
            else:
                pyautogui.moveTo(x, y, duration=0.1)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_click(self, button: str = "left", clicks: int = 1):
        """Click mouse button."""
        try:
            pyautogui.click(button=button, clicks=clicks)
            print(f"🖱️ Click: {button} x{clicks}")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_scroll(self, amount: int):
        """Scroll mouse wheel."""
        try:
            pyautogui.scroll(amount)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_clipboard(self) -> Dict[str, Any]:
        """Get clipboard content."""
        try:
            import pyperclip
            content = pyperclip.paste()
            return {"success": True, "content": content}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _set_clipboard(self, content: str):
        """Set clipboard content."""
        try:
            import pyperclip
            pyperclip.copy(content)
            print("📋 Clipboard updated")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _open_app(self, app_name: str):
        """Open an application."""
        try:
            print(f"🚀 Opening: {app_name}")
            app_lower = app_name.lower()
            
            if platform.system() == "Windows":
                # Common app mappings for Windows
                app_paths = {
                    "chrome": "chrome",
                    "google chrome": "chrome",
                    "notepad": "notepad",
                    "calculator": "calc",
                    "spotify": "spotify",
                    "vscode": "code",
                    "vs code": "code",
                    "terminal": "cmd",
                    "cmd": "cmd",
                    "powershell": "powershell",
                    "explorer": "explorer",
                    "vlc": "vlc",
                    "vlc player": "vlc",
                }
                cmd = app_paths.get(app_lower, app_name)
                os.system(f"start {cmd}")
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", "-a", app_name])
            else:
                subprocess.Popen([app_name])
            return {"success": True, "message": f"Opened {app_name}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _close_app(self, app_name: str):
        """Close an application by name."""
        try:
            for proc in psutil.process_iter(['name']):
                if app_name.lower() in proc.info['name'].lower():
                    proc.terminate()
            print(f"❌ Closed: {app_name}")
            return {"success": True, "message": f"Closed {app_name}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _list_files(self, path: str) -> Dict[str, Any]:
        """List files in a directory."""
        try:
            items = []
            for item in os.listdir(path):
                full_path = os.path.join(path, item)
                is_dir = os.path.isdir(full_path)
                try:
                    size = os.path.getsize(full_path) if not is_dir else 0
                    modified = os.path.getmtime(full_path)
                except:
                    size = 0
                    modified = 0
                items.append({
                    "name": item,
                    "path": full_path,
                    "is_directory": is_dir,
                    "size": size,
                    "modified": modified,
                })
            return {"success": True, "items": items[:100]}  # Limit to 100 items
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _open_file(self, path: str):
        """Open a file with default application."""
        try:
            print(f"📁 Opening file: {path}")
            if platform.system() == "Windows":
                os.startfile(path)
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
            return {"success": True, "message": f"Opened {path}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _play_music(self, query: str):
        """Search and play music (opens in default browser)."""
        try:
            import webbrowser
            search_url = f"https://music.youtube.com/search?q={query.replace(' ', '+')}"
            webbrowser.open(search_url)
            print(f"🎵 Searching music: {query}")
            return {"success": True, "message": f"Searching for: {query}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _media_control(self, action: str):
        """Control media playback."""
        key_map = {
            "play_pause": "playpause",
            "next": "nexttrack",
            "previous": "prevtrack",
            "volume_up": "volumeup",
            "volume_down": "volumedown",
            "mute": "volumemute",
        }
        try:
            if action in key_map:
                pyautogui.press(key_map[action])
                print(f"🎵 Media: {action}")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_running_apps(self) -> Dict[str, Any]:
        """Get list of running applications."""
        try:
            apps = []
            for proc in psutil.process_iter(['pid', 'name', 'memory_percent']):
                try:
                    info = proc.info
                    if info['memory_percent'] and info['memory_percent'] > 0.1:
                        apps.append({
                            "pid": info['pid'],
                            "name": info['name'],
                            "memory": round(info['memory_percent'], 2),
                        })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            apps.sort(key=lambda x: x['memory'], reverse=True)
            return {"success": True, "apps": apps[:20]}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_system_stats(self) -> Dict[str, Any]:
        """Get current system statistics."""
        try:
            cpu_percent = psutil.cpu_percent(interval=0.5)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            battery = psutil.sensors_battery()
            
            return {
                "success": True,
                "cpu_percent": cpu_percent,
                "memory_percent": memory.percent,
                "memory_used_gb": round(memory.used / (1024**3), 2),
                "memory_total_gb": round(memory.total / (1024**3), 2),
                "disk_percent": disk.percent,
                "disk_used_gb": round(disk.used / (1024**3), 2),
                "disk_total_gb": round(disk.total / (1024**3), 2),
                "battery_percent": battery.percent if battery else None,
                "battery_plugged": battery.power_plugged if battery else None,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def execute_command(self, command_type: str, payload: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute a command based on type."""
        payload = payload or {}
        
        # Command handlers mapping - matches web app command types
        command_handlers = {
            # Volume & Brightness (from web app)
            "set_volume": lambda: self._set_volume(payload.get("level", 50)),
            "get_volume": lambda: {"success": True, "volume": self._get_volume()},
            "set_brightness": lambda: self._set_brightness(payload.get("level", 75)),
            "get_brightness": lambda: {"success": True, "brightness": self._get_brightness()},
            
            # Power commands (from web app)
            "shutdown": self._shutdown,
            "restart": self._restart,
            "sleep": self._sleep,
            "hibernate": self._hibernate,
            
            # Lock/Unlock (from web app)
            "lock": self._lock_screen,
            "unlock": lambda: self._unlock_screen(payload.get("pin", "")),
            
            # Screenshot (from web app)
            "screenshot": self._take_screenshot,
            
            # Keyboard (from web app)
            "type_text": lambda: self._type_text(payload.get("text", "")),
            "press_key": lambda: self._press_key(payload.get("key", "")),
            "key_combo": lambda: self._key_combo(payload.get("keys", [])),
            
            # Mouse (from web app)
            "mouse_move": lambda: self._mouse_move(
                payload.get("x", 0), 
                payload.get("y", 0), 
                payload.get("relative", False)
            ),
            "mouse_click": lambda: self._mouse_click(
                payload.get("button", "left"),
                payload.get("clicks", 1)
            ),
            "mouse_scroll": lambda: self._mouse_scroll(payload.get("amount", 0)),
            
            # Clipboard (from web app)
            "get_clipboard": self._get_clipboard,
            "set_clipboard": lambda: self._set_clipboard(payload.get("content", "")),
            
            # Apps (from web app)
            "open_app": lambda: self._open_app(payload.get("app_name", "")),
            "close_app": lambda: self._close_app(payload.get("app_name", "")),
            "get_running_apps": self._get_running_apps,
            
            # Files (from web app)
            "list_files": lambda: self._list_files(payload.get("path", os.path.expanduser("~"))),
            "open_file": lambda: self._open_file(payload.get("path", "")),
            
            # Music (from web app)
            "play_music": lambda: self._play_music(payload.get("query", "")),
            "media_control": lambda: self._media_control(payload.get("action", "")),
            
            # System (from web app)
            "get_system_stats": self._get_system_stats,
        }
        
        handler = command_handlers.get(command_type)
        if handler:
            try:
                return handler()
            except Exception as e:
                return {"success": False, "error": str(e)}
        else:
            print(f"⚠️ Unknown command: {command_type}")
            return {"success": False, "error": f"Unknown command: {command_type}"}
    
    async def poll_commands(self):
        """Poll for pending commands and execute them."""
        print("\n🎧 Listening for commands...")
        
        while self.running:
            try:
                # Get pending commands for this device
                result = supabase.table("commands").select("*").eq(
                    "device_id", self.device_id
                ).eq("status", "pending").order("created_at").execute()
                
                for command in result.data:
                    cmd_type = command['command_type']
                    print(f"\n📥 Command: {cmd_type}")
                    
                    # Execute the command
                    exec_result = self.execute_command(
                        cmd_type,
                        command.get("payload", {})
                    )
                    
                    # Update command status
                    supabase.table("commands").update({
                        "status": "completed" if exec_result.get("success") else "failed",
                        "result": exec_result,
                        "executed_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", command["id"]).execute()
                    
                    status = "✅" if exec_result.get("success") else "❌"
                    print(f"{status} {cmd_type}: {exec_result.get('message', exec_result.get('error', 'Done'))}")
                
                # Update device heartbeat
                supabase.table("devices").update({
                    "is_online": True,
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "current_volume": self._get_volume(),
                    "current_brightness": self._get_brightness(),
                    "is_locked": self.is_locked,
                }).eq("id", self.device_id).execute()
                
            except Exception as e:
                print(f"❌ Error: {e}")
            
            await asyncio.sleep(POLL_INTERVAL)
    
    async def run(self):
        """Main run loop."""
        await self.register_device()
        
        print("\n" + "="*50)
        print("🤖 JARVIS Agent is now running!")
        print(f"📍 Device: {DEVICE_NAME}")
        print(f"🔑 Device ID: {self.device_id[:8]}...")
        print("="*50)
        print("\n👀 Open the Jarvis web app to see your PC connected.")
        print("📱 You can now control your PC from your phone!")
        print("🛑 Press Ctrl+C to stop.\n")
        
        try:
            await self.poll_commands()
        except KeyboardInterrupt:
            print("\n\n👋 Shutting down...")
            self.running = False
            # Mark device as offline
            supabase.table("devices").update({
                "is_online": False,
            }).eq("id", self.device_id).execute()
            print("✅ Device marked offline. Goodbye!")


def main():
    """Main entry point."""
    print("""
    ╔═══════════════════════════════════════════════════════╗
    ║           JARVIS PC Agent v1.1                        ║
    ║       Your AI-Powered PC Assistant                    ║
    ╠═══════════════════════════════════════════════════════╣
    ║  This agent connects your PC to the Jarvis web app.   ║
    ║  Control your PC remotely from anywhere!              ║
    ╚═══════════════════════════════════════════════════════╝
    """)
    
    print("🔌 Connecting to Jarvis servers...")
    
    agent = JarvisAgent()
    asyncio.run(agent.run())


if __name__ == "__main__":
    main()
