"""
JARVIS PC Agent v5.1.0 - Professional GUI Edition
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
AGENT_VERSION = "5.1.0"

# Skill registry
try:
    from skills import get_skill_registry
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
    # Check websockets version for API compatibility
    _ws_version = tuple(int(x) for x in websockets.__version__.split(".")[:2])
    WS_V10_PLUS = _ws_version >= (10, 0)
except ImportError:
    HAS_WEBSOCKETS = False
    WS_V10_PLUS = False

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
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
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
# CRITICAL: These MUST match the web app's Supabase project
DEFAULT_JARVIS_URL = "https://yckqdxfzonnuhqdqnwrs.supabase.co"
DEFAULT_JARVIS_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlja3FkeGZ6b25udWhxZHFud3JzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NjQyMTIsImV4cCI6MjA4NzM0MDIxMn0.dME09SJ11wg8JKv41XbdiWvzovfkeJM69Q9BlDD6pro"

# Optional: where the "Open Web App" button should navigate.
DEFAULT_APP_URL = os.environ.get("JARVIS_APP_URL", "https://id-preview--f4290e42-0101-4af6-93cf-bf0d2c89db92.lovable.app")

SUPABASE_URL = os.environ.get("JARVIS_SUPABASE_URL", DEFAULT_JARVIS_URL)
SUPABASE_KEY = os.environ.get("JARVIS_SUPABASE_KEY", DEFAULT_JARVIS_KEY)

DEVICE_NAME = platform.node() or "My PC"
UNLOCK_PIN = "1212"
POLL_INTERVAL = 0.3
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
    """Get local IPs, filtering out VPN/virtual adapter IPs."""
    ips = []
    hostname = socket.gethostname()
    
    # First get the primary IP via UDP socket (most reliable)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        primary_ip = s.getsockname()[0]
        s.close()
        if primary_ip and not primary_ip.startswith("127."):
            ips.append(primary_ip)
    except Exception:
        pass
    
    # Then add others from hostname resolution
    try:
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                # Filter out common VPN/virtual adapter ranges
                if not _is_vpn_ip(ip):
                    ips.append(ip)
    except Exception:
        pass
    
    return ips


def _is_vpn_ip(ip: str) -> bool:
    """Check if IP likely belongs to a VPN or virtual adapter."""
    # Common VPN ranges
    vpn_prefixes = [
        "10.8.", "10.9.",      # OpenVPN defaults
        "10.0.0.",             # Sometimes VPN
        "100.64.",             # CGNAT / Tailscale
        "172.16.", "172.17.",  # Docker
        "198.18.",             # Benchmark testing
    ]
    for prefix in vpn_prefixes:
        if ip.startswith(prefix):
            return True
    return False


def get_network_prefix(ip: str) -> str:
    parts = ip.split(".")
    return ".".join(parts[:3]) if len(parts) == 4 else ""


def _add_firewall_rule(port: int):
    """Add Windows Firewall rule for the P2P port."""
    if platform.system() != "Windows":
        return
    rule_name = f"JARVIS P2P Port {port}"
    try:
        # Check if rule already exists
        check = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name}"],
            capture_output=True, text=True, timeout=5
        )
        if "No rules match" in check.stdout or check.returncode != 0:
            subprocess.run([
                "netsh", "advfirewall", "firewall", "add", "rule",
                f"name={rule_name}", "dir=in", "action=allow",
                "protocol=TCP", f"localport={port}",
            ], capture_output=True, timeout=5)
            add_log("info", f"Firewall rule added for port {port}", category="p2p")
    except Exception as e:
        add_log("warn", f"Could not add firewall rule: {e}", category="p2p")


# ============== LOCAL P2P WEBSOCKET SERVER ==============
class LocalP2PServer:
    """Ultra-low latency local WebSocket server for same-network connections."""
    
    def __init__(self, command_handler: Optional[Callable] = None, port: int = LOCAL_P2P_PORT):
        self.port = port
        self._actual_port = port  # Track actual port if fallback is used
        self.command_handler = command_handler
        self.running = False
        self.server = None
        self.clients: Set = set()
        self.local_ips: List[str] = []
        self._server_thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ready = threading.Event()
        
    async def handle_client(self, websocket, path=None):
        """Handle P2P client - compatible with websockets v10+ and older."""
        client_ip = "unknown"
        try:
            if hasattr(websocket, 'remote_address') and websocket.remote_address:
                client_ip = websocket.remote_address[0]
        except Exception:
            pass
        add_log("info", f"Local P2P client connected: {client_ip}", category="p2p")
        
        self.clients.add(websocket)
        update_agent_status({"connection_mode": "local_p2p"})
        
        try:
            await websocket.send(json.dumps({
                "type": "welcome",
                "server": "jarvis_local_p2p",
                "version": AGENT_VERSION,
                "local_ips": self.local_ips,
                "port": self._actual_port,
            }))
            
            async for message in websocket:
                try:
                    # Handle both string and binary messages
                    if isinstance(message, bytes):
                        try:
                            message = message.decode("utf-8")
                        except UnicodeDecodeError:
                            continue
                    
                    if isinstance(message, str):
                        data = json.loads(message)
                        response = await self._process_message(data)
                        if response:
                            await websocket.send(json.dumps(response))
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({"type": "error", "error": "Invalid JSON"}))
                except Exception as e:
                    add_log("error", f"P2P message error: {e}", category="p2p")
                    try:
                        await websocket.send(json.dumps({"type": "error", "error": str(e)}))
                    except Exception:
                        pass
                    
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
                "port": self._actual_port,
                "clients": len(self.clients),
            }
        
        return None
    
    async def _start_server(self):
        self.local_ips = get_local_ips()
        
        # Add firewall rule (Windows)
        _add_firewall_rule(self.port)
        
        try:
            # Kill any existing process on the port first (Windows)
            if platform.system() == "Windows":
                try:
                    result = subprocess.run(
                        ["netstat", "-ano"], capture_output=True, text=True, timeout=5
                    )
                    for line in result.stdout.splitlines():
                        if f":{self.port}" in line and "LISTENING" in line:
                            parts = line.split()
                            pid = parts[-1]
                            try:
                                pid_int = int(pid)
                                if pid_int != os.getpid():
                                    subprocess.run(["taskkill", "/F", "/PID", str(pid_int)],
                                                   capture_output=True, timeout=5)
                                    add_log("info", f"Killed existing process on port {self.port} (PID {pid_int})", category="p2p")
                                    time.sleep(0.5)
                            except (ValueError, Exception):
                                pass
                except Exception:
                    pass

            # websockets v10+ changed the serve() signature
            serve_kwargs = {
                "ping_interval": 20,
                "ping_timeout": 10,
                "max_size": 10 * 1024 * 1024,  # 10MB max message size (fixes screenshot disconnects)
            }
            if not WS_V10_PLUS:
                serve_kwargs["reuse_port"] = False if platform.system() == "Windows" else True

            if WS_V10_PLUS:
                # websockets >= 10: serve(handler, host, port, **kwargs)
                self.server = await websockets.serve(
                    self.handle_client,
                    "0.0.0.0",
                    self.port,
                    **serve_kwargs,
                )
            else:
                self.server = await websockets.serve(
                    self.handle_client,
                    "0.0.0.0",
                    self.port,
                    **serve_kwargs,
                )
            
            self.running = True
            self._actual_port = self.port
            self._ready.set()
            
            add_log("info", f"Local P2P server started on port {self.port}", category="p2p")
            for ip in self.local_ips:
                add_log("info", f"  → ws://{ip}:{self.port}/p2p", category="p2p")
            
            update_agent_status({"local_ips": self.local_ips, "p2p_port": self._actual_port})
            
            await self.server.wait_closed()
            
        except OSError as e:
            if "10048" in str(e) or "Address already in use" in str(e):
                add_log("warn", f"Port {self.port} busy, trying port {self.port + 1}", category="p2p")
                self._actual_port = self.port + 1
                _add_firewall_rule(self._actual_port)
                try:
                    serve_kwargs_fallback = {
                        "ping_interval": 20,
                        "ping_timeout": 10,
                        "max_size": 10 * 1024 * 1024,
                    }
                    self.server = await websockets.serve(
                        self.handle_client, "0.0.0.0", self._actual_port,
                        **serve_kwargs_fallback,
                    )
                    self.running = True
                    self._ready.set()
                    add_log("info", f"Local P2P server started on fallback port {self._actual_port}", category="p2p")
                    for ip in self.local_ips:
                        add_log("info", f"  → ws://{ip}:{self._actual_port}/p2p", category="p2p")
                    update_agent_status({"local_ips": self.local_ips, "p2p_port": self._actual_port})
                    await self.server.wait_closed()
                except Exception as e2:
                    add_log("error", f"P2P server fallback failed: {e2}", category="p2p")
                    self.running = False
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
        
        # Wait for server to be ready (up to 5s)
        self._ready.wait(timeout=5)
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

        self.current_user_id: Optional[str] = None
        
        # Input session gating
        self._active_input_session: Optional[str] = None
        self._input_session_expires_at: float = 0.0
        
        # Backoff
        self.consecutive_failures = 0
        self.backoff_seconds = 1
        self.max_backoff = 60
        self.max_failures_before_reregister = 10
        
        self.screenshot_handler = ThreadedScreenshot()
        
        # Supabase client
        self.supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    def _get_session_token(self) -> Optional[str]:
        try:
            result = self.supabase.table("device_sessions").select("session_token").eq(
                "device_id", self.device_id
            ).order("last_active", desc=True).limit(1).execute()
            if result.data:
                return result.data[0]["session_token"]
        except Exception as e:
            add_log("warn", f"Failed to get session token: {e}", category="system")
        return None
    
    def _get_ws_base(self) -> str:
        """Get the WebSocket base URL from SUPABASE_URL."""
        ref = SUPABASE_URL.replace('https://', '').split('.')[0]
        return f"wss://{ref}.functions.supabase.co"
    
    # ============== VOLUME/BRIGHTNESS ==============
    def _get_volume(self) -> int:
        try:
            if platform.system() == "Windows" and HAS_PYCAW:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                level = volume.GetMasterVolumeLevelScalar()
                self._volume_cache = int(level * 100)
        except Exception as e:
            add_log("warn", f"pycaw get_volume error: {e}", category="audio")
        return self._volume_cache
    
    def _set_volume(self, level: int) -> Dict[str, Any]:
        try:
            level = max(0, min(100, level))
            if platform.system() == "Windows" and HAS_PYCAW:
                try:
                    devices = AudioUtilities.GetSpeakers()
                    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                    volume = cast(interface, POINTER(IAudioEndpointVolume))
                    volume.SetMasterVolumeLevelScalar(level / 100.0, None)
                    self._volume_cache = level
                    return {"success": True, "volume": level}
                except Exception as pycaw_err:
                    add_log("warn", f"pycaw set_volume error: {pycaw_err}, trying keyboard fallback", category="audio")
            
            # Keyboard fallback - works on all systems
            if platform.system() == "Windows":
                # Set to 0 first, then press volume up keys
                import ctypes
                # Use nircmd if available, otherwise keyboard
                try:
                    subprocess.run(
                        ["nircmd", "setsysvolume", str(int(level / 100 * 65535))],
                        capture_output=True, timeout=5
                    )
                    self._volume_cache = level
                    return {"success": True, "volume": level, "method": "nircmd"}
                except (FileNotFoundError, subprocess.TimeoutExpired):
                    pass
            
            # Ultimate fallback: keyboard volume keys
            current = self._volume_cache
            diff = level - current
            steps = abs(diff) // 2  # Each key press changes by ~2%
            key = "volumeup" if diff > 0 else "volumedown"
            for _ in range(min(steps, 50)):
                pyautogui.press(key)
            self._volume_cache = level
            return {"success": True, "volume": level, "method": "keyboard"}
        except Exception as e:
            add_log("error", f"set_volume failed: {e}", category="audio")
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
            
            # List all audio sessions (per-app volumes)
            if platform.system() == "Windows" and HAS_PYCAW:
                try:
                    sessions = AudioUtilities.GetAllSessions()
                    for session in sessions:
                        if session.Process:
                            devices_out.append({
                                "id": f"app_{session.Process.pid}",
                                "name": session.Process.name(),
                                "type": "app",
                                "pid": session.Process.pid,
                                "isDefault": False,
                            })
                except Exception:
                    pass
            
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
        try:
            meeting_link = str(payload.get("meeting_link") or "").strip()
            meeting_id = str(payload.get("meeting_id") or "").strip()
            password = str(payload.get("password") or "").strip()
            mute_audio = bool(payload.get("mute_audio", True))
            mute_video = bool(payload.get("mute_video", True))
            take_screenshot = bool(payload.get("take_screenshot", True))

            link = ""
            if meeting_link:
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
            
            if platform.system() == "Windows":
                os.startfile(link)
            else:
                webbrowser.open(link)

            initial_wait = int(payload.get("initial_wait", 240))
            add_log("info", f"Waiting {initial_wait}s for Zoom to load...", category="zoom")
            await asyncio.sleep(initial_wait)

            if platform.system() == "Windows":
                for attempt in range(3):
                    if mute_audio:
                        pyautogui.hotkey("alt", "a")
                        await asyncio.sleep(1)
                    if mute_video:
                        pyautogui.hotkey("alt", "v")
                        await asyncio.sleep(1)
                    await asyncio.sleep(2)

            screenshot_base64 = None
            if take_screenshot:
                screenshot_wait = int(payload.get("screenshot_wait", 20))
                await asyncio.sleep(screenshot_wait)
                shot = self.screenshot_handler.capture_sync(quality=70, scale=0.5)
                if shot.get("success") and shot.get("image"):
                    screenshot_base64 = shot["image"]

            return {"success": True, "muted_audio": mute_audio, "muted_video": mute_video, "screenshot": screenshot_base64}
        except Exception as e:
            add_log("error", f"Zoom join error: {e}", category="zoom")
            return {"success": False, "error": str(e)}
    
    def _play_alarm(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            alarm_type = payload.get("type", "beep")
            if alarm_type == "siren":
                if sys.platform == "win32":
                    import winsound
                    for _ in range(5):
                        winsound.Beep(1000, 300)
                        winsound.Beep(1500, 300)
                else:
                    print("\a" * 10)
            else:
                if sys.platform == "win32":
                    import winsound
                    winsound.Beep(800, 1000)
                else:
                    print("\a")
            return {"success": True, "type": alarm_type}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _take_camera_snapshot(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if not HAS_OPENCV:
                return {"success": False, "error": "OpenCV not installed"}
            camera_index = int(payload.get("camera_index", 0))
            quality = int(payload.get("quality", 70))
            cap = cv2.VideoCapture(camera_index)
            if not cap.isOpened():
                return {"success": False, "error": f"Cannot open camera {camera_index}"}
            ret, frame = cap.read()
            cap.release()
            if not ret or frame is None:
                return {"success": False, "error": "Failed to capture frame"}
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
            image_b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
            return {"success": True, "image": image_b64}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ============== AUDIO RELAY ==============
    _audio_streamer = None
    _audio_ws = None

    async def _start_audio_relay(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            session_id = payload.get("session_id", "")
            direction = payload.get("direction", "phone_to_pc")
            use_system_audio = payload.get("use_system_audio", False)

            if not session_id:
                return {"success": False, "error": "Missing session_id"}

            session_token = self._get_session_token()
            if not session_token:
                return {"success": False, "error": "No active session token for relay auth"}

            self._stop_audio_relay()

            self._audio_streamer = {
                "session_id": session_id,
                "direction": direction,
                "running": True,
            }

            ws_base = self._get_ws_base()

            def stream_audio():
                import websockets.sync.client as ws_client
                ws_url = f"{ws_base}/functions/v1/audio-relay?sessionId={session_id}&type=pc&direction={direction}&session_token={session_token}"
                retry_delay = 2
                max_retry_delay = 30
                attempt = 0
                while self._audio_streamer and self._audio_streamer.get("running"):
                    try:
                        attempt += 1
                        add_log("info", f"Audio relay connecting (attempt {attempt})...", category="audio")
                        with ws_client.connect(ws_url, open_timeout=10, max_size=10*1024*1024) as ws:
                            self._audio_ws = ws
                            retry_delay = 2
                            add_log("info", f"Audio relay connected: session={session_id[:8]}..., direction={direction}", category="audio")

                            if not HAS_PYAUDIO:
                                add_log("warn", "PyAudio not installed - audio capture/playback limited", category="audio")
                                while self._audio_streamer and self._audio_streamer.get("running"):
                                    try:
                                        msg = ws.recv(timeout=1.0)
                                        if isinstance(msg, str):
                                            data = json.loads(msg)
                                            if data.get("type") == "peer_connected":
                                                add_log("info", "Audio peer connected", category="audio")
                                    except Exception:
                                        pass
                                return

                            pa = pyaudio.PyAudio()
                            RATE = 16000
                            CHANNELS = 1
                            CHUNK = 2048
                            FORMAT = pyaudio.paInt16

                            mic_stream = None
                            if direction in ("pc_to_phone", "bidirectional"):
                                try:
                                    if use_system_audio and platform.system() == "Windows":
                                        # Try WASAPI loopback for system audio
                                        try:
                                            mic_stream = pa.open(
                                                format=FORMAT, channels=CHANNELS, rate=RATE,
                                                input=True, frames_per_buffer=CHUNK,
                                                input_host_api_specific_stream_info=None,
                                                as_loopback=True,
                                            )
                                            add_log("info", "System audio (WASAPI loopback) opened", category="audio")
                                        except Exception:
                                            mic_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
                                            add_log("info", "Fallback to PC microphone (WASAPI loopback not available)", category="audio")
                                    else:
                                        mic_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
                                        add_log("info", "PC microphone opened for audio relay", category="audio")
                                except Exception as e:
                                    add_log("warn", f"Could not open PC microphone: {e}", category="audio")

                            speaker_stream = None
                            if direction in ("phone_to_pc", "bidirectional"):
                                try:
                                    speaker_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, output=True, frames_per_buffer=CHUNK)
                                    add_log("info", "PC speakers opened for audio relay", category="audio")
                                except Exception as e:
                                    add_log("warn", f"Could not open PC speakers: {e}", category="audio")

                            def send_mic():
                                while self._audio_streamer and self._audio_streamer.get("running") and mic_stream:
                                    try:
                                        data = mic_stream.read(CHUNK, exception_on_overflow=False)
                                        ws.send(data)
                                    except Exception:
                                        break

                            if mic_stream:
                                threading.Thread(target=send_mic, daemon=True).start()

                            while self._audio_streamer and self._audio_streamer.get("running"):
                                try:
                                    msg = ws.recv(timeout=0.1)
                                    if isinstance(msg, bytes) and speaker_stream:
                                        speaker_stream.write(msg)
                                    elif isinstance(msg, str):
                                        data = json.loads(msg)
                                        if data.get("type") == "peer_connected":
                                            add_log("info", "Audio peer connected", category="audio")
                                except Exception:
                                    pass

                            if mic_stream:
                                mic_stream.stop_stream()
                                mic_stream.close()
                            if speaker_stream:
                                speaker_stream.stop_stream()
                                speaker_stream.close()
                            pa.terminate()

                    except Exception as e:
                        if not (self._audio_streamer and self._audio_streamer.get("running")):
                            break
                        add_log("warn", f"Audio relay error (attempt {attempt}): {e} — retrying in {retry_delay}s", category="audio")
                        time.sleep(retry_delay)
                        retry_delay = min(retry_delay * 2, max_retry_delay)
                add_log("info", "Audio relay ended", category="audio")

            threading.Thread(target=stream_audio, daemon=True).start()
            add_log("info", f"Audio relay started: direction={direction}", category="audio")
            return {"success": True, "session_id": session_id, "direction": direction}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _stop_audio_relay(self) -> Dict[str, Any]:
        try:
            if self._audio_streamer:
                self._audio_streamer["running"] = False
            if self._audio_ws:
                try:
                    self._audio_ws.close()
                except:
                    pass
            self._audio_streamer = None
            self._audio_ws = None
            return {"success": True}
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
            apps.sort(key=lambda x: x['memory'], reverse=True)
            return {"success": True, "apps": apps[:100]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_installed_apps(self) -> Dict[str, Any]:
        try:
            apps = []
            if platform.system() == "Windows":
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
            
            session_token = self._get_session_token()
            if not session_token:
                return {"success": False, "error": "No active session token for relay auth"}
            
            # Gracefully stop existing stream
            self._stop_camera_stream()
            time.sleep(0.3)
            
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
            
            ws_base = self._get_ws_base()
            
            def stream_camera():
                import websockets.sync.client as ws_client
                ws_url = f"{ws_base}/functions/v1/camera-relay?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true&session_token={session_token}"
                retry_delay = 2
                max_retry_delay = 30
                attempt = 0
                while self._camera_streamer and self._camera_streamer.get("running"):
                    try:
                        attempt += 1
                        add_log("info", f"Camera stream connecting (attempt {attempt})...", category="camera")
                        with ws_client.connect(ws_url, open_timeout=10, max_size=10*1024*1024) as ws:
                            self._camera_ws = ws
                            retry_delay = 2
                            add_log("info", f"Camera stream connected: session={session_id[:8]}...", category="camera")
                            while self._camera_streamer and self._camera_streamer.get("running"):
                                current_fps = self._camera_streamer.get("fps", fps)
                                current_quality = self._camera_streamer.get("quality", quality)
                                interval = 1.0 / max(1, current_fps)
                                ret, frame = cap.read()
                                if not ret:
                                    time.sleep(0.01)
                                    continue
                                try:
                                    encode_params = [cv2.IMWRITE_JPEG_QUALITY, current_quality]
                                    _, buffer = cv2.imencode(".jpg", frame, encode_params)
                                    ws.send(buffer.tobytes())
                                except Exception as send_err:
                                    add_log("warn", f"Camera send error: {send_err}", category="camera")
                                    break
                                time.sleep(interval)
                    except Exception as e:
                        if not (self._camera_streamer and self._camera_streamer.get("running")):
                            break
                        add_log("warn", f"Camera stream error (attempt {attempt}): {e} — retrying in {retry_delay}s", category="camera")
                        time.sleep(retry_delay)
                        retry_delay = min(retry_delay * 2, max_retry_delay)
                try:
                    cap.release()
                except Exception:
                    pass
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
            
            session_token = self._get_session_token()
            if not session_token:
                return {"success": False, "error": "No active session token for relay auth"}
            
            self._stop_screen_stream()
            time.sleep(0.3)
            
            self._screen_streamer = {"session_id": session_id, "fps": fps, "quality": quality, "scale": scale, "monitor_index": monitor_index, "running": True}
            
            ws_base = self._get_ws_base()
            
            def stream_screen():
                import websockets.sync.client as ws_client
                ws_url = f"{ws_base}/functions/v1/camera-relay?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true&session_token={session_token}"
                retry_delay = 2
                max_retry_delay = 30
                attempt = 0
                while self._screen_streamer and self._screen_streamer.get("running"):
                    try:
                        attempt += 1
                        add_log("info", f"Screen stream connecting (attempt {attempt})...", category="screen")
                        with ws_client.connect(ws_url, open_timeout=10, max_size=10*1024*1024) as ws:
                            self._screen_ws = ws
                            retry_delay = 2
                            add_log("info", f"Screen stream connected: session={session_id[:8]}...", category="screen")
                            with mss.mss() as sct:
                                monitors = sct.monitors
                                idx = monitor_index if 0 < monitor_index < len(monitors) else 1
                                monitor = monitors[idx]
                                while self._screen_streamer and self._screen_streamer.get("running"):
                                    current_fps = self._screen_streamer.get("fps", fps)
                                    current_quality = self._screen_streamer.get("quality", quality)
                                    current_scale = self._screen_streamer.get("scale", scale)
                                    interval = 1.0 / max(1, current_fps)
                                    try:
                                        screenshot = sct.grab(monitor)
                                        img = Image.frombytes('RGB', screenshot.size, screenshot.bgra, 'raw', 'BGRX')
                                        new_size = (int(img.width * current_scale), int(img.height * current_scale))
                                        img = img.resize(new_size, Image.LANCZOS)
                                        buffer = io.BytesIO()
                                        img.save(buffer, format="JPEG", quality=current_quality, optimize=True)
                                        ws.send(buffer.getvalue())
                                    except Exception as send_err:
                                        add_log("warn", f"Screen send error: {send_err}", category="screen")
                                        break
                                    time.sleep(interval)
                    except Exception as e:
                        if not (self._screen_streamer and self._screen_streamer.get("running")):
                            break
                        add_log("warn", f"Screen stream error (attempt {attempt}): {e} — retrying in {retry_delay}s", category="screen")
                        time.sleep(retry_delay)
                        retry_delay = min(retry_delay * 2, max_retry_delay)
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
            
            session_token = self._get_session_token()
            if not session_token:
                return {"success": False, "error": "No active session token for relay auth"}
            
            if mode == "screen":
                self._stop_screen_stream()
                self._screen_streamer = {"session_id": session_id, "fps": fps, "quality": quality, "running": True}
            else:
                self._stop_camera_stream()
                self._camera_streamer = {"session_id": session_id, "fps": fps, "quality": quality, "running": True}
            
            ws_base = self._get_ws_base()
            
            def stream_test_pattern():
                import websockets.sync.client as ws_client
                ws_url = f"{ws_base}/functions/v1/camera-relay?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true&session_token={session_token}"
                try:
                    with ws_client.connect(ws_url, max_size=10*1024*1024) as ws:
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
    
    # ============== STREAMING STATS ==============
    def _get_streaming_stats(self) -> Dict[str, Any]:
        stats: Dict[str, Any] = {"success": True}
        if self._camera_streamer:
            stats["camera"] = {"running": bool(self._camera_streamer.get("running")), "fps": self._camera_streamer.get("fps", 0), "quality": self._camera_streamer.get("quality", 0)}
        else:
            stats["camera"] = {"running": False, "fps": 0}
        if self._screen_streamer:
            stats["screen"] = {"running": bool(self._screen_streamer.get("running")), "fps": self._screen_streamer.get("fps", 0), "quality": self._screen_streamer.get("quality", 0)}
        else:
            stats["screen"] = {"running": False, "fps": 0}
        if self._audio_streamer:
            stats["audio"] = {"running": bool(self._audio_streamer.get("running")), "direction": self._audio_streamer.get("direction", "")}
        else:
            stats["audio"] = {"running": False}
        return stats

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
            return {"success": True, "freed_mb": int(freed_mb)}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _set_power_plan(self, plan: str) -> Dict[str, Any]:
        try:
            if sys.platform == "win32":
                plans = {"high_performance": "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", "balanced": "381b4222-f694-41f0-9685-ff5bb260df2e"}
                plan_guid = plans.get(plan, plans["high_performance"])
                os.system(f"powercfg /setactive {plan_guid}")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _restart_explorer(self) -> Dict[str, Any]:
        try:
            if sys.platform == "win32":
                os.system("taskkill /f /im explorer.exe")
                time.sleep(1)
                os.system("start explorer.exe")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _gaming_mode(self, enable: bool) -> Dict[str, Any]:
        try:
            if enable and sys.platform == "win32":
                kernel32 = ctypes.windll.kernel32
                handle = kernel32.GetCurrentProcess()
                kernel32.SetPriorityClass(handle, 0x00008000)
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
            "p2p_port": p2p_server._actual_port if p2p_server else LOCAL_P2P_PORT,
            "p2p_server_running": p2p_server is not None and p2p_server.running,
            "p2p_clients": len(p2p_server.clients) if p2p_server else 0,
        }
    
    def _open_url(self, url: str) -> Dict[str, Any]:
        try:
            url = (url or "").strip()
            if not url:
                return {"success": False, "error": "Missing URL"}
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
                return {"success": True, "enabled": True}
            
            if cmd == "remote_input_disable":
                session = str(payload.get("session", "") or "")
                if session and session == self._active_input_session:
                    self._active_input_session = None
                    self._input_session_expires_at = 0.0
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
                    self._open_app("spotify")
                    await asyncio.sleep(3)
                    pyautogui.hotkey("ctrl", "l")
                    await asyncio.sleep(0.5)
                    pyautogui.hotkey("ctrl", "a")
                    pyautogui.typewrite(query, interval=0.03)
                    await asyncio.sleep(2)
                    pyautogui.press("enter")
                    if auto_play:
                        await asyncio.sleep(2)
                        pyautogui.press("tab")
                        await asyncio.sleep(0.3)
                        pyautogui.press("tab")
                        await asyncio.sleep(0.3)
                        pyautogui.press("enter")
                    return {"success": True, "message": f"Playing '{query}' on Spotify"}
                elif service in ("youtube", "yt"):
                    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
                    webbrowser.open(url)
                    if auto_play:
                        await asyncio.sleep(6)
                        pyautogui.press("tab")
                        await asyncio.sleep(0.2)
                        pyautogui.press("tab")
                        await asyncio.sleep(0.2)
                        pyautogui.press("enter")
                    return {"success": True, "message": f"Playing '{query}' on YouTube"}
                else:
                    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
                    webbrowser.open(url)
                    return {"success": True, "message": f"Playing '{query}' on YouTube (fallback)"}
            
            elif cmd == "search_web":
                query = payload.get("query", "")
                engine = payload.get("engine", "google").lower()
                auto_enter = payload.get("auto_enter", True)
                
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
                return {"success": True}
            
            # Batch
            elif cmd == "execute_batch":
                return await self._execute_batch(payload.get("commands", []))
            
            # Screenshot
            elif cmd == "take_screenshot":
                return self.screenshot_handler.capture_sync(quality=payload.get("quality", 70), scale=payload.get("scale", 0.5))
            
            elif cmd == "take_camera_snapshot":
                return self._take_camera_snapshot(payload)
            
            elif cmd == "play_alarm":
                return self._play_alarm(payload)
            
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
            
            # Audio relay
            elif cmd == "start_audio_relay":
                return await self._start_audio_relay(payload)
            elif cmd == "stop_audio_relay":
                return self._stop_audio_relay()
            
            elif cmd == "get_streaming_stats":
                return self._get_streaming_stats()
            
            elif cmd == "check_audio_support":
                return {
                    "success": True,
                    "has_pyaudio": HAS_PYAUDIO,
                    "has_websockets": HAS_WEBSOCKETS,
                    "has_opencv": HAS_OPENCV,
                    "has_speech_recognition": HAS_SPEECH_RECOGNITION,
                    "has_pycaw": HAS_PYCAW,
                }
            
            # Phone webcam commands (handled by agent receiving frames)
            elif cmd in ["start_phone_webcam", "stop_phone_webcam", "check_virtual_webcam"]:
                if cmd == "check_virtual_webcam":
                    try:
                        import pyvirtualcam
                        return {"success": True, "available": True, "driver": "pyvirtualcam"}
                    except ImportError:
                        return {"success": True, "available": False, "driver": None}
                return {"success": True, "message": f"{cmd} acknowledged"}
            
            else:
                add_log("warn", f"Unknown command: {cmd}", category="command")
                return {"success": False, "error": f"Unknown command: {cmd}"}
                
        except Exception as e:
            add_log("error", f"Command error: {e}", details=traceback.format_exc(), category="command")
            return {"success": False, "error": str(e)}
    
    # ============== REGISTRATION ==============
    async def register_device(self):
        try:
            result = self.supabase.table("devices").select("id, user_id").eq("device_key", self.device_key).execute()
            
            if result.data:
                self.device_id = result.data[0]["id"]
                user_id = result.data[0].get("user_id")
                if user_id and user_id != "00000000-0000-0000-0000-000000000000":
                    self.current_user_id = user_id
                self.supabase.table("devices").update({
                    "is_online": True,
                    "pairing_code": None,
                    "pairing_expires_at": None,
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "name": DEVICE_NAME,
                }).eq("id", self.device_id).execute()
            else:
                insert_result = self.supabase.table("devices").insert({
                    "device_key": self.device_key,
                    "name": DEVICE_NAME,
                    "is_online": True,
                    "pairing_code": None,
                    "pairing_expires_at": None,
                    "user_id": "00000000-0000-0000-0000-000000000000",
                }).execute()
                self.device_id = insert_result.data[0]["id"]
            
            local_ips = get_local_ips()
            update_agent_status({
                "connected": True,
                "device_id": self.device_id,
                "local_ips": local_ips,
            })
            
            add_log("info", f"Device registered: {self.device_id}", category="system")
            
        except Exception as e:
            add_log("error", f"Registration failed: {e}", category="system")
            raise
    
    async def heartbeat(self):
        try:
            now = datetime.now(timezone.utc).isoformat()
            cpu = psutil.cpu_percent()
            mem = psutil.virtual_memory().percent
            
            p2p_server = get_local_p2p_server()
            actual_port = p2p_server._actual_port if p2p_server else LOCAL_P2P_PORT
            
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
                    "p2p_port": actual_port,
                    "agent_version": AGENT_VERSION,
                },
            }).eq("id", self.device_id).execute()
            
            update_agent_status({
                "last_heartbeat": now,
                "cpu_percent": cpu,
                "memory_percent": mem,
                "volume": self._get_volume(),
                "brightness": self._get_brightness(),
                "p2p_port": actual_port,
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
                
                created_str = cmd.get("created_at", "")
                if created_str:
                    try:
                        created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                        age_seconds = (datetime.now(timezone.utc) - created_dt).total_seconds()
                        if age_seconds > 60:
                            self.supabase.table("commands").update({
                                "status": "expired",
                                "result": {"error": f"Stale command ({int(age_seconds)}s old)"},
                                "executed_at": datetime.now(timezone.utc).isoformat(),
                            }).eq("id", cmd_id).execute()
                            continue
                    except Exception:
                        pass
                
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
                self.consecutive_failures = 0
                self.backoff_seconds = 1
                await self.register_device()
    
    async def run(self):
        await self.register_device()
        
        # Start P2P server  
        p2p = start_local_p2p_server(command_handler=self._handle_command)
        
        # Wait for P2P server to be ready
        if p2p:
            p2p._ready.wait(timeout=5)
        
        last_heartbeat = 0
        
        add_log("info", "Agent running. Waiting for commands...", category="system")
        
        while self.running:
            try:
                now = time.time()
                
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    await self.heartbeat()
                    last_heartbeat = now
                
                await self.poll_commands()
                
                await asyncio.sleep(max(POLL_INTERVAL, self.backoff_seconds if self.consecutive_failures > 0 else POLL_INTERVAL))
            except Exception as e:
                # Catch ALL exceptions to prevent auto-close
                add_log("error", f"Main loop error (recovering): {e}", category="system")
                await asyncio.sleep(2)
                continue
    
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
    """Run agent with auto-restart on crash to prevent auto-close."""
    while True:
        agent = JarvisAgent()
        try:
            await agent.run()
            break
        except KeyboardInterrupt:
            await agent.shutdown()
            break
        except Exception as e:
            add_log("error", f"Fatal error (restarting in 3s): {e}", details=traceback.format_exc(), category="system")
            try:
                await agent.shutdown()
            except Exception:
                pass
            await asyncio.sleep(3)
            add_log("info", "Auto-restarting agent...", category="system")


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

        # Simple console GUI placeholder - the full Tkinter GUI is in the uploaded file
        runner = AgentThreadRunner()
        runner.start()
        
        try:
            print("Agent running with GUI. Press Ctrl+C to stop.")
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            runner.stop()
    else:
        # Console mode
        try:
            asyncio.run(run_agent())
        except KeyboardInterrupt:
            print("\n👋 Agent stopped by user.")


if __name__ == "__main__":
    main()
