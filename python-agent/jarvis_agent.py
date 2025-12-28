"""
JARVIS PC Agent - Python Client
Runs on your PC to execute commands from the Jarvis web dashboard.

Requirements:
    pip install supabase pycaw comtypes screen-brightness-control pyautogui pillow psutil websockets keyboard

Usage:
    python jarvis_agent.py
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
from datetime import datetime
from typing import Optional, Dict, Any
import base64
import io

# Third-party imports (install via pip)
try:
    from supabase import create_client, Client
    import pyautogui
    from PIL import ImageGrab
    import psutil
    import keyboard
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install supabase pyautogui pillow psutil keyboard")
    sys.exit(1)

# Windows-specific imports
if platform.system() == "Windows":
    try:
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
        from comtypes import CLSCTX_ALL
        import screen_brightness_control as sbc
    except ImportError:
        print("Windows extras needed: pip install pycaw comtypes screen-brightness-control")


# ============== CONFIGURATION ==============
SUPABASE_URL = "https://pnndpactueqrbrwrxjjj.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBubmRwYWN0dWVxcmJyd3J4ampqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5Mzk4MTAsImV4cCI6MjA4MjUxNTgxMH0.w_w_mUfX1gnC9nj_UDXRA-JjY8fGYTK5O0YDl2tBX_8"
DEVICE_NAME = platform.node() or "My PC"
UNLOCK_PIN = "1212"
POLL_INTERVAL = 2  # seconds

# ============== SUPABASE CLIENT ==============
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


class JarvisAgent:
    def __init__(self):
        self.device_id: Optional[str] = None
        self.user_id: Optional[str] = None
        self.device_key = self._generate_device_key()
        self.is_locked = False
        self.running = True
        
    def _generate_device_key(self) -> str:
        """Generate a unique device key based on hardware."""
        import hashlib
        unique_string = f"{platform.node()}-{platform.machine()}-{os.getlogin()}"
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
    
    async def register_device(self, user_id: str):
        """Register this device with Supabase."""
        self.user_id = user_id
        
        # Check if device already exists
        result = supabase.table("devices").select("*").eq("device_key", self.device_key).execute()
        
        if result.data:
            self.device_id = result.data[0]["id"]
            # Update device info
            supabase.table("devices").update({
                "name": DEVICE_NAME,
                "is_online": True,
                "last_seen": datetime.utcnow().isoformat(),
                "system_info": self._get_system_info(),
                "current_volume": self._get_volume(),
                "current_brightness": self._get_brightness(),
            }).eq("id", self.device_id).execute()
            print(f"✅ Device reconnected: {self.device_id}")
        else:
            # Create new device
            result = supabase.table("devices").insert({
                "user_id": user_id,
                "device_key": self.device_key,
                "name": DEVICE_NAME,
                "is_online": True,
                "system_info": self._get_system_info(),
                "current_volume": self._get_volume(),
                "current_brightness": self._get_brightness(),
            }).execute()
            self.device_id = result.data[0]["id"]
            print(f"✅ Device registered: {self.device_id}")
    
    def _get_volume(self) -> int:
        """Get current system volume (0-100)."""
        if platform.system() == "Windows":
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
        if platform.system() == "Windows":
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = ctypes.cast(interface, ctypes.POINTER(IAudioEndpointVolume))
                volume.SetMasterVolumeLevelScalar(level / 100, None)
                return {"success": True, "volume": level}
            except Exception as e:
                return {"success": False, "error": str(e)}
        elif platform.system() == "Darwin":
            subprocess.run(["osascript", "-e", f"set volume output volume {level}"])
            return {"success": True, "volume": level}
        return {"success": False, "error": "Unsupported OS"}
    
    def _get_brightness(self) -> int:
        """Get current screen brightness (0-100)."""
        if platform.system() == "Windows":
            try:
                return sbc.get_brightness()[0]
            except Exception:
                return 75
        elif platform.system() == "Darwin":
            try:
                result = subprocess.run(
                    ["brightness", "-l"],
                    capture_output=True, text=True
                )
                # Parse brightness output
                return 75
            except Exception:
                return 75
        return 75
    
    def _set_brightness(self, level: int):
        """Set screen brightness (0-100)."""
        level = max(0, min(100, level))
        if platform.system() == "Windows":
            try:
                sbc.set_brightness(level)
                return {"success": True, "brightness": level}
            except Exception as e:
                return {"success": False, "error": str(e)}
        elif platform.system() == "Darwin":
            try:
                subprocess.run(["brightness", str(level / 100)])
                return {"success": True, "brightness": level}
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": "Unsupported OS"}
    
    def _shutdown(self):
        """Shutdown the PC."""
        if platform.system() == "Windows":
            os.system("shutdown /s /t 5")
        elif platform.system() == "Darwin":
            os.system("sudo shutdown -h +1")
        else:
            os.system("shutdown -h +1")
        return {"success": True, "message": "Shutdown initiated"}
    
    def _restart(self):
        """Restart the PC."""
        if platform.system() == "Windows":
            os.system("shutdown /r /t 5")
        elif platform.system() == "Darwin":
            os.system("sudo shutdown -r +1")
        else:
            os.system("shutdown -r +1")
        return {"success": True, "message": "Restart initiated"}
    
    def _sleep(self):
        """Put PC to sleep."""
        if platform.system() == "Windows":
            os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
        elif platform.system() == "Darwin":
            os.system("pmset sleepnow")
        return {"success": True, "message": "Sleep initiated"}
    
    def _hibernate(self):
        """Hibernate the PC."""
        if platform.system() == "Windows":
            os.system("shutdown /h")
        else:
            return {"success": False, "error": "Hibernate not supported on this OS"}
        return {"success": True, "message": "Hibernate initiated"}
    
    def _lock_screen(self):
        """Lock the screen."""
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
            # Note: Actually unlocking the screen programmatically is not possible
            # This just tracks the state for the web app
            return {"success": True, "message": "PIN verified"}
        return {"success": False, "error": "Invalid PIN"}
    
    def _take_screenshot(self) -> Dict[str, Any]:
        """Take a screenshot and return as base64."""
        try:
            screenshot = ImageGrab.grab()
            # Resize for faster transfer
            screenshot.thumbnail((1280, 720))
            buffer = io.BytesIO()
            screenshot.save(buffer, format="JPEG", quality=70)
            base64_image = base64.b64encode(buffer.getvalue()).decode()
            return {"success": True, "image": base64_image}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _type_text(self, text: str):
        """Type text using keyboard."""
        try:
            pyautogui.typewrite(text, interval=0.02)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _press_key(self, key: str):
        """Press a keyboard key."""
        try:
            pyautogui.press(key)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _key_combo(self, keys: list):
        """Press a key combination."""
        try:
            pyautogui.hotkey(*keys)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_move(self, x: int, y: int, relative: bool = False):
        """Move mouse cursor."""
        try:
            if relative:
                pyautogui.moveRel(x, y)
            else:
                pyautogui.moveTo(x, y)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_click(self, button: str = "left", clicks: int = 1):
        """Click mouse button."""
        try:
            pyautogui.click(button=button, clicks=clicks)
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
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _open_app(self, app_name: str):
        """Open an application."""
        try:
            if platform.system() == "Windows":
                os.startfile(app_name)
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
                size = os.path.getsize(full_path) if not is_dir else 0
                items.append({
                    "name": item,
                    "path": full_path,
                    "is_directory": is_dir,
                    "size": size,
                    "modified": os.path.getmtime(full_path),
                })
            return {"success": True, "items": items}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _open_file(self, path: str):
        """Open a file with default application."""
        try:
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
        """Search and play music (opens in default browser/app)."""
        try:
            import webbrowser
            # Open YouTube Music search
            search_url = f"https://music.youtube.com/search?q={query.replace(' ', '+')}"
            webbrowser.open(search_url)
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
                    if info['memory_percent'] > 0.1:  # Filter small processes
                        apps.append({
                            "pid": info['pid'],
                            "name": info['name'],
                            "memory": round(info['memory_percent'], 2),
                        })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            # Sort by memory usage
            apps.sort(key=lambda x: x['memory'], reverse=True)
            return {"success": True, "apps": apps[:20]}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_system_stats(self) -> Dict[str, Any]:
        """Get current system statistics."""
        try:
            cpu_percent = psutil.cpu_percent(interval=1)
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
        
        command_handlers = {
            # Volume & Brightness
            "set_volume": lambda: self._set_volume(payload.get("level", 50)),
            "get_volume": lambda: {"success": True, "volume": self._get_volume()},
            "set_brightness": lambda: self._set_brightness(payload.get("level", 75)),
            "get_brightness": lambda: {"success": True, "brightness": self._get_brightness()},
            
            # Power
            "shutdown": self._shutdown,
            "restart": self._restart,
            "sleep": self._sleep,
            "hibernate": self._hibernate,
            
            # Lock/Unlock
            "lock": self._lock_screen,
            "unlock": lambda: self._unlock_screen(payload.get("pin", "")),
            
            # Screenshot
            "screenshot": self._take_screenshot,
            
            # Keyboard
            "type_text": lambda: self._type_text(payload.get("text", "")),
            "press_key": lambda: self._press_key(payload.get("key", "")),
            "key_combo": lambda: self._key_combo(payload.get("keys", [])),
            
            # Mouse
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
            
            # Clipboard
            "get_clipboard": self._get_clipboard,
            "set_clipboard": lambda: self._set_clipboard(payload.get("content", "")),
            
            # Apps
            "open_app": lambda: self._open_app(payload.get("app_name", "")),
            "close_app": lambda: self._close_app(payload.get("app_name", "")),
            "get_running_apps": self._get_running_apps,
            
            # Files
            "list_files": lambda: self._list_files(payload.get("path", os.path.expanduser("~"))),
            "open_file": lambda: self._open_file(payload.get("path", "")),
            
            # Music
            "play_music": lambda: self._play_music(payload.get("query", "")),
            "media_control": lambda: self._media_control(payload.get("action", "")),
            
            # System
            "get_system_stats": self._get_system_stats,
        }
        
        handler = command_handlers.get(command_type)
        if handler:
            try:
                return handler()
            except Exception as e:
                return {"success": False, "error": str(e)}
        else:
            return {"success": False, "error": f"Unknown command: {command_type}"}
    
    async def poll_commands(self):
        """Poll for pending commands and execute them."""
        while self.running:
            try:
                # Get pending commands for this device
                result = supabase.table("commands").select("*").eq(
                    "device_id", self.device_id
                ).eq("status", "pending").order("created_at").execute()
                
                for command in result.data:
                    print(f"📥 Executing: {command['command_type']}")
                    
                    # Execute the command
                    result = self.execute_command(
                        command["command_type"],
                        command.get("payload", {})
                    )
                    
                    # Update command status
                    supabase.table("commands").update({
                        "status": "completed" if result.get("success") else "failed",
                        "result": result,
                        "executed_at": datetime.utcnow().isoformat(),
                    }).eq("id", command["id"]).execute()
                    
                    print(f"✅ Completed: {command['command_type']}")
                
                # Update device status
                supabase.table("devices").update({
                    "is_online": True,
                    "last_seen": datetime.utcnow().isoformat(),
                    "current_volume": self._get_volume(),
                    "current_brightness": self._get_brightness(),
                    "is_locked": self.is_locked,
                }).eq("id", self.device_id).execute()
                
            except Exception as e:
                print(f"❌ Error polling commands: {e}")
            
            await asyncio.sleep(POLL_INTERVAL)
    
    async def run(self, user_id: str):
        """Main run loop."""
        print("🤖 JARVIS Agent Starting...")
        print(f"📍 Device: {DEVICE_NAME}")
        print(f"🔑 Device Key: {self.device_key[:8]}...")
        
        await self.register_device(user_id)
        
        print("✅ Agent ready and listening for commands!")
        print("Press Ctrl+C to stop.\n")
        
        try:
            await self.poll_commands()
        except KeyboardInterrupt:
            print("\n👋 Shutting down...")
            self.running = False
            # Mark device as offline
            supabase.table("devices").update({
                "is_online": False,
            }).eq("id", self.device_id).execute()


def main():
    """Main entry point."""
    print("""
    ╔═══════════════════════════════════════════╗
    ║         JARVIS PC Agent v1.0              ║
    ║    Your AI-Powered PC Assistant           ║
    ╚═══════════════════════════════════════════╝
    """)
    
    # Get user ID - in production, this would be from authentication
    user_id = input("Enter your Jarvis User ID (from web app): ").strip()
    
    if not user_id:
        print("❌ User ID is required!")
        sys.exit(1)
    
    agent = JarvisAgent()
    asyncio.run(agent.run(user_id))


if __name__ == "__main__":
    main()
