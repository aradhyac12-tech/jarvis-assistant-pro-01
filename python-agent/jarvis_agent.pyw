"""
JARVIS PC Agent - Python Client v3.0 (Full P2P + Windows Service Edition)
==========================================================================
Runs on your PC to execute commands from the Jarvis web dashboard.
Includes local P2P server for ultra-low latency on same network.

NEW IN v3.0:
- Integrated local P2P server (no separate file needed)
- Pairing code expiry countdown + auto-regeneration
- Connection recovery with exponential backoff
- Circular buffers for memory management
- Worker thread for screenshot encoding
- Proper error logging (no silent failures)
- Multi-command execution support
- Windows service bootstrap integration
- IP address display for P2P connection

SETUP INSTRUCTIONS:
------------------
1. Install Python 3.8+ from https://python.org
2. Install dependencies: python -m pip install -r requirements.txt
3. Run the agent: pythonw jarvis_agent.pyw (silent) or python jarvis_agent.pyw

For Windows Service auto-start:
- Run: python jarvis_service_installer.py install
- The agent will start automatically on boot
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
import concurrent.futures
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Callable, Set
import base64
import io
import uuid
import webbrowser
import urllib.parse

# Native GUI
try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext, filedialog
    HAS_TKINTER = True
except ImportError:
    HAS_TKINTER = False
    print("⚠️  tkinter not available - GUI disabled")


# ============== BOOTSTRAP (dependency check) ==============

def _requirements_path() -> str:
    return os.path.join(os.path.dirname(__file__), "requirements.txt")


def _check_dependencies() -> None:
    """Fail fast with clear instructions if dependencies are missing."""
    try:
        import supabase  # noqa: F401
        return
    except ImportError:
        req_path = _requirements_path()
        py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"

        print("\n❌ Missing Python packages (e.g. 'supabase').")
        print("\n✅ Fix (recommended):")
        print(f"   python -m pip install -r {req_path}")
        print("\n✅ Windows one-click:")
        print("   Double-click: run_agent_windows.bat")

        if sys.version_info >= (3, 13):
            print("\n⚠️  Your Python version is", py_ver)
            print("   Some packages may not support Python 3.13+ yet.")

        sys.exit(1)


_check_dependencies()


# Third-party imports
from supabase import create_client, Client
import pyautogui
from PIL import Image
import psutil

# Fast screenshot using mss
try:
    import mss
    HAS_MSS = True
except ImportError:
    HAS_MSS = False

# Optional imports for keyboard
try:
    import keyboard
    HAS_KEYBOARD = True
except ImportError:
    HAS_KEYBOARD = False

# Audio streaming
try:
    import pyaudio
    HAS_PYAUDIO = True
except ImportError:
    HAS_PYAUDIO = False

# Camera streaming
try:
    os.environ.setdefault("OPENCV_VIDEOIO_PRIORITY_OBSENSOR", "0")
    os.environ.setdefault("OPENCV_VIDEOIO_PRIORITY_INTEL_MFX", "0")
    os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

# WebSocket
try:
    import websockets
    from websockets.server import WebSocketServerProtocol
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

# Voice Recognition
try:
    import speech_recognition as sr
    HAS_SPEECH_RECOGNITION = True
except ImportError:
    HAS_SPEECH_RECOGNITION = False

# Text-to-Speech
try:
    import pyttsx3
    HAS_TTS = True
except ImportError:
    HAS_TTS = False

# System Tray
try:
    import pystray
    from pystray import MenuItem as item
    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False

# Windows Notifications
try:
    from win10toast_click import ToastNotifier
    HAS_TOAST = True
except ImportError:
    try:
        from win10toast import ToastNotifier
        HAS_TOAST = True
    except ImportError:
        HAS_TOAST = False

# Windows-specific imports
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


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="JARVIS PC Agent v3.0")
    p.add_argument("--url", help="Backend URL")
    p.add_argument("--key", help="Backend publishable key")
    p.add_argument("--no-self-test", action="store_true", help="Skip connectivity test")
    p.add_argument("--headless", action="store_true", help="Run without GUI")
    p.add_argument("--service", action="store_true", help="Running as Windows service")
    return p.parse_args()


def _config_path() -> str:
    return os.path.join(os.path.dirname(__file__), "jarvis_agent_config.json")


def _load_local_config() -> Dict[str, str]:
    try:
        with open(_config_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        return {k: str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except:
        return {}


def _normalize_url(raw: str) -> str:
    raw = (raw or "").strip().strip('"').strip("'")
    if not raw:
        return ""
    if not raw.startswith("http://") and not raw.startswith("https://"):
        raw = "https://" + raw
    return raw


ARGS = _parse_args()
LOCAL_CFG = _load_local_config()

SUPABASE_URL = _normalize_url(
    ARGS.url or os.environ.get("JARVIS_SUPABASE_URL") or LOCAL_CFG.get("JARVIS_SUPABASE_URL") or DEFAULT_JARVIS_URL
)
SUPABASE_KEY = (
    (ARGS.key or "").strip() or os.environ.get("JARVIS_SUPABASE_KEY") or LOCAL_CFG.get("JARVIS_SUPABASE_KEY") or DEFAULT_JARVIS_KEY
)


def _project_ref_from_url(url: str) -> str:
    try:
        host = urllib.parse.urlparse(url).hostname or ""
        return host.split(".")[0] if host else ""
    except:
        return ""


PROJECT_REF = _project_ref_from_url(SUPABASE_URL)
AUDIO_RELAY_WS_URL = f"wss://{PROJECT_REF}.functions.supabase.co/functions/v1/audio-relay"
CAMERA_RELAY_WS_URL = f"wss://{PROJECT_REF}.functions.supabase.co/functions/v1/camera-relay"

DEVICE_NAME = platform.node() or "My PC"
POLL_INTERVAL = 0.5
HEARTBEAT_INTERVAL = 5
LOCAL_P2P_PORT = 9876
PAIRING_CODE_LIFETIME_SECONDS = 300  # 5 minutes
PAIRING_CODE_WARNING_SECONDS = 60   # Show warning when 1 minute left

# PyAutoGUI settings
pyautogui.PAUSE = 0.01
pyautogui.FAILSAFE = False


# ============== GLOBAL LOG STORAGE (Circular Buffer) ==============
MAX_LOGS = 100
log_entries: deque = deque(maxlen=MAX_LOGS)

agent_status: Dict[str, Any] = {
    "connected": False,
    "device_name": DEVICE_NAME,
    "device_id": "",
    "pairing_code": "",
    "pairing_expires_at": None,
    "last_heartbeat": "",
    "volume": 50,
    "brightness": 50,
    "is_locked": False,
    "cpu_percent": 0,
    "memory_percent": 0,
    "audio_streaming": False,
    "camera_streaming": False,
    "screen_streaming": False,
    "local_ips": [],
    "p2p_connected": False,
    "p2p_clients": 0,
    "connection_failures": 0,
}


def add_log(level: str, message: str, details: str = "", category: str = "system"):
    """Add log entry with proper error tracking."""
    entry = {
        "timestamp": datetime.now().isoformat(),
        "level": level,
        "message": message,
        "details": details,
        "category": category,
    }
    log_entries.append(entry)
    
    # Print to console for debugging
    icon = {"error": "❌", "warn": "⚠️", "info": "ℹ️"}.get(level, "•")
    print(f"{icon} [{category}] {message}" + (f" | {details}" if details else ""))


def get_logs() -> List[Dict]:
    return list(log_entries)


def clear_logs():
    log_entries.clear()


def update_agent_status(updates: Dict[str, Any]):
    agent_status.update(updates)


def get_agent_status() -> Dict[str, Any]:
    return agent_status.copy()


# ============== LOCAL P2P SERVER (Integrated) ==============
class LocalP2PServer:
    """Local WebSocket server for ultra-low latency same-network connections."""
    
    def __init__(self, command_handler: Optional[Callable] = None, port: int = LOCAL_P2P_PORT):
        self.port = port
        self.command_handler = command_handler
        self.running = False
        self.server = None
        self.clients: Set = set()
        self.local_ips: list = []
        self._server_thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        
    def get_local_ips(self) -> list:
        """Get all local IP addresses for this machine."""
        ips = []
        hostname = socket.gethostname()
        
        try:
            for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
                ip = info[4][0]
                if not ip.startswith("127."):
                    ips.append(ip)
        except Exception as e:
            add_log("warn", f"IP detection via hostname failed: {e}", category="p2p")
        
        # Primary IP via connection method
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            primary_ip = s.getsockname()[0]
            s.close()
            if primary_ip not in ips:
                ips.insert(0, primary_ip)
        except Exception as e:
            add_log("warn", f"Primary IP detection failed: {e}", category="p2p")
        
        self.local_ips = ips
        update_agent_status({"local_ips": ips})
        return ips

    async def handle_client(self, websocket, path: str):
        """Handle a WebSocket client connection."""
        client_ip = websocket.remote_address[0] if websocket.remote_address else "unknown"
        add_log("info", f"P2P client connected from {client_ip}", category="p2p")
        
        self.clients.add(websocket)
        update_agent_status({"p2p_connected": True, "p2p_clients": len(self.clients)})
        
        try:
            await websocket.send(json.dumps({
                "type": "welcome",
                "server": "jarvis_local_p2p",
                "version": "3.0",
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
                    add_log("error", f"P2P message handling error: {e}", category="p2p")
                    await websocket.send(json.dumps({"type": "error", "error": str(e)}))
                    
        except Exception as e:
            if "ConnectionClosed" not in str(type(e)):
                add_log("warn", f"P2P client error: {e}", category="p2p")
        finally:
            self.clients.discard(websocket)
            update_agent_status({"p2p_clients": len(self.clients), "p2p_connected": len(self.clients) > 0})
            add_log("info", f"P2P client {client_ip} disconnected", category="p2p")
    
    async def _process_message(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process incoming message and return response."""
        msg_type = data.get("type", "")
        
        if msg_type == "ping":
            return {"type": "pong", "t": data.get("t", 0), "server_time": datetime.now().isoformat()}
        
        elif msg_type == "command":
            command_type = data.get("commandType", "")
            payload = data.get("payload", {})
            
            if self.command_handler:
                try:
                    if asyncio.iscoroutinefunction(self.command_handler):
                        result = await self.command_handler(command_type, payload)
                    else:
                        result = self.command_handler(command_type, payload)
                    
                    return {"type": "command_result", "commandType": command_type, "result": result}
                except Exception as e:
                    add_log("error", f"P2P command execution error: {e}", category="p2p")
                    return {"type": "command_error", "commandType": command_type, "error": str(e)}
            else:
                return {"type": "error", "error": "No command handler configured"}
        
        elif msg_type == "get_info":
            return {
                "type": "info",
                "local_ips": self.local_ips,
                "port": self.port,
                "clients": len(self.clients),
            }
        
        elif msg_type == "multi_command":
            # Multi-command execution support
            commands = data.get("commands", [])
            results = []
            for cmd in commands:
                cmd_type = cmd.get("commandType", "")
                cmd_payload = cmd.get("payload", {})
                try:
                    if self.command_handler:
                        if asyncio.iscoroutinefunction(self.command_handler):
                            result = await self.command_handler(cmd_type, cmd_payload)
                        else:
                            result = self.command_handler(cmd_type, cmd_payload)
                        results.append({"commandType": cmd_type, "success": True, "result": result})
                    else:
                        results.append({"commandType": cmd_type, "success": False, "error": "No handler"})
                except Exception as e:
                    results.append({"commandType": cmd_type, "success": False, "error": str(e)})
            return {"type": "multi_command_result", "results": results}
        
        return None
    
    async def _start_server(self):
        """Start the WebSocket server."""
        self.get_local_ips()
        
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
                add_log("info", f"P2P available at ws://{ip}:{self.port}/p2p", category="p2p")
            
            await self.server.wait_closed()
            
        except OSError as e:
            if "Address already in use" in str(e):
                add_log("warn", f"P2P port {self.port} already in use", category="p2p")
            else:
                add_log("error", f"P2P server error: {e}", category="p2p")
            self.running = False
    
    def start(self):
        """Start server in background thread."""
        if not HAS_WEBSOCKETS:
            add_log("warn", "Cannot start P2P - websockets not installed", category="p2p")
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
        """Stop the server."""
        self.running = False
        if self.server:
            self.server.close()
            self.server = None
        add_log("info", "P2P server stopped", category="p2p")


