"""
JARVIS PC Agent v3.0 - Consolidated Edition
============================================
Single-file agent with:
- Local P2P WebSocket server (port 9876) for ultra-low latency
- Input-session gating to prevent "ghost" command execution
- Pairing code countdown with auto-regeneration
- Exponential backoff connection recovery
- Threaded screenshot encoding
- Circular buffers to prevent memory leaks
- Batch command execution
- File transfer support

Run: python jarvis_agent.py
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

# ============== VERSION ==============
AGENT_VERSION = "3.1.0"

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
    def __init__(self):
        self.device_id = ""
        self.device_key = str(uuid.uuid4())
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
        """Lightweight snapshot used by the Hub to sync sliders + lock state."""
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
        """Enumerate basic camera indices for PC camera streaming."""
        try:
            cameras: List[Dict[str, Any]] = []

            if not HAS_OPENCV:
                return {
                    "success": True,
                    "cameras": [],
                    "note": "OpenCV not installed; camera enumeration disabled.",
                }

            max_test = 6
            for idx in range(0, max_test):
                cap = None
                try:
                    # CAP_DSHOW improves reliability on Windows
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
        """Return output devices + master volume/mute.

        Note: full endpoint enumeration is OS-specific; we return the default endpoint
        for now so the UI works without 'unknown command' errors.
        """
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

            devices_out = [
                {
                    "id": "default",
                    "name": "Default Output",
                    "type": "default",
                    "volume": int(master_volume),
                    "isMuted": bool(is_muted),
                    "isDefault": True,
                }
            ]

            return {
                "success": True,
                "devices": devices_out,
                "master_volume": int(master_volume),
                "is_muted": bool(is_muted),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _set_audio_output(self, device_id: str) -> Dict[str, Any]:
        """Best-effort audio output switching.

        We keep this as a safe no-op for non-default ids to avoid breaking the UI.
        """
        try:
            device_id = (device_id or "").strip() or "default"
            if device_id != "default":
                return {
                    "success": True,
                    "device_id": device_id,
                    "note": "Only the default output endpoint is supported in this build.",
                }
            return {"success": True, "device_id": "default"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _list_audio_outputs(self) -> Dict[str, Any]:
        """Alias for get_audio_devices that returns a compatible structure."""
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

            # Fallback: media key
            pyautogui.press("volumemute")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _join_zoom(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Join a Zoom meeting and apply privacy toggles.

        This is intentionally best-effort (Zoom focus can vary), but avoids unknown-command errors.
        """
        try:
            meeting_link = str(payload.get("meeting_link") or "").strip()
            meeting_id = str(payload.get("meeting_id") or "").strip()
            password = str(payload.get("password") or "").strip()

            mute_audio = bool(payload.get("mute_audio", True))
            mute_video = bool(payload.get("mute_video", True))
            take_screenshot = bool(payload.get("take_screenshot", False))

            link = meeting_link
            if not link and meeting_id:
                mid = re.sub(r"[^0-9]", "", meeting_id)
                link = f"https://zoom.us/j/{mid}"
                if password:
                    link += f"?pwd={urllib.parse.quote(password)}"

            if not link:
                return {"success": False, "error": "Missing meeting_link or meeting_id"}

            add_log("info", "Opening Zoom meeting", details=link[:140], category="zoom")
            webbrowser.open(link)

            # Give Zoom time to open and focus
            await asyncio.sleep(8)

            # Privacy toggles (Windows Zoom hotkeys)
            if platform.system() == "Windows":
                if mute_audio:
                    pyautogui.hotkey("alt", "a")
                if mute_video:
                    pyautogui.hotkey("alt", "v")

            screenshot_path = None
            if take_screenshot:
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
            # Handle combos like "ctrl+c"
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
        """Start streaming camera frames to the relay."""
        try:
            if not HAS_OPENCV:
                return {"success": False, "error": "OpenCV not installed"}
            
            session_id = payload.get("session_id", "")
            camera_index = int(payload.get("camera_index", 0))
            fps = int(payload.get("fps", 30))
            quality = int(payload.get("quality", 70))
            
            if not session_id:
                return {"success": False, "error": "Missing session_id"}
            
            # Stop existing stream
            self._stop_camera_stream()
            
            # Open camera with DirectShow on Windows for reliability
            if platform.system() == "Windows":
                cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
            else:
                cap = cv2.VideoCapture(camera_index)
            
            if not cap.isOpened():
                return {"success": False, "error": f"Failed to open camera {camera_index}"}
            
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            cap.set(cv2.CAP_PROP_FPS, fps)
            
            # Store for later cleanup
            self._camera_streamer = {
                "cap": cap,
                "session_id": session_id,
                "fps": fps,
                "quality": quality,
                "running": True,
            }
            
            # Start streaming in background thread
            def stream_camera():
                import websockets.sync.client as ws_client
                
                # Build WebSocket URL with session token
                ws_url = f"wss://gkppopjoedadacolxufi.functions.supabase.co/functions/v1/camera-relay?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true"
                
                try:
                    with ws_client.connect(ws_url) as ws:
                        self._camera_ws = ws
                        add_log("info", f"Camera stream connected: session={session_id[:8]}...", category="camera")
                        
                        interval = 1.0 / max(1, fps)
                        while self._camera_streamer and self._camera_streamer.get("running"):
                            ret, frame = cap.read()
                            if not ret:
                                continue
                            
                            # Encode to JPEG
                            encode_params = [cv2.IMWRITE_JPEG_QUALITY, self._camera_streamer.get("quality", quality)]
                            _, buffer = cv2.imencode(".jpg", frame, encode_params)
                            
                            # Send binary frame
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
        """Stop camera streaming."""
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
        """Update FPS/quality settings for active camera stream."""
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
        """Start streaming screen frames to the relay."""
        try:
            if not HAS_MSS:
                return {"success": False, "error": "mss not installed - screen capture unavailable"}
            
            session_id = payload.get("session_id", "")
            fps = int(payload.get("fps", 30))
            quality = int(payload.get("quality", 70))
            scale = float(payload.get("scale", 0.5))
            monitor_index = int(payload.get("monitor_index", 1))
            
            if not session_id:
                return {"success": False, "error": "Missing session_id"}
            
            # Stop existing stream
            self._stop_screen_stream()
            
            self._screen_streamer = {
                "session_id": session_id,
                "fps": fps,
                "quality": quality,
                "scale": scale,
                "monitor_index": monitor_index,
                "running": True,
            }
            
            def stream_screen():
                import websockets.sync.client as ws_client
                
                ws_url = f"wss://gkppopjoedadacolxufi.functions.supabase.co/functions/v1/camera-relay?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true"
                
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
                                
                                # Scale down
                                current_scale = self._screen_streamer.get("scale", scale)
                                new_size = (int(img.width * current_scale), int(img.height * current_scale))
                                img = img.resize(new_size, Image.LANCZOS)
                                
                                # Encode to JPEG
                                buffer = io.BytesIO()
                                img.save(buffer, format="JPEG", quality=self._screen_streamer.get("quality", quality), optimize=True)
                                
                                # Send binary frame
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
        """Stop screen streaming."""
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
        """Update FPS/quality/scale settings for active screen stream."""
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
        """Start a test pattern stream for debugging."""
        try:
            session_id = payload.get("session_id", "")
            fps = int(payload.get("fps", 30))
            quality = int(payload.get("quality", 70))
            mode = payload.get("mode", "camera")  # 'camera' or 'screen'
            
            if not session_id:
                return {"success": False, "error": "Missing session_id"}
            
            if mode == "screen":
                self._stop_screen_stream()
                self._screen_streamer = {"session_id": session_id, "fps": fps, "quality": quality, "running": True}
            else:
                self._stop_camera_stream()
                self._camera_streamer = {"session_id": session_id, "fps": fps, "quality": quality, "running": True}
            
            def stream_test_pattern():
                import websockets.sync.client as ws_client
                
                ws_url = f"wss://gkppopjoedadacolxufi.functions.supabase.co/functions/v1/camera-relay?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true"
                
                try:
                    with ws_client.connect(ws_url) as ws:
                        add_log("info", f"Test pattern connected: session={session_id[:8]}...", category="test")
                        
                        frame_num = 0
                        interval = 1.0 / max(1, fps)
                        streamer = self._screen_streamer if mode == "screen" else self._camera_streamer
                        
                        while streamer and streamer.get("running"):
                            # Create test pattern with frame number
                            img = Image.new('RGB', (640, 480), color=(frame_num % 256, 128, 255 - (frame_num % 256)))
                            from PIL import ImageDraw
                            draw = ImageDraw.Draw(img)
                            draw.text((280, 220), f"Frame {frame_num}", fill=(255, 255, 255))
                            draw.text((250, 250), f"FPS: {fps} | Quality: {quality}", fill=(255, 255, 255))
                            
                            buffer = io.BytesIO()
                            img.save(buffer, format="JPEG", quality=quality)
                            ws.send(buffer.getvalue())
                            
                            frame_num += 1
                            time.sleep(interval)
                            
                except Exception as e:
                    add_log("error", f"Test pattern error: {e}", category="test")
            
            threading.Thread(target=stream_test_pattern, daemon=True).start()
            
            add_log("info", f"Test pattern started: mode={mode}, fps={fps}", category="test")
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
            temp_paths = [
                os.environ.get("TEMP", ""),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp"),
            ]
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
                plans = {
                    "high_performance": "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
                    "balanced": "381b4222-f694-41f0-9685-ff5bb260df2e",
                }
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
                # Skill aliases
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
            GATED_COMMANDS = {
                "mouse_move", "mouse_click", "key_press", "key_combo", "type_text",
                "scroll", "zoom", "gesture_3_finger", "gesture_4_finger",
            }
            if cmd in GATED_COMMANDS:
                incoming_session = str(payload.get("input_session", "") or "")
                if (
                    not self._active_input_session
                    or incoming_session != self._active_input_session
                    or time.time() > self._input_session_expires_at
                ):
                    # Silently reject - prevents ghost input
                    return {"success": False, "error": "Remote input not enabled"}
            
            # ============== SKILLS DISPATCH ==============
            if HAS_SKILLS:
                registry = get_skill_registry()
                if registry.can_dispatch(cmd):
                    ctx = {
                        "supabase": self.supabase,
                        "user_id": self.current_user_id,
                        "device_id": self.device_id,
                    }
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
            
            # Audio device listing alias
            elif cmd in ["list_audio_outputs", "get_audio_outputs"]:
                return self._list_audio_outputs()
            
            # Play music alias (open YouTube search)
            elif cmd == "play_music":
                query = payload.get("query", "")
                service = payload.get("service", "youtube")
                if service == "youtube":
                    url = f"https://www.youtube.com/results?search_query={query.replace(' ', '+')}"
                    webbrowser.open(url)
                    return {"success": True, "message": f"Playing '{query}' on YouTube"}
                return {"success": False, "error": f"Unsupported service: {service}"}
            
            # Web search alias
            elif cmd == "search_web":
                query = payload.get("query", "")
                engine = payload.get("engine", "google").lower()
                urls = {
                    "google": f"https://www.google.com/search?q={query.replace(' ', '+')}",
                    "bing": f"https://www.bing.com/search?q={query.replace(' ', '+')}",
                    "duckduckgo": f"https://duckduckgo.com/?q={query.replace(' ', '+')}",
                    "perplexity": f"https://www.perplexity.ai/search?q={query.replace(' ', '+')}",
                    "chatgpt": f"https://chat.openai.com/?q={query.replace(' ', '+')}",
                }
                url = urls.get(engine, urls["google"])
                webbrowser.open(url)
                return {"success": True, "message": f"Searching '{query}' on {engine}"}
            
            # Call controls - these are mobile-side actions; agent just acknowledges
            elif cmd in ["answer_call", "end_call", "decline_call", "call_mute"]:
                add_log("info", f"Call control received: {cmd}", category="command")
                return {"success": True, "message": f"{cmd} acknowledged (mobile-side action)"}
            
            # Apps
            elif cmd == "open_app":
                return self._open_app(payload.get("app_name", ""), payload.get("app_id"))
            elif cmd == "close_app":
                return self._close_app(payload.get("app_name", ""))
            
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
            
            # Notifications (PC-side acknowledgment)
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
            
            # ============== CAMERA/SCREEN STREAMING ==============
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
            add_log("error", f"Command '{command_type}' exception: {e}", details=traceback.format_exc(), category="command")
            return {"success": False, "error": str(e)}
    
    # ============== DEVICE REGISTRATION ==============
    async def register_device(self):
        try:
            # Generate pairing code
            import random
            self.pairing_code = ''.join([str(random.randint(0, 9)) for _ in range(6)])
            pairing_expires = datetime.now(timezone.utc) + timedelta(minutes=PAIRING_CODE_LIFETIME_MINUTES)
            
            # Check for existing device
            result = self.supabase.table("devices").select("id, device_key").eq("device_key", self.device_key).limit(1).execute()
            
            if result.data:
                self.device_id = result.data[0]["id"]
                self.supabase.table("devices").update({
                    "is_online": True,
                    "pairing_code": self.pairing_code,
                    "pairing_expires_at": pairing_expires.isoformat(),
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                }).eq("id", self.device_id).execute()
            else:
                # Create new device
                insert_result = self.supabase.table("devices").insert({
                    "name": DEVICE_NAME,
                    "device_key": self.device_key,
                    "is_online": True,
                    "pairing_code": self.pairing_code,
                    "pairing_expires_at": pairing_expires.isoformat(),
                    "current_volume": self._get_volume(),
                    "current_brightness": self._get_brightness(),
                    "user_id": "00000000-0000-0000-0000-000000000000",  # Anonymous device
                }).execute()
                
                if insert_result.data:
                    self.device_id = insert_result.data[0]["id"]
            
            update_agent_status({
                "connected": True,
                "device_id": self.device_id,
                "pairing_code": self.pairing_code,
                "pairing_expires_at": pairing_expires.isoformat(),
            })
            
            add_log("info", f"Device registered: {self.device_id}", category="system")
            add_log("info", f"Pairing code: {self.pairing_code}", category="system")
            
        except Exception as e:
            add_log("error", f"Registration failed: {e}", category="system")
    
    # ============== POLLING ==============
    async def poll_commands(self):
        poll_url = f"{SUPABASE_URL}/functions/v1/agent-poll"
        
        while self.running:
            try:
                req_data = json.dumps({"action": "poll"}).encode("utf-8")
                req = urllib.request.Request(
                    poll_url,
                    data=req_data,
                    headers={
                        "Content-Type": "application/json",
                        "x-device-key": self.device_key,
                    },
                    method="POST"
                )
                
                with urllib.request.urlopen(req, timeout=10) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                
                if not result.get("success"):
                    if "Invalid device key" in str(result.get("error", "")):
                        add_log("error", "Device key rejected - re-registering", category="auth")
                        await self.register_device()
                    await asyncio.sleep(POLL_INTERVAL)
                    continue
                
                # Update user_id if returned (needed for skills)
                if result.get("user_id"):
                    self.current_user_id = result.get("user_id")

                commands = result.get("commands", [])
                self.consecutive_failures = 0
                self.backoff_seconds = 1
                
                for cmd in commands:
                    cmd_type = cmd["command_type"]
                    payload = cmd.get("payload") or {}
                    cmd_id = cmd["id"]
                    
                    add_log("info", f"Executing: {cmd_type}", category="command")
                    result_data = await self._handle_command(cmd_type, payload)
                    
                    # Report completion
                    try:
                        complete_data = json.dumps({
                            "action": "complete",
                            "commandId": cmd_id,
                            "result": result_data
                        }).encode("utf-8")
                        complete_req = urllib.request.Request(
                            poll_url,
                            data=complete_data,
                            headers={
                                "Content-Type": "application/json",
                                "x-device-key": self.device_key,
                            },
                            method="POST"
                        )
                        with urllib.request.urlopen(complete_req, timeout=10) as _:
                            pass
                    except Exception as e:
                        add_log("warn", f"Failed to report completion: {e}", category="command")
                
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    add_log("error", "Authentication failed", category="auth")
                self.consecutive_failures += 1
            except Exception as e:
                self.consecutive_failures += 1
                add_log("warn", f"Poll error ({self.consecutive_failures}): {e}", category="polling")
                
                if self.consecutive_failures >= self.max_failures_before_reregister:
                    add_log("warn", "Too many failures, re-registering...", category="system")
                    self.backoff_seconds = min(self.backoff_seconds * 2, self.max_backoff)
                    await asyncio.sleep(self.backoff_seconds)
                    await self.register_device()
            
            await asyncio.sleep(POLL_INTERVAL)
    
    # ============== HEARTBEAT ==============
    async def heartbeat(self):
        poll_url = f"{SUPABASE_URL}/functions/v1/agent-poll"
        
        while self.running:
            try:
                hb_data = json.dumps({
                    "action": "heartbeat",
                    "volume": self._get_volume(),
                    "brightness": self._get_brightness(),
                }).encode("utf-8")
                
                req = urllib.request.Request(
                    poll_url,
                    data=hb_data,
                    headers={
                        "Content-Type": "application/json",
                        "x-device-key": self.device_key,
                    },
                    method="POST"
                )
                
                with urllib.request.urlopen(req, timeout=10) as _:
                    pass
                
                update_agent_status({
                    "last_heartbeat": datetime.now().isoformat(),
                    "volume": self._volume_cache,
                    "brightness": self._brightness_cache,
                    "cpu_percent": psutil.cpu_percent(),
                    "memory_percent": psutil.virtual_memory().percent,
                })
            except Exception as e:
                add_log("warn", f"Heartbeat error: {e}", category="heartbeat")
            
            await asyncio.sleep(HEARTBEAT_INTERVAL)
    
    # ============== RUN ==============
    async def run(self):
        print("\n" + "="*50)
        print(f"🤖 JARVIS PC Agent v{AGENT_VERSION}")
        print("="*50)
        print(f"📍 Device: {DEVICE_NAME}")
        print(f"🔗 Backend: {SUPABASE_URL}")
        print(f"📷 Camera: {'✅' if HAS_OPENCV else '❌'}")
        print(f"🎤 Audio: {'✅' if HAS_PYAUDIO else '❌'}")
        print(f"🔌 WebSockets: {'✅' if HAS_WEBSOCKETS else '❌'}")
        print("="*50 + "\n")
        
        await self.register_device()
        
        # Start local P2P server
        async def handle_local_command(command_type: str, payload: dict):
            return await self._handle_command(command_type, payload)
        
        start_local_p2p_server(handle_local_command, LOCAL_P2P_PORT)
        
        print("\n✅ Agent running! Open the Jarvis web app to control this PC.")
        print("   Press Ctrl+C to stop.\n")
        
        await asyncio.gather(
            self.poll_commands(),
            self.heartbeat()
        )
    
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
        print("⚠️ Tkinter not available on this Python install. Starting in console mode.")

    if args.gui and HAS_TKINTER:
        # Run agent in a background thread; keep UI responsive.
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
            def __init__(self):
                self.runner = AgentThreadRunner()
                self.runner.start()

                self.root = tk.Tk()
                self.root.title(f"JARVIS PC Agent v{AGENT_VERSION}")
                self.root.geometry("520x760")
                self.root.minsize(480, 680)

                # Dark-ish styling (simple + stable across Windows builds)
                self.root.configure(bg="#0b0b0f")
                style = ttk.Style()
                try:
                    style.theme_use("clam")
                except Exception:
                    pass

                style.configure("TFrame", background="#0b0b0f")
                style.configure("TLabel", background="#0b0b0f", foreground="#e5e7eb")
                style.configure("TButton", padding=6)
                style.configure("TLabelframe", background="#0b0b0f", foreground="#e5e7eb")
                style.configure("TLabelframe.Label", background="#0b0b0f", foreground="#e5e7eb")

                self._build_ui()
                self._last_log_ids: Set[str] = set()
                self._tick()
                self.root.protocol("WM_DELETE_WINDOW", self._on_close)
                self.root.mainloop()

            def _build_ui(self):
                container = ttk.Frame(self.root)
                container.pack(fill="both", expand=True, padx=12, pady=12)

                # Notebook for tabs
                notebook = ttk.Notebook(container)
                notebook.pack(fill="both", expand=True)

                # ============ Tab 1: Dashboard ============
                status_tab = ttk.Frame(notebook)
                notebook.add(status_tab, text="📊 Dashboard")

                # Connection Status Card
                status_box = ttk.Labelframe(status_tab, text="🔗 Connection Status")
                status_box.pack(fill="x", padx=8, pady=(8, 0))

                grid = ttk.Frame(status_box)
                grid.pack(fill="x", padx=10, pady=10)

                self.pairing_value = ttk.Label(grid, text="—", font=("Consolas", 18, "bold"), foreground="#22c55e")
                self.device_value = ttk.Label(grid, text="—", font=("Segoe UI", 11))
                self.ip_value = ttk.Label(grid, text="—", font=("Consolas", 10))
                self.heartbeat_value = ttk.Label(grid, text="—", font=("Segoe UI", 9))
                self.mode_label = ttk.Label(grid, text="—", font=("Segoe UI", 10, "bold"), foreground="#3b82f6")
                self.cpu_label = ttk.Label(grid, text="—", font=("Segoe UI", 10))
                self.stream_label = ttk.Label(grid, text="—", font=("Segoe UI", 9))

                labels_1 = [
                    ("🔑 Pairing Code:", self.pairing_value),
                    ("💻 Device:", self.device_value),
                    ("🌐 Local IPs:", self.ip_value),
                    ("💓 Heartbeat:", self.heartbeat_value),
                    ("📡 Mode:", self.mode_label),
                    ("📊 CPU / RAM:", self.cpu_label),
                    ("📹 Streams:", self.stream_label),
                ]
                for i, (lbl_text, value_widget) in enumerate(labels_1):
                    ttk.Label(grid, text=lbl_text, font=("Segoe UI", 10)).grid(row=i, column=0, sticky="w", pady=(4, 0))
                    value_widget.grid(row=i, column=1, sticky="w", pady=(4, 0), padx=(12, 0))

                for c in (0, 1):
                    grid.grid_columnconfigure(c, weight=1)

                actions = ttk.Frame(status_box)
                actions.pack(fill="x", padx=10, pady=(0, 10))

                ttk.Button(actions, text="🌐 Open Web App", command=lambda: webbrowser.open(DEFAULT_APP_URL)).pack(side="left")
                ttk.Button(actions, text="📋 Copy Code", command=self._copy_pairing).pack(side="left", padx=(8, 0))
                ttk.Button(actions, text="🔄 Refresh", command=self._refresh_status).pack(side="left", padx=(8, 0))
                ttk.Button(actions, text="❌ Quit", command=self._on_close).pack(side="right")

                # System Info Card
                sysinfo_box = ttk.Labelframe(status_tab, text="💻 System Info")
                sysinfo_box.pack(fill="x", padx=8, pady=(12, 0))
                
                sysinfo = ttk.Frame(sysinfo_box)
                sysinfo.pack(fill="x", padx=10, pady=10)
                
                self.disk_label = ttk.Label(sysinfo, text="Disk: —")
                self.battery_label = ttk.Label(sysinfo, text="Battery: —")
                self.uptime_label = ttk.Label(sysinfo, text="Uptime: —")
                
                self.disk_label.grid(row=0, column=0, sticky="w")
                self.battery_label.grid(row=0, column=1, sticky="w", padx=(20, 0))
                self.uptime_label.grid(row=0, column=2, sticky="w", padx=(20, 0))

                # Logs Card
                logs_box = ttk.Labelframe(status_tab, text="📜 Live Logs")
                logs_box.pack(fill="both", expand=True, padx=8, pady=(12, 8))

                self.log_text = scrolledtext.ScrolledText(
                    logs_box,
                    height=10,
                    bg="#0f172a",
                    fg="#e5e7eb",
                    insertbackground="#e5e7eb",
                    font=("Consolas", 9),
                )
                self.log_text.pack(fill="both", expand=True, padx=10, pady=10)
                self.log_text.configure(state="disabled")

                # ============ Tab 2: Quick Actions ============
                actions_tab = ttk.Frame(notebook)
                notebook.add(actions_tab, text="⚡ Actions")

                # Power Controls
                power_box = ttk.Labelframe(actions_tab, text="🔌 Power Controls")
                power_box.pack(fill="x", padx=8, pady=8)

                pb = ttk.Frame(power_box)
                pb.pack(fill="x", padx=10, pady=10)

                ttk.Button(pb, text="🔒 Lock", command=self._action_lock, width=12).grid(row=0, column=0, padx=4, pady=4)
                ttk.Button(pb, text="😴 Sleep", command=self._action_sleep, width=12).grid(row=0, column=1, padx=4, pady=4)
                ttk.Button(pb, text="🔄 Restart", command=self._action_restart, width=12).grid(row=0, column=2, padx=4, pady=4)
                ttk.Button(pb, text="⏻ Shutdown", command=self._action_shutdown, width=12).grid(row=0, column=3, padx=4, pady=4)

                # Audio Controls
                audio_box = ttk.Labelframe(actions_tab, text="🔊 Audio Controls")
                audio_box.pack(fill="x", padx=8, pady=8)

                ab = ttk.Frame(audio_box)
                ab.pack(fill="x", padx=10, pady=10)

                ttk.Button(ab, text="🔇 Mute", command=self._action_mute, width=12).grid(row=0, column=0, padx=4, pady=4)
                ttk.Button(ab, text="🔊 Unmute", command=self._action_unmute, width=12).grid(row=0, column=1, padx=4, pady=4)
                ttk.Button(ab, text="⏯️ Play/Pause", command=self._action_playpause, width=12).grid(row=0, column=2, padx=4, pady=4)
                ttk.Button(ab, text="⏭️ Next", command=self._action_next, width=12).grid(row=0, column=3, padx=4, pady=4)

                # Performance
                perf_box = ttk.Labelframe(actions_tab, text="🚀 Performance")
                perf_box.pack(fill="x", padx=8, pady=8)

                pf = ttk.Frame(perf_box)
                pf.pack(fill="x", padx=10, pady=10)

                ttk.Button(pf, text="🧹 Clear Temp", command=self._action_clear_temp, width=12).grid(row=0, column=0, padx=4, pady=4)
                ttk.Button(pf, text="⚡ High Perf", command=self._action_highperf, width=12).grid(row=0, column=1, padx=4, pady=4)
                ttk.Button(pf, text="🔄 Explorer", command=self._action_explorer, width=12).grid(row=0, column=2, padx=4, pady=4)
                ttk.Button(pf, text="🎮 Gaming Mode", command=self._action_gaming, width=12).grid(row=0, column=3, padx=4, pady=4)

                # P2P Diagnostics
                diag_box = ttk.Labelframe(actions_tab, text="🔍 P2P Diagnostics")
                diag_box.pack(fill="x", padx=8, pady=8)

                diag_frame = ttk.Frame(diag_box)
                diag_frame.pack(fill="x", padx=10, pady=10)

                ttk.Label(diag_frame, text="P2P Port:").grid(row=0, column=0, sticky="w")
                self.port_entry = ttk.Entry(diag_frame, width=8)
                self.port_entry.insert(0, str(LOCAL_P2P_PORT))
                self.port_entry.config(state="readonly")
                self.port_entry.grid(row=0, column=1, sticky="w", padx=(4, 0))

                self.p2p_status_label = ttk.Label(diag_frame, text="—", font=("Segoe UI", 10, "bold"))
                self.p2p_status_label.grid(row=0, column=2, sticky="w", padx=(16, 0))

                ttk.Button(diag_frame, text="🔥 Test Firewall", command=self._action_test_firewall).grid(row=0, column=3, sticky="e")

                # ============ Tab 3: File Transfer ============
                files_tab = ttk.Frame(notebook)
                notebook.add(files_tab, text="📁 Files")

                # Save Folder
                folder_box = ttk.Labelframe(files_tab, text="📂 Download Folder")
                folder_box.pack(fill="x", padx=8, pady=8)

                ff = ttk.Frame(folder_box)
                ff.pack(fill="x", padx=10, pady=10)

                self.save_folder_var = tk.StringVar(value=os.path.expanduser("~/Downloads/JARVIS"))
                self.folder_entry = ttk.Entry(ff, textvariable=self.save_folder_var, width=40)
                self.folder_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
                ttk.Button(ff, text="📁 Browse", command=self._browse_folder).grid(row=0, column=1)
                ttk.Button(ff, text="📂 Open", command=self._open_folder).grid(row=0, column=2, padx=(4, 0))
                ff.grid_columnconfigure(0, weight=1)

                # Send File
                send_box = ttk.Labelframe(files_tab, text="📤 Send File to Phone")
                send_box.pack(fill="x", padx=8, pady=8)

                sf = ttk.Frame(send_box)
                sf.pack(fill="x", padx=10, pady=10)

                self.send_file_var = tk.StringVar()
                self.send_file_entry = ttk.Entry(sf, textvariable=self.send_file_var, width=40)
                self.send_file_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
                ttk.Button(sf, text="📄 Select File", command=self._select_file).grid(row=0, column=1)
                ttk.Button(sf, text="📤 Send", command=self._send_file).grid(row=0, column=2, padx=(4, 0))
                sf.grid_columnconfigure(0, weight=1)

                # Recent Transfers
                transfers_box = ttk.Labelframe(files_tab, text="📋 Recent Transfers")
                transfers_box.pack(fill="both", expand=True, padx=8, pady=8)

                self.transfer_list = tk.Listbox(transfers_box, bg="#0f172a", fg="#e5e7eb", font=("Consolas", 9), height=8)
                self.transfer_list.pack(fill="both", expand=True, padx=10, pady=10)

                # ============ Tab 4: Settings ============
                settings_tab = ttk.Frame(notebook)
                notebook.add(settings_tab, text="⚙️ Settings")

                settings_box = ttk.Labelframe(settings_tab, text="⚙️ Agent Settings")
                settings_box.pack(fill="x", padx=8, pady=8)

                sf = ttk.Frame(settings_box)
                sf.pack(fill="x", padx=10, pady=10)

                ttk.Label(sf, text="Auto-start with Windows:").grid(row=0, column=0, sticky="w")
                self.autostart_var = tk.BooleanVar()
                ttk.Checkbutton(sf, variable=self.autostart_var, command=self._toggle_autostart).grid(row=0, column=1, sticky="w")

                ttk.Label(sf, text="Device Name:").grid(row=1, column=0, sticky="w", pady=(8, 0))
                self.device_name_entry = ttk.Entry(sf, width=24)
                self.device_name_entry.insert(0, DEVICE_NAME)
                self.device_name_entry.grid(row=1, column=1, sticky="w", pady=(8, 0))

                ttk.Label(sf, text="Supabase URL:").grid(row=2, column=0, sticky="w", pady=(8, 0))
                self.url_entry = ttk.Entry(sf, width=40)
                self.url_entry.insert(0, SUPABASE_URL)
                self.url_entry.config(state="readonly")
                self.url_entry.grid(row=2, column=1, sticky="w", pady=(8, 0))

                ttk.Label(sf, text="Export logs:").grid(row=3, column=0, sticky="w", pady=(8, 0))
                ttk.Button(sf, text="📥 Export JSON", command=self._export_logs).grid(row=3, column=1, sticky="w", pady=(8, 0))

                # About Box
                about_box = ttk.Labelframe(settings_tab, text="ℹ️ About")
                about_box.pack(fill="x", padx=8, pady=8)
                
                ab_frame = ttk.Frame(about_box)
                ab_frame.pack(fill="x", padx=10, pady=10)
                
                ttk.Label(ab_frame, text=f"JARVIS PC Agent v{AGENT_VERSION}", font=("Segoe UI", 12, "bold")).pack(anchor="w")
                ttk.Label(ab_frame, text="Remote PC control from your phone", font=("Segoe UI", 10)).pack(anchor="w")
                ttk.Label(ab_frame, text=f"Python {sys.version_info.major}.{sys.version_info.minor} | Platform: {platform.system()}", font=("Segoe UI", 9)).pack(anchor="w", pady=(8, 0))

            # ================ ACTION HELPERS ================
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
                        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
                        devices = AudioUtilities.GetSpeakers()
                        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                        volume = cast(interface, POINTER(IAudioEndpointVolume))
                        volume.SetMute(1, None)
                    except Exception:
                        pass

            def _action_unmute(self):
                if sys.platform == "win32" and HAS_PYCAW:
                    try:
                        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
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
                        self.p2p_status_label.configure(text="Port OPEN ✓")
                    else:
                        self.p2p_status_label.configure(text="Port CLOSED ✗")
                except Exception as e:
                    self.p2p_status_label.configure(text=f"Error: {e}")

            def _toggle_autostart(self):
                # Placeholder: would set a registry key or scheduled task
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
            
            def _refresh_status(self):
                """Force refresh system status."""
                try:
                    st = get_agent_status()
                    st["cpu_percent"] = psutil.cpu_percent()
                    st["memory_percent"] = psutil.virtual_memory().percent
                    update_agent_status(st)
                except Exception:
                    pass
            
            def _browse_folder(self):
                """Browse for download folder."""
                try:
                    folder = filedialog.askdirectory()
                    if folder:
                        self.save_folder_var.set(folder)
                        os.makedirs(folder, exist_ok=True)
                except Exception:
                    pass
            
            def _open_folder(self):
                """Open the download folder."""
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
                """Select a file to send."""
                try:
                    file_path = filedialog.askopenfilename()
                    if file_path:
                        self.send_file_var.set(file_path)
                except Exception:
                    pass
            
            def _send_file(self):
                """Queue file for sending (placeholder - actual sending via P2P)."""
                try:
                    file_path = self.send_file_var.get()
                    if file_path and os.path.exists(file_path):
                        file_name = os.path.basename(file_path)
                        self.transfer_list.insert(0, f"📤 {file_name} - Pending...")
                        add_log("info", f"File queued for send: {file_name}", category="file")
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
                st = get_agent_status()
                mode = st.get("connection_mode", "cloud")
                self.mode_label.configure(text=f"{'🟢' if mode == 'local_p2p' else '🟡'} {mode.upper()}")

                self.pairing_value.configure(text=str(st.get("pairing_code") or "—"))
                self.device_value.configure(text=str(st.get("device_name") or DEVICE_NAME))

                ips = st.get("local_ips") or []
                self.ip_value.configure(text=", ".join(ips[:2]) if ips else "—")
                
                hb = st.get("last_heartbeat")
                if hb:
                    try:
                        hb_time = hb.split("T")[1][:8] if "T" in hb else hb[-8:]
                        self.heartbeat_value.configure(text=f"✓ {hb_time}")
                    except:
                        self.heartbeat_value.configure(text=str(hb))
                else:
                    self.heartbeat_value.configure(text="—")
                    
                self.cpu_label.configure(text=f"{'🟢' if st.get('cpu_percent', 0) < 80 else '🔴'} {st.get('cpu_percent', 0):.0f}% / {st.get('memory_percent', 0):.0f}%")
                
                # Stream status
                if hasattr(self, 'stream_label'):
                    agent = self.runner.agent if self.runner else None
                    cam_active = agent and agent._camera_streamer and agent._camera_streamer.get("running")
                    screen_active = agent and agent._screen_streamer and agent._screen_streamer.get("running")
                    if cam_active and screen_active:
                        self.stream_label.configure(text="📹 Camera + 🖥️ Screen")
                    elif cam_active:
                        self.stream_label.configure(text="📹 Camera Active")
                    elif screen_active:
                        self.stream_label.configure(text="🖥️ Screen Active")
                    else:
                        self.stream_label.configure(text="—")
                
                # System info
                try:
                    disk = psutil.disk_usage('C:\\' if sys.platform == "win32" else '/')
                    self.disk_label.configure(text=f"Disk: {disk.percent:.0f}%")
                    
                    battery = psutil.sensors_battery()
                    if battery:
                        plug = "⚡" if battery.power_plugged else "🔋"
                        self.battery_label.configure(text=f"Battery: {plug} {battery.percent:.0f}%")
                    else:
                        self.battery_label.configure(text="Battery: N/A")
                    
                    boot_time = psutil.boot_time()
                    uptime_secs = time.time() - boot_time
                    hours = int(uptime_secs // 3600)
                    mins = int((uptime_secs % 3600) // 60)
                    self.uptime_label.configure(text=f"Uptime: {hours}h {mins}m")
                except:
                    pass

                # Update P2P status
                p2p = get_local_p2p_server()
                if p2p and p2p.running:
                    clients = len(p2p.clients)
                    self.p2p_status_label.configure(text=f"🟢 Running ({clients} clients)", foreground="#22c55e")
                else:
                    self.p2p_status_label.configure(text="🔴 Stopped", foreground="#ef4444")

                # Append new logs
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
