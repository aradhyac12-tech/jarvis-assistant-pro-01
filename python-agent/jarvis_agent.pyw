"""
JARVIS PC Agent v3.1 - Unified Background Service Edition
===========================================================
Single background-friendly script with:
- Local P2P WebSocket server (port 9876) for ultra-low latency
- Pairing code countdown with auto-regeneration
- Exponential backoff connection recovery
- Threaded screenshot encoding
- Circular buffers to prevent memory leaks
- Proper error logging (no silent failures)
- execute_batch for multi-command execution
- gesture_3_finger, gesture_4_finger, file transfer commands

This file uses .pyw extension for silent background running on Windows.
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
import socket
import base64
import io
import uuid
import traceback
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Callable, Set
from collections import deque

# ============== VERSION ==============
AGENT_VERSION = "3.1.0"

# Remote input safety window (prevents "ghost" input)
INPUT_SESSION_TTL_SECONDS = 12

# Native GUI
try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext, filedialog
    HAS_TKINTER = True
except ImportError:
    HAS_TKINTER = False

# ============== BOOTSTRAP ==============
def _check_dependencies() -> None:
    try:
        import supabase
        return
    except ImportError:
        print("❌ Missing Python packages. Run: pip install -r requirements.txt")
        sys.exit(1)

_check_dependencies()

# Third-party imports
from supabase import create_client, Client
import pyautogui
from PIL import Image
import psutil

try:
    import mss
    HAS_MSS = True
except ImportError:
    HAS_MSS = False

try:
    import keyboard
    HAS_KEYBOARD = True
except ImportError:
    HAS_KEYBOARD = False

try:
    import pyaudio
    HAS_PYAUDIO = True
except ImportError:
    HAS_PYAUDIO = False

try:
    os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

try:
    import pyperclip
    HAS_PYPERCLIP = True
except ImportError:
    HAS_PYPERCLIP = False

try:
    import pystray
    from pystray import MenuItem as item
    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False

try:
    from win10toast_click import ToastNotifier
    HAS_TOAST = True
except ImportError:
    try:
        from win10toast import ToastNotifier
        HAS_TOAST = True
    except ImportError:
        HAS_TOAST = False

if platform.system() == "Windows":
    try:
        from pycaw.pycaw import AudioUtilities, ISimpleAudioVolume, IAudioEndpointVolume
        from ctypes import cast, POINTER
        from comtypes import CLSCTX_ALL
        HAS_PYCAW = True
    except ImportError:
        HAS_PYCAW = False
    try:
        import screen_brightness_control as sbc
        HAS_BRIGHTNESS = True
    except ImportError:
        HAS_BRIGHTNESS = False
else:
    HAS_PYCAW = False
    HAS_BRIGHTNESS = False

# ============== CONFIGURATION ==============
DEFAULT_JARVIS_URL = "https://gkppopjoedadacolxufi.supabase.co"
DEFAULT_JARVIS_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrcHBvcGpvZWRhZGFjb2x4dWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MzAyNjAsImV4cCI6MjA4NTAwNjI2MH0.BTudp4YXmUuYv6gtPeurUzqzM_mbf_j7QqsL78uwQUE"

SUPABASE_URL = os.environ.get("JARVIS_SUPABASE_URL", DEFAULT_JARVIS_URL)
SUPABASE_KEY = os.environ.get("JARVIS_SUPABASE_KEY", DEFAULT_JARVIS_KEY)

DEVICE_NAME = platform.node() or "My PC"
UNLOCK_PIN = "1212"
POLL_INTERVAL = 0.5
HEARTBEAT_INTERVAL = 5
LOCAL_P2P_PORT = 9876
PAIRING_CODE_LIFETIME_MINUTES = 30

# Default save folder for file transfers
DEFAULT_SAVE_FOLDER = os.path.join(os.path.expanduser("~"), "Downloads", "Jarvis")

# PyAutoGUI settings
pyautogui.PAUSE = 0.01
pyautogui.FAILSAFE = False

# ============== CIRCULAR BUFFER LOGS ==============
MAX_LOGS = 100
log_entries: deque = deque(maxlen=MAX_LOGS)

agent_status: Dict[str, Any] = {
    "connected": False,
    "device_name": DEVICE_NAME,
    "device_id": "",
    "pairing_code": "",
    "pairing_expires_at": None,
    "pairing_countdown": "",
    "last_heartbeat": "",
    "volume": 50,
    "brightness": 50,
    "is_locked": False,
    "cpu_percent": 0,
    "memory_percent": 0,
    "local_ips": [],
    "p2p_port": LOCAL_P2P_PORT,
    "connection_mode": "cloud",  # local_p2p, cloud
}


def add_log(level: str, message: str, details: str = "", category: str = "general"):
    """Add log entry with proper error tracking."""
    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now().isoformat(),
        "level": level,
        "category": category,
        "message": message,
        "details": details
    }
    log_entries.append(entry)
    
    level_emoji = {"error": "❌", "warn": "⚠️", "info": "ℹ️"}.get(level, "📝")
    print(f"{level_emoji} [{category}] {message}" + (f" | {details}" if details else ""))


def get_logs() -> List[Dict[str, Any]]:
    return list(log_entries)


def update_agent_status(updates: Dict[str, Any]):
    global agent_status
    agent_status.update(updates)


def get_agent_status() -> Dict[str, Any]:
    return agent_status


# ============== NETWORK UTILITIES ==============
def get_local_ips() -> List[str]:
    """Get all local IP addresses for this machine."""
    ips = []
    hostname = socket.gethostname()
    
    try:
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        primary_ip = s.getsockname()[0]
        s.close()
        if primary_ip not in ips:
            ips.insert(0, primary_ip)
    except Exception:
        pass
    
    return ips


def get_network_prefix(ip: str) -> str:
    """Extract network prefix from IP (first 3 octets)."""
    parts = ip.split(".")
    return ".".join(parts[:3]) if len(parts) == 4 else ""


# ============== LOCAL P2P WEBSOCKET SERVER ==============
class LocalP2PServer:
    """Ultra-low latency local WebSocket server for same-network connections."""
    
    def __init__(self, command_handler: Optional[Callable] = None, port: int = LOCAL_P2P_PORT):
        self.port = port
        self.command_handler = command_handler
        self.running = False
        self.server = None
        self.clients: Set = set()
        self.local_ips: List[str] = []
        self._server_thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        
    async def handle_client(self, websocket, path: str):
        """Handle WebSocket client connection."""
        client_ip = websocket.remote_address[0] if websocket.remote_address else "unknown"
        add_log("info", f"Local P2P client connected: {client_ip}", category="p2p")
        
        self.clients.add(websocket)
        update_agent_status({"connection_mode": "local_p2p"})
        
        try:
            await websocket.send(json.dumps({
                "type": "welcome",
                "server": "jarvis_local_p2p",
                "version": AGENT_VERSION,
                "local_ips": self.local_ips,
                "port": self.port,
            }))
            
            async for message in websocket:
                try:
                    if isinstance(message, str):
                        data = json.loads(message)
                        response = await self._process_message(data)
                        if response:
                            await websocket.send(json.dumps(response))
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({"type": "error", "error": "Invalid JSON"}))
                except Exception as e:
                    add_log("error", f"P2P message error: {e}", category="p2p")
                    await websocket.send(json.dumps({"type": "error", "error": str(e)}))
                    
        except Exception as e:
            add_log("warn", f"P2P client disconnected: {e}", category="p2p")
        finally:
            self.clients.discard(websocket)
            if len(self.clients) == 0:
                update_agent_status({"connection_mode": "cloud"})
    
    async def _process_message(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        msg_type = data.get("type", "")
        request_id = data.get("requestId")
        
        if msg_type == "ping":
            resp: Dict[str, Any] = {"type": "pong", "t": data.get("t", 0), "server_time": datetime.now().isoformat()}
            if request_id:
                resp["requestId"] = request_id
            return resp
        
        elif msg_type == "command":
            command_type = data.get("commandType", "")
            payload = data.get("payload", {})
            
            if self.command_handler:
                try:
                    if asyncio.iscoroutinefunction(self.command_handler):
                        result = await self.command_handler(command_type, payload)
                    else:
                        result = self.command_handler(command_type, payload)
                    
                    return {
                        "type": "command_result",
                        "requestId": request_id,
                        "commandType": command_type,
                        "result": result,
                    }
                except Exception as e:
                    add_log("error", f"Command '{command_type}' failed: {e}", category="p2p")
                    return {
                        "type": "command_error",
                        "requestId": request_id,
                        "commandType": command_type,
                        "error": str(e),
                    }
        
        elif msg_type == "get_info":
            return {
                "type": "info",
                "local_ips": self.local_ips,
                "network_prefix": get_network_prefix(self.local_ips[0]) if self.local_ips else "",
                "port": self.port,
                "clients": len(self.clients),
            }
        
        return None
    
    async def _start_server(self):
        self.local_ips = get_local_ips()
        
        try:
            self.server = await websockets.serve(
                self.handle_client,
                "0.0.0.0",
                self.port,
                ping_interval=20,
                ping_timeout=10,
            )
            self.running = True
            
            add_log("info", f"Local P2P server started on port {self.port}", category="p2p")
            for ip in self.local_ips:
                add_log("info", f"  → ws://{ip}:{self.port}/p2p", category="p2p")
            
            update_agent_status({"local_ips": self.local_ips, "p2p_port": self.port})
            
            await self.server.wait_closed()
            
        except OSError as e:
            if "Address already in use" in str(e):
                add_log("warn", f"Port {self.port} already in use", category="p2p")
            else:
                add_log("error", f"P2P server error: {e}", category="p2p")
            self.running = False
    
    def start(self):
        if not HAS_WEBSOCKETS:
            add_log("warn", "websockets not installed - P2P disabled", category="p2p")
            return False
        
        if self.running:
            return True
        
        def run_server():
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            try:
                self._loop.run_until_complete(self._start_server())
            except Exception as e:
                add_log("error", f"P2P server thread error: {e}", category="p2p")
            finally:
                self._loop.close()
        
        self._server_thread = threading.Thread(target=run_server, daemon=True)
        self._server_thread.start()
        return True
    
    def stop(self):
        self.running = False
        if self.server:
            self.server.close()
            self.server = None
        add_log("info", "P2P server stopped", category="p2p")


# ============== THREADED SCREENSHOT ==============
class ThreadedScreenshot:
    """Non-blocking screenshot capture using worker thread."""
    
    def __init__(self):
        self._lock = threading.Lock()
        self._result: Optional[Dict[str, Any]] = None
        self._in_progress = False
    
    def capture_sync(self, quality: int = 70, scale: float = 0.5, monitor_index: int = 1) -> Dict[str, Any]:
        """Synchronous capture (blocking)."""
        try:
            if HAS_MSS:
                with mss.mss() as sct:
                    monitors = sct.monitors
                    idx = monitor_index if 0 < monitor_index < len(monitors) else 1
                    monitor = monitors[idx]
                    screenshot = sct.grab(monitor)
                    img = Image.frombytes('RGB', screenshot.size, screenshot.bgra, 'raw', 'BGRX')
            else:
                from PIL import ImageGrab
                img = ImageGrab.grab()

            new_size = (int(img.width * scale), int(img.height * scale))
            img = img.resize(new_size, Image.LANCZOS)

            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=quality, optimize=True)
            base64_image = base64.b64encode(buffer.getvalue()).decode()

            return {"success": True, "image": base64_image, "width": new_size[0], "height": new_size[1]}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ============== JARVIS AGENT ==============
class JarvisAgent:
    """Main agent class."""
    
    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.device_id: Optional[str] = None
        self.device_key: str = str(uuid.uuid4())
        self.running = True
        
        self.screenshot_handler = ThreadedScreenshot()
        
        # Pairing
        self.pairing_code: str = ""
        self.pairing_expires_at: Optional[datetime] = None
        
        # Recovery
        self.consecutive_failures = 0
        self.max_failures_before_reregister = 10
        self.backoff_seconds = 1
        self.max_backoff = 60
        self.last_heartbeat = 0
        
        # Input session gating
        self._active_input_session: Optional[str] = None
        self._input_session_expires_at: float = 0.0
        
        # Local P2P server
        self.local_p2p_server: Optional[LocalP2PServer] = None
        
        # File transfer in-progress chunks
        self._file_chunks: Dict[str, Dict[str, Any]] = {}
    
    def _generate_pairing_code(self) -> str:
        import random
        return ''.join(random.choices('0123456789', k=6))
    
    def is_pairing_expired(self) -> bool:
        if not self.pairing_expires_at:
            return True
        return datetime.now(timezone.utc) > self.pairing_expires_at
    
    def get_pairing_countdown(self) -> str:
        if not self.pairing_expires_at:
            return "EXPIRED"
        remaining = (self.pairing_expires_at - datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            return "EXPIRED"
        mins, secs = divmod(int(remaining), 60)
        return f"{mins:02d}:{secs:02d}"
    
    async def regenerate_pairing_code(self):
        self.pairing_code = self._generate_pairing_code()
        self.pairing_expires_at = datetime.now(timezone.utc) + timedelta(minutes=PAIRING_CODE_LIFETIME_MINUTES)
        
        update_agent_status({
            "pairing_code": self.pairing_code,
            "pairing_expires_at": self.pairing_expires_at.isoformat(),
        })
        
        if self.device_id:
            try:
                self.supabase.table("devices").update({
                    "pairing_code": self.pairing_code,
                    "pairing_expires_at": self.pairing_expires_at.isoformat(),
                }).eq("id", self.device_id).execute()
                add_log("info", f"New pairing code: {self.pairing_code}", category="system")
            except Exception as e:
                add_log("error", f"Failed to update pairing code: {e}", category="system")
    
    async def register_device(self):
        self.pairing_code = self._generate_pairing_code()
        self.pairing_expires_at = datetime.now(timezone.utc) + timedelta(minutes=PAIRING_CODE_LIFETIME_MINUTES)
        
        system_info = {
            "os": platform.system(),
            "os_version": platform.version(),
            "hostname": DEVICE_NAME,
            "python_version": platform.python_version(),
            "agent_version": AGENT_VERSION,
        }
        
        try:
            result = self.supabase.table("devices").insert({
                "device_key": self.device_key,
                "name": DEVICE_NAME,
                "is_online": True,
                "pairing_code": self.pairing_code,
                "pairing_expires_at": self.pairing_expires_at.isoformat(),
                "system_info": system_info,
                "user_id": "00000000-0000-0000-0000-000000000000",  # Placeholder
            }).execute()
            
            if result.data:
                self.device_id = result.data[0]["id"]
                update_agent_status({
                    "connected": True,
                    "device_id": self.device_id,
                    "pairing_code": self.pairing_code,
                    "pairing_expires_at": self.pairing_expires_at.isoformat(),
                })
                add_log("info", f"Device registered: {self.device_id}", category="system")
                add_log("info", f"Pairing code: {self.pairing_code}", category="system")
                
        except Exception as e:
            add_log("error", f"Registration failed: {e}", category="system")
    
    # ============== SYSTEM COMMANDS ==============
    def _get_system_stats(self) -> Dict[str, Any]:
        try:
            cpu = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory().percent
            disk = psutil.disk_usage("/").percent if platform.system() != "Windows" else psutil.disk_usage("C:\\").percent
            
            update_agent_status({"cpu_percent": cpu, "memory_percent": mem})
            
            result = {"success": True, "cpu_percent": cpu, "memory_percent": mem, "disk_percent": disk}
            
            try:
                battery = psutil.sensors_battery()
                if battery:
                    result["battery_percent"] = battery.percent
                    result["battery_plugged"] = battery.power_plugged
            except:
                pass
            
            return result
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_volume(self) -> int:
        try:
            if platform.system() == "Windows" and HAS_PYCAW:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                endpoint = cast(interface, POINTER(IAudioEndpointVolume))
                vol = endpoint.GetMasterVolumeLevelScalar()
                return int(vol * 100)
        except:
            pass
        return 50
    
    def _set_volume(self, level: int) -> Dict[str, Any]:
        try:
            level = max(0, min(100, int(level)))
            if platform.system() == "Windows" and HAS_PYCAW:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                endpoint = cast(interface, POINTER(IAudioEndpointVolume))
                endpoint.SetMasterVolumeLevelScalar(level / 100.0, None)
                return {"success": True, "volume": level}
        except Exception as e:
            return {"success": False, "error": str(e)}
        return {"success": False, "error": "Volume control not available"}
    
    def _get_brightness(self) -> int:
        try:
            if HAS_BRIGHTNESS:
                levels = sbc.get_brightness()
                if levels:
                    return levels[0] if isinstance(levels, list) else levels
        except:
            pass
        return 50
    
    def _set_brightness(self, level: int) -> Dict[str, Any]:
        try:
            level = max(0, min(100, int(level)))
            if HAS_BRIGHTNESS:
                sbc.set_brightness(level)
                return {"success": True, "brightness": level}
        except Exception as e:
            return {"success": False, "error": str(e)}
        return {"success": False, "error": "Brightness control not available"}
    
    def _get_network_info(self) -> Dict[str, Any]:
        ips = get_local_ips()
        prefix = get_network_prefix(ips[0]) if ips else ""
        return {
            "success": True,
            "local_ips": ips,
            "network_prefix": prefix,
            "p2p_port": LOCAL_P2P_PORT,
            "p2p_available": self.local_p2p_server is not None and self.local_p2p_server.running,
        }
    
    def _mouse_move(self, x: int, y: int, relative: bool = True) -> Dict[str, Any]:
        try:
            if relative:
                pyautogui.moveRel(x, y, duration=0)
            else:
                pyautogui.moveTo(x, y, duration=0)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_click(self, button: str = "left", clicks: int = 1) -> Dict[str, Any]:
        try:
            pyautogui.click(button=button, clicks=clicks)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _key_press(self, key: str) -> Dict[str, Any]:
        try:
            if "+" in key:
                keys = [k.strip().lower() for k in key.split("+")]
                pyautogui.hotkey(*keys)
            else:
                pyautogui.press(key.lower())
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _type_text(self, text: str) -> Dict[str, Any]:
        try:
            pyautogui.typewrite(text, interval=0.02) if text.isascii() else pyautogui.write(text)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _scroll(self, amount: int) -> Dict[str, Any]:
        try:
            pyautogui.scroll(amount)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _lock_screen(self) -> Dict[str, Any]:
        try:
            if platform.system() == "Windows":
                ctypes.windll.user32.LockWorkStation()
            elif platform.system() == "Darwin":
                subprocess.run(["pmset", "displaysleepnow"])
            else:
                subprocess.run(["xdg-screensaver", "lock"])
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _unlock_screen(self, pin: str) -> Dict[str, Any]:
        if pin == UNLOCK_PIN:
            try:
                pyautogui.press("enter")
                return {"success": True}
            except:
                pass
        return {"success": False, "error": "Invalid PIN"}
    
    def _get_clipboard(self) -> Dict[str, Any]:
        try:
            if HAS_PYPERCLIP:
                import pyperclip
                content = pyperclip.paste()
                return {"success": True, "content": content}
            return {"success": False, "error": "pyperclip not installed"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _set_clipboard(self, text: str) -> Dict[str, Any]:
        try:
            if HAS_PYPERCLIP:
                import pyperclip
                pyperclip.copy(text)
                return {"success": True}
            return {"success": False, "error": "pyperclip not installed"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _media_control(self, action: str) -> Dict[str, Any]:
        try:
            action_lower = action.lower().strip()
            
            if action_lower in ["play_pause", "playpause", "play", "pause"]:
                pyautogui.press("playpause")
            elif action_lower in ["next", "nexttrack"]:
                pyautogui.press("nexttrack")
            elif action_lower in ["previous", "prevtrack"]:
                pyautogui.press("prevtrack")
            elif action_lower == "stop":
                pyautogui.press("stop")
            elif action_lower in ["mute", "togglemute"]:
                pyautogui.press("volumemute")
            else:
                return {"success": False, "error": f"Unknown action: {action}"}
            
            return {"success": True, "action": action}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== GESTURE COMMANDS ==============
    def _gesture_3_finger(self) -> Dict[str, Any]:
        """Show desktop (Win+D)."""
        try:
            pyautogui.hotkey("win", "d")
            return {"success": True, "gesture": "show_desktop"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _gesture_4_finger(self, direction: str) -> Dict[str, Any]:
        """Switch virtual desktop."""
        try:
            direction = direction.lower().strip()
            if direction == "left":
                pyautogui.hotkey("ctrl", "win", "left")
            elif direction == "right":
                pyautogui.hotkey("ctrl", "win", "right")
            else:
                return {"success": False, "error": f"Unknown direction: {direction}"}
            return {"success": True, "gesture": f"switch_desktop_{direction}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== FILE TRANSFER ==============
    def _list_files(self, path: str = "~") -> Dict[str, Any]:
        try:
            path = os.path.expanduser(path)
            if not os.path.exists(path):
                return {"success": False, "error": "Path not found"}
            
            items = []
            for entry in os.scandir(path):
                try:
                    stat = entry.stat()
                    items.append({
                        "name": entry.name,
                        "path": entry.path,
                        "is_directory": entry.is_dir(),
                        "size": stat.st_size if entry.is_file() else 0,
                        "modified": int(stat.st_mtime * 1000),
                    })
                except:
                    pass
            
            return {"success": True, "items": items, "current_path": path}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _receive_file_chunk(self, file_id: str, file_name: str, chunk_index: int, total_chunks: int, data: str, save_folder: str = "") -> Dict[str, Any]:
        """Receive a chunk of file data from phone."""
        try:
            if not save_folder:
                save_folder = DEFAULT_SAVE_FOLDER
            else:
                save_folder = os.path.expanduser(save_folder)
            
            os.makedirs(save_folder, exist_ok=True)
            
            if file_id not in self._file_chunks:
                self._file_chunks[file_id] = {"chunks": {}, "name": file_name, "total": total_chunks}
            
            self._file_chunks[file_id]["chunks"][chunk_index] = data
            
            if len(self._file_chunks[file_id]["chunks"]) == total_chunks:
                # All chunks received, assemble file
                full_data = b""
                for i in range(total_chunks):
                    chunk_data = self._file_chunks[file_id]["chunks"][i]
                    full_data += base64.b64decode(chunk_data)
                
                file_path = os.path.join(save_folder, file_name)
                with open(file_path, "wb") as f:
                    f.write(full_data)
                
                del self._file_chunks[file_id]
                add_log("info", f"File received: {file_name}", category="file")
                return {"success": True, "complete": True, "path": file_path}
            
            return {"success": True, "complete": False, "received": chunk_index + 1, "total": total_chunks}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _send_file_chunk(self, path: str, chunk_index: int, chunk_size: int = 65536) -> Dict[str, Any]:
        """Send a chunk of file data to phone."""
        try:
            path = os.path.expanduser(path)
            if not os.path.exists(path):
                return {"success": False, "error": "File not found"}
            
            file_size = os.path.getsize(path)
            offset = chunk_index * chunk_size
            
            with open(path, "rb") as f:
                f.seek(offset)
                chunk = f.read(chunk_size)
            
            data = base64.b64encode(chunk).decode()
            
            return {"success": True, "data": data, "size": len(chunk), "file_size": file_size}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== BOOST PC ==============
    def _boost_ram(self) -> Dict[str, Any]:
        try:
            if platform.system() == "Windows":
                subprocess.run(["taskkill", "/F", "/IM", "SearchApp.exe"], capture_output=True)
                subprocess.run(["taskkill", "/F", "/IM", "YourPhone.exe"], capture_output=True)
            import gc
            gc.collect()
            return {"success": True, "action": "boost_ram"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _clear_temp_files(self) -> Dict[str, Any]:
        try:
            if platform.system() == "Windows":
                temp = os.environ.get("TEMP", "")
                if temp:
                    for f in os.listdir(temp):
                        try:
                            fp = os.path.join(temp, f)
                            if os.path.isfile(fp):
                                os.remove(fp)
                        except:
                            pass
            return {"success": True, "action": "clear_temp"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _set_power_plan(self, plan: str) -> Dict[str, Any]:
        try:
            if platform.system() == "Windows":
                plans = {
                    "high_performance": "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
                    "balanced": "381b4222-f694-41f0-9685-ff5bb260df2e",
                    "power_saver": "a1841308-3541-4fab-bc81-f71556f20b4a",
                }
                guid = plans.get(plan.lower(), plans["high_performance"])
                subprocess.run(["powercfg", "/S", guid], capture_output=True)
            return {"success": True, "plan": plan}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _restart_explorer(self) -> Dict[str, Any]:
        try:
            if platform.system() == "Windows":
                subprocess.run(["taskkill", "/F", "/IM", "explorer.exe"], capture_output=True)
                subprocess.Popen(["explorer.exe"])
                add_log("info", "Explorer restarted", category="system")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== EXECUTE COMMAND ==============
    def execute_command(self, command_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a command and return result. Never silently fails."""
        try:
            cmd = command_type.lower().strip()

            # Normalize legacy command names from the web app
            if cmd == "lock":
                cmd = "lock_screen"
            if cmd == "unlock":
                cmd = "smart_unlock"
            if cmd == "press_key":
                cmd = "key_press"
            if cmd == "mouse_scroll":
                cmd = "scroll"
            if cmd == "pinch_zoom":
                cmd = "zoom"

            # Remote input gating commands
            if cmd == "remote_input_enable":
                session = str(payload.get("session", "") or "")
                ttl_ms = int(payload.get("ttl_ms", INPUT_SESSION_TTL_SECONDS * 1000) or (INPUT_SESSION_TTL_SECONDS * 1000))
                if not session:
                    return {"success": False, "error": "Missing session"}
                self._active_input_session = session
                self._input_session_expires_at = time.time() + max(1, ttl_ms / 1000.0)
                return {"success": True, "enabled": True}

            if cmd == "remote_input_disable":
                session = str(payload.get("session", "") or "")
                if session and session == self._active_input_session:
                    self._active_input_session = None
                    self._input_session_expires_at = 0.0
                    return {"success": True, "enabled": False}
                return {"success": True, "enabled": False}

            # Reject remote input unless enabled recently (prevents accidental/queued execution)
            if cmd in {
                "mouse_move",
                "mouse_click",
                "key_press",
                "press_key",
                "key_combo",
                "type_text",
                "scroll",
                "mouse_scroll",
                "pinch_zoom",
                "zoom",
                "gesture_3_finger",
                "gesture_4_finger",
            }:
                incoming_session = str(payload.get("input_session", "") or "")
                if (
                    not self._active_input_session
                    or incoming_session != self._active_input_session
                    or time.time() > self._input_session_expires_at
                ):
                    # Silently reject - this is not an error, just blocked input
                    return {"success": True, "blocked": True, "reason": "Remote input not enabled"}
            
            # Batch execution
            if cmd == "execute_batch":
                commands = payload.get("commands", [])
                if not isinstance(commands, list):
                    return {"success": False, "error": "commands must be a list"}
                results = []
                for c in commands:
                    ctype = c.get("type", c.get("command_type", ""))
                    cpayload = c.get("payload", {})
                    r = self.execute_command(ctype, cpayload)
                    results.append({"type": ctype, "result": r})
                return {"success": True, "results": results}
            
            # System status commands
            if cmd == "get_system_stats":
                return self._get_system_stats()
            elif cmd == "get_system_state":
                return {
                    "success": True,
                    "volume": self._get_volume(),
                    "brightness": self._get_brightness(),
                    "is_locked": False,
                }
            elif cmd == "get_volume":
                return {"success": True, "volume": self._get_volume()}
            elif cmd == "set_volume":
                return self._set_volume(payload.get("level", 50))
            elif cmd == "get_brightness":
                return {"success": True, "brightness": self._get_brightness()}
            elif cmd == "set_brightness":
                return self._set_brightness(payload.get("level", 50))
            elif cmd == "get_network_info":
                return self._get_network_info()
            
            # Mouse/keyboard commands
            elif cmd == "mouse_move":
                return self._mouse_move(
                    payload.get("x", 0),
                    payload.get("y", 0),
                    payload.get("relative", True)
                )
            elif cmd == "mouse_click":
                return self._mouse_click(
                    payload.get("button", "left"),
                    payload.get("clicks", 1)
                )
            elif cmd == "key_press":
                return self._key_press(payload.get("key", ""))
            elif cmd == "key_combo":
                keys = payload.get("keys", []) or []
                if not isinstance(keys, list) or not keys:
                    return {"success": False, "error": "Missing keys"}
                return self._key_press("+".join([str(k) for k in keys]))
            elif cmd == "type_text":
                return self._type_text(payload.get("text", ""))
            elif cmd == "scroll":
                return self._scroll(int(payload.get("delta", payload.get("amount", 0)) or 0))
            elif cmd == "zoom":
                direction = str(payload.get("direction", "in")).lower()
                steps = int(payload.get("steps", 1) or 1)
                steps = max(1, min(steps, 10))
                try:
                    pyautogui.keyDown("ctrl")
                    for _ in range(steps):
                        pyautogui.press("=" if direction == "in" else "-")
                    return {"success": True}
                except Exception as e:
                    return {"success": False, "error": str(e)}
                finally:
                    try:
                        pyautogui.keyUp("ctrl")
                    except:
                        pass
            
            # Gesture commands
            elif cmd == "gesture_3_finger":
                return self._gesture_3_finger()
            elif cmd == "gesture_4_finger":
                return self._gesture_4_finger(payload.get("direction", "left"))
            
            # Screen control
            elif cmd == "lock_screen":
                return self._lock_screen()
            elif cmd == "smart_unlock":
                return self._unlock_screen(payload.get("pin", ""))
            
            # Clipboard
            elif cmd == "get_clipboard":
                return self._get_clipboard()
            elif cmd == "set_clipboard":
                text = payload.get("content", payload.get("text", ""))
                return self._set_clipboard(text)
            
            # Media
            elif cmd == "media_control":
                return self._media_control(payload.get("action", "play_pause"))
            elif cmd == "mute_pc":
                pyautogui.press("volumemute")
                return {"success": True, "muted": True}
            elif cmd == "unmute_pc":
                return {"success": True, "muted": False}
            
            # File operations
            elif cmd == "list_files":
                return self._list_files(payload.get("path", "~"))
            elif cmd == "receive_file_chunk":
                return self._receive_file_chunk(
                    payload.get("file_id", ""),
                    payload.get("file_name", "file"),
                    int(payload.get("chunk_index", 0)),
                    int(payload.get("total_chunks", 1)),
                    payload.get("data", ""),
                    payload.get("save_folder", ""),
                )
            elif cmd == "send_file_chunk":
                return self._send_file_chunk(
                    payload.get("path", ""),
                    int(payload.get("chunk_index", 0)),
                    int(payload.get("chunk_size", 65536)),
                )
            elif cmd == "open_file":
                path = os.path.expanduser(payload.get("path", ""))
                if os.path.exists(path):
                    if platform.system() == "Windows":
                        os.startfile(path)
                    elif platform.system() == "Darwin":
                        subprocess.run(["open", path])
                    else:
                        subprocess.run(["xdg-open", path])
                    return {"success": True}
                return {"success": False, "error": "File not found"}
            
            # Boost/optimization
            elif cmd == "boost_ram":
                return self._boost_ram()
            elif cmd == "clear_temp_files":
                return self._clear_temp_files()
            elif cmd == "set_power_plan":
                return self._set_power_plan(payload.get("plan", "high_performance"))
            elif cmd == "restart_explorer":
                return self._restart_explorer()
            
            # Power
            elif cmd == "shutdown":
                if platform.system() == "Windows":
                    subprocess.run(["shutdown", "/s", "/t", "5"])
                return {"success": True}
            elif cmd == "restart":
                if platform.system() == "Windows":
                    subprocess.run(["shutdown", "/r", "/t", "5"])
                return {"success": True}
            elif cmd == "sleep":
                if platform.system() == "Windows":
                    subprocess.run(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
                return {"success": True}
            
            # Screenshot
            elif cmd == "take_screenshot":
                return self.screenshot_handler.capture_sync(
                    quality=payload.get("quality", 70),
                    scale=payload.get("scale", 0.5)
                )
            
            # Ping/heartbeat
            elif cmd in ["ping", "heartbeat"]:
                return {"success": True, "pong": True, "timestamp": datetime.now().isoformat()}
            
            # Audio support check
            elif cmd == "check_audio_support":
                return {"success": True, "has_pyaudio": HAS_PYAUDIO, "has_websockets": HAS_WEBSOCKETS}
            
            else:
                add_log("warn", f"Unknown command: {cmd}", category="command")
                return {"success": False, "error": f"Unknown command: {cmd}"}
                
        except Exception as e:
            add_log("error", f"Command '{command_type}' exception: {e}", details=traceback.format_exc(), category="command")
            return {"success": False, "error": str(e)}
    
    async def poll_commands(self):
        """Poll for commands with exponential backoff recovery."""
        if not self.device_id:
            return
        
        try:
            result = self.supabase.table("commands")\
                .select("*")\
                .eq("device_id", self.device_id)\
                .eq("status", "pending")\
                .order("created_at", desc=False)\
                .limit(10)\
                .execute()
            
            # Reset failures on successful poll
            self.consecutive_failures = 0
            self.backoff_seconds = 1
            
            for cmd in result.data:
                cmd_type = cmd.get("command_type", "")
                payload = cmd.get("payload", {}) or {}
                
                add_log("info", f"Executing: {cmd_type}", category="command")
                
                # Execute command
                result_data = self.execute_command(cmd_type, payload)
                
                # Mark as completed
                try:
                    self.supabase.table("commands").update({
                        "status": "completed",
                        "result": result_data,
                        "executed_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", cmd["id"]).execute()
                except Exception as e:
                    add_log("error", f"Failed to update command status: {e}", category="command")
                    
        except Exception as e:
            self.consecutive_failures += 1
            add_log("error", f"Poll error ({self.consecutive_failures}): {e}", category="poll")
            
            # Exponential backoff
            self.backoff_seconds = min(self.backoff_seconds * 2, self.max_backoff)
            
            # Re-register after too many failures
            if self.consecutive_failures >= self.max_failures_before_reregister:
                add_log("warn", "Too many failures, re-registering device...", category="system")
                await asyncio.sleep(self.backoff_seconds)
                await self.register_device()
    
    async def heartbeat(self):
        """Send heartbeat to indicate device is online."""
        if not self.device_id:
            return
        
        try:
            stats = self._get_system_stats()
            self.supabase.table("devices").update({
                "is_online": True,
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "current_volume": self._get_volume(),
                "current_brightness": self._get_brightness(),
            }).eq("id", self.device_id).execute()
            
            self.last_heartbeat = time.time()
            update_agent_status({"last_heartbeat": datetime.now().isoformat()})
            
        except Exception as e:
            add_log("error", f"Heartbeat failed: {e}", category="system")
    
    async def run(self):
        """Main agent loop."""
        # Start local P2P server
        self.local_p2p_server = LocalP2PServer(
            command_handler=self.execute_command,
            port=LOCAL_P2P_PORT
        )
        self.local_p2p_server.start()
        
        # Register device
        await self.register_device()
        
        last_heartbeat = 0
        last_pairing_check = 0
        
        while self.running:
            try:
                now = time.time()
                
                # Poll commands
                await self.poll_commands()
                
                # Heartbeat
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    await self.heartbeat()
                    last_heartbeat = now
                
                # Check pairing code expiry and regenerate
                if now - last_pairing_check >= 10:
                    countdown = self.get_pairing_countdown()
                    update_agent_status({"pairing_countdown": countdown})
                    
                    if self.is_pairing_expired():
                        await self.regenerate_pairing_code()
                    
                    last_pairing_check = now
                
                # Wait with backoff
                await asyncio.sleep(max(POLL_INTERVAL, self.backoff_seconds / 10))
                
            except Exception as e:
                add_log("error", f"Main loop error: {e}", details=traceback.format_exc(), category="system")
                await asyncio.sleep(self.backoff_seconds)
    
    def stop(self):
        self.running = False
        if self.local_p2p_server:
            self.local_p2p_server.stop()


# ============== GUI ==============
class JarvisGUI:
    """Minimal dark GUI with file transfer."""
    
    def __init__(self, agent: JarvisAgent):
        self.agent = agent
        self.root: Optional[tk.Tk] = None
        self.running = True
        
        self.colors = {
            "bg": "#000000",
            "card": "#0a0a0a",
            "border": "#1a1a1a",
            "text": "#ffffff",
            "muted": "#666666",
            "primary": "#22c55e",
            "success": "#22c55e",
            "warning": "#f59e0b",
            "error": "#ef4444",
            "accent": "#3b82f6",
        }
        
        self.update_interval = 500
        self.last_log_count = 0
    
    def setup(self) -> bool:
        if not HAS_TKINTER:
            return False
        
        self.root = tk.Tk()
        self.root.title("JARVIS Agent")
        self.root.geometry("480x700")
        self.root.configure(bg=self.colors["bg"])
        self.root.resizable(True, True)
        self.root.minsize(420, 600)
        
        self._setup_styles()
        self._build_ui()
        
        self.root.after(500, self._update_ui)
        return True
    
    def _setup_styles(self):
        style = ttk.Style()
        style.theme_use('clam')
        c = self.colors
        
        style.configure("TFrame", background=c["bg"])
        style.configure("TLabel", background=c["bg"], foreground=c["text"], font=("Segoe UI", 10))
        style.configure("Stat.Horizontal.TProgressbar", background=c["primary"], troughcolor=c["border"], thickness=4)
    
    def _build_ui(self):
        c = self.colors
        
        main = tk.Frame(self.root, bg=c["bg"])
        main.pack(fill=tk.BOTH, expand=True, padx=20, pady=16)
        
        # Header
        header = tk.Frame(main, bg=c["bg"])
        header.pack(fill=tk.X, pady=(0, 12))
        
        tk.Label(header, text="JARVIS", font=("Segoe UI", 18, "bold"), fg=c["text"], bg=c["bg"]).pack(side=tk.LEFT)
        
        # Connection status
        status_frame = tk.Frame(header, bg=c["bg"])
        status_frame.pack(side=tk.RIGHT)
        
        self.status_dot = tk.Canvas(status_frame, width=8, height=8, bg=c["bg"], highlightthickness=0)
        self.status_dot.pack(side=tk.LEFT, padx=(0, 5))
        self.status_dot.create_oval(1, 1, 7, 7, fill=c["muted"], outline="", tags="dot")
        
        self.status_text = tk.Label(status_frame, text="Connecting", font=("Segoe UI", 9), fg=c["muted"], bg=c["bg"])
        self.status_text.pack(side=tk.LEFT)
        
        # Pairing card
        pairing_card = tk.Frame(main, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        pairing_card.pack(fill=tk.X, pady=(0, 12), ipady=12)
        
        tk.Label(pairing_card, text="PAIRING CODE", font=("Segoe UI", 8, "bold"), fg=c["muted"], bg=c["card"]).pack(pady=(10, 2))
        
        self.pairing_label = tk.Label(pairing_card, text="------", font=("Consolas", 32, "bold"), fg=c["primary"], bg=c["card"])
        self.pairing_label.pack()
        
        self.countdown_label = tk.Label(pairing_card, text="Expires in --:--", font=("Segoe UI", 8), fg=c["muted"], bg=c["card"])
        self.countdown_label.pack(pady=(2, 10))
        
        # Network info card
        net_card = tk.Frame(main, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        net_card.pack(fill=tk.X, pady=(0, 10), ipady=6)
        
        tk.Label(net_card, text="🌐 LOCAL P2P", font=("Segoe UI", 8, "bold"), fg=c["muted"], bg=c["card"]).pack(anchor=tk.W, padx=12, pady=(6, 2))
        
        self.ip_label = tk.Label(net_card, text="Detecting...", font=("Consolas", 9), fg=c["text"], bg=c["card"])
        self.ip_label.pack(anchor=tk.W, padx=12, pady=(0, 6))
        
        self.connection_mode_label = tk.Label(net_card, text="Mode: Cloud", font=("Segoe UI", 8), fg=c["accent"], bg=c["card"])
        self.connection_mode_label.pack(anchor=tk.W, padx=12, pady=(0, 8))
        
        # Stats row
        stats_row = tk.Frame(main, bg=c["bg"])
        stats_row.pack(fill=tk.X, pady=(0, 10))
        
        for i in range(2):
            stats_row.columnconfigure(i, weight=1)
        
        cpu_frame = tk.Frame(stats_row, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        cpu_frame.grid(row=0, column=0, padx=(0, 4), sticky="nsew")
        tk.Label(cpu_frame, text="CPU", font=("Segoe UI", 8), fg=c["muted"], bg=c["card"]).pack(anchor=tk.W, padx=10, pady=(8, 2))
        self.cpu_bar = ttk.Progressbar(cpu_frame, style="Stat.Horizontal.TProgressbar", length=160, mode='determinate')
        self.cpu_bar.pack(fill=tk.X, padx=10, pady=(0, 8))
        
        mem_frame = tk.Frame(stats_row, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        mem_frame.grid(row=0, column=1, padx=(4, 0), sticky="nsew")
        tk.Label(mem_frame, text="MEM", font=("Segoe UI", 8), fg=c["muted"], bg=c["card"]).pack(anchor=tk.W, padx=10, pady=(8, 2))
        self.mem_bar = ttk.Progressbar(mem_frame, style="Stat.Horizontal.TProgressbar", length=160, mode='determinate')
        self.mem_bar.pack(fill=tk.X, padx=10, pady=(0, 8))
        
        # File Transfer card
        file_card = tk.Frame(main, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        file_card.pack(fill=tk.X, pady=(0, 10))
        
        tk.Label(file_card, text="📁 FILE TRANSFER", font=("Segoe UI", 9, "bold"), fg=c["text"], bg=c["card"]).pack(anchor=tk.W, padx=12, pady=(10, 6))
        
        path_row = tk.Frame(file_card, bg=c["card"])
        path_row.pack(fill=tk.X, padx=12, pady=(0, 6))
        
        tk.Label(path_row, text="Save to:", font=("Segoe UI", 8), fg=c["muted"], bg=c["card"]).pack(side=tk.LEFT)
        
        self.save_path_var = tk.StringVar(value=DEFAULT_SAVE_FOLDER)
        
        path_entry = tk.Entry(path_row, textvariable=self.save_path_var, font=("Consolas", 8),
                             bg=c["bg"], fg=c["text"], insertbackground=c["text"], bd=0, highlightthickness=1,
                             highlightbackground=c["border"])
        path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(6, 4))
        
        browse_btn = tk.Label(path_row, text="📂", font=("Segoe UI", 10), fg=c["primary"], bg=c["card"], cursor="hand2")
        browse_btn.pack(side=tk.RIGHT)
        browse_btn.bind("<Button-1>", self._browse_folder)
        
        btn_row = tk.Frame(file_card, bg=c["card"])
        btn_row.pack(fill=tk.X, padx=12, pady=(0, 8))
        
        open_btn = tk.Frame(btn_row, bg=c["border"], cursor="hand2")
        open_btn.pack(side=tk.RIGHT, expand=True, fill=tk.X)
        tk.Label(open_btn, text="📂 Open Folder", font=("Segoe UI", 9), fg=c["text"], bg=c["border"], pady=6).pack()
        open_btn.bind("<Button-1>", self._open_folder)
        
        # Activity log
        log_card = tk.Frame(main, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        log_card.pack(fill=tk.BOTH, expand=True)
        
        log_header = tk.Frame(log_card, bg=c["card"])
        log_header.pack(fill=tk.X, padx=12, pady=(8, 4))
        
        tk.Label(log_header, text="ACTIVITY", font=("Segoe UI", 8, "bold"), fg=c["muted"], bg=c["card"]).pack(side=tk.LEFT)
        
        self.log_text = scrolledtext.ScrolledText(
            log_card, bg="#050505", fg=c["text"], font=("Consolas", 8),
            wrap=tk.WORD, bd=0, highlightthickness=0, height=8
        )
        self.log_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))
        self.log_text.configure(state=tk.DISABLED)
        
        self.log_text.tag_configure("error", foreground=c["error"])
        self.log_text.tag_configure("warn", foreground=c["warning"])
        self.log_text.tag_configure("info", foreground=c["primary"])
        self.log_text.tag_configure("time", foreground=c["muted"])
    
    def _browse_folder(self, event=None):
        folder = filedialog.askdirectory(initialdir=self.save_path_var.get())
        if folder:
            self.save_path_var.set(folder)
    
    def _open_folder(self, event=None):
        folder = self.save_path_var.get()
        os.makedirs(folder, exist_ok=True)
        if platform.system() == "Windows":
            os.startfile(folder)
        elif platform.system() == "Darwin":
            subprocess.run(["open", folder])
        else:
            subprocess.run(["xdg-open", folder])
    
    def _update_ui(self):
        if not self.running or not self.root:
            return
        
        try:
            status = get_agent_status()
            c = self.colors
            
            # Status
            if status.get("connected"):
                self.status_dot.itemconfig("dot", fill=c["success"])
                self.status_text.configure(text="Connected", fg=c["success"])
            else:
                self.status_dot.itemconfig("dot", fill=c["muted"])
                self.status_text.configure(text="Offline", fg=c["muted"])
            
            # Pairing code
            code = status.get("pairing_code", "------")
            self.pairing_label.configure(text=code if code else "------")
            
            # Countdown
            countdown = status.get("pairing_countdown", "--:--")
            if countdown == "EXPIRED":
                self.countdown_label.configure(text="Regenerating...", fg=c["warning"])
            else:
                self.countdown_label.configure(text=f"Expires in {countdown}", fg=c["muted"])
            
            # Network info
            ips = status.get("local_ips", [])
            if ips:
                ip_text = f"ws://{ips[0]}:{status.get('p2p_port', LOCAL_P2P_PORT)}/p2p"
                self.ip_label.configure(text=ip_text)
            
            # Connection mode
            mode = status.get("connection_mode", "cloud")
            mode_text = "Mode: Local P2P ⚡" if mode == "local_p2p" else "Mode: Cloud ☁️"
            mode_color = c["success"] if mode == "local_p2p" else c["accent"]
            self.connection_mode_label.configure(text=mode_text, fg=mode_color)
            
            # Stats
            self.cpu_bar["value"] = int(status.get("cpu_percent", 0))
            self.mem_bar["value"] = int(status.get("memory_percent", 0))
            
            # Logs
            logs = get_logs()
            if len(logs) != self.last_log_count:
                self._render_logs(logs)
                self.last_log_count = len(logs)
                
        except Exception as e:
            print(f"UI update error: {e}")
        
        if self.running and self.root:
            self.root.after(self.update_interval, self._update_ui)
    
    def _render_logs(self, logs):
        if not self.log_text:
            return
        
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.delete(1.0, tk.END)
        
        for log in list(logs)[-30:]:
            try:
                time_str = datetime.fromisoformat(log.get("timestamp", "")).strftime("%H:%M")
            except:
                time_str = "--:--"
            
            level = log.get("level", "info")
            msg = log.get("message", "")
            
            self.log_text.insert(tk.END, f"{time_str} ", "time")
            self.log_text.insert(tk.END, f"{msg}\n", level if level in ["error", "warn"] else "info")
        
        self.log_text.configure(state=tk.DISABLED)
        self.log_text.see(tk.END)
    
    def run_mainloop(self):
        if self.root:
            try:
                self.root.mainloop()
            except KeyboardInterrupt:
                pass
    
    def stop(self):
        self.running = False
        if self.root:
            try:
                self.root.quit()
                self.root.destroy()
            except:
                pass


# ============== MAIN ==============
def main():
    print(f"\n🤖 JARVIS Agent v{AGENT_VERSION} starting...\n")
    
    agent = JarvisAgent()
    
    # Start agent loop in background thread
    def run_agent():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(agent.run())
        except Exception as e:
            add_log("error", f"Agent error: {e}", category="system")
        finally:
            loop.close()
    
    agent_thread = threading.Thread(target=run_agent, daemon=True)
    agent_thread.start()
    
    # Give agent time to register
    time.sleep(2)
    
    # Start GUI if available
    if HAS_TKINTER:
        gui = JarvisGUI(agent)
        if gui.setup():
            try:
                gui.run_mainloop()
            except KeyboardInterrupt:
                pass
            finally:
                gui.stop()
                agent.stop()
    else:
        # Headless mode
        try:
            while agent.running:
                time.sleep(1)
        except KeyboardInterrupt:
            agent.stop()


if __name__ == "__main__":
    main()