# Global P2P server instance
local_p2p_server: Optional[LocalP2PServer] = None


# ============== NOTIFICATION SYSTEM ==============
class NotificationManager:
    """Handles Windows notifications."""
    
    def __init__(self):
        self.toaster = None
        if HAS_TOAST:
            try:
                self.toaster = ToastNotifier()
            except Exception as e:
                add_log("warn", f"Toast notification init failed: {e}", category="system")
    
    def notify(self, title: str, message: str, duration: int = 5):
        """Show a Windows notification."""
        if self.toaster:
            try:
                self.toaster.show_toast(title, message, duration=duration, threaded=True, icon_path=None)
            except Exception as e:
                add_log("warn", f"Notification failed: {e}", category="system")


notification_manager = NotificationManager()


# ============== SCREENSHOT WORKER (Threaded) ==============
screenshot_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="screenshot")


def _take_screenshot_worker(quality: int = 70, region: Optional[Dict] = None) -> Dict[str, Any]:
    """Take screenshot in worker thread to avoid blocking."""
    try:
        if HAS_MSS:
            with mss.mss() as sct:
                if region:
                    monitor = {"top": region.get("y", 0), "left": region.get("x", 0),
                               "width": region.get("width", 1920), "height": region.get("height", 1080)}
                else:
                    monitor = sct.monitors[0]
                img = sct.grab(monitor)
                pil_img = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")
        else:
            pil_img = pyautogui.screenshot()
        
        # Resize if too large
        max_dim = 1920
        if pil_img.width > max_dim or pil_img.height > max_dim:
            pil_img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        
        buffer = io.BytesIO()
        pil_img.save(buffer, format='JPEG', quality=quality)
        img_data = base64.b64encode(buffer.getvalue()).decode('utf-8')
        
        return {"success": True, "data": img_data, "width": pil_img.width, "height": pil_img.height}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============== AUDIO STREAMER (with Circular Buffer) ==============
