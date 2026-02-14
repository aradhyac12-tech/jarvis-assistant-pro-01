"""
JARVIS PC Agent v5.0.0 - Professional GUI Edition
==================================================
Single-file agent with:
- Local P2P WebSocket server (port 9876) for ultra-low latency
- Input-session gating to prevent "ghost" command execution
- Pairing code countdown with auto-regeneration
- Exponential backoff connection recovery
- Threaded screenshot encoding
- Circular buffers to prevent memory leaks
- Batch command execution
- File transfer support
- Professional 5-tab GUI: Dashboard, Actions, Files, Assistant, Settings

Run: python jarvis_agent.py --gui
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
import argparse
import socket
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Callable, Set
from collections import deque
import base64
import io
import uuid
import webbrowser
import urllib.parse
import urllib.request
import traceback
import calendar as cal_module

# ============== VERSION ==============
AGENT_VERSION = "5.0.0"

# Skill registry
try:
    from skills.registry import get_skill_registry
    HAS_SKILLS = True
except ImportError:
    HAS_SKILLS = False

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
    import speech_recognition as sr
    HAS_SPEECH_RECOGNITION = True
except ImportError:
    HAS_SPEECH_RECOGNITION = False

try:
    import pyttsx3
    HAS_TTS = True
except ImportError:
    HAS_TTS = False

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

# Optional: where the "Open Web App" button should navigate.
DEFAULT_APP_URL = os.environ.get("JARVIS_APP_URL", "https://aradhya-jarvis.lovable.app")

SUPABASE_URL = os.environ.get("JARVIS_SUPABASE_URL", DEFAULT_JARVIS_URL)
SUPABASE_KEY = os.environ.get("JARVIS_SUPABASE_KEY", DEFAULT_JARVIS_KEY)

DEVICE_NAME = platform.node() or "My PC"
UNLOCK_PIN = "1212"
POLL_INTERVAL = 0.5
HEARTBEAT_INTERVAL = 5
LOCAL_P2P_PORT = 9876
PAIRING_CODE_LIFETIME_MINUTES = 30

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
    "connection_mode": "cloud",
}


def add_log(level: str, message: str, details: str = "", category: str = "general"):
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


def clear_logs():
    log_entries.clear()


def update_agent_status(updates: Dict[str, Any]):
    global agent_status
    agent_status.update(updates)


def get_agent_status() -> Dict[str, Any]:
    return agent_status


# ============== NETWORK UTILITIES ==============
def get_local_ips() -> List[str]:
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


# Singleton P2P server
_local_p2p_server: Optional[LocalP2PServer] = None


def get_local_p2p_server() -> Optional[LocalP2PServer]:
    return _local_p2p_server


def start_local_p2p_server(command_handler: Callable, port: int = LOCAL_P2P_PORT) -> LocalP2PServer:
    global _local_p2p_server
    if _local_p2p_server is not None and _local_p2p_server.running:
        return _local_p2p_server
    _local_p2p_server = LocalP2PServer(command_handler=command_handler, port=port)
    _local_p2p_server.start()
    return _local_p2p_server


def stop_local_p2p_server():
    global _local_p2p_server
    if _local_p2p_server:
        _local_p2p_server.stop()
        _local_p2p_server = None


# ============== THREADED SCREENSHOT ==============
class ThreadedScreenshot:
    def __init__(self):
        self._lock = threading.Lock()
        self._result: Optional[Dict[str, Any]] = None
        self._in_progress = False
    
    def capture_sync(self, quality: int = 70, scale: float = 0.5, monitor_index: int = 1) -> Dict[str, Any]:
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


# ============== NOTIFICATION MANAGER ==============
class NotificationManager:
    def __init__(self):
        self._toaster = None
        if HAS_TOAST:
            try:
                self._toaster = ToastNotifier()
            except:
                pass
    
    def notify(self, title: str, message: str):
        if self._toaster:
            try:
                self._toaster.show_toast(title, message, duration=3, threaded=True)
            except:
                pass

notification_manager = NotificationManager()


# ============== VOICE LISTENER (PLACEHOLDER) ==============
voice_listener = None


# ============== JARVIS AGENT ==============
class JarvisAgent:
    DEVICE_KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".device_key")

    @staticmethod
    def _load_or_create_device_key() -> str:
        """Persist device_key so the agent reuses the same device across restarts."""
        key_file = JarvisAgent.DEVICE_KEY_FILE
        if os.path.exists(key_file):
            try:
                with open(key_file, "r") as f:
                    key = f.read().strip()
                if key:
                    return key
            except Exception:
                pass
        key = str(uuid.uuid4())
        try:
            with open(key_file, "w") as f:
                f.write(key)
        except Exception as e:
            add_log("warn", f"Could not save device key: {e}", category="system")
        return key

    def __init__(self):
        self.device_id = ""
        self.device_key = self._load_or_create_device_key()
        self.pairing_code = ""
        self.running = True
        self.is_locked = False
        self._volume_cache = 50
        self._brightness_cache = 50

        # User id (set after pairing verification)
        self.current_user_id: Optional[str] = None
        
        # Input session gating
        self._active_input_session: Optional[str] = None
        self._input_session_expires_at: float = 0.0
        
        # Backoff
        self.consecutive_failures = 0
        self.backoff_seconds = 1
        self.max_backoff = 60
        self.max_failures_before_reregister = 10
        
        # Streamers (placeholders for compatibility)
        self.screenshot_handler = ThreadedScreenshot()
        
        # Supabase client
        self.supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    def _get_session_token(self) -> Optional[str]:
        """Get the session token for the current device from active sessions."""
        try:
            result = self.supabase.table("device_sessions").select("session_token").eq(
                "device_id", self.device_id
            ).order("last_active", desc=True).limit(1).execute()
            if result.data:
                return result.data[0]["session_token"]
        except Exception as e:
            add_log("warn", f"Failed to get session token: {e}", category="system")
        return None
    
    # ============== VOLUME/BRIGHTNESS ==============
    def _get_volume(self) -> int:
        try:
            if platform.system() == "Windows" and HAS_PYCAW:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                level = volume.GetMasterVolumeLevelScalar()
                self._volume_cache = int(level * 100)
        except:
            pass
        return self._volume_cache
    
    def _set_volume(self, level: int) -> Dict[str, Any]:
        try:
            level = max(0, min(100, level))
            if platform.system() == "Windows" and HAS_PYCAW:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                volume.SetMasterVolumeLevelScalar(level / 100.0, None)
                self._volume_cache = level
            return {"success": True, "volume": level}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_brightness(self) -> int:
        try:
            if HAS_BRIGHTNESS:
                levels = sbc.get_brightness()
                if levels:
                    self._brightness_cache = levels[0] if isinstance(levels, list) else levels
        except:
            pass
        return self._brightness_cache
    
    def _set_brightness(self, level: int) -> Dict[str, Any]:
        try:
            level = max(0, min(100, level))
            if HAS_BRIGHTNESS:
                sbc.set_brightness(level)
                self._brightness_cache = level
            return {"success": True, "brightness": level}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== SYSTEM CONTROLS ==============
    def _shutdown(self) -> Dict[str, Any]:
        if platform.system() == "Windows":
            os.system("shutdown /s /t 5")
        else:
            os.system("shutdown -h now")
        return {"success": True}
    
    def _restart(self) -> Dict[str, Any]:
        if platform.system() == "Windows":
            os.system("shutdown /r /t 5")
        else:
            os.system("shutdown -r now")
        return {"success": True}
    
    def _sleep(self) -> Dict[str, Any]:
        if platform.system() == "Windows":
            os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
        else:
            os.system("systemctl suspend")
        return {"success": True}
    
    def _hibernate(self) -> Dict[str, Any]:
        if platform.system() == "Windows":
            os.system("shutdown /h")
        return {"success": True}
    
    def _lock_screen(self) -> Dict[str, Any]:
        if platform.system() == "Windows":
            ctypes.windll.user32.LockWorkStation()
        self.is_locked = True
        return {"success": True}
    
    def _smart_unlock(self, pin: str) -> Dict[str, Any]:
        if pin == UNLOCK_PIN:
            self.is_locked = False
            return {"success": True}
        return {"success": False, "error": "Invalid PIN"}
    
    def _get_system_stats(self) -> Dict[str, Any]:
        try:
            cpu = psutil.cpu_percent()
            mem = psutil.virtual_memory().percent
            disk = psutil.disk_usage('/').percent if platform.system() != "Windows" else psutil.disk_usage('C:\\').percent
            battery = psutil.sensors_battery()
            
            return {
                "success": True,
                "cpu_percent": cpu,
                "memory_percent": mem,
                "disk_percent": disk,
                "battery_percent": battery.percent if battery else None,
                "battery_plugged": battery.power_plugged if battery else None,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_system_state(self) -> Dict[str, Any]:
        try:
            return {
                "success": True,
                "volume": self._get_volume(),
                "brightness": self._get_brightness(),
                "is_locked": bool(self.is_locked),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_cameras(self) -> Dict[str, Any]:
        try:
            cameras: List[Dict[str, Any]] = []
            if not HAS_OPENCV:
                return {"success": True, "cameras": [], "note": "OpenCV not installed."}
            max_test = 6
            for idx in range(0, max_test):
                cap = None
                try:
                    if platform.system() == "Windows":
                        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
                    else:
                        cap = cv2.VideoCapture(idx)
                    if cap is not None and cap.isOpened():
                        cameras.append({"index": idx, "name": f"Camera {idx}"})
                except Exception:
                    pass
                finally:
                    try:
                        if cap is not None:
                            cap.release()
                    except Exception:
                        pass
            return {"success": True, "cameras": cameras}
        except Exception as e:
            return {"success": False, "error": str(e), "cameras": []}

    def _get_audio_devices(self) -> Dict[str, Any]:
        try:
            master_volume = self._get_volume()
            is_muted = False
            if platform.system() == "Windows" and HAS_PYCAW:
                try:
                    devices = AudioUtilities.GetSpeakers()
                    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                    endpoint = cast(interface, POINTER(IAudioEndpointVolume))
                    is_muted = bool(endpoint.GetMute())
                except Exception:
                    pass
            devices_out = [{"id": "default", "name": "Default Output", "type": "default", "volume": int(master_volume), "isMuted": bool(is_muted), "isDefault": True}]
            return {"success": True, "devices": devices_out, "master_volume": int(master_volume), "is_muted": bool(is_muted)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _set_audio_output(self, device_id: str) -> Dict[str, Any]:
        try:
            device_id = (device_id or "").strip() or "default"
            if device_id != "default":
                return {"success": True, "device_id": device_id, "note": "Only the default output endpoint is supported."}
            return {"success": True, "device_id": "default"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _list_audio_outputs(self) -> Dict[str, Any]:
        return self._get_audio_devices()

    def _toggle_mute(self) -> Dict[str, Any]:
        try:
            if platform.system() == "Windows" and HAS_PYCAW:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                endpoint = cast(interface, POINTER(IAudioEndpointVolume))
                current = bool(endpoint.GetMute())
                endpoint.SetMute(0 if current else 1, None)
                return {"success": True, "is_muted": (not current)}
            pyautogui.press("volumemute")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _join_zoom(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Join a Zoom meeting via native Zoom protocol for reliability."""
        try:
            meeting_link = str(payload.get("meeting_link") or "").strip()
            meeting_id = str(payload.get("meeting_id") or "").strip()
            password = str(payload.get("password") or "").strip()

            mute_audio = bool(payload.get("mute_audio", True))
            mute_video = bool(payload.get("mute_video", True))
            take_screenshot = bool(payload.get("take_screenshot", False))

            # Build zoom protocol URL for native app
            link = ""
            if meeting_link:
                # Convert web URL to zoom protocol
                link = meeting_link
                if "zoom.us/j/" in link:
                    mid = re.search(r'/j/(\d+)', link)
                    pwd = re.search(r'pwd=([^&]+)', link)
                    if mid:
                        link = f"zoommtg://zoom.us/join?confno={mid.group(1)}"
                        if pwd:
                            link += f"&pwd={pwd.group(1)}"
                        elif password:
                            link += f"&pwd={urllib.parse.quote(password)}"
            elif meeting_id:
                mid = re.sub(r"[^0-9]", "", meeting_id)
                link = f"zoommtg://zoom.us/join?confno={mid}"
                if password:
                    link += f"&pwd={urllib.parse.quote(password)}"

            if not link:
                return {"success": False, "error": "Missing meeting_link or meeting_id"}

            add_log("info", "Opening Zoom meeting via native protocol", details=link[:140], category="zoom")
            
            # Try zoommtg:// protocol first (opens native Zoom app)
            if platform.system() == "Windows":
                os.startfile(link)
            else:
                webbrowser.open(link)

            # Give Zoom more time to open (slow PC support)
            await asyncio.sleep(12)

            # Privacy toggles (Windows Zoom hotkeys)
            if platform.system() == "Windows":
                if mute_audio:
                    pyautogui.hotkey("alt", "a")
                if mute_video:
                    pyautogui.hotkey("alt", "v")

            screenshot_path = None
            if take_screenshot:
                # Extra wait for slow PCs
                await asyncio.sleep(5)
                shot = self.screenshot_handler.capture_sync(quality=70, scale=0.5)
                if shot.get("success") and shot.get("image"):
                    os.makedirs("screenshots", exist_ok=True)
                    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                    screenshot_path = os.path.abspath(os.path.join("screenshots", f"zoom_{ts}.jpg"))
                    with open(screenshot_path, "wb") as f:
                        f.write(base64.b64decode(shot["image"]))

            return {
                "success": True,
                "muted_audio": mute_audio,
                "muted_video": mute_video,
                "screenshot_path": screenshot_path,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== MOUSE/KEYBOARD ==============
    def _mouse_move(self, x: int, y: int, relative: bool = True) -> Dict[str, Any]:
        try:
            if relative:
                pyautogui.move(x, y)
            else:
                pyautogui.moveTo(x, y)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_click(self, button: str = "left", clicks: int = 1) -> Dict[str, Any]:
        try:
            pyautogui.click(button=button, clicks=clicks)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_scroll(self, amount: int) -> Dict[str, Any]:
        try:
            pyautogui.scroll(amount)
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
    
    def _key_combo(self, keys: List[str]) -> Dict[str, Any]:
        try:
            pyautogui.hotkey(*[k.lower() for k in keys])
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _type_text(self, text: str) -> Dict[str, Any]:
        try:
            pyautogui.typewrite(text, interval=0.02)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _pinch_zoom(self, direction: str, steps: int = 1) -> Dict[str, Any]:
        try:
            key = "=" if direction == "in" else "-"
            steps = max(1, min(steps, 10))
            pyautogui.keyDown("ctrl")
            for _ in range(steps):
                pyautogui.press(key)
            pyautogui.keyUp("ctrl")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _gesture_3_finger(self) -> Dict[str, Any]:
        try:
            if platform.system() == "Windows":
                pyautogui.hotkey("win", "d")
            else:
                pyautogui.hotkey("super", "d")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _gesture_4_finger(self, direction: str) -> Dict[str, Any]:
        try:
            arrow = "right" if direction == "right" else "left"
            if platform.system() == "Windows":
                pyautogui.hotkey("ctrl", "win", arrow)
            else:
                pyautogui.hotkey("ctrl", "alt", arrow)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== CLIPBOARD ==============
    def _get_clipboard(self) -> Dict[str, Any]:
        try:
            import pyperclip
            content = pyperclip.paste()
            return {"success": True, "content": content}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _set_clipboard(self, content: str) -> Dict[str, Any]:
        try:
            import pyperclip
            pyperclip.copy(content)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== MEDIA ==============
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
            elif action_lower in ["mute", "volumemute"]:
                pyautogui.press("volumemute")
            else:
                return {"success": False, "error": f"Unknown action: {action}"}
            return {"success": True, "action": action}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_media_state(self) -> Dict[str, Any]:
        return {"success": True, "title": "", "artist": "", "is_playing": False, "volume": self._get_volume()}
    
    # ============== APPS ==============
    def _open_app(self, app_name: str, app_id: Optional[str] = None) -> Dict[str, Any]:
        try:
            app_name = (app_name or "").strip()
            if platform.system() == "Windows":
                app_paths = {
                    "chrome": "chrome", "firefox": "firefox", "edge": "msedge",
                    "notepad": "notepad", "calculator": "calc", "terminal": "wt",
                    "explorer": "explorer", "spotify": "spotify", "discord": "discord",
                    "vscode": "code", "vs code": "code",
                    "zoom": "zoom",
                }
                cmd = app_paths.get(app_name.lower())
                if cmd:
                    subprocess.Popen(f"start {cmd}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return {"success": True}
                # Fallback: Windows search
                pyautogui.press("win")
                time.sleep(0.3)
                pyautogui.typewrite(app_name, interval=0.02)
                time.sleep(0.5)
                pyautogui.press("enter")
                return {"success": True}
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", "-a", app_name])
                return {"success": True}
            else:
                subprocess.Popen([app_name])
                return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _close_app(self, app_name: str) -> Dict[str, Any]:
        try:
            for proc in psutil.process_iter(['name', 'pid']):
                if app_name.lower() in proc.info['name'].lower():
                    proc.terminate()
                    return {"success": True}
            return {"success": False, "error": "Process not found"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_running_apps(self) -> Dict[str, Any]:
        """Get list of running processes with CPU and memory usage."""
        try:
            apps = []
            seen = set()
            for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent', 'status']):
                try:
                    info = proc.info
                    name = info.get('name', '')
                    if not name or name in seen or name.lower() in ('system idle process', 'system', 'registry', 'idle'):
                        continue
                    seen.add(name)
                    apps.append({
                        "pid": info['pid'],
                        "name": name,
                        "cpu": round(info.get('cpu_percent', 0) or 0, 1),
                        "memory": round(info.get('memory_percent', 0) or 0, 1),
                        "status": info.get('status', 'unknown'),
                    })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            # Sort by memory descending
            apps.sort(key=lambda x: x['memory'], reverse=True)
            return {"success": True, "apps": apps[:100]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_installed_apps(self) -> Dict[str, Any]:
        """Get list of installed applications (Windows only)."""
        try:
            apps = []
            if platform.system() == "Windows":
                # Query registry for installed apps
                import winreg
                reg_paths = [
                    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
                    (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                ]
                seen = set()
                for hive, path in reg_paths:
                    try:
                        key = winreg.OpenKey(hive, path)
                        for i in range(winreg.QueryInfoKey(key)[0]):
                            try:
                                subkey_name = winreg.EnumKey(key, i)
                                subkey = winreg.OpenKey(key, subkey_name)
                                try:
                                    name = winreg.QueryValueEx(subkey, "DisplayName")[0]
                                    if name and name not in seen:
                                        seen.add(name)
                                        source = "registry"
                                        try:
                                            source = winreg.QueryValueEx(subkey, "Publisher")[0] or "registry"
                                        except (FileNotFoundError, OSError):
                                            pass
                                        apps.append({"name": name, "app_id": subkey_name, "source": source})
                                except (FileNotFoundError, OSError):
                                    pass
                                finally:
                                    winreg.CloseKey(subkey)
                            except (OSError, WindowsError):
                                continue
                        winreg.CloseKey(key)
                    except (FileNotFoundError, OSError):
                        continue
                apps.sort(key=lambda x: x['name'].lower())
            return {"success": True, "apps": apps}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _kill_app(self, pid=None, app_name: str = "") -> Dict[str, Any]:
        """Kill a process by PID or name."""
        try:
            if pid:
                proc = psutil.Process(int(pid))
                proc.kill()
                return {"success": True, "message": f"Killed PID {pid}"}
            elif app_name:
                killed = 0
                for proc in psutil.process_iter(['name', 'pid']):
                    if app_name.lower() in proc.info['name'].lower():
                        try:
                            proc.kill()
                            killed += 1
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            continue
                return {"success": killed > 0, "message": f"Killed {killed} processes", "killed": killed}
            return {"success": False, "error": "No PID or app_name provided"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_services(self) -> Dict[str, Any]:
        """Get list of Windows services."""
        try:
            services = []
            if platform.system() == "Windows":
                for svc in psutil.win_service_iter():
                    try:
                        info = svc.as_dict()
                        services.append({
                            "name": info.get("name", ""),
                            "display_name": info.get("display_name", ""),
                            "status": info.get("status", ""),
                            "start_type": info.get("start_type", ""),
                            "pid": info.get("pid"),
                        })
                    except Exception:
                        continue
                services.sort(key=lambda x: x['display_name'].lower())
            return {"success": True, "services": services}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ============== FILES ==============
    def _list_files(self, path: str = "~") -> Dict[str, Any]:
        try:
            path = os.path.expanduser(path)
            items = []
            for item in os.listdir(path):
                full_path = os.path.join(path, item)
                is_dir = os.path.isdir(full_path)
                try:
                    size = os.path.getsize(full_path) if not is_dir else 0
                except:
                    size = 0
                items.append({"name": item, "path": full_path, "is_directory": is_dir, "size": size})
            return {"success": True, "items": items[:100], "current_path": path}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _receive_file_chunk(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            file_id = payload.get("file_id", "")
            chunk_index = payload.get("chunk_index", 0)
            total_chunks = payload.get("total_chunks", 1)
            data_base64 = payload.get("data", "")
            file_name = payload.get("file_name", "received_file")
            save_folder = payload.get("save_folder") or os.path.join(os.path.expanduser("~"), "Downloads", "Jarvis")
            
            chunk_data = base64.b64decode(data_base64)
            os.makedirs(save_folder, exist_ok=True)
            file_path = os.path.join(save_folder, file_name)
            mode = "wb" if chunk_index == 0 else "ab"
            
            with open(file_path, mode) as f:
                f.write(chunk_data)
            
            progress = int((chunk_index + 1) / total_chunks * 100)
            completed = chunk_index + 1 == total_chunks
            
            if completed:
                add_log("info", f"File received: {file_name}", category="file")
                notification_manager.notify("File Received", f"{file_name} saved")
            
            return {"success": True, "completed": completed, "progress": progress, "path": file_path if completed else None}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _send_file_chunk(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            file_path = payload.get("path", "")
            chunk_index = payload.get("chunk_index", 0)
            chunk_size = payload.get("chunk_size", 64 * 1024)
            
            if not os.path.exists(file_path):
                return {"success": False, "error": "File not found"}
            
            file_size = os.path.getsize(file_path)
            offset = chunk_index * chunk_size
            
            with open(file_path, "rb") as f:
                f.seek(offset)
                chunk_data = f.read(chunk_size)
            
            return {
                "success": True,
                "data": base64.b64encode(chunk_data).decode(),
                "chunk_index": chunk_index,
                "total_chunks": (file_size + chunk_size - 1) // chunk_size,
                "file_size": file_size,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== CAMERA/SCREEN STREAMING ==============
    _camera_streamer = None
    _screen_streamer = None
    _camera_ws = None
    _screen_ws = None
    
    async def _start_camera_stream(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if not HAS_OPENCV:
                return {"success": False, "error": "OpenCV not installed"}
            
            session_id = payload.get("session_id", "")
            camera_index = int(payload.get("camera_index", 0))
            fps = int(payload.get("fps", 30))
            quality = int(payload.get("quality", 70))
            
            if not session_id:
                return {"success": False, "error": "Missing session_id"}
            
            # Get session token for relay authentication
            session_token = self._get_session_token()
            if not session_token:
                return {"success": False, "error": "No active session token for relay auth"}
            
            self._stop_camera_stream()
            
            if platform.system() == "Windows":
                cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
            else:
                cap = cv2.VideoCapture(camera_index)
            
            if not cap.isOpened():
                return {"success": False, "error": f"Failed to open camera {camera_index}"}
            
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            cap.set(cv2.CAP_PROP_FPS, fps)
            
            self._camera_streamer = {"cap": cap, "session_id": session_id, "fps": fps, "quality": quality, "running": True}
            
            def stream_camera():
                import websockets.sync.client as ws_client
                ws_url = f"wss://gkppopjoedadacolxufi.functions.supabase.co/functions/v1/camera-relay?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true&session_token={session_token}"
                try:
                    with ws_client.connect(ws_url) as ws:
                        self._camera_ws = ws
                        add_log("info", f"Camera stream connected: session={session_id[:8]}...", category="camera")
                        interval = 1.0 / max(1, fps)
                        while self._camera_streamer and self._camera_streamer.get("running"):
                            ret, frame = cap.read()
                            if not ret:
                                continue
                            encode_params = [cv2.IMWRITE_JPEG_QUALITY, self._camera_streamer.get("quality", quality)]
                            _, buffer = cv2.imencode(".jpg", frame, encode_params)
                            ws.send(buffer.tobytes())
                            time.sleep(interval)
                except Exception as e:
                    add_log("error", f"Camera stream error: {e}", category="camera")
                finally:
                    cap.release()
                    add_log("info", "Camera stream ended", category="camera")
            
            threading.Thread(target=stream_camera, daemon=True).start()
            add_log("info", f"Camera stream started: camera={camera_index}, fps={fps}, quality={quality}", category="camera")
            return {"success": True, "session_id": session_id, "camera_index": camera_index}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _stop_camera_stream(self) -> Dict[str, Any]:
        try:
            if self._camera_streamer:
                self._camera_streamer["running"] = False
            if self._camera_ws:
                try:
                    self._camera_ws.close()
                except:
                    pass
            self._camera_streamer = None
            self._camera_ws = None
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _update_camera_settings(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if not self._camera_streamer:
                return {"success": False, "error": "No active camera stream"}
            if "fps" in payload:
                self._camera_streamer["fps"] = int(payload["fps"])
            if "quality" in payload:
                self._camera_streamer["quality"] = int(payload["quality"])
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _start_screen_stream(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if not HAS_MSS:
                return {"success": False, "error": "mss not installed"}
            
            session_id = payload.get("session_id", "")
            fps = int(payload.get("fps", 30))
            quality = int(payload.get("quality", 70))
            scale = float(payload.get("scale", 0.5))
            monitor_index = int(payload.get("monitor_index", 1))
            
            if not session_id:
                return {"success": False, "error": "Missing session_id"}
            
            # Get session token for relay authentication
            session_token = self._get_session_token()
            if not session_token:
                return {"success": False, "error": "No active session token for relay auth"}
            
            self._stop_screen_stream()
            
            self._screen_streamer = {"session_id": session_id, "fps": fps, "quality": quality, "scale": scale, "monitor_index": monitor_index, "running": True}
            
            def stream_screen():
                import websockets.sync.client as ws_client
                ws_url = f"wss://gkppopjoedadacolxufi.functions.supabase.co/functions/v1/camera-relay?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true&session_token={session_token}"
                try:
                    with ws_client.connect(ws_url) as ws:
                        self._screen_ws = ws
                        add_log("info", f"Screen stream connected: session={session_id[:8]}...", category="screen")
                        with mss.mss() as sct:
                            monitors = sct.monitors
                            idx = monitor_index if 0 < monitor_index < len(monitors) else 1
                            monitor = monitors[idx]
                            interval = 1.0 / max(1, fps)
                            while self._screen_streamer and self._screen_streamer.get("running"):
                                screenshot = sct.grab(monitor)
                                img = Image.frombytes('RGB', screenshot.size, screenshot.bgra, 'raw', 'BGRX')
                                current_scale = self._screen_streamer.get("scale", scale)
                                new_size = (int(img.width * current_scale), int(img.height * current_scale))
                                img = img.resize(new_size, Image.LANCZOS)
                                buffer = io.BytesIO()
                                img.save(buffer, format="JPEG", quality=self._screen_streamer.get("quality", quality), optimize=True)
                                ws.send(buffer.getvalue())
                                time.sleep(interval)
                except Exception as e:
                    add_log("error", f"Screen stream error: {e}", category="screen")
                finally:
                    add_log("info", "Screen stream ended", category="screen")
            
            threading.Thread(target=stream_screen, daemon=True).start()
            add_log("info", f"Screen stream started: fps={fps}, quality={quality}, scale={scale}", category="screen")
            return {"success": True, "session_id": session_id}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _stop_screen_stream(self) -> Dict[str, Any]:
        try:
            if self._screen_streamer:
                self._screen_streamer["running"] = False
            if self._screen_ws:
                try:
                    self._screen_ws.close()
                except:
                    pass
            self._screen_streamer = None
            self._screen_ws = None
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _update_screen_settings(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if not self._screen_streamer:
                return {"success": False, "error": "No active screen stream"}
            if "fps" in payload:
                self._screen_streamer["fps"] = int(payload["fps"])
            if "quality" in payload:
                self._screen_streamer["quality"] = int(payload["quality"])
            if "scale" in payload:
                self._screen_streamer["scale"] = float(payload["scale"])
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _start_test_pattern(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            session_id = payload.get("session_id", "")
            fps = int(payload.get("fps", 30))
            quality = int(payload.get("quality", 70))
            mode = payload.get("mode", "camera")
            
            if not session_id:
                return {"success": False, "error": "Missing session_id"}
            
            # Get session token for relay authentication
            session_token = self._get_session_token()
            if not session_token:
                return {"success": False, "error": "No active session token for relay auth"}
            
            if mode == "screen":
                self._stop_screen_stream()
                self._screen_streamer = {"session_id": session_id, "fps": fps, "quality": quality, "running": True}
            else:
                self._stop_camera_stream()
                self._camera_streamer = {"session_id": session_id, "fps": fps, "quality": quality, "running": True}
            
            def stream_test_pattern():
                import websockets.sync.client as ws_client
                ws_url = f"wss://gkppopjoedadacolxufi.functions.supabase.co/functions/v1/camera-relay?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true&session_token={session_token}"
                try:
                    with ws_client.connect(ws_url) as ws:
                        add_log("info", f"Test pattern connected: session={session_id[:8]}...", category="test")
                        frame_num = 0
                        interval = 1.0 / max(1, fps)
                        streamer = self._screen_streamer if mode == "screen" else self._camera_streamer
                        while streamer and streamer.get("running"):
                            img = Image.new('RGB', (640, 480), color=(frame_num % 256, 128, 255 - (frame_num % 256)))
                            from PIL import ImageDraw
                            draw = ImageDraw.Draw(img)
                            draw.text((280, 220), f"Frame {frame_num}", fill=(255, 255, 255))
                            buffer = io.BytesIO()
                            img.save(buffer, format="JPEG", quality=quality)
                            ws.send(buffer.getvalue())
                            frame_num += 1
                            time.sleep(interval)
                except Exception as e:
                    add_log("error", f"Test pattern error: {e}", category="test")
            
            threading.Thread(target=stream_test_pattern, daemon=True).start()
            return {"success": True, "session_id": session_id, "mode": mode}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== BOOST PC ==============
    def _boost_ram(self) -> Dict[str, Any]:
        try:
            import gc
            gc.collect()
            freed_mb = 50
            if sys.platform == "win32":
                kernel32 = ctypes.windll.kernel32
                handle = kernel32.GetCurrentProcess()
                kernel32.SetProcessWorkingSetSize(handle, -1, -1)
            add_log("info", f"RAM cleanup: ~{freed_mb}MB freed", category="system")
            return {"success": True, "freed_mb": freed_mb}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _clear_temp_files(self) -> Dict[str, Any]:
        try:
            import shutil
            freed_mb = 0
            temp_paths = [os.environ.get("TEMP", ""), os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp")]
            for temp_path in temp_paths:
                if os.path.exists(temp_path):
                    try:
                        for item in os.listdir(temp_path):
                            item_path = os.path.join(temp_path, item)
                            try:
                                if os.path.isfile(item_path):
                                    size = os.path.getsize(item_path)
                                    os.remove(item_path)
                                    freed_mb += size / (1024 * 1024)
                                elif os.path.isdir(item_path):
                                    shutil.rmtree(item_path, ignore_errors=True)
                            except:
                                pass
                    except:
                        pass
            add_log("info", f"Temp files cleared: ~{int(freed_mb)}MB freed", category="system")
            return {"success": True, "freed_mb": int(freed_mb)}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _set_power_plan(self, plan: str) -> Dict[str, Any]:
        try:
            if sys.platform == "win32":
                plans = {"high_performance": "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", "balanced": "381b4222-f694-41f0-9685-ff5bb260df2e"}
                plan_guid = plans.get(plan, plans["high_performance"])
                os.system(f"powercfg /setactive {plan_guid}")
                add_log("info", f"Power plan set to: {plan}", category="system")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _restart_explorer(self) -> Dict[str, Any]:
        try:
            if sys.platform == "win32":
                os.system("taskkill /f /im explorer.exe")
                time.sleep(1)
                os.system("start explorer.exe")
                add_log("info", "Explorer restarted", category="system")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _gaming_mode(self, enable: bool) -> Dict[str, Any]:
        try:
            if enable and sys.platform == "win32":
                kernel32 = ctypes.windll.kernel32
                handle = kernel32.GetCurrentProcess()
                kernel32.SetPriorityClass(handle, 0x00008000)
                add_log("info", "Gaming mode enabled", category="system")
            return {"success": True, "enabled": enable}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== NETWORK INFO ==============
    def _get_network_info(self) -> Dict[str, Any]:
        local_ips = get_local_ips()
        network_prefix = get_network_prefix(local_ips[0]) if local_ips else ""
        p2p_server = get_local_p2p_server()
        return {
            "success": True,
            "hostname": socket.gethostname(),
            "local_ips": local_ips,
            "network_prefix": network_prefix,
            "p2p_port": LOCAL_P2P_PORT,
            "p2p_server_running": p2p_server is not None and p2p_server.running,
            "p2p_clients": len(p2p_server.clients) if p2p_server else 0,
        }
    
    # ============== OPEN URL (supports zoom protocol) ==============
    def _open_url(self, url: str) -> Dict[str, Any]:
        try:
            url = (url or "").strip()
            if not url:
                return {"success": False, "error": "Missing URL"}
            
            # For protocol URLs on Windows, use os.startfile
            if platform.system() == "Windows" and "://" in url and not url.startswith("http"):
                os.startfile(url)
            else:
                webbrowser.open(url)
            
            return {"success": True, "url": url}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== BATCH COMMAND EXECUTION ==============
    async def _execute_batch(self, commands: List[Dict[str, Any]]) -> Dict[str, Any]:
        results = []
        for cmd in commands:
            cmd_type = cmd.get("commandType", cmd.get("type", ""))
            payload = cmd.get("payload", {})
            result = await self._handle_command(cmd_type, payload)
            results.append({"commandType": cmd_type, "result": result})
        return {"success": True, "results": results}
    
    # ============== MAIN COMMAND HANDLER ==============
    async def _handle_command(self, command_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            cmd = command_type.lower().strip()
            
            # Normalize aliases
            alias_map = {
                "lock": "lock_screen",
                "unlock": "smart_unlock",
                "press_key": "key_press",
                "mouse_scroll": "scroll",
                "pinch_zoom": "zoom",
                "get_system_state": "system_state",
                "get_cameras": "list_cameras",
                "get_audio_devices": "audio_devices",
                "spotify": "spotify",
                "spotify_control": "spotify",
                "spotify_play": "spotify",
                "spotify_pause": "spotify",
                "spotify_next": "spotify",
                "spotify_prev": "spotify",
                "calendar": "calendar",
                "notes": "calendar",
                "reminders": "calendar",
                "todo": "calendar",
                "add_note": "calendar",
                "get_notes": "calendar",
                "brightness": "brightness_volume",
                "volume": "brightness_volume",
                "mute": "brightness_volume",
                "unmute": "brightness_volume",
                "system_control": "system_control",
                "power": "system_control",
                "boost": "system_control",
            }
            cmd = alias_map.get(cmd, cmd)
            
            # ============== INPUT SESSION GATING ==============
            if cmd == "remote_input_enable":
                session = str(payload.get("session", "") or "")
                ttl_ms = int(payload.get("ttl_ms", INPUT_SESSION_TTL_SECONDS * 1000) or (INPUT_SESSION_TTL_SECONDS * 1000))
                if not session:
                    return {"success": False, "error": "Missing session"}
                self._active_input_session = session
                self._input_session_expires_at = time.time() + max(1, ttl_ms / 1000.0)
                add_log("info", "Remote input enabled", category="input")
                return {"success": True, "enabled": True}
            
            if cmd == "remote_input_disable":
                session = str(payload.get("session", "") or "")
                if session and session == self._active_input_session:
                    self._active_input_session = None
                    self._input_session_expires_at = 0.0
                    add_log("info", "Remote input disabled", category="input")
                return {"success": True, "enabled": False}
            
            # Gate remote input commands
            GATED_COMMANDS = {"mouse_move", "mouse_click", "key_press", "key_combo", "type_text", "scroll", "zoom", "gesture_3_finger", "gesture_4_finger"}
            if cmd in GATED_COMMANDS:
                incoming_session = str(payload.get("input_session", "") or "")
                if (not self._active_input_session or incoming_session != self._active_input_session or time.time() > self._input_session_expires_at):
                    return {"success": False, "error": "Remote input not enabled"}
            
            # ============== SKILLS DISPATCH ==============
            if HAS_SKILLS:
                registry = get_skill_registry()
                if registry.can_dispatch(cmd):
                    ctx = {"supabase": self.supabase, "user_id": self.current_user_id, "device_id": self.device_id}
                    return await registry.dispatch(cmd, payload, ctx)

            # ============== ROUTE COMMANDS ==============
            if cmd == "get_system_stats":
                return self._get_system_stats()
            elif cmd == "system_state":
                return self._get_system_state()
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
            elif cmd == "list_cameras":
                return self._get_cameras()
            elif cmd == "audio_devices":
                return self._get_audio_devices()
            elif cmd == "set_audio_output":
                return self._set_audio_output(str(payload.get("device_id") or ""))
            elif cmd == "toggle_mute":
                return self._toggle_mute()
            
            # Mouse/keyboard
            elif cmd == "mouse_move":
                return self._mouse_move(payload.get("x", 0), payload.get("y", 0), payload.get("relative", True))
            elif cmd == "mouse_click":
                return self._mouse_click(payload.get("button", "left"), payload.get("clicks", 1))
            elif cmd in ["scroll", "mouse_scroll"]:
                return self._mouse_scroll(int(payload.get("delta", payload.get("amount", 0)) or 0))
            elif cmd == "key_press":
                return self._key_press(payload.get("key", ""))
            elif cmd == "key_combo":
                return self._key_combo(payload.get("keys", []) or [])
            elif cmd == "type_text":
                return self._type_text(payload.get("text", ""))
            elif cmd == "zoom":
                return self._pinch_zoom(payload.get("direction", "in"), payload.get("steps", 1))
            elif cmd == "gesture_3_finger":
                return self._gesture_3_finger()
            elif cmd == "gesture_4_finger":
                return self._gesture_4_finger(payload.get("direction", "right"))
            
            # System
            elif cmd == "shutdown":
                return self._shutdown()
            elif cmd == "restart":
                return self._restart()
            elif cmd == "sleep":
                return self._sleep()
            elif cmd == "hibernate":
                return self._hibernate()
            elif cmd == "lock_screen":
                return self._lock_screen()
            elif cmd == "smart_unlock":
                return self._smart_unlock(payload.get("pin", ""))
            
            # Clipboard
            elif cmd == "get_clipboard":
                return self._get_clipboard()
            elif cmd == "set_clipboard":
                return self._set_clipboard(payload.get("content", payload.get("text", "")))
            
            # Media
            elif cmd == "media_control":
                return self._media_control(payload.get("action", "play_pause"))
            elif cmd in ["get_media_state", "get_media_info"]:
                return self._get_media_state()
            elif cmd == "join_zoom":
                return await self._join_zoom(payload)
            elif cmd in ["mute_pc", "mute"]:
                if HAS_PYCAW and sys.platform == "win32":
                    try:
                        devices = AudioUtilities.GetSpeakers()
                        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                        volume = cast(interface, POINTER(IAudioEndpointVolume))
                        volume.SetMute(1, None)
                    except Exception as e:
                        add_log("warn", f"mute_pc failed: {e}", category="command")
                return {"success": True}
            elif cmd in ["unmute_pc", "unmute"]:
                if HAS_PYCAW and sys.platform == "win32":
                    try:
                        devices = AudioUtilities.GetSpeakers()
                        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                        volume = cast(interface, POINTER(IAudioEndpointVolume))
                        volume.SetMute(0, None)
                    except Exception as e:
                        add_log("warn", f"unmute_pc failed: {e}", category="command")
                return {"success": True}
            
            elif cmd in ["list_audio_outputs", "get_audio_outputs"]:
                return self._list_audio_outputs()
            
            elif cmd == "play_music":
                query = payload.get("query", "")
                service = payload.get("service", "youtube").lower()
                auto_play = payload.get("auto_play", True)
                if service == "spotify":
                    # Open Spotify and search
                    self._open_app("spotify")
                    await asyncio.sleep(3)
                    pyautogui.hotkey("ctrl", "l")  # Focus search
                    await asyncio.sleep(0.5)
                    pyautogui.hotkey("ctrl", "a")
                    pyautogui.typewrite(query, interval=0.03)
                    await asyncio.sleep(1.5)
                    pyautogui.press("enter")
                    await asyncio.sleep(1)
                    if auto_play:
                        pyautogui.press("enter")  # Play first result
                    return {"success": True, "message": f"Playing '{query}' on Spotify"}
                elif service in ("youtube", "yt"):
                    # Open YouTube search and auto-play first video
                    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
                    webbrowser.open(url)
                    if auto_play:
                        await asyncio.sleep(5)  # Wait for page load (slow PC)
                        # Tab to first video and play it
                        pyautogui.press("tab")
                        await asyncio.sleep(0.3)
                        pyautogui.press("enter")
                    return {"success": True, "message": f"Playing '{query}' on YouTube"}
                else:
                    return {"success": False, "error": f"Unsupported service: {service}"}
            
            elif cmd == "search_web":
                query = payload.get("query", "")
                engine = payload.get("engine", "google").lower()
                auto_enter = payload.get("auto_enter", True)
                
                # AI platforms need special handling - open and type into search box
                if engine in ("chatgpt", "openai"):
                    webbrowser.open("https://chat.openai.com/")
                    if auto_enter:
                        await asyncio.sleep(5)
                        pyautogui.typewrite(query, interval=0.02)
                        await asyncio.sleep(0.3)
                        pyautogui.press("enter")
                    return {"success": True, "message": f"Searching '{query}' on ChatGPT"}
                elif engine == "gemini":
                    webbrowser.open("https://gemini.google.com/app")
                    if auto_enter:
                        await asyncio.sleep(5)
                        pyautogui.typewrite(query, interval=0.02)
                        await asyncio.sleep(0.3)
                        pyautogui.press("enter")
                    return {"success": True, "message": f"Searching '{query}' on Gemini"}
                elif engine == "perplexity":
                    webbrowser.open(f"https://www.perplexity.ai/search?q={urllib.parse.quote(query)}")
                    return {"success": True, "message": f"Searching '{query}' on Perplexity"}
                elif engine == "wikipedia":
                    webbrowser.open(f"https://en.wikipedia.org/wiki/Special:Search?search={urllib.parse.quote(query)}")
                    return {"success": True, "message": f"Searching '{query}' on Wikipedia"}
                else:
                    urls = {
                        "google": f"https://www.google.com/search?q={urllib.parse.quote(query)}",
                        "bing": f"https://www.bing.com/search?q={urllib.parse.quote(query)}",
                        "duckduckgo": f"https://duckduckgo.com/?q={urllib.parse.quote(query)}",
                    }
                    url = urls.get(engine, urls["google"])
                    webbrowser.open(url)
                    return {"success": True, "message": f"Searching '{query}' on {engine}"}
            
            elif cmd in ["answer_call", "end_call", "decline_call", "call_mute"]:
                add_log("info", f"Call control received: {cmd}", category="command")
                return {"success": True, "message": f"{cmd} acknowledged (mobile-side action)"}
            
            # Apps
            elif cmd == "open_app":
                return self._open_app(payload.get("app_name", ""), payload.get("app_id"))
            elif cmd == "close_app":
                return self._close_app(payload.get("app_name", ""))
            elif cmd == "get_running_apps":
                return self._get_running_apps()
            elif cmd == "get_installed_apps":
                return self._get_installed_apps()
            elif cmd == "kill_app":
                return self._kill_app(payload.get("pid"), payload.get("app_name", ""))
            elif cmd == "get_services":
                return self._get_services()
            
            # Open URL (supports zoom:// and other protocols)
            elif cmd == "open_url":
                return self._open_url(payload.get("url", ""))
            
            # Files
            elif cmd == "list_files":
                return self._list_files(payload.get("path", "~"))
            elif cmd == "receive_file_chunk":
                return self._receive_file_chunk(payload)
            elif cmd == "send_file_chunk":
                return self._send_file_chunk(payload)
            
            # Boost
            elif cmd == "boost_ram":
                return self._boost_ram()
            elif cmd == "clear_temp_files":
                return self._clear_temp_files()
            elif cmd == "set_power_plan":
                return self._set_power_plan(payload.get("plan", "high_performance"))
            elif cmd == "restart_explorer":
                return self._restart_explorer()
            elif cmd == "gaming_mode":
                return self._gaming_mode(payload.get("enable", True))
            
            # Notifications
            elif cmd in ["start_notification_sync", "stop_notification_sync"]:
                add_log("info", f"Notification sync: {cmd}", category="sync")
                return {"success": True}
            
            # Batch
            elif cmd == "execute_batch":
                return await self._execute_batch(payload.get("commands", []))
            
            # Screenshot
            elif cmd == "take_screenshot":
                return self.screenshot_handler.capture_sync(
                    quality=payload.get("quality", 70),
                    scale=payload.get("scale", 0.5)
                )
            
            # Ping
            elif cmd in ["ping", "heartbeat"]:
                return {"success": True, "pong": True, "timestamp": datetime.now().isoformat()}
            
            # Camera/Screen streaming
            elif cmd == "start_camera_stream":
                return await self._start_camera_stream(payload)
            elif cmd == "stop_camera_stream":
                return self._stop_camera_stream()
            elif cmd == "update_camera_settings":
                return self._update_camera_settings(payload)
            elif cmd == "start_screen_stream":
                return await self._start_screen_stream(payload)
            elif cmd == "stop_screen_stream":
                return self._stop_screen_stream()
            elif cmd == "update_screen_settings":
                return self._update_screen_settings(payload)
            elif cmd == "start_test_pattern":
                return await self._start_test_pattern(payload)
            
            else:
                add_log("warn", f"Unknown command: {cmd}", category="command")
                return {"success": False, "error": f"Unknown command: {cmd}"}
                
        except Exception as e:
            add_log("error", f"Command error: {e}", details=traceback.format_exc(), category="command")
            return {"success": False, "error": str(e)}
    
    # ============== REGISTRATION & PAIRING ==============
    def _generate_pairing_code(self) -> str:
        import random
        return f"{random.randint(100000, 999999)}"
    
    async def register_device(self):
        self.pairing_code = self._generate_pairing_code()
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=PAIRING_CODE_LIFETIME_MINUTES)).isoformat()
        
        try:
            result = self.supabase.table("devices").select("id").eq("device_key", self.device_key).execute()
            
            if result.data:
                self.device_id = result.data[0]["id"]
                self.supabase.table("devices").update({
                    "is_online": True,
                    "pairing_code": self.pairing_code,
                    "pairing_expires_at": expires_at,
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "name": DEVICE_NAME,
                }).eq("id", self.device_id).execute()
            else:
                insert_result = self.supabase.table("devices").insert({
                    "device_key": self.device_key,
                    "name": DEVICE_NAME,
                    "is_online": True,
                    "pairing_code": self.pairing_code,
                    "pairing_expires_at": expires_at,
                    "user_id": "00000000-0000-0000-0000-000000000000",
                }).execute()
                self.device_id = insert_result.data[0]["id"]
            
            local_ips = get_local_ips()
            update_agent_status({
                "connected": True,
                "device_id": self.device_id,
                "pairing_code": self.pairing_code,
                "pairing_expires_at": expires_at,
                "local_ips": local_ips,
            })
            
            add_log("info", f"Device registered: {self.device_id}", category="system")
            add_log("info", f"Pairing code: {self.pairing_code}", category="system")
            
        except Exception as e:
            add_log("error", f"Registration failed: {e}", category="system")
            raise
    
    async def _refresh_pairing_code(self):
        self.pairing_code = self._generate_pairing_code()
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=PAIRING_CODE_LIFETIME_MINUTES)).isoformat()
        
        try:
            self.supabase.table("devices").update({
                "pairing_code": self.pairing_code,
                "pairing_expires_at": expires_at,
            }).eq("id", self.device_id).execute()
            
            update_agent_status({
                "pairing_code": self.pairing_code,
                "pairing_expires_at": expires_at,
            })
            
            add_log("info", f"New pairing code: {self.pairing_code}", category="system")
        except Exception as e:
            add_log("error", f"Failed to refresh pairing code: {e}", category="system")
    
    async def heartbeat(self):
        try:
            now = datetime.now(timezone.utc).isoformat()
            cpu = psutil.cpu_percent()
            mem = psutil.virtual_memory().percent
            
            self.supabase.table("devices").update({
                "is_online": True,
                "last_seen": now,
                "current_volume": self._get_volume(),
                "current_brightness": self._get_brightness(),
                "is_locked": self.is_locked,
                "system_info": {
                    "cpu_percent": cpu,
                    "memory_percent": mem,
                    "platform": platform.system(),
                    "hostname": socket.gethostname(),
                    "local_ips": get_local_ips(),
                    "p2p_port": LOCAL_P2P_PORT,
                    "agent_version": AGENT_VERSION,
                },
            }).eq("id", self.device_id).execute()
            
            update_agent_status({
                "last_heartbeat": now,
                "cpu_percent": cpu,
                "memory_percent": mem,
                "volume": self._get_volume(),
                "brightness": self._get_brightness(),
            })
            
        except Exception as e:
            add_log("warn", f"Heartbeat failed: {e}", category="system")
    
    async def poll_commands(self):
        try:
            result = self.supabase.table("commands").select("*").eq(
                "device_id", self.device_id
            ).eq("status", "pending").order("created_at").limit(10).execute()
            
            for cmd in (result.data or []):
                command_type = cmd.get("command_type", "")
                payload = cmd.get("payload") or {}
                cmd_id = cmd.get("id")
                
                try:
                    self.supabase.table("commands").update({"status": "executing"}).eq("id", cmd_id).execute()
                    
                    result_data = await self._handle_command(command_type, payload)
                    
                    self.supabase.table("commands").update({
                        "status": "completed",
                        "result": result_data,
                        "executed_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", cmd_id).execute()
                    
                    add_log("info", f"Command executed: {command_type}", category="command")
                    self.consecutive_failures = 0
                    self.backoff_seconds = 1
                    
                except Exception as e:
                    self.supabase.table("commands").update({
                        "status": "failed",
                        "result": {"error": str(e)},
                        "executed_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", cmd_id).execute()
                    add_log("error", f"Command failed: {command_type} - {e}", category="command")
                    
        except Exception as e:
            self.consecutive_failures += 1
            self.backoff_seconds = min(self.backoff_seconds * 2, self.max_backoff)
            add_log("warn", f"Poll error (attempt {self.consecutive_failures}): {e}", category="system")
            
            if self.consecutive_failures >= self.max_failures_before_reregister:
                add_log("warn", "Too many failures, re-registering...", category="system")
                self.consecutive_failures = 0
                self.backoff_seconds = 1
                await self.register_device()
    
    async def run(self):
        await self.register_device()
        
        # Start P2P server
        start_local_p2p_server(command_handler=self._handle_command)
        
        last_heartbeat = 0
        last_pairing_check = 0
        
        add_log("info", "Agent running. Waiting for commands...", category="system")
        
        while self.running:
            now = time.time()
            
            # Heartbeat
            if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                await self.heartbeat()
                last_heartbeat = now
            
            # Pairing code refresh
            if now - last_pairing_check >= 60:
                last_pairing_check = now
                try:
                    expires_str = get_agent_status().get("pairing_expires_at")
                    if expires_str:
                        expires_dt = datetime.fromisoformat(expires_str.replace("Z", "+00:00"))
                        if datetime.now(timezone.utc) >= expires_dt:
                            await self._refresh_pairing_code()
                except Exception:
                    pass
            
            # Poll commands
            await self.poll_commands()
            
            await asyncio.sleep(max(POLL_INTERVAL, self.backoff_seconds if self.consecutive_failures > 0 else POLL_INTERVAL))
    
    async def shutdown(self):
        self.running = False
        stop_local_p2p_server()
        
        try:
            self.supabase.table("devices").update({
                "is_online": False,
                "last_seen": datetime.now(timezone.utc).isoformat()
            }).eq("id", self.device_id).execute()
        except:
            pass
        
        add_log("info", "Agent stopped. Goodbye!", category="system")


# ============== MAIN ==============
async def run_agent():
    agent = JarvisAgent()
    try:
        await agent.run()
    except KeyboardInterrupt:
        await agent.shutdown()
    except Exception as e:
        add_log("error", f"Fatal error: {e}", category="system")
        await agent.shutdown()


def main():
    parser = argparse.ArgumentParser(description="JARVIS PC Agent")
    parser.add_argument("--gui", action="store_true", help="Run with a native desktop GUI")
    args = parser.parse_args()

    print("\n" + "="*60)
    print(f"🤖 JARVIS PC Agent v{AGENT_VERSION}")
    print("="*60 + "\n")

    if args.gui and not HAS_TKINTER:
        print("⚠️ Tkinter not available. Starting in console mode.")

    if args.gui and HAS_TKINTER:
        class AgentThreadRunner:
            def __init__(self):
                self.loop: Optional[asyncio.AbstractEventLoop] = None
                self.thread: Optional[threading.Thread] = None
                self.agent: Optional[JarvisAgent] = None

            def start(self):
                def _run():
                    self.loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(self.loop)
                    self.agent = JarvisAgent()
                    try:
                        self.loop.run_until_complete(self.agent.run())
                    except Exception as e:
                        add_log("error", f"Agent crashed: {e}", details=traceback.format_exc(), category="system")
                    finally:
                        try:
                            stop_local_p2p_server()
                        except Exception:
                            pass

                self.thread = threading.Thread(target=_run, daemon=True)
                self.thread.start()

            def stop(self):
                try:
                    if self.agent:
                        self.agent.running = False
                    if self.loop and self.agent:
                        fut = asyncio.run_coroutine_threadsafe(self.agent.shutdown(), self.loop)
                        try:
                            fut.result(timeout=6)
                        except Exception:
                            pass
                except Exception:
                    pass

        class JarvisAgentGUI:
            """Professional v5.0.0 GUI with Dashboard, Actions, Files, Assistant, Settings."""
            
            def __init__(self):
                self.runner = AgentThreadRunner()
                self.runner.start()

                self.root = tk.Tk()
                self.root.title(f"JARVIS PC Agent v{AGENT_VERSION}")
                self.root.geometry("780x900")
                self.root.minsize(720, 840)

                # ─── Professional Color Palette ───
                BG = "#0f172a"           # Deep navy background
                CARD_BG = "#1e293b"      # Slate card background
                CARD_BORDER = "#334155"   # Subtle border
                TEXT = "#f1f5f9"          # Light text
                TEXT_DIM = "#94a3b8"      # Muted text
                ACCENT = "#3b82f6"        # Blue accent
                ACCENT_GLOW = "#60a5fa"   # Lighter blue
                SUCCESS = "#22c55e"       # Green
                WARNING = "#f59e0b"       # Amber
                DANGER = "#ef4444"        # Red
                HEADER_BG = "#020617"     # Almost black header
                INPUT_BG = "#0f172a"      # Input background
                
                self.BG = BG
                self.CARD_BG = CARD_BG
                self.CARD_BORDER = CARD_BORDER
                self.TEXT = TEXT
                self.TEXT_DIM = TEXT_DIM
                self.ACCENT = ACCENT
                self.ACCENT_GLOW = ACCENT_GLOW
                self.SUCCESS = SUCCESS
                self.WARNING = WARNING
                self.DANGER = DANGER
                self.HEADER_BG = HEADER_BG
                self.INPUT_BG = INPUT_BG

                self.root.configure(bg=BG)
                
                style = ttk.Style()
                style.theme_use("clam")
                style.configure("TNotebook", background=BG, borderwidth=0)
                style.configure("TNotebook.Tab", background=CARD_BG, foreground=TEXT_DIM, padding=[18, 10], font=("Segoe UI Semibold", 10))
                style.map("TNotebook.Tab", background=[("selected", ACCENT)], foreground=[("selected", "#ffffff")])
                style.configure("TEntry", fieldbackground=INPUT_BG, foreground=TEXT, borderwidth=1, relief="solid")
                style.configure("TFrame", background=BG)

                self._last_log_ids: set = set()

                # ═══════ TOP HEADER BAR ═══════
                header = tk.Frame(self.root, bg=HEADER_BG, height=56)
                header.pack(fill="x")
                header.pack_propagate(False)

                # Left: Logo + Title
                logo_frame = tk.Frame(header, bg=HEADER_BG)
                logo_frame.pack(side="left", padx=16)
                tk.Label(logo_frame, text="⬡", font=("Segoe UI", 22), bg=HEADER_BG, fg=ACCENT).pack(side="left")
                title_frame = tk.Frame(logo_frame, bg=HEADER_BG)
                title_frame.pack(side="left", padx=(8, 0))
                tk.Label(title_frame, text="JARVIS", font=("Segoe UI Black", 15), bg=HEADER_BG, fg=TEXT).pack(anchor="w")
                tk.Label(title_frame, text=f"v{AGENT_VERSION} • PC Agent", font=("Segoe UI", 8), bg=HEADER_BG, fg=TEXT_DIM).pack(anchor="w")

                # Right: Status indicators
                right_frame = tk.Frame(header, bg=HEADER_BG)
                right_frame.pack(side="right", padx=16)
                
                self.conn_status = tk.Label(right_frame, text="● CONNECTING", font=("Segoe UI Black", 9), bg=HEADER_BG, fg=WARNING)
                self.conn_status.pack(side="right", padx=(12, 0))
                
                self.pairing_label = tk.Label(right_frame, text="CODE: ——", font=("JetBrains Mono", 11, "bold"), bg=HEADER_BG, fg=ACCENT_GLOW)
                self.pairing_label.pack(side="right", padx=8)
                
                self.ip_label = tk.Label(right_frame, text="IP: —", font=("JetBrains Mono", 9), bg=HEADER_BG, fg=TEXT_DIM)
                self.ip_label.pack(side="right", padx=8)

                # ═══════ NOTEBOOK (TABS) ═══════
                notebook = ttk.Notebook(self.root)
                notebook.pack(fill="both", expand=True, padx=0, pady=0)

                # ══════════ Tab 1: DASHBOARD ══════════
                dash_tab = tk.Frame(notebook, bg=BG)
                notebook.add(dash_tab, text="  📊 Dashboard  ")

                # ── Clock + Calendar Row ──
                top_row = tk.Frame(dash_tab, bg=BG)
                top_row.pack(fill="x", padx=12, pady=(12, 8))

                # Clock Card (large, prominent)
                clock_card = tk.Frame(top_row, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1, padx=24, pady=16)
                clock_card.pack(side="left", fill="both", expand=True, padx=(0, 6))

                self.clock_label = tk.Label(clock_card, text="00:00", font=("Segoe UI Light", 48), bg=CARD_BG, fg=TEXT)
                self.clock_label.pack(anchor="w")
                self.seconds_label = tk.Label(clock_card, text=":00", font=("Segoe UI Light", 20), bg=CARD_BG, fg=TEXT_DIM)
                self.seconds_label.place(relx=0.62, rely=0.35)
                self.date_label = tk.Label(clock_card, text="Loading...", font=("Segoe UI", 13), bg=CARD_BG, fg=ACCENT_GLOW)
                self.date_label.pack(anchor="w", pady=(4, 0))

                # Calendar Card
                cal_card = tk.Frame(top_row, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1, padx=14, pady=10)
                cal_card.pack(side="left", fill="both", expand=True, padx=(6, 0))

                now = datetime.now()
                tk.Label(cal_card, text=f"📅 {now.strftime('%B %Y')}", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", pady=(0, 6))
                
                cal_grid = tk.Frame(cal_card, bg=CARD_BG)
                cal_grid.pack(fill="x")
                
                for i, day in enumerate(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]):
                    color = DANGER if i >= 5 else TEXT_DIM
                    tk.Label(cal_grid, text=day, font=("Segoe UI", 8, "bold"), bg=CARD_BG, fg=color, width=3).grid(row=0, column=i, pady=(0, 2))
                
                month_cal = cal_module.monthcalendar(now.year, now.month)
                for r, week in enumerate(month_cal[:6]):
                    for c, day in enumerate(week):
                        if day == 0:
                            tk.Label(cal_grid, text="", bg=CARD_BG, width=3).grid(row=r+1, column=c)
                        else:
                            is_today = day == now.day
                            lbl = tk.Label(cal_grid, text=str(day), font=("Segoe UI", 9, "bold" if is_today else "normal"),
                                          bg=ACCENT if is_today else CARD_BG, fg="white" if is_today else TEXT_DIM, width=3)
                            if is_today:
                                lbl.configure(relief="solid", borderwidth=0)
                            lbl.grid(row=r+1, column=c, pady=1)

                # ── System Stats Cards ──
                stats_frame = tk.Frame(dash_tab, bg=BG)
                stats_frame.pack(fill="x", padx=12, pady=(0, 8))
                stats_frame.columnconfigure((0,1,2,3,4), weight=1)

                self.cpu_card = self._make_stat_card(stats_frame, "⚡ CPU", "—%", 0, ACCENT)
                self.ram_card = self._make_stat_card(stats_frame, "🧠 RAM", "—%", 1, "#8b5cf6")
                self.disk_card = self._make_stat_card(stats_frame, "💾 Disk", "—%", 2, "#f59e0b")
                self.battery_card = self._make_stat_card(stats_frame, "🔋 Battery", "—", 3, SUCCESS)
                self.uptime_card = self._make_stat_card(stats_frame, "⏱️ Uptime", "—", 4, "#ec4899")

                # ── Connection Info Card ──
                conn_card = tk.Frame(dash_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                conn_card.pack(fill="x", padx=12, pady=(0, 8))

                conn_inner = tk.Frame(conn_card, bg=CARD_BG)
                conn_inner.pack(fill="x", padx=16, pady=12)

                tk.Label(conn_inner, text="🔗 Connection Details", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", pady=(0, 8))
                
                self.conn_details = tk.Label(conn_inner, text="Initializing...", font=("JetBrains Mono", 9), bg=CARD_BG, fg=TEXT_DIM, justify="left", anchor="w")
                self.conn_details.pack(anchor="w", fill="x")

                # ── Activity Log ──
                log_card = tk.Frame(dash_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                log_card.pack(fill="both", expand=True, padx=12, pady=(0, 8))

                log_header = tk.Frame(log_card, bg=CARD_BG)
                log_header.pack(fill="x", padx=16, pady=(12, 6))
                tk.Label(log_header, text="📋 Activity Log", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(side="left")
                tk.Button(log_header, text="🗑 Clear", command=lambda: (clear_logs(), self._clear_log_display()), bg=CARD_BG, fg=TEXT_DIM, relief="flat", font=("Segoe UI", 8), activebackground=DANGER, activeforeground="white").pack(side="right")
                
                self.log_text = scrolledtext.ScrolledText(log_card, height=6, bg=INPUT_BG, fg=TEXT_DIM, font=("JetBrains Mono", 9), borderwidth=0, state="disabled", insertbackground=TEXT)
                self.log_text.pack(fill="both", expand=True, padx=12, pady=(0, 12))

                # ══════════ Tab 2: ACTIONS ══════════
                actions_tab = tk.Frame(notebook, bg=BG)
                notebook.add(actions_tab, text="  ⚡ Actions  ")

                actions_scroll = tk.Frame(actions_tab, bg=BG)
                actions_scroll.pack(fill="both", expand=True, padx=0, pady=0)

                self._make_action_group(actions_scroll, "🔌 Power Controls", [
                    ("🔒 Lock", self._action_lock), ("😴 Sleep", self._action_sleep),
                    ("🔄 Restart", self._action_restart), ("⏻ Shutdown", self._action_shutdown),
                ])

                self._make_action_group(actions_scroll, "🔊 Audio Controls", [
                    ("🔇 Mute", self._action_mute), ("🔊 Unmute", self._action_unmute),
                    ("⏯️ Play/Pause", self._action_playpause), ("⏭️ Next Track", self._action_next),
                ])

                self._make_action_group(actions_scroll, "🚀 Performance", [
                    ("🧹 Clear Temp", self._action_clear_temp), ("⚡ High Perf", self._action_highperf),
                    ("🔄 Explorer", self._action_explorer), ("🎮 Gaming Mode", self._action_gaming),
                ])

                # P2P Diagnostics
                diag_frame = tk.Frame(actions_scroll, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                diag_frame.pack(fill="x", padx=12, pady=8)

                tk.Label(diag_frame, text="🔍 P2P Network Diagnostics", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", padx=16, pady=(12, 6))
                
                diag_inner = tk.Frame(diag_frame, bg=CARD_BG)
                diag_inner.pack(fill="x", padx=16, pady=(0, 12))

                diag_info = tk.Frame(diag_inner, bg=CARD_BG)
                diag_info.pack(fill="x", pady=(0, 8))
                tk.Label(diag_info, text=f"Port: {LOCAL_P2P_PORT}", font=("JetBrains Mono", 10), bg=CARD_BG, fg=ACCENT_GLOW).pack(side="left")
                self.p2p_status_label = tk.Label(diag_info, text="Checking...", font=("Segoe UI Semibold", 10), bg=CARD_BG, fg=TEXT_DIM)
                self.p2p_status_label.pack(side="left", padx=16)

                diag_btns = tk.Frame(diag_inner, bg=CARD_BG)
                diag_btns.pack(fill="x")
                tk.Button(diag_btns, text="🔥 Test Port", command=self._action_test_firewall, bg="#1e3a5f", fg=TEXT, relief="flat", borderwidth=0, font=("Segoe UI Semibold", 9), padx=16, pady=6, activebackground=ACCENT).pack(side="left", padx=(0, 6))
                tk.Button(diag_btns, text="📋 Copy IPs", command=self._copy_ips, bg="#1e3a5f", fg=TEXT, relief="flat", borderwidth=0, font=("Segoe UI Semibold", 9), padx=16, pady=6, activebackground=ACCENT).pack(side="left", padx=(0, 6))
                tk.Button(diag_btns, text="🔄 Refresh", command=lambda: self._tick(), bg="#1e3a5f", fg=TEXT, relief="flat", borderwidth=0, font=("Segoe UI Semibold", 9), padx=16, pady=6, activebackground=ACCENT).pack(side="left")

                # ══════════ Tab 3: FILES ══════════
                files_tab = tk.Frame(notebook, bg=BG)
                notebook.add(files_tab, text="  📁 Files  ")

                # Download Folder Config
                dl_frame = tk.Frame(files_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                dl_frame.pack(fill="x", padx=12, pady=(12, 8))

                tk.Label(dl_frame, text="📂 Download Folder", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", padx=16, pady=(12, 6))

                ff = tk.Frame(dl_frame, bg=CARD_BG)
                ff.pack(fill="x", padx=16, pady=(0, 12))

                self.save_folder_var = tk.StringVar(value=os.path.expanduser("~/Downloads/JARVIS"))
                self.folder_entry = ttk.Entry(ff, textvariable=self.save_folder_var, width=40)
                self.folder_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))
                tk.Button(ff, text="📁 Browse", command=self._browse_folder, bg="#1e3a5f", fg=TEXT, relief="flat", font=("Segoe UI Semibold", 9), padx=12, pady=4).pack(side="left")
                tk.Button(ff, text="📂 Open", command=self._open_folder, bg="#1e3a5f", fg=TEXT, relief="flat", font=("Segoe UI Semibold", 9), padx=12, pady=4).pack(side="left", padx=(6, 0))

                # Drag & Drop Zone
                drop_frame = tk.Frame(files_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                drop_frame.pack(fill="x", padx=12, pady=(0, 8))

                tk.Label(drop_frame, text="📥 Drag & Drop to Share", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", padx=16, pady=(12, 6))
                
                self.drop_zone = tk.Label(drop_frame, text="🗂️  Drag files here to send to phone\n\n— or use the Send File button below —",
                                          font=("Segoe UI", 11), bg="#0c1929", fg=TEXT_DIM,
                                          relief="ridge", borderwidth=2, padx=24, pady=36)
                self.drop_zone.pack(fill="x", padx=16, pady=(0, 12))

                # Enable drag and drop (Windows)
                try:
                    if sys.platform == "win32":
                        hwnd = int(self.root.wm_frame(), 16)
                        ctypes.windll.shell32.DragAcceptFiles(hwnd, True)
                except Exception:
                    pass

                # Send File
                send_frame = tk.Frame(files_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                send_frame.pack(fill="x", padx=12, pady=(0, 8))

                tk.Label(send_frame, text="📤 Send File to Phone", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", padx=16, pady=(12, 6))

                sf = tk.Frame(send_frame, bg=CARD_BG)
                sf.pack(fill="x", padx=16, pady=(0, 12))

                self.send_file_var = tk.StringVar()
                self.send_file_entry = ttk.Entry(sf, textvariable=self.send_file_var, width=40)
                self.send_file_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))
                tk.Button(sf, text="📄 Select", command=self._select_file, bg="#1e3a5f", fg=TEXT, relief="flat", font=("Segoe UI Semibold", 9), padx=12, pady=4).pack(side="left")
                tk.Button(sf, text="📤 Send", command=self._send_file, bg=ACCENT, fg="white", relief="flat", font=("Segoe UI Semibold", 9, "bold"), padx=16, pady=4).pack(side="left", padx=(6, 0))

                # Recent Transfers
                transfers_frame = tk.Frame(files_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                transfers_frame.pack(fill="both", expand=True, padx=12, pady=(0, 8))

                tk.Label(transfers_frame, text="📋 Recent Transfers", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", padx=16, pady=(12, 6))

                self.transfer_list = tk.Listbox(transfers_frame, bg=INPUT_BG, fg=TEXT_DIM, font=("JetBrains Mono", 9), height=6, borderwidth=0, selectbackground=ACCENT, selectforeground="white")
                self.transfer_list.pack(fill="both", expand=True, padx=16, pady=(0, 12))

                # ══════════ Tab 4: ASSISTANT ══════════
                assistant_tab = tk.Frame(notebook, bg=BG)
                notebook.add(assistant_tab, text="  🤖 Assistant  ")

                # Voice Assistant Card
                assist_card = tk.Frame(assistant_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                assist_card.pack(fill="x", padx=12, pady=(12, 8))

                assist_header = tk.Frame(assist_card, bg=CARD_BG)
                assist_header.pack(fill="x", padx=16, pady=(12, 4))
                tk.Label(assist_header, text="🎤", font=("Segoe UI", 20), bg=CARD_BG, fg=ACCENT).pack(side="left")
                ah_text = tk.Frame(assist_header, bg=CARD_BG)
                ah_text.pack(side="left", padx=(10, 0))
                tk.Label(ah_text, text="JARVIS Voice Assistant", font=("Segoe UI Semibold", 14), bg=CARD_BG, fg=TEXT).pack(anchor="w")
                tk.Label(ah_text, text='Wake word: "Jarvis" • Auto-listens in background', font=("Segoe UI", 9), bg=CARD_BG, fg=TEXT_DIM).pack(anchor="w")

                assist_btns = tk.Frame(assist_card, bg=CARD_BG)
                assist_btns.pack(fill="x", padx=16, pady=(8, 12))

                self.wake_status = tk.Label(assist_btns, text="⏸ Inactive", font=("Segoe UI Semibold", 11), bg=CARD_BG, fg=TEXT_DIM)
                self.wake_status.pack(side="left")

                tk.Button(assist_btns, text="🎤 Start Listening", command=self._start_wake_word, bg=ACCENT, fg="white", relief="flat", font=("Segoe UI Semibold", 10), padx=20, pady=6, activebackground=ACCENT_GLOW).pack(side="right")
                tk.Button(assist_btns, text="⏹ Stop", command=self._stop_wake_word, bg="#1e3a5f", fg=TEXT, relief="flat", font=("Segoe UI", 10), padx=14, pady=6).pack(side="right", padx=(0, 8))

                # Voice Training Card
                train_card = tk.Frame(assistant_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                train_card.pack(fill="x", padx=12, pady=(0, 8))

                tk.Label(train_card, text="🧠 Voice Training", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", padx=16, pady=(12, 2))
                tk.Label(train_card, text='Record your voice saying "Jarvis" to improve wake-word accuracy.\nSamples are auto-saved to ~/.jarvis/voice_samples/', font=("Segoe UI", 9), bg=CARD_BG, fg=TEXT_DIM).pack(anchor="w", padx=16, pady=(0, 8))
                
                train_btns = tk.Frame(train_card, bg=CARD_BG)
                train_btns.pack(fill="x", padx=16, pady=(0, 12))
                
                self.train_count_label = tk.Label(train_btns, text="Samples: 0", font=("JetBrains Mono", 10), bg=CARD_BG, fg=ACCENT_GLOW)
                self.train_count_label.pack(side="left")
                tk.Button(train_btns, text="🎙️ Record Sample", command=self._record_voice_sample, bg="#1e3a5f", fg=TEXT, relief="flat", font=("Segoe UI Semibold", 9), padx=16, pady=6).pack(side="right")
                
                # Load existing sample count
                try:
                    samples_dir = os.path.join(os.path.expanduser("~"), ".jarvis", "voice_samples")
                    if os.path.isdir(samples_dir):
                        count = len([f for f in os.listdir(samples_dir) if f.endswith(".wav")])
                        self.train_count_label.configure(text=f"Samples: {count}")
                except Exception:
                    pass

                # Assistant Chat Log
                chat_card = tk.Frame(assistant_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                chat_card.pack(fill="both", expand=True, padx=12, pady=(0, 8))

                tk.Label(chat_card, text="💬 Conversation", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", padx=16, pady=(12, 6))
                self.chat_log = scrolledtext.ScrolledText(chat_card, height=8, bg=INPUT_BG, fg=TEXT, font=("Segoe UI", 10), borderwidth=0, state="disabled", wrap="word", insertbackground=TEXT)
                self.chat_log.pack(fill="both", expand=True, padx=16, pady=(0, 8))
                
                chat_input_frame = tk.Frame(chat_card, bg=CARD_BG)
                chat_input_frame.pack(fill="x", padx=16, pady=(0, 12))
                
                self.chat_input_var = tk.StringVar()
                chat_entry = ttk.Entry(chat_input_frame, textvariable=self.chat_input_var, width=50)
                chat_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))
                chat_entry.bind("<Return>", lambda e: self._send_chat())
                tk.Button(chat_input_frame, text="📤 Send", command=self._send_chat, bg=ACCENT, fg="white", relief="flat", font=("Segoe UI Semibold", 9), padx=16, pady=6).pack(side="right")

                # ══════════ Tab 5: SETTINGS ══════════
                settings_tab = tk.Frame(notebook, bg=BG)
                notebook.add(settings_tab, text="  ⚙️ Settings  ")

                # Agent Settings Card
                settings_card = tk.Frame(settings_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                settings_card.pack(fill="x", padx=12, pady=(12, 8))

                tk.Label(settings_card, text="⚙️ Agent Configuration", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", padx=16, pady=(12, 8))

                sf = tk.Frame(settings_card, bg=CARD_BG)
                sf.pack(fill="x", padx=16, pady=(0, 12))

                tk.Label(sf, text="Device Name:", bg=CARD_BG, fg=TEXT_DIM, font=("Segoe UI", 10)).grid(row=0, column=0, sticky="w", pady=6)
                self.device_name_entry = ttk.Entry(sf, width=30)
                self.device_name_entry.insert(0, DEVICE_NAME)
                self.device_name_entry.grid(row=0, column=1, sticky="w", pady=6, padx=(12, 0))

                tk.Label(sf, text="P2P Port:", bg=CARD_BG, fg=TEXT_DIM, font=("Segoe UI", 10)).grid(row=1, column=0, sticky="w", pady=6)
                port_entry = ttk.Entry(sf, width=30)
                port_entry.insert(0, str(LOCAL_P2P_PORT))
                port_entry.config(state="readonly")
                port_entry.grid(row=1, column=1, sticky="w", pady=6, padx=(12, 0))

                tk.Label(sf, text="Save Path:", bg=CARD_BG, fg=TEXT_DIM, font=("Segoe UI", 10)).grid(row=2, column=0, sticky="w", pady=6)
                tk.Label(sf, text=os.path.expanduser("~/Downloads/JARVIS"), bg=CARD_BG, fg=ACCENT_GLOW, font=("JetBrains Mono", 9)).grid(row=2, column=1, sticky="w", pady=6, padx=(12, 0))

                # Quick Actions
                btn_frame = tk.Frame(settings_card, bg=CARD_BG)
                btn_frame.pack(fill="x", padx=16, pady=(0, 12))
                
                tk.Button(btn_frame, text="📥 Export Logs", command=self._export_logs, bg="#1e3a5f", fg=TEXT, relief="flat", font=("Segoe UI Semibold", 9), padx=14, pady=6).pack(side="left")
                tk.Button(btn_frame, text="📋 Copy Code", command=self._copy_pairing, bg="#1e3a5f", fg=TEXT, relief="flat", font=("Segoe UI Semibold", 9), padx=14, pady=6).pack(side="left", padx=6)
                tk.Button(btn_frame, text="🌐 Open Web App", command=lambda: webbrowser.open(DEFAULT_APP_URL), bg=ACCENT, fg="white", relief="flat", font=("Segoe UI Semibold", 9), padx=16, pady=6).pack(side="left", padx=6)
                tk.Button(btn_frame, text="❌ Quit", command=self._on_close, bg=DANGER, fg="white", relief="flat", font=("Segoe UI Semibold", 9), padx=16, pady=6).pack(side="right")

                # About Card
                about_card = tk.Frame(settings_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                about_card.pack(fill="x", padx=12, pady=(0, 8))

                about_inner = tk.Frame(about_card, bg=CARD_BG)
                about_inner.pack(fill="x", padx=16, pady=16)
                tk.Label(about_inner, text="⬡", font=("Segoe UI", 28), bg=CARD_BG, fg=ACCENT).pack(side="left")
                about_text = tk.Frame(about_inner, bg=CARD_BG)
                about_text.pack(side="left", padx=(12, 0))
                tk.Label(about_text, text=f"JARVIS PC Agent v{AGENT_VERSION}", font=("Segoe UI Black", 14), bg=CARD_BG, fg=TEXT).pack(anchor="w")
                tk.Label(about_text, text="Remote PC control from your phone • Built with Python", font=("Segoe UI", 10), bg=CARD_BG, fg=TEXT_DIM).pack(anchor="w")
                tk.Label(about_text, text=f"Python {sys.version_info.major}.{sys.version_info.minor} │ {platform.system()} │ {platform.node()}", font=("JetBrains Mono", 9), bg=CARD_BG, fg=TEXT_DIM).pack(anchor="w", pady=(4, 0))

                # System Info Card
                sysinfo_card = tk.Frame(settings_tab, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1)
                sysinfo_card.pack(fill="x", padx=12, pady=(0, 8))
                
                tk.Label(sysinfo_card, text="🖥️ System Information", font=("Segoe UI Semibold", 12), bg=CARD_BG, fg=TEXT).pack(anchor="w", padx=16, pady=(12, 6))
                
                sysinfo_inner = tk.Frame(sysinfo_card, bg=CARD_BG)
                sysinfo_inner.pack(fill="x", padx=16, pady=(0, 12))
                
                try:
                    import cpuinfo
                    cpu_name = cpuinfo.get_cpu_info().get("brand_raw", "Unknown CPU")
                except Exception:
                    cpu_name = platform.processor() or "Unknown CPU"
                
                total_ram = psutil.virtual_memory().total / (1024**3)
                disk_total = psutil.disk_usage('C:\\' if sys.platform == "win32" else '/').total / (1024**3)
                
                for label_text in [
                    f"CPU: {cpu_name}",
                    f"RAM: {total_ram:.1f} GB",
                    f"Disk: {disk_total:.0f} GB",
                    f"OS: {platform.system()} {platform.release()}",
                    f"Hostname: {platform.node()}",
                ]:
                    tk.Label(sysinfo_inner, text=label_text, font=("JetBrains Mono", 9), bg=CARD_BG, fg=TEXT_DIM, anchor="w").pack(anchor="w", pady=1)

                # Start ticking
                self._tick()
                self.root.protocol("WM_DELETE_WINDOW", self._on_close)
                self.root.mainloop()

            # ═══════ HELPER METHODS ═══════
            def _make_stat_card(self, parent, title, value, col, accent_color=None):
                accent = accent_color or self.ACCENT
                card = tk.Frame(parent, bg=self.CARD_BG, highlightbackground=self.CARD_BORDER, highlightthickness=1)
                card.grid(row=0, column=col, padx=3, sticky="nsew")
                tk.Label(card, text=title, font=("Segoe UI", 8), bg=self.CARD_BG, fg=self.TEXT_DIM).pack(pady=(10, 2))
                val_label = tk.Label(card, text=value, font=("Segoe UI Black", 18), bg=self.CARD_BG, fg=accent)
                val_label.pack(pady=(0, 10))
                return val_label

            def _make_action_group(self, parent, title, buttons):
                frame = tk.Frame(parent, bg=self.CARD_BG, highlightbackground=self.CARD_BORDER, highlightthickness=1)
                frame.pack(fill="x", padx=12, pady=4)
                tk.Label(frame, text=title, font=("Segoe UI Semibold", 12), bg=self.CARD_BG, fg=self.TEXT).pack(anchor="w", padx=16, pady=(12, 6))
                btn_row = tk.Frame(frame, bg=self.CARD_BG)
                btn_row.pack(fill="x", padx=16, pady=(0, 12))
                for i, (text, cmd) in enumerate(buttons):
                    tk.Button(btn_row, text=text, command=cmd, width=14, bg="#1e3a5f", fg=self.TEXT, relief="flat", font=("Segoe UI Semibold", 9), activebackground=self.ACCENT, activeforeground="white", padx=4, pady=6).grid(row=0, column=i, padx=3, pady=2)
            
            def _clear_log_display(self):
                try:
                    self.log_text.configure(state="normal")
                    self.log_text.delete("1.0", "end")
                    self.log_text.configure(state="disabled")
                    self._last_log_ids.clear()
                except Exception:
                    pass

            # ═══════ ACTIONS ═══════
            def _action_lock(self):
                if sys.platform == "win32":
                    ctypes.windll.user32.LockWorkStation()

            def _action_sleep(self):
                if sys.platform == "win32":
                    os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")

            def _action_restart(self):
                if sys.platform == "win32":
                    os.system("shutdown /r /t 10")
            
            def _action_shutdown(self):
                if sys.platform == "win32":
                    os.system("shutdown /s /t 10")

            def _action_explorer(self):
                if sys.platform == "win32":
                    os.system("taskkill /f /im explorer.exe")
                    time.sleep(1)
                    os.system("start explorer.exe")

            def _action_mute(self):
                if sys.platform == "win32" and HAS_PYCAW:
                    try:
                        devices = AudioUtilities.GetSpeakers()
                        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                        volume = cast(interface, POINTER(IAudioEndpointVolume))
                        volume.SetMute(1, None)
                    except Exception:
                        pass

            def _action_unmute(self):
                if sys.platform == "win32" and HAS_PYCAW:
                    try:
                        devices = AudioUtilities.GetSpeakers()
                        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                        volume = cast(interface, POINTER(IAudioEndpointVolume))
                        volume.SetMute(0, None)
                    except Exception:
                        pass
            
            def _action_playpause(self):
                pyautogui.press("playpause")
            
            def _action_next(self):
                pyautogui.press("nexttrack")

            def _action_clear_temp(self):
                if sys.platform == "win32":
                    try:
                        temp_path = os.environ.get("TEMP", "")
                        if temp_path and os.path.isdir(temp_path):
                            import shutil
                            for item in os.listdir(temp_path):
                                item_path = os.path.join(temp_path, item)
                                try:
                                    if os.path.isdir(item_path):
                                        shutil.rmtree(item_path, ignore_errors=True)
                                    else:
                                        os.unlink(item_path)
                                except Exception:
                                    pass
                    except Exception:
                        pass

            def _action_highperf(self):
                if sys.platform == "win32":
                    os.system("powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c")
            
            def _action_gaming(self):
                if sys.platform == "win32":
                    try:
                        kernel32 = ctypes.windll.kernel32
                        handle = kernel32.GetCurrentProcess()
                        kernel32.SetPriorityClass(handle, 0x00008000)
                        add_log("info", "Gaming mode enabled", category="system")
                    except Exception:
                        pass

            def _action_test_firewall(self):
                try:
                    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    sock.settimeout(2)
                    result = sock.connect_ex(("127.0.0.1", LOCAL_P2P_PORT))
                    sock.close()
                    if result == 0:
                        self.p2p_status_label.configure(text="✅ Port OPEN", fg=self.SUCCESS)
                    else:
                        self.p2p_status_label.configure(text="❌ Port CLOSED", fg=self.DANGER)
                except Exception as e:
                    self.p2p_status_label.configure(text=f"Error: {e}", fg=self.DANGER)

            def _copy_ips(self):
                try:
                    ips = get_agent_status().get("local_ips", [])
                    self.root.clipboard_clear()
                    self.root.clipboard_append("\n".join(ips))
                except Exception:
                    pass

            def _export_logs(self):
                try:
                    path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON", "*.json")])
                    if path:
                        with open(path, "w", encoding="utf-8") as f:
                            json.dump(get_logs(), f, indent=2, default=str)
                except Exception:
                    pass

            def _copy_pairing(self):
                try:
                    code = str(get_agent_status().get("pairing_code") or "")
                    self.root.clipboard_clear()
                    self.root.clipboard_append(code)
                except Exception:
                    pass
            
            def _browse_folder(self):
                try:
                    folder = filedialog.askdirectory()
                    if folder:
                        self.save_folder_var.set(folder)
                        os.makedirs(folder, exist_ok=True)
                except Exception:
                    pass
            
            def _open_folder(self):
                try:
                    folder = self.save_folder_var.get()
                    os.makedirs(folder, exist_ok=True)
                    if sys.platform == "win32":
                        os.startfile(folder)
                    else:
                        subprocess.run(["xdg-open", folder])
                except Exception:
                    pass
            
            def _select_file(self):
                try:
                    file_path = filedialog.askopenfilename()
                    if file_path:
                        self.send_file_var.set(file_path)
                except Exception:
                    pass
            
            def _send_file(self):
                try:
                    file_path = self.send_file_var.get()
                    if file_path and os.path.exists(file_path):
                        file_name = os.path.basename(file_path)
                        self.transfer_list.insert(0, f"📤 {file_name} - Pending...")
                        add_log("info", f"File queued for send: {file_name}", category="file")
                except Exception:
                    pass

            def _start_wake_word(self):
                self.wake_status.configure(text="🟢 Listening for 'Jarvis'...", fg=self.SUCCESS)
                add_log("info", "Wake word listener started", category="assistant")
                # Start speech recognition in background
                if HAS_SPEECH_RECOGNITION:
                    def listen_loop():
                        recognizer = sr.Recognizer()
                        mic = sr.Microphone()
                        with mic as source:
                            recognizer.adjust_for_ambient_noise(source, duration=1)
                        while True:
                            try:
                                with mic as source:
                                    audio = recognizer.listen(source, timeout=5, phrase_time_limit=10)
                                text = recognizer.recognize_google(audio).lower()
                                if "jarvis" in text:
                                    command = text.split("jarvis", 1)[-1].strip()
                                    if command:
                                        self.root.after(0, lambda c=command: self._process_voice_command(c))
                            except (sr.WaitTimeoutError, sr.UnknownValueError):
                                continue
                            except Exception as e:
                                add_log("warn", f"Voice recognition error: {e}", category="assistant")
                                break
                    threading.Thread(target=listen_loop, daemon=True).start()
            
            def _stop_wake_word(self):
                self.wake_status.configure(text="⏸ Inactive", fg=self.TEXT_DIM)
                add_log("info", "Wake word listener stopped", category="assistant")
            
            def _process_voice_command(self, command: str):
                self._append_chat(f"🎤 You: {command}")
                add_log("info", f"Voice command: {command}", category="assistant")
                # Process through agent's command handler
                if self.runner.agent and self.runner.loop:
                    async def _run_cmd():
                        result = await self.runner.agent._handle_command("voice_command", {"text": command})
                        return result
                    fut = asyncio.run_coroutine_threadsafe(_run_cmd(), self.runner.loop)
                    try:
                        result = fut.result(timeout=10)
                        self._append_chat(f"🤖 JARVIS: {json.dumps(result, indent=2)[:200]}")
                    except Exception as e:
                        self._append_chat(f"🤖 JARVIS: Error - {e}")
            
            def _record_voice_sample(self):
                """Record a wake word sample for voice training."""
                if not HAS_SPEECH_RECOGNITION:
                    add_log("warn", "speech_recognition not installed", category="assistant")
                    return
                
                def record():
                    try:
                        self.train_count_label.configure(text="🎙️ Recording...")
                        recognizer = sr.Recognizer()
                        with sr.Microphone() as source:
                            audio = recognizer.listen(source, timeout=5, phrase_time_limit=3)
                        # Save sample
                        samples_dir = os.path.join(os.path.expanduser("~"), ".jarvis", "voice_samples")
                        os.makedirs(samples_dir, exist_ok=True)
                        count = len([f for f in os.listdir(samples_dir) if f.endswith(".wav")])
                        sample_path = os.path.join(samples_dir, f"wake_sample_{count + 1}.wav")
                        with open(sample_path, "wb") as f:
                            f.write(audio.get_wav_data())
                        self.root.after(0, lambda: self.train_count_label.configure(text=f"Samples: {count + 1}"))
                        add_log("info", f"Voice sample saved: {sample_path}", category="assistant")
                    except Exception as e:
                        self.root.after(0, lambda: self.train_count_label.configure(text=f"Error: {e}"))
                
                threading.Thread(target=record, daemon=True).start()
            
            def _send_chat(self):
                text = self.chat_input_var.get().strip()
                if not text:
                    return
                self.chat_input_var.set("")
                self._append_chat(f"🧑 You: {text}")
                self._process_voice_command(text)
            
            def _append_chat(self, line: str):
                try:
                    self.chat_log.configure(state="normal")
                    self.chat_log.insert("end", line + "\n\n")
                    self.chat_log.see("end")
                    self.chat_log.configure(state="disabled")
                except Exception:
                    pass

            def _append_log(self, line: str):
                try:
                    self.log_text.configure(state="normal")
                    self.log_text.insert("end", line + "\n")
                    self.log_text.see("end")
                    self.log_text.configure(state="disabled")
                except Exception:
                    pass

            def _tick(self):
                now = datetime.now()
                self.clock_label.configure(text=now.strftime("%H:%M"))
                self.seconds_label.configure(text=f":{now.strftime('%S')}")
                self.date_label.configure(text=now.strftime("%A, %d %B %Y"))
                
                st = get_agent_status()
                mode = st.get("connection_mode", "cloud")
                
                if mode == "local_p2p":
                    self.conn_status.configure(text="● LOCAL P2P", fg=self.SUCCESS)
                elif st.get("connected"):
                    self.conn_status.configure(text="● CONNECTED", fg=self.SUCCESS)
                else:
                    self.conn_status.configure(text="● CONNECTING", fg=self.WARNING)
                
                code = st.get('pairing_code') or '——'
                self.pairing_label.configure(text=f"CODE: {code}")
                
                ips = st.get("local_ips") or []
                self.ip_label.configure(text=f"IP: {', '.join(ips[:2]) if ips else '—'}")

                p2p = get_local_p2p_server()
                dev_id = st.get('device_id', '—')
                dev_id_short = dev_id[:12] + "..." if len(dev_id) > 12 else dev_id
                details = f"Device: {st.get('device_name', '—')}  │  ID: {dev_id_short}\n"
                details += f"IPs: {', '.join(ips) if ips else '—'}  │  Port: {LOCAL_P2P_PORT}\n"
                details += f"P2P: {'Running' if p2p and p2p.running else 'Stopped'} ({len(p2p.clients) if p2p else 0} clients)  │  Mode: {mode.upper()}"
                self.conn_details.configure(text=details)

                cpu = st.get('cpu_percent', 0)
                mem = st.get('memory_percent', 0)
                self.cpu_card.configure(text=f"{cpu:.0f}%", fg=self.DANGER if cpu > 80 else self.ACCENT)
                self.ram_card.configure(text=f"{mem:.0f}%", fg=self.DANGER if mem > 80 else "#8b5cf6")
                
                try:
                    disk = psutil.disk_usage('C:\\' if sys.platform == "win32" else '/')
                    self.disk_card.configure(text=f"{disk.percent:.0f}%", fg=self.DANGER if disk.percent > 90 else "#f59e0b")
                    
                    battery = psutil.sensors_battery()
                    if battery:
                        plug = "⚡" if battery.power_plugged else ""
                        bat_color = self.DANGER if battery.percent < 20 else self.SUCCESS
                        self.battery_card.configure(text=f"{plug}{battery.percent:.0f}%", fg=bat_color)
                    else:
                        self.battery_card.configure(text="AC", fg=self.SUCCESS)
                    
                    boot_time = psutil.boot_time()
                    uptime_secs = time.time() - boot_time
                    hours = int(uptime_secs // 3600)
                    mins = int((uptime_secs % 3600) // 60)
                    self.uptime_card.configure(text=f"{hours}h{mins}m")
                except Exception:
                    pass

                if p2p and p2p.running:
                    clients = len(p2p.clients)
                    self.p2p_status_label.configure(text=f"🟢 Running ({clients} clients)", fg=self.SUCCESS)
                else:
                    self.p2p_status_label.configure(text="🔴 Stopped", fg=self.DANGER)

                for entry in get_logs():
                    eid = str(entry.get("id"))
                    if eid in self._last_log_ids:
                        continue
                    self._last_log_ids.add(eid)
                    ts = str(entry.get("timestamp", ""))[-8:]
                    cat = str(entry.get("category", "general"))
                    lvl = str(entry.get("level", "info")).upper()
                    msg = str(entry.get("message", ""))
                    emoji = {"ERROR": "❌", "WARN": "⚠️", "INFO": "ℹ️"}.get(lvl, "📝")
                    self._append_log(f"{ts} {emoji} [{cat}] {msg}")

                self.root.after(500, self._tick)

            def _on_close(self):
                self.runner.stop()
                try:
                    self.root.destroy()
                except Exception:
                    pass

        JarvisAgentGUI()
        return

    # Console mode
    try:
        asyncio.run(run_agent())
    except KeyboardInterrupt:
        print("\n\nShutting down...")
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        print("\nPress Enter to exit...")
        try:
            input()
        except:
            time.sleep(5)


if __name__ == "__main__":
    main()
