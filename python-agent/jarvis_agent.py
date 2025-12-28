"""
JARVIS PC Agent - Python Client v2.0
=====================================
Runs on your PC to execute commands from the Jarvis web dashboard.

SETUP INSTRUCTIONS:
------------------
1. Install Python 3.8+ from https://python.org

2. Install dependencies:
   pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip mss

3. Run the agent:
   python jarvis_agent.py

4. Open the Jarvis web app and you'll see your PC connected!

FEATURES:
---------
- System Controls: Volume, brightness, shutdown, sleep, hibernate, restart
- Smart Unlock: Unlock screen by typing PIN
- Remote Input: Virtual keyboard and mouse/trackpad control
- Screen Streaming: Real-time screen mirror
- Clipboard Sync: Read and write clipboard content
- App Control: Open/close applications
- File Browser: Navigate and open files
- Music Player: Search and play music via YouTube/Browser
- System Stats: CPU, memory, disk, battery monitoring
- Media Controls: Play/pause, next, previous, volume
- Boost Mode: Refresh explorer, clear temp, optimize
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
from typing import Optional, Dict, Any, List
import base64
import io
import uuid

# Third-party imports
try:
    from supabase import create_client, Client
    import pyautogui
    from PIL import Image
    import psutil
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("\n📦 Install required packages with:")
    print("   pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip mss")
    sys.exit(1)

# Fast screenshot using mss
try:
    import mss
    HAS_MSS = True
except ImportError:
    HAS_MSS = False
    print("⚠️  mss not installed - using slower PIL screenshots")

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
        from pycaw.pycaw import AudioUtilities, ISimpleAudioVolume
        from ctypes import cast, POINTER
        from comtypes import CLSCTX_ALL
        HAS_PYCAW = True
    except ImportError:
        HAS_PYCAW = False
        print("⚠️  pycaw not installed properly")
    
    try:
        import screen_brightness_control as sbc
        HAS_BRIGHTNESS = True
    except ImportError:
        HAS_BRIGHTNESS = False
        print("⚠️  screen_brightness_control not installed")
else:
    HAS_PYCAW = False
    HAS_BRIGHTNESS = False


# ============== CONFIGURATION ==============
SUPABASE_URL = "https://pnndpactueqrbrwrxjjj.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBubmRwYWN0dWVxcmJyd3J4ampqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5Mzk4MTAsImV4cCI6MjA4MjUxNTgxMH0.w_w_mUfX1gnC9nj_UDXRA-JjY8fGYTK5O0YDl2tBX_8"

DEVICE_NAME = platform.node() or "My PC"
UNLOCK_PIN = "1212"
POLL_INTERVAL = 0.5  # Faster polling for less lag
HEARTBEAT_INTERVAL = 5  # Separate heartbeat

# PyAutoGUI settings for less lag
pyautogui.PAUSE = 0.01
pyautogui.FAILSAFE = False

# ============== SUPABASE CLIENT ==============
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


class JarvisAgent:
    def __init__(self):
        self.device_id: Optional[str] = None
        self.device_key = self._generate_device_key()
        self.is_locked = False
        self.running = True
        self.last_heartbeat = 0
        self.screen_streaming = False
        self.stream_quality = 50
        self.stream_fps = 5
        
        # Cache for system info
        self._volume_cache = 50
        self._brightness_cache = 50
        self._last_cache_update = 0
        
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
        
        result = supabase.table("devices").select("*").eq("device_key", self.device_key).execute()
        
        if result.data:
            self.device_id = result.data[0]["id"]
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
            result = supabase.table("devices").insert({
                "user_id": str(uuid.uuid4()),
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
        """Get current system volume (0-100) using Windows APIs."""
        if platform.system() == "Windows":
            try:
                # Use nircmd or PowerShell for reliable volume reading
                result = subprocess.run(
                    ['powershell', '-Command', 
                     "(Get-AudioDevice -PlaybackVolume).Volume"],
                    capture_output=True, text=True, timeout=2
                )
                if result.returncode == 0 and result.stdout.strip():
                    return int(float(result.stdout.strip()))
            except:
                pass
            
            # Fallback: Use COM interface directly
            try:
                from ctypes import windll, c_float, byref
                # Try using mixer API
                import subprocess
                result = subprocess.run(
                    ['powershell', '-Command',
                     '[Audio]::Volume'],
                    capture_output=True, text=True, timeout=2
                )
            except:
                pass
            
            return self._volume_cache
        elif platform.system() == "Darwin":
            try:
                result = subprocess.run(
                    ["osascript", "-e", "output volume of (get volume settings)"],
                    capture_output=True, text=True, timeout=2
                )
                return int(result.stdout.strip())
            except:
                return 50
        return self._volume_cache
    
    def _set_volume(self, level: int):
        """Set system volume (0-100)."""
        level = max(0, min(100, level))
        self._volume_cache = level
        
        if platform.system() == "Windows":
            try:
                # Method 1: Use nircmd (if available)
                nircmd_path = os.path.join(os.path.dirname(__file__), "nircmd.exe")
                if os.path.exists(nircmd_path):
                    # nircmd uses 0-65535 range
                    vol_value = int(level * 65535 / 100)
                    subprocess.run([nircmd_path, "setsysvolume", str(vol_value)], 
                                 capture_output=True, timeout=2)
                    print(f"🔊 Volume set to {level}% (nircmd)")
                    return {"success": True, "volume": level}
                
                # Method 2: Use PowerShell with AudioDeviceCmdlets
                subprocess.run([
                    'powershell', '-Command',
                    f'Set-AudioDevice -PlaybackVolume {level}'
                ], capture_output=True, timeout=3)
                print(f"🔊 Volume set to {level}%")
                return {"success": True, "volume": level}
            except Exception as e:
                # Method 3: Use keyboard simulation
                try:
                    current = self._volume_cache
                    diff = level - current
                    steps = abs(diff) // 2
                    key = "volumeup" if diff > 0 else "volumedown"
                    for _ in range(steps):
                        pyautogui.press(key)
                    print(f"🔊 Volume adjusted to ~{level}%")
                    return {"success": True, "volume": level}
                except:
                    return {"success": False, "error": str(e)}
        elif platform.system() == "Darwin":
            subprocess.run(["osascript", "-e", f"set volume output volume {level}"])
            print(f"🔊 Volume set to {level}%")
            return {"success": True, "volume": level}
        return {"success": False, "error": "Unsupported OS"}
    
    def _get_brightness(self) -> int:
        """Get current screen brightness (0-100)."""
        if platform.system() == "Windows" and HAS_BRIGHTNESS:
            try:
                brightness = sbc.get_brightness(display=0)
                if isinstance(brightness, list):
                    return brightness[0]
                return brightness
            except:
                return self._brightness_cache
        return self._brightness_cache
    
    def _set_brightness(self, level: int):
        """Set screen brightness (0-100)."""
        level = max(0, min(100, level))  # Allow 0 brightness
        self._brightness_cache = level
        
        if platform.system() == "Windows" and HAS_BRIGHTNESS:
            try:
                sbc.set_brightness(level, display=0)
                print(f"☀️ Brightness set to {level}%")
                return {"success": True, "brightness": level}
            except Exception as e:
                # Fallback: Use WMI
                try:
                    subprocess.run([
                        'powershell', '-Command',
                        f'(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{level})'
                    ], capture_output=True, timeout=3)
                    print(f"☀️ Brightness set to {level}%")
                    return {"success": True, "brightness": level}
                except:
                    return {"success": False, "error": str(e)}
        return {"success": False, "error": "Unsupported OS or no display control"}
    
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
    
    def _smart_unlock(self, pin: str):
        """Smart unlock - wake screen and type PIN."""
        if pin != UNLOCK_PIN:
            print("❌ Invalid unlock PIN!")
            return {"success": False, "error": "Invalid PIN"}
        
        print("🔓 Smart unlock initiated...")
        self.is_locked = False
        
        if platform.system() == "Windows":
            try:
                # Step 1: Wake the screen
                ctypes.windll.user32.SetCursorPos(100, 100)
                pyautogui.move(1, 1)
                time.sleep(0.3)
                
                # Step 2: Press any key to show login screen
                pyautogui.press('space')
                time.sleep(0.5)
                
                # Step 3: Press Enter or Space to focus password field
                pyautogui.press('enter')
                time.sleep(0.3)
                
                # Step 4: Type the PIN
                pyautogui.typewrite(pin, interval=0.05)
                time.sleep(0.2)
                
                # Step 5: Press Enter to submit
                pyautogui.press('enter')
                
                print("🔓 Smart unlock completed!")
                return {"success": True, "message": "Unlock sequence executed"}
            except Exception as e:
                return {"success": False, "error": str(e)}
        
        return {"success": True, "message": "PIN verified"}
    
    def _take_screenshot(self, quality: int = 70, scale: float = 0.5) -> Dict[str, Any]:
        """Take a fast screenshot and return as base64."""
        try:
            if HAS_MSS:
                # Fast screenshot with mss
                with mss.mss() as sct:
                    monitor = sct.monitors[1]  # Primary monitor
                    screenshot = sct.grab(monitor)
                    img = Image.frombytes('RGB', screenshot.size, screenshot.bgra, 'raw', 'BGRX')
            else:
                from PIL import ImageGrab
                img = ImageGrab.grab()
            
            # Resize for faster transfer
            new_size = (int(img.width * scale), int(img.height * scale))
            img = img.resize(new_size, Image.LANCZOS)
            
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=quality, optimize=True)
            base64_image = base64.b64encode(buffer.getvalue()).decode()
            
            return {"success": True, "image": base64_image, "width": new_size[0], "height": new_size[1]}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _type_text(self, text: str):
        """Type text using keyboard."""
        try:
            if HAS_KEYBOARD:
                keyboard.write(text, delay=0.01)
            else:
                pyautogui.typewrite(text, interval=0.01)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _press_key(self, key: str):
        """Press a keyboard key."""
        try:
            key_map = {
                "win": "win", "windows": "win", "super": "win",
                "ctrl": "ctrl", "control": "ctrl",
                "alt": "alt",
                "shift": "shift",
                "enter": "enter", "return": "enter",
                "escape": "esc", "esc": "esc",
                "tab": "tab",
                "space": "space",
                "backspace": "backspace", "back": "backspace",
                "delete": "delete", "del": "delete",
                "home": "home", "end": "end",
                "pageup": "pageup", "pagedown": "pagedown",
                "up": "up", "down": "down", "left": "left", "right": "right",
                "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
                "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
                "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
                "printscreen": "printscreen", "prtsc": "printscreen",
                "insert": "insert", "ins": "insert",
                "capslock": "capslock", "caps": "capslock",
                "numlock": "numlock", "scrolllock": "scrolllock",
                "pause": "pause", "break": "pause",
            }
            mapped_key = key_map.get(key.lower(), key.lower())
            
            if HAS_KEYBOARD:
                keyboard.press_and_release(mapped_key)
            else:
                pyautogui.press(mapped_key)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _key_combo(self, keys: list):
        """Press a key combination."""
        try:
            key_map = {
                "ctrl": "ctrl", "control": "ctrl",
                "alt": "alt",
                "shift": "shift",
                "win": "win", "windows": "win", "super": "win",
            }
            mapped_keys = [key_map.get(k.lower(), k.lower()) for k in keys]
            
            if HAS_KEYBOARD:
                keyboard.press_and_release('+'.join(mapped_keys))
            else:
                pyautogui.hotkey(*mapped_keys)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_move(self, x: int, y: int, relative: bool = False):
        """Move mouse cursor with reduced lag."""
        try:
            if relative:
                pyautogui.moveRel(x, y, duration=0)
            else:
                pyautogui.moveTo(x, y, duration=0)
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
            print(f"🚀 Opening: {app_name}")
            app_lower = app_name.lower()
            
            if platform.system() == "Windows":
                app_paths = {
                    "chrome": "chrome", "google chrome": "chrome",
                    "firefox": "firefox", "mozilla firefox": "firefox",
                    "edge": "msedge", "microsoft edge": "msedge",
                    "notepad": "notepad",
                    "calculator": "calc",
                    "spotify": "spotify",
                    "vscode": "code", "vs code": "code", "visual studio code": "code",
                    "terminal": "cmd", "cmd": "cmd", "command prompt": "cmd",
                    "powershell": "powershell",
                    "explorer": "explorer", "file explorer": "explorer",
                    "vlc": "vlc", "vlc player": "vlc",
                    "task manager": "taskmgr",
                    "settings": "start ms-settings:",
                    "paint": "mspaint",
                    "word": "winword", "microsoft word": "winword",
                    "excel": "excel", "microsoft excel": "excel",
                    "outlook": "outlook", "microsoft outlook": "outlook",
                    "discord": "discord",
                    "steam": "steam",
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
            closed = False
            for proc in psutil.process_iter(['name', 'pid']):
                try:
                    if app_name.lower() in proc.info['name'].lower():
                        proc.terminate()
                        closed = True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            if closed:
                print(f"❌ Closed: {app_name}")
                return {"success": True, "message": f"Closed {app_name}"}
            return {"success": False, "error": f"Process {app_name} not found"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _list_files(self, path: str) -> Dict[str, Any]:
        """List files in a directory."""
        try:
            path = os.path.expanduser(path)
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
            return {"success": True, "items": items[:100], "current_path": path}
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
    
    def _play_music(self, query: str, service: str = "youtube"):
        """Search and play music."""
        try:
            import webbrowser
            
            if service == "youtube":
                search_url = f"https://www.youtube.com/results?search_query={query.replace(' ', '+')}"
            elif service == "spotify":
                search_url = f"https://open.spotify.com/search/{query.replace(' ', '%20')}"
            else:
                search_url = f"https://music.youtube.com/search?q={query.replace(' ', '+')}"
            
            webbrowser.open(search_url)
            print(f"🎵 Searching music: {query} on {service}")
            return {"success": True, "message": f"Searching for: {query}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _media_control(self, action: str):
        """Control media playback."""
        key_map = {
            "play_pause": "playpause",
            "play": "playpause",
            "pause": "playpause",
            "next": "nexttrack",
            "previous": "prevtrack",
            "prev": "prevtrack",
            "volume_up": "volumeup",
            "volume_down": "volumedown",
            "mute": "volumemute",
            "stop": "stop",
        }
        try:
            if action in key_map:
                pyautogui.press(key_map[action])
                print(f"🎵 Media: {action}")
                return {"success": True, "action": action}
            return {"success": False, "error": f"Unknown action: {action}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_running_apps(self) -> Dict[str, Any]:
        """Get list of running applications."""
        try:
            apps = []
            seen = set()
            for proc in psutil.process_iter(['pid', 'name', 'memory_percent', 'cpu_percent']):
                try:
                    info = proc.info
                    name = info['name']
                    if name not in seen and info['memory_percent'] and info['memory_percent'] > 0.1:
                        seen.add(name)
                        apps.append({
                            "pid": info['pid'],
                            "name": name,
                            "memory": round(info['memory_percent'], 2),
                            "cpu": round(info.get('cpu_percent', 0) or 0, 1),
                        })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            apps.sort(key=lambda x: x['memory'], reverse=True)
            return {"success": True, "apps": apps[:30]}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_installed_apps(self) -> Dict[str, Any]:
        """Get list of installed applications (Windows)."""
        try:
            apps = []
            if platform.system() == "Windows":
                # Common app locations
                start_menu = os.path.join(os.environ.get('APPDATA', ''), 
                    'Microsoft\\Windows\\Start Menu\\Programs')
                if os.path.exists(start_menu):
                    for root, dirs, files in os.walk(start_menu):
                        for file in files:
                            if file.endswith('.lnk'):
                                apps.append({"name": file[:-4], "type": "shortcut"})
            return {"success": True, "apps": apps[:50]}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_system_stats(self) -> Dict[str, Any]:
        """Get current system statistics."""
        try:
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            battery = psutil.sensors_battery()
            
            # Network stats
            net = psutil.net_io_counters()
            
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
                "net_sent_mb": round(net.bytes_sent / (1024**2), 2),
                "net_recv_mb": round(net.bytes_recv / (1024**2), 2),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _boost_pc(self):
        """Boost PC performance - refresh explorer, clear temp."""
        try:
            results = []
            
            if platform.system() == "Windows":
                # Restart Explorer
                os.system("taskkill /f /im explorer.exe")
                time.sleep(0.5)
                os.system("start explorer.exe")
                results.append("Explorer restarted")
                
                # Clear temp files (user temp)
                temp_path = os.environ.get('TEMP', '')
                if temp_path and os.path.exists(temp_path):
                    cleared = 0
                    for item in os.listdir(temp_path):
                        try:
                            item_path = os.path.join(temp_path, item)
                            if os.path.isfile(item_path):
                                os.remove(item_path)
                                cleared += 1
                        except:
                            pass
                    results.append(f"Cleared {cleared} temp files")
                
                # Clear RAM (empty working sets)
                try:
                    subprocess.run(['powershell', '-Command',
                        'Get-Process | ForEach-Object { $_.MinWorkingSet = 1 }'],
                        capture_output=True, timeout=5)
                    results.append("Memory optimized")
                except:
                    pass
            
            print(f"🚀 Boost completed: {', '.join(results)}")
            return {"success": True, "message": "; ".join(results)}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _start_screen_stream(self, fps: int = 5, quality: int = 50):
        """Start screen streaming mode."""
        self.screen_streaming = True
        self.stream_fps = max(1, min(30, fps))
        self.stream_quality = max(10, min(90, quality))
        return {"success": True, "message": f"Streaming at {fps} FPS, quality {quality}"}
    
    def _stop_screen_stream(self):
        """Stop screen streaming mode."""
        self.screen_streaming = False
        return {"success": True, "message": "Streaming stopped"}
    
    def execute_command(self, command_type: str, payload: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute a command based on type."""
        payload = payload or {}
        
        command_handlers = {
            # Volume & Brightness
            "set_volume": lambda: self._set_volume(payload.get("level", 50)),
            "get_volume": lambda: {"success": True, "volume": self._get_volume()},
            "set_brightness": lambda: self._set_brightness(payload.get("level", 75)),
            "get_brightness": lambda: {"success": True, "brightness": self._get_brightness()},
            
            # Power commands
            "shutdown": self._shutdown,
            "restart": self._restart,
            "sleep": self._sleep,
            "hibernate": self._hibernate,
            
            # Lock/Unlock
            "lock": self._lock_screen,
            "unlock": lambda: self._smart_unlock(payload.get("pin", "")),
            
            # Screenshot & Streaming
            "screenshot": lambda: self._take_screenshot(
                payload.get("quality", 70),
                payload.get("scale", 0.5)
            ),
            "start_stream": lambda: self._start_screen_stream(
                payload.get("fps", 5),
                payload.get("quality", 50)
            ),
            "stop_stream": self._stop_screen_stream,
            "get_frame": lambda: self._take_screenshot(
                self.stream_quality,
                0.4
            ),
            
            # Keyboard
            "type_text": lambda: self._type_text(payload.get("text", "")),
            "press_key": lambda: self._press_key(payload.get("key", "")),
            "key_combo": lambda: self._key_combo(payload.get("keys", [])),
            "raw_key": lambda: self._press_key(payload.get("key", "")),
            
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
            "get_installed_apps": self._get_installed_apps,
            
            # Files
            "list_files": lambda: self._list_files(payload.get("path", "~")),
            "open_file": lambda: self._open_file(payload.get("path", "")),
            
            # Music & Media
            "play_music": lambda: self._play_music(
                payload.get("query", ""),
                payload.get("service", "youtube")
            ),
            "media_control": lambda: self._media_control(payload.get("action", "")),
            
            # System
            "get_system_stats": self._get_system_stats,
            "boost": self._boost_pc,
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
    
    async def update_heartbeat(self):
        """Update device heartbeat separately from command polling."""
        while self.running:
            try:
                supabase.table("devices").update({
                    "is_online": True,
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "current_volume": self._volume_cache,
                    "current_brightness": self._brightness_cache,
                    "is_locked": self.is_locked,
                }).eq("id", self.device_id).execute()
            except Exception as e:
                print(f"❌ Heartbeat error: {e}")
            
            await asyncio.sleep(HEARTBEAT_INTERVAL)
    
    async def poll_commands(self):
        """Poll for pending commands and execute them."""
        print("\n🎧 Listening for commands...")
        
        while self.running:
            try:
                result = supabase.table("commands").select("*").eq(
                    "device_id", self.device_id
                ).eq("status", "pending").order("created_at").execute()
                
                for command in result.data:
                    cmd_type = command['command_type']
                    print(f"\n📥 Command: {cmd_type}")
                    
                    exec_result = self.execute_command(
                        cmd_type,
                        command.get("payload", {})
                    )
                    
                    supabase.table("commands").update({
                        "status": "completed" if exec_result.get("success") else "failed",
                        "result": exec_result,
                        "executed_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", command["id"]).execute()
                    
                    status = "✅" if exec_result.get("success") else "❌"
                    msg = exec_result.get('message', exec_result.get('error', 'Done'))
                    print(f"{status} {cmd_type}: {msg}")
                
            except Exception as e:
                print(f"❌ Poll error: {e}")
            
            await asyncio.sleep(POLL_INTERVAL)
    
    async def run(self):
        """Main run loop."""
        await self.register_device()
        
        print("\n" + "="*50)
        print("🤖 JARVIS Agent v2.0 is now running!")
        print(f"📍 Device: {DEVICE_NAME}")
        print(f"🔑 Device ID: {self.device_id[:8]}...")
        print(f"⚡ Poll interval: {POLL_INTERVAL}s (fast mode)")
        print("="*50)
        print("\n👀 Open the Jarvis web app to see your PC connected.")
        print("📱 You can now control your PC from your phone!")
        print("🛑 Press Ctrl+C to stop.\n")
        
        try:
            # Run command polling and heartbeat in parallel
            await asyncio.gather(
                self.poll_commands(),
                self.update_heartbeat()
            )
        except KeyboardInterrupt:
            print("\n\n👋 Shutting down...")
            self.running = False
            supabase.table("devices").update({
                "is_online": False,
            }).eq("id", self.device_id).execute()
            print("✅ Device marked offline. Goodbye!")


def main():
    """Main entry point."""
    print("""
    ╔═══════════════════════════════════════════════════════╗
    ║           JARVIS PC Agent v2.0                        ║
    ║       Your AI-Powered PC Assistant                    ║
    ╠═══════════════════════════════════════════════════════╣
    ║  This agent connects your PC to the Jarvis web app.   ║
    ║  Control your PC remotely from anywhere!              ║
    ║                                                       ║
    ║  NEW: Faster response, screen streaming, boost mode   ║
    ╚═══════════════════════════════════════════════════════╝
    """)
    
    print("🔌 Connecting to Jarvis servers...")
    
    agent = JarvisAgent()
    asyncio.run(agent.run())


if __name__ == "__main__":
    main()