class AudioStreamer:
    """Audio relay with circular buffer to prevent memory leaks."""
    
    MAX_BUFFER_SIZE = 100  # Max chunks in buffer
    
    def __init__(self):
        self.running = False
        self.ws = None
        self.pa = None
        self.input_stream = None
        self.output_stream = None
        self.session_id = None
        self.direction = "phone_to_pc"
        self.sample_rate = 16000
        self.chunk_size = 1024
        self.format = pyaudio.paInt16 if HAS_PYAUDIO else None
        self.channels = 1
        self.use_system_audio = False
        self.bytes_sent = 0
        self.bytes_received = 0
        
        # Circular buffer for audio data
        self.audio_buffer: deque = deque(maxlen=self.MAX_BUFFER_SIZE)
        self.buffer_lock = threading.Lock()
    
    async def connect(self, session_id: str, direction: str = "phone_to_pc", use_system_audio: bool = False):
        if not HAS_WEBSOCKETS:
            add_log("error", "WebSockets not available", category="audio")
            return False
        
        self.session_id = session_id
        self.direction = direction
        self.use_system_audio = use_system_audio
        
        ws_url = f"{AUDIO_RELAY_WS_URL}?sessionId={session_id}&type=pc&direction={direction}"
        
        try:
            self.ws = await websockets.connect(ws_url)
            self.running = True
            self.bytes_sent = 0
            self.bytes_received = 0
            self.audio_buffer.clear()
            add_log("info", f"Audio relay connected (direction={direction})", category="audio")
            update_agent_status({"audio_streaming": True})
            return True
        except Exception as e:
            add_log("error", f"Audio relay connection failed: {e}", category="audio")
            return False
    
    async def stop(self):
        self.running = False
        self.audio_buffer.clear()
        
        if self.input_stream:
            try:
                self.input_stream.stop_stream()
                self.input_stream.close()
            except:
                pass
            self.input_stream = None
        
        if self.output_stream:
            try:
                self.output_stream.stop_stream()
                self.output_stream.close()
            except:
                pass
            self.output_stream = None
        
        if self.pa:
            try:
                self.pa.terminate()
            except:
                pass
            self.pa = None
        
        if self.ws:
            try:
                await self.ws.close()
            except:
                pass
            self.ws = None
        
        update_agent_status({"audio_streaming": False})
        add_log("info", "Audio relay stopped", category="audio")


# ============== SUPABASE CLIENT ==============
print(f"🔗 Connecting to: {SUPABASE_URL}")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ============== JARVIS AGENT (Main Class) ==============
class JarvisAgent:
    """Main agent class with connection recovery and multi-command support."""
    
    MAX_CONSECUTIVE_FAILURES = 10
    BACKOFF_BASE = 2
    MAX_BACKOFF = 60
    
    def __init__(self):
        self.device_id: Optional[str] = None
        self.device_key: str = ""
        self.running = False
        self.pairing_code: Optional[str] = None
        self.pairing_expires_at: Optional[datetime] = None
        self.consecutive_failures = 0
        
        # File transfer
        self.pending_files: Dict[str, Dict] = {}
        self.file_chunks: Dict[str, List] = {}
        self.save_path = os.path.join(os.path.expanduser("~"), "Downloads", "Jarvis")
        os.makedirs(self.save_path, exist_ok=True)
        
        # Streamers
        self.audio_streamer = AudioStreamer() if HAS_PYAUDIO else None
        
    async def register_device(self) -> bool:
        """Register device with pairing code and expiry tracking."""
        try:
            self.device_key = str(uuid.uuid4())
            user_id = str(uuid.uuid4())
            
            # Generate pairing code
            import random
            import string
            self.pairing_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
            self.pairing_expires_at = datetime.now(timezone.utc) + timedelta(seconds=PAIRING_CODE_LIFETIME_SECONDS)
            
            result = supabase.table("devices").insert({
                "name": DEVICE_NAME,
                "device_key": self.device_key,
                "is_online": True,
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "user_id": user_id,
                "pairing_code": self.pairing_code,
                "pairing_expires_at": self.pairing_expires_at.isoformat(),
            }).execute()
            
            if result.data:
                self.device_id = result.data[0]["id"]
                update_agent_status({
                    "device_id": self.device_id,
                    "pairing_code": self.pairing_code,
                    "pairing_expires_at": self.pairing_expires_at.isoformat(),
                    "connected": True,
                })
                add_log("info", f"Device registered with code: {self.pairing_code}", category="system")
                notification_manager.notify("JARVIS Ready", f"Pairing code: {self.pairing_code}")
                return True
            return False
        except Exception as e:
            add_log("error", f"Device registration failed: {e}", category="system")
            return False
    
    async def refresh_pairing_code(self):
        """Regenerate pairing code when expired."""
        if not self.device_id:
            return
        
        import random
        import string
        self.pairing_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        self.pairing_expires_at = datetime.now(timezone.utc) + timedelta(seconds=PAIRING_CODE_LIFETIME_SECONDS)
        
        try:
            supabase.table("devices").update({
                "pairing_code": self.pairing_code,
                "pairing_expires_at": self.pairing_expires_at.isoformat(),
            }).eq("id", self.device_id).execute()
            
            update_agent_status({
                "pairing_code": self.pairing_code,
                "pairing_expires_at": self.pairing_expires_at.isoformat(),
            })
            add_log("info", f"Pairing code refreshed: {self.pairing_code}", category="system")
            notification_manager.notify("New Pairing Code", self.pairing_code)
        except Exception as e:
            add_log("error", f"Failed to refresh pairing code: {e}", category="system")
    
    def check_pairing_expiry(self):
        """Check if pairing code is about to expire or has expired."""
        if not self.pairing_expires_at:
            return
        
        now = datetime.now(timezone.utc)
        remaining = (self.pairing_expires_at - now).total_seconds()
        
        if remaining <= 0:
            # Code expired - regenerate
            asyncio.create_task(self.refresh_pairing_code())
        elif remaining <= PAIRING_CODE_WARNING_SECONDS:
            # Warning - code expiring soon
            add_log("warn", f"Pairing code expires in {int(remaining)}s", category="system")
    
    async def _handle_command(self, command_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Handle a single command with proper error logging."""
        try:
            # Volume
            if command_type == "set_volume":
                return self._set_volume(payload.get("level", 50))
            elif command_type == "get_volume":
                return {"success": True, "volume": self._get_volume()}
            
            # Brightness
            elif command_type == "set_brightness":
                return self._set_brightness(payload.get("level", 50))
            elif command_type == "get_brightness":
                return {"success": True, "brightness": self._get_brightness()}
            
            # Mouse movement
            elif command_type == "mouse_move":
                dx = payload.get("dx", 0)
                dy = payload.get("dy", 0)
                pyautogui.moveRel(dx, dy, duration=0)
                return {"success": True}
            
            elif command_type == "mouse_click":
                button = payload.get("button", "left")
                pyautogui.click(button=button)
                return {"success": True}
            
            elif command_type == "mouse_scroll":
                delta = payload.get("delta", 0)
                pyautogui.scroll(int(delta))
                return {"success": True}
            
            # Keyboard
            elif command_type == "type_text":
                text = payload.get("text", "")
                pyautogui.typewrite(text, interval=0.02)
                return {"success": True}
            
            elif command_type == "key_press":
                key = payload.get("key", "")
                if key:
                    pyautogui.press(key)
                return {"success": True}
            
            elif command_type == "hotkey":
                keys = payload.get("keys", "")
                if keys:
                    key_list = [k.strip() for k in keys.split("+")]
                    pyautogui.hotkey(*key_list)
                return {"success": True}
            
            # Media controls
            elif command_type == "media_control":
                action = payload.get("action", "play_pause")
                key_map = {"play_pause": "playpause", "next": "nexttrack", "previous": "prevtrack", "mute": "volumemute"}
                pyautogui.press(key_map.get(action, "playpause"))
                return {"success": True}
            
            # Clipboard
            elif command_type == "get_clipboard":
                import pyperclip
                text = pyperclip.paste()
                return {"success": True, "text": text}
            
            elif command_type == "set_clipboard":
                import pyperclip
                pyperclip.copy(payload.get("text", ""))
                return {"success": True}
            
            # Screenshot (async via worker thread)
            elif command_type == "screenshot":
                quality = payload.get("quality", 70)
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(screenshot_executor, _take_screenshot_worker, quality, None)
                return result
            
            # System power
            elif command_type == "lock":
                if platform.system() == "Windows":
                    ctypes.windll.user32.LockWorkStation()
                return {"success": True}
            
            elif command_type == "sleep":
                if platform.system() == "Windows":
                    os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
                return {"success": True}
            
            elif command_type == "shutdown":
                if platform.system() == "Windows":
                    os.system("shutdown /s /t 60")
                return {"success": True, "message": "Shutdown in 60 seconds"}
            
            elif command_type == "restart":
                if platform.system() == "Windows":
                    os.system("shutdown /r /t 60")
                return {"success": True, "message": "Restart in 60 seconds"}
            
            # Get system stats
            elif command_type == "get_stats":
                return {
                    "success": True,
                    "cpu_percent": psutil.cpu_percent(),
                    "memory_percent": psutil.virtual_memory().percent,
                    "disk_percent": psutil.disk_usage('/').percent if platform.system() != "Windows" else psutil.disk_usage('C:').percent,
                }
            
            # Get network info (for P2P)
            elif command_type == "get_network_info":
                ips = local_p2p_server.get_local_ips() if local_p2p_server else []
                primary_ip = ips[0] if ips else ""
                prefix = ".".join(primary_ip.split(".")[:3]) if primary_ip else ""
                return {
                    "success": True,
                    "local_ip": primary_ip,
                    "network_prefix": prefix,
                    "all_ips": ips,
                    "p2p_port": LOCAL_P2P_PORT,
                    "p2p_available": local_p2p_server is not None and local_p2p_server.running,
                }
            
            # Multi-command execution
            elif command_type == "multi_command":
                commands = payload.get("commands", [])
                results = []
                for cmd in commands:
                    try:
                        result = await self._handle_command(cmd.get("type", ""), cmd.get("payload", {}))
                        results.append({"type": cmd.get("type"), "success": True, "result": result})
                    except Exception as e:
                        results.append({"type": cmd.get("type"), "success": False, "error": str(e)})
                return {"success": True, "results": results}
            
            # Open agent command (for Windows service)
            elif command_type == "open_agent":
                return {"success": True, "message": "Agent is already running"}
            
            else:
                return {"success": False, "error": f"Unknown command: {command_type}"}
                
        except Exception as e:
            add_log("error", f"Command {command_type} failed: {e}", category="command")
            return {"success": False, "error": str(e)}
    
    def _get_volume(self) -> int:
        if HAS_PYCAW and platform.system() == "Windows":
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                return int(volume.GetMasterVolumeLevelScalar() * 100)
            except:
                pass
        return 50
    
    def _set_volume(self, level: int) -> Dict[str, Any]:
        level = max(0, min(100, level))
        if HAS_PYCAW and platform.system() == "Windows":
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                volume.SetMasterVolumeLevelScalar(level / 100.0, None)
                update_agent_status({"volume": level})
                return {"success": True, "volume": level}
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": "Volume control not available"}
    
    def _get_brightness(self) -> int:
        if HAS_BRIGHTNESS:
            try:
                levels = sbc.get_brightness()
                return levels[0] if levels else 50
            except:
                pass
        return 50
    
    def _set_brightness(self, level: int) -> Dict[str, Any]:
        level = max(0, min(100, level))
        if HAS_BRIGHTNESS:
            try:
                sbc.set_brightness(level)
                update_agent_status({"brightness": level})
                return {"success": True, "brightness": level}
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": "Brightness control not available"}
    
    async def poll_commands(self):
        """Poll for commands with exponential backoff on failures."""
        if not self.device_id:
            return
        
        try:
            result = supabase.table("commands").select("*").eq("device_id", self.device_id).eq("status", "pending").execute()
            
            self.consecutive_failures = 0
            update_agent_status({"connection_failures": 0})
            
            for cmd in result.data or []:
                try:
                    response = await self._handle_command(cmd["command_type"], cmd.get("payload") or {})
                    
                    supabase.table("commands").update({
                        "status": "completed",
                        "result": response,
                        "executed_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", cmd["id"]).execute()
                    
                    add_log("info", f"Executed: {cmd['command_type']}", category="command")
                except Exception as e:
                    add_log("error", f"Command execution error: {e}", category="command")
                    supabase.table("commands").update({
                        "status": "failed",
                        "result": {"error": str(e)},
                    }).eq("id", cmd["id"]).execute()
                    
        except Exception as e:
            self.consecutive_failures += 1
            update_agent_status({"connection_failures": self.consecutive_failures})
            
            backoff = min(self.BACKOFF_BASE ** self.consecutive_failures, self.MAX_BACKOFF)
            add_log("warn", f"Poll error ({self.consecutive_failures}): {e}, backing off {backoff}s", category="system")
            
            if self.consecutive_failures >= self.MAX_CONSECUTIVE_FAILURES:
                add_log("error", "Max failures reached, attempting re-registration", category="system")
                await self.register_device()
                self.consecutive_failures = 0
            
            await asyncio.sleep(backoff)
    
    async def heartbeat(self):
        """Send heartbeat to indicate device is online."""
        if not self.device_id:
            return
        
        try:
            stats = {
                "cpu_percent": psutil.cpu_percent(),
                "memory_percent": psutil.virtual_memory().percent,
            }
            update_agent_status(stats)
            
            supabase.table("devices").update({
                "is_online": True,
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "system_info": stats,
            }).eq("id", self.device_id).execute()
            
            update_agent_status({"last_heartbeat": datetime.now().isoformat()})
        except Exception as e:
            add_log("warn", f"Heartbeat failed: {e}", category="system")
    
    async def run(self):
        """Main agent loop."""
        self.running = True
        
        if not await self.register_device():
            add_log("error", "Failed to register device", category="system")
            return
        
        # Start local P2P server
        global local_p2p_server
        local_p2p_server = LocalP2PServer(command_handler=self._handle_command, port=LOCAL_P2P_PORT)
        local_p2p_server.start()
        
        last_heartbeat = 0
        last_pairing_check = 0
        
        add_log("info", "Agent started, polling for commands...", category="system")
        
        while self.running:
            try:
                now = time.time()
                
                # Poll commands
                await self.poll_commands()
                
                # Heartbeat
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    await self.heartbeat()
                    last_heartbeat = now
                
                # Check pairing code expiry
                if now - last_pairing_check >= 30:
                    self.check_pairing_expiry()
                    last_pairing_check = now
                
                await asyncio.sleep(POLL_INTERVAL)
                
            except Exception as e:
                add_log("error", f"Main loop error: {e}", category="system")
                await asyncio.sleep(POLL_INTERVAL)
        
        await self.shutdown()
    
    async def shutdown(self):
        """Clean shutdown."""
        self.running = False
        
        if self.device_id:
            try:
                supabase.table("devices").update({"is_online": False}).eq("id", self.device_id).execute()
            except:
                pass
        
        if self.audio_streamer:
            await self.audio_streamer.stop()
        
        if local_p2p_server:
            local_p2p_server.stop()
        
        add_log("info", "Agent shutdown complete", category="system")


# ============== GUI ==============
class JarvisGUI:
    """Minimal, sexy black GUI with P2P status and file transfer."""
    
    def __init__(self):
        self.root: Optional[tk.Tk] = None
        self.running = False
        self.update_interval = 500
        self.colors = {
            "bg": "#000000",
            "card": "#0a0a0a",
            "border": "#1a1a1a",
            "text": "#ffffff",
            "muted": "#666666",
            "primary": "#22c55e",
            "success": "#22c55e",
            "warning": "#eab308",
            "error": "#ef4444",
            "accent": "#3b82f6",
        }
        self.stream_indicators = {}
        self.last_log_count = 0
        self.tray = None
        self.save_path_var = None
        self.transfer_status = None
        self.ip_label = None
        self.pairing_countdown_label = None
    
    def start(self) -> bool:
        if not HAS_TKINTER:
            return False
        
        try:
            self.root = tk.Tk()
            self.root.title("JARVIS Agent v3.0")
            self.root.geometry("420x700")
            self.root.configure(bg=self.colors["bg"])
            self.root.resizable(True, True)
            self.root.minsize(380, 600)
            
            self._setup_styles()
            self._build_ui()
            
            self.running = True
            self.root.after(self.update_interval, self._update_ui)
            
            return True
        except Exception as e:
            print(f"GUI init error: {e}")
            return False
    
    def _setup_styles(self):
        style = ttk.Style()
        style.theme_use("clam")
        c = self.colors
        
        style.configure("TFrame", background=c["bg"])
        style.configure("TLabel", background=c["bg"], foreground=c["text"])
        style.configure("Stat.Horizontal.TProgressbar", background=c["primary"], troughcolor=c["card"], borderwidth=0, thickness=4)
    
    def _build_ui(self):
        c = self.colors
        
        main = tk.Frame(self.root, bg=c["bg"])
        main.pack(fill=tk.BOTH, expand=True, padx=16, pady=12)
        
        # Header
        header = tk.Frame(main, bg=c["bg"])
        header.pack(fill=tk.X, pady=(0, 8))
        
        tk.Label(header, text="JARVIS", font=("Segoe UI", 16, "bold"), fg=c["text"], bg=c["bg"]).pack(side=tk.LEFT)
        
        status_frame = tk.Frame(header, bg=c["bg"])
        status_frame.pack(side=tk.RIGHT)
        
        self.status_dot = tk.Canvas(status_frame, width=8, height=8, bg=c["bg"], highlightthickness=0)
        self.status_dot.pack(side=tk.LEFT, padx=(0, 4))
        self.status_dot.create_oval(1, 1, 7, 7, fill=c["muted"], outline="", tags="dot")
        
        self.status_text = tk.Label(status_frame, text="Connecting", font=("Segoe UI", 9), fg=c["muted"], bg=c["bg"])
        self.status_text.pack(side=tk.LEFT)
        
        # Pairing Card
        pairing_card = tk.Frame(main, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        pairing_card.pack(fill=tk.X, pady=(0, 8), ipady=8)
        
        tk.Label(pairing_card, text="PAIRING CODE", font=("Segoe UI", 7, "bold"), fg=c["muted"], bg=c["card"]).pack(pady=(8, 0))
        
        self.pairing_label = tk.Label(pairing_card, text="------", font=("JetBrains Mono", 28, "bold"), fg=c["primary"], bg=c["card"])
        self.pairing_label.pack()
        
        self.pairing_countdown_label = tk.Label(pairing_card, text="", font=("Segoe UI", 8), fg=c["muted"], bg=c["card"])
        self.pairing_countdown_label.pack(pady=(0, 6))
        
        # P2P / IP Info Card
        ip_card = tk.Frame(main, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        ip_card.pack(fill=tk.X, pady=(0, 8), ipady=6)
        
        tk.Label(ip_card, text="🌐 LOCAL P2P", font=("Segoe UI", 8, "bold"), fg=c["muted"], bg=c["card"]).pack(anchor=tk.W, padx=10, pady=(6, 2))
        
        self.ip_label = tk.Label(ip_card, text="Detecting IP...", font=("JetBrains Mono", 10), fg=c["accent"], bg=c["card"])
        self.ip_label.pack(anchor=tk.W, padx=10, pady=(0, 6))
        
        self.p2p_status_label = tk.Label(ip_card, text="• 0 clients connected", font=("Segoe UI", 8), fg=c["muted"], bg=c["card"])
        self.p2p_status_label.pack(anchor=tk.W, padx=10, pady=(0, 6))
        
        # Stats Row
        stats_row = tk.Frame(main, bg=c["bg"])
        stats_row.pack(fill=tk.X, pady=(0, 8))
        stats_row.columnconfigure(0, weight=1)
        stats_row.columnconfigure(1, weight=1)
        
        cpu_frame = tk.Frame(stats_row, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        cpu_frame.grid(row=0, column=0, padx=(0, 3), sticky="nsew")
        tk.Label(cpu_frame, text="CPU", font=("Segoe UI", 7), fg=c["muted"], bg=c["card"]).pack(anchor=tk.W, padx=8, pady=(6, 2))
        self.cpu_bar = ttk.Progressbar(cpu_frame, style="Stat.Horizontal.TProgressbar", length=140, mode='determinate')
        self.cpu_bar.pack(fill=tk.X, padx=8, pady=(0, 6))
        
        mem_frame = tk.Frame(stats_row, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        mem_frame.grid(row=0, column=1, padx=(3, 0), sticky="nsew")
        tk.Label(mem_frame, text="MEM", font=("Segoe UI", 7), fg=c["muted"], bg=c["card"]).pack(anchor=tk.W, padx=8, pady=(6, 2))
        self.mem_bar = ttk.Progressbar(mem_frame, style="Stat.Horizontal.TProgressbar", length=140, mode='determinate')
        self.mem_bar.pack(fill=tk.X, padx=8, pady=(0, 6))
        
        # File Transfer Card
        file_card = tk.Frame(main, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        file_card.pack(fill=tk.X, pady=(0, 8))
        
        tk.Label(file_card, text="📁 FILE TRANSFER", font=("Segoe UI", 8, "bold"), fg=c["text"], bg=c["card"]).pack(anchor=tk.W, padx=10, pady=(8, 4))
        
        path_row = tk.Frame(file_card, bg=c["card"])
        path_row.pack(fill=tk.X, padx=10, pady=(0, 4))
        
        tk.Label(path_row, text="Save to:", font=("Segoe UI", 7), fg=c["muted"], bg=c["card"]).pack(side=tk.LEFT)
        
        default_save = os.path.join(os.path.expanduser("~"), "Downloads", "Jarvis")
        self.save_path_var = tk.StringVar(value=default_save)
        
        path_entry = tk.Entry(path_row, textvariable=self.save_path_var, font=("JetBrains Mono", 7),
                             bg=c["bg"], fg=c["text"], insertbackground=c["text"], bd=0, highlightthickness=1,
                             highlightbackground=c["border"], highlightcolor=c["primary"], width=30)
        path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(4, 2))
        
        browse_btn = tk.Label(path_row, text="📂", font=("Segoe UI", 9), fg=c["primary"], bg=c["card"], cursor="hand2")
        browse_btn.pack(side=tk.RIGHT)
        browse_btn.bind("<Button-1>", self._browse_save_folder)
        
        btn_row = tk.Frame(file_card, bg=c["card"])
        btn_row.pack(fill=tk.X, padx=10, pady=(0, 6))
        
        send_btn = tk.Frame(btn_row, bg=c["primary"], cursor="hand2")
        send_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(0, 3))
        send_label = tk.Label(send_btn, text="📤 Send", font=("Segoe UI", 8, "bold"), fg="#000", bg=c["primary"], pady=4)
        send_label.pack()
        send_btn.bind("<Button-1>", self._send_file_dialog)
        send_label.bind("<Button-1>", self._send_file_dialog)
        
        open_btn = tk.Frame(btn_row, bg=c["border"], cursor="hand2")
        open_btn.pack(side=tk.RIGHT, expand=True, fill=tk.X, padx=(3, 0))
        open_label = tk.Label(open_btn, text="📂 Open", font=("Segoe UI", 8), fg=c["text"], bg=c["border"], pady=4)
        open_label.pack()
        open_btn.bind("<Button-1>", self._open_save_folder)
        open_label.bind("<Button-1>", self._open_save_folder)
        
        self.transfer_status = tk.Label(file_card, text="Ready", font=("Segoe UI", 7), fg=c["muted"], bg=c["card"])
        self.transfer_status.pack(pady=(0, 6))
        
        # Activity Log
        log_card = tk.Frame(main, bg=c["card"], highlightbackground=c["border"], highlightthickness=1)
        log_card.pack(fill=tk.BOTH, expand=True)
        
        log_header = tk.Frame(log_card, bg=c["card"])
        log_header.pack(fill=tk.X, padx=10, pady=(6, 2))
        
        tk.Label(log_header, text="ACTIVITY", font=("Segoe UI", 7, "bold"), fg=c["muted"], bg=c["card"]).pack(side=tk.LEFT)
        
        clear_btn = tk.Label(log_header, text="Clear", font=("Segoe UI", 7), fg=c["muted"], bg=c["card"], cursor="hand2")
        clear_btn.pack(side=tk.RIGHT)
        clear_btn.bind("<Button-1>", lambda e: self._clear_logs())
        
        self.log_text = scrolledtext.ScrolledText(log_card, bg="#050505", fg=c["text"], font=("JetBrains Mono", 7),
                                                   wrap=tk.WORD, bd=0, highlightthickness=0, height=10)
        self.log_text.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))
        self.log_text.configure(state=tk.DISABLED)
        
        self.log_text.tag_configure("error", foreground=c["error"])
        self.log_text.tag_configure("warn", foreground=c["warning"])
        self.log_text.tag_configure("info", foreground=c["primary"])
        self.log_text.tag_configure("time", foreground=c["muted"])
    
    def _browse_save_folder(self, event=None):
        folder = filedialog.askdirectory(title="Select save folder", initialdir=self.save_path_var.get())
        if folder:
            self.save_path_var.set(folder)
            add_log("info", f"Save path: {folder}", category="file")
    
    def _send_file_dialog(self, event=None):
        files = filedialog.askopenfilenames(title="Select files to send")
        if files:
            for f in files:
                add_log("info", f"Queued: {os.path.basename(f)}", category="file")
                notification_manager.notify("File Ready", os.path.basename(f))
    
    def _open_save_folder(self, event=None):
        folder = self.save_path_var.get()
        try:
            os.makedirs(folder, exist_ok=True)
            if platform.system() == "Windows":
                os.startfile(folder)
            elif platform.system() == "Darwin":
                subprocess.run(["open", folder])
            else:
                subprocess.run(["xdg-open", folder])
        except Exception as e:
            add_log("error", f"Open folder failed: {e}", category="file")
    
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
            
            # Pairing countdown
            expires_at = status.get("pairing_expires_at")
            if expires_at:
                try:
                    exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                    remaining = (exp_dt - datetime.now(timezone.utc)).total_seconds()
                    if remaining > 0:
                        mins, secs = divmod(int(remaining), 60)
                        self.pairing_countdown_label.configure(text=f"Expires in {mins}:{secs:02d}", fg=c["muted"] if remaining > 60 else c["warning"])
                    else:
                        self.pairing_countdown_label.configure(text="Expired - refreshing...", fg=c["error"])
                except:
                    self.pairing_countdown_label.configure(text="")
            
            # IP / P2P info
            ips = status.get("local_ips", [])
            if ips:
                self.ip_label.configure(text=f"{ips[0]}:{LOCAL_P2P_PORT}")
            else:
                self.ip_label.configure(text="No network")
            
            p2p_clients = status.get("p2p_clients", 0)
            self.p2p_status_label.configure(
                text=f"• {p2p_clients} client{'s' if p2p_clients != 1 else ''} connected",
                fg=c["success"] if p2p_clients > 0 else c["muted"]
            )
            
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
    
    def _clear_logs(self):
        clear_logs()
        self.last_log_count = 0
        if self.log_text:
            self.log_text.configure(state=tk.NORMAL)
            self.log_text.delete(1.0, tk.END)
            self.log_text.configure(state=tk.DISABLED)
    
    def run_mainloop(self):
        if self.root:
            try:
                self.root.mainloop()
            except KeyboardInterrupt:
                self.stop()
    
    def stop(self):
        self.running = False
        if self.root:
            try:
                self.root.quit()
                self.root.destroy()
            except:
                pass
            self.root = None


# Global instances
jarvis_gui: Optional[JarvisGUI] = None
jarvis_agent_instance: Optional[JarvisAgent] = None


async def run_agent():
    global jarvis_agent_instance
    
    agent = JarvisAgent()
    jarvis_agent_instance = agent
    
    try:
        await agent.run()
    except KeyboardInterrupt:
        await agent.shutdown()
    except Exception as e:
        add_log("error", f"Fatal error: {e}", category="system")
        await agent.shutdown()
    finally:
        jarvis_agent_instance = None


def main():
    global jarvis_gui
    
    print("\n" + "=" * 50)
    print("🤖 JARVIS PC Agent v3.0")
    print("=" * 50)
    
    try:
        if HAS_TKINTER and not ARGS.headless and not ARGS.service:
            jarvis_gui = JarvisGUI()
            
            if jarvis_gui.start():
                notification_manager.notify("JARVIS Started", "Agent ready for pairing")
                
                def run_agent_thread():
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    try:
                        loop.run_until_complete(run_agent())
                    except Exception as e:
                        add_log("error", f"Agent thread error: {e}", category="system")
                    finally:
                        loop.close()
                
                agent_thread = threading.Thread(target=run_agent_thread, daemon=True)
                agent_thread.start()
                
                jarvis_gui.run_mainloop()
            else:
                asyncio.run(run_agent())
        else:
            asyncio.run(run_agent())
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
