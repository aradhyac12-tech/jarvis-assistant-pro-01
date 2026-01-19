"""
JARVIS PC Agent - Python Client v2.4 (Combined Agent + UI)
============================================================
Runs on your PC to execute commands from the Jarvis web dashboard.
Includes a local web dashboard at http://localhost:8765 for monitoring.

SETUP INSTRUCTIONS:
------------------
1. Install Python 3.8+ from https://python.org

2. Install dependencies:
   python -m pip install -r requirements.txt

3. (Optional) Override backend via env vars or flags:
   Windows CMD:
     set JARVIS_SUPABASE_URL=https://YOUR_BACKEND_URL
     set JARVIS_SUPABASE_KEY=YOUR_PUBLISHABLE_KEY

4. Run the agent:
   python jarvis_agent.py

5. Open the Jarvis web app and you'll see your PC connected!
   Local dashboard also available at http://localhost:8765

FEATURES:
---------
- System Controls: Volume, brightness, shutdown, sleep, hibernate, restart
- Smart Unlock: Unlock screen by typing PIN
- Remote Input: Virtual keyboard and mouse/trackpad control
- Screen Streaming: Real-time screen mirror
- Clipboard Sync: Read and write clipboard content
- App Control: Open/close applications, search and launch
- File Browser: Navigate and open files
- Music Player: Play music on YouTube (default) or other platforms
- Open Websites: Open any URL in default browser
- AI Search: Search on ChatGPT, Perplexity, Wikipedia, Google
- System Stats: CPU, memory, disk, battery monitoring
- Media Controls: Play/pause, next, previous, volume (Windows-specific)
- Boost Mode: Refresh explorer, clear temp, optimize
- Audio Relay: Stream audio bidirectionally between phone and PC
- Camera Streaming: Stream PC camera to phone
- File Sharing: Wi-Fi file transfer (Bluetooth coming soon)
- Local Dashboard: Web UI for monitoring agent status and logs
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
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
import base64
import io
import uuid
import webbrowser
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler


# ============== BOOTSTRAP (dependency check) ==============

def _requirements_path() -> str:
    return os.path.join(os.path.dirname(__file__), "requirements.txt")


def _check_dependencies() -> None:
    """Fail fast with clear instructions if dependencies are missing.

    Auto-installing Python packages often hangs/fails on Windows (permissions, venv mismatch,
    unsupported Python versions). We keep startup reliable by requiring an explicit install.
    """
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
            print("   Some packages used by the agent may not support Python 3.13+ yet.")
            print("   Install Python 3.10–3.12, recreate your venv, then reinstall requirements.")

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
    print("⚠️  mss not installed - using slower PIL screenshots")

# Optional imports for keyboard
try:
    import keyboard
    HAS_KEYBOARD = True
except ImportError:
    HAS_KEYBOARD = False
    print("⚠️  keyboard module not installed - some features limited")

# Audio streaming
try:
    import pyaudio
    HAS_PYAUDIO = True
except ImportError:
    HAS_PYAUDIO = False
    print("⚠️  pyaudio not installed - audio relay disabled")

# Camera streaming
try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False
    print("⚠️  opencv-python not installed - camera streaming disabled")

# WebSocket
try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False
    print("⚠️  websockets not installed - real-time streaming disabled")

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
# The backend URL and key are embedded below for this project.
# You can override them via environment variables or command-line flags if needed.
#
# To override (Windows CMD):
#   set JARVIS_SUPABASE_URL=https://... && set JARVIS_SUPABASE_KEY=... && python jarvis_agent.py
# Or pass flags:
#   python jarvis_agent.py --url https://... --key ...

# =====================================================================
# EMBEDDED BACKEND CONFIGURATION - DO NOT CHANGE UNLESS YOU KNOW WHAT YOU'RE DOING
# =====================================================================
DEFAULT_JARVIS_URL = "https://ugvynlowlvrferetovnq.supabase.co"
DEFAULT_JARVIS_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVndnlubG93bHZyZmVyZXRvdm5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3ODgzMTksImV4cCI6MjA4NDM2NDMxOX0.26wXn4zSZt9813W_6thD8ejA5qY2AuHXz-HgroVtzxU"
# =====================================================================


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="JARVIS PC Agent")
    p.add_argument("--url", help="Backend URL (e.g. https://xxxx.supabase.co)")
    p.add_argument("--key", help="Backend publishable/anon key")
    p.add_argument("--no-self-test", action="store_true", help="Skip connectivity self-test")
    p.add_argument("--save-config", action="store_true", help="Save URL/KEY to jarvis_agent_config.json")
    return p.parse_args()


def _config_path() -> str:
    return os.path.join(os.path.dirname(__file__), "jarvis_agent_config.json")


def _load_local_config() -> Dict[str, str]:
    try:
        with open(_config_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {k: str(v) for k, v in data.items()}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    return {}


def _save_local_config(url: str, key: str) -> None:
    try:
        with open(_config_path(), "w", encoding="utf-8") as f:
            json.dump({"JARVIS_SUPABASE_URL": url, "JARVIS_SUPABASE_KEY": key}, f, indent=2)
        print(f"💾 Saved config to: {_config_path()}")
    except Exception as e:
        print(f"⚠️  Could not save config: {e}")


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
    ARGS.url
    or os.environ.get("JARVIS_SUPABASE_URL")
    or LOCAL_CFG.get("JARVIS_SUPABASE_URL")
    or DEFAULT_JARVIS_URL
)

SUPABASE_KEY = (
    (ARGS.key or "").strip()
    or os.environ.get("JARVIS_SUPABASE_KEY")
    or LOCAL_CFG.get("JARVIS_SUPABASE_KEY")
    or DEFAULT_JARVIS_KEY
)

if ARGS.save_config:
    _save_local_config(SUPABASE_URL, SUPABASE_KEY)


def _mask_key(k: str) -> str:
    if not k:
        return "<empty>"
    if len(k) <= 10:
        return "*" * len(k)
    return f"{k[:6]}…{k[-4:]}"


print(f"🔧 Using backend URL: {SUPABASE_URL}")
print(f"🔑 Using key: {_mask_key(SUPABASE_KEY)}")

# Validate required configuration
if not SUPABASE_URL:
    print("❌ ERROR: Missing JARVIS_SUPABASE_URL")
    sys.exit(1)

if not SUPABASE_KEY:
    print("❌ ERROR: Missing JARVIS_SUPABASE_KEY")
    sys.exit(1)


def _project_ref_from_url(url: str) -> str:
    try:
        host = urllib.parse.urlparse(url).hostname or ""
        return host.split(".")[0] if host else ""
    except Exception:
        return ""


PROJECT_REF = _project_ref_from_url(SUPABASE_URL)

# WebSocket endpoints for realtime streaming (Functions domain)
AUDIO_RELAY_WS_URL = f"wss://{PROJECT_REF}.functions.supabase.co/functions/v1/audio-relay"
CAMERA_RELAY_WS_URL = f"wss://{PROJECT_REF}.functions.supabase.co/functions/v1/camera-relay"

DEVICE_NAME = platform.node() or "My PC"
UNLOCK_PIN = "1212"
POLL_INTERVAL = 0.5  # Faster polling for less lag
HEARTBEAT_INTERVAL = 5  # Separate heartbeat
UI_PORT = 8765

# PyAutoGUI settings for less lag
pyautogui.PAUSE = 0.01
pyautogui.FAILSAFE = False


STARTUP_LOG_PATH = os.path.join(os.path.dirname(__file__), "jarvis_agent_startup.log")


def _startup_log(stage: str, message: str) -> None:
    try:
        with open(STARTUP_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now().isoformat()} | {stage} | {message}\n")
    except Exception:
        pass


# ============== CONNECTIVITY SELF-TEST ==============
def run_connectivity_test() -> bool:
    """Run connectivity diagnostics before starting the agent."""
    import socket
    import ssl

    print("\n" + "=" * 50)
    print("🔍 CONNECTIVITY SELF-TEST")
    print("=" * 50)

    parsed = urllib.parse.urlparse(SUPABASE_URL)
    hostname = parsed.hostname

    if not hostname:
        msg = f"Invalid URL format: {SUPABASE_URL}"
        _startup_log("url", msg)
        print(f"❌ {msg}")
        print("\n💡 Tip: You can run:")
        print("   python jarvis_agent.py --url https://YOUR_PROJECT.supabase.co --key YOUR_KEY")
        return False

    print(f"📍 Target: {hostname}")

    # Test 1: DNS Resolution
    print("\n1️⃣  DNS Resolution...")
    try:
        ip_addresses = socket.getaddrinfo(hostname, 443, socket.AF_UNSPEC, socket.SOCK_STREAM)
        ip = ip_addresses[0][4][0]
        print(f"   ✅ Resolved to: {ip}")
    except socket.gaierror as e:
        _startup_log("dns", f"{hostname} | {e}")
        print(f"   ❌ DNS FAILED: {e}")
        print("\n💡 FIXES:")
        print("   • Check your internet connection")
        print("   • Disable VPN/proxy if active")
        print("   • Try: ipconfig /flushdns (Windows)")
        print("   • Change DNS to 8.8.8.8 or 1.1.1.1")
        print("\n💡 If this keeps failing, double-check your URL is correct:")
        print(f"   Current URL: {SUPABASE_URL}")
        return False

    # Test 2: TCP Connection
    print("\n2️⃣  TCP Connection (port 443)...")
    try:
        sock = socket.create_connection((hostname, 443), timeout=10)
        sock.close()
        print("   ✅ TCP connection successful")
    except socket.timeout:
        _startup_log("tcp", f"timeout {hostname}:443")
        print("   ❌ Connection timed out")
        print("\n💡 FIXES:")
        print("   • Check firewall settings")
        print("   • Try a different network")
        return False
    except Exception as e:
        _startup_log("tcp", f"{hostname}:443 | {e}")
        print(f"   ❌ TCP FAILED: {e}")
        return False

    # Test 3: HTTPS/TLS Connection
    print("\n3️⃣  HTTPS/TLS Handshake...")
    try:
        context = ssl.create_default_context()
        with socket.create_connection((hostname, 443), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                print(f"   ✅ TLS {ssock.version()} established")
    except ssl.SSLError as e:
        _startup_log("tls", str(e))
        print(f"   ❌ SSL/TLS FAILED: {e}")
        return False
    except Exception as e:
        _startup_log("https", str(e))
        print(f"   ❌ HTTPS FAILED: {e}")
        return False

    # Test 4: REST API basic check
    print("\n4️⃣  REST API Health Check...")
    try:
        import http.client

        conn = http.client.HTTPSConnection(hostname, timeout=10)
        conn.request(
            "GET",
            "/rest/v1/",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
            },
        )
        resp = conn.getresponse()
        status = resp.status
        conn.close()

        if status in (200, 400):
            print(f"   ✅ API responding (HTTP {status})")
        else:
            print(f"   ⚠️  Unexpected status: HTTP {status}")
    except Exception as e:
        _startup_log("api", str(e))
        print(f"   ⚠️  API check failed: {e} (will retry on start)")

    print("\n" + "=" * 50)
    print("✅ ALL CONNECTIVITY TESTS PASSED")
    print("=" * 50 + "\n")
    return True


# Run connectivity test before initializing client
if not ARGS.no_self_test:
    if not run_connectivity_test():
        print(f"\n❌ Connectivity test failed. Startup log saved to: {STARTUP_LOG_PATH}")
        sys.exit(1)

# ============== SUPABASE CLIENT ==============
print(f"🔗 Connecting to: {SUPABASE_URL}")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ============== GLOBAL LOG STORAGE (shared for web UI) ==============
log_entries: List[Dict[str, Any]] = []
MAX_LOGS = 100

agent_status: Dict[str, Any] = {
    "connected": False,
    "device_name": DEVICE_NAME,
    "device_id": "",
    "pairing_code": "",
    "last_heartbeat": "",
    "volume": 50,
    "brightness": 50,
    "is_locked": False,
    "cpu_percent": 0,
    "memory_percent": 0,
    "audio_streaming": False,
    "camera_streaming": False,
    "screen_streaming": False,
}


def add_log(level: str, message: str, details: str = "", category: str = "general"):
    """Add a log entry (shared with web UI)."""
    global log_entries
    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now().isoformat(),
        "level": level,
        "category": category,
        "message": message,
        "details": details
    }
    log_entries.insert(0, entry)
    log_entries = log_entries[:MAX_LOGS]
    
    # Also print to console
    level_emoji = {"error": "❌", "warn": "⚠️", "info": "ℹ️"}.get(level, "📝")
    print(f"{level_emoji} [{category}] {message}" + (f" | {details}" if details else ""))


def get_logs() -> List[Dict[str, Any]]:
    return log_entries


def clear_logs():
    global log_entries
    log_entries = []


def update_agent_status(updates: Dict[str, Any]):
    global agent_status
    agent_status.update(updates)


def get_agent_status() -> Dict[str, Any]:
    return agent_status


# ============== AUDIO STREAMER ==============
class AudioStreamer:
    """Handles bidirectional audio streaming between phone and PC."""
    
    def __init__(self):
        self.running = False
        self.ws = None
        self.session_id = None
        self.direction = "phone_to_pc"
        self.use_system_audio = False
        
        self.sample_rate = 44100
        self.channels = 1  # Mono for mic, stereo for system audio
        self.chunk_size = 4096  # Larger chunks for smoother playback
        self.format = pyaudio.paInt16 if HAS_PYAUDIO else None
        
        self.pa = None
        self.input_stream = None
        self.output_stream = None
        
        self.bytes_sent = 0
        self.bytes_received = 0
        self.last_stats_time = time.time()
        
        # Audio buffer for smoother playback
        self.audio_buffer: List[bytes] = []
        self.buffer_lock = threading.Lock()
        
    async def connect(self, session_id: str, direction: str = "phone_to_pc", use_system_audio: bool = False):
        if not HAS_WEBSOCKETS:
            add_log("error", "WebSockets not available for audio relay", category="audio")
            return False
            
        self.session_id = session_id
        self.direction = direction
        self.use_system_audio = use_system_audio
        
        ws_url = f"{AUDIO_RELAY_WS_URL}?sessionId={session_id}&type=pc&direction={direction}"
        add_log("info", f"Connecting to audio relay", f"direction={direction}, system_audio={use_system_audio}", category="audio")
        
        try:
            self.ws = await websockets.connect(ws_url)
            self.running = True
            self.bytes_sent = 0
            self.bytes_received = 0
            self.last_stats_time = time.time()
            add_log("info", "Audio relay connected", category="audio")
            update_agent_status({"audio_streaming": True})
            return True
        except Exception as e:
            add_log("error", f"Audio relay connection failed: {e}", category="audio")
            return False
    
    def _get_loopback_device_index(self) -> Optional[int]:
        if not HAS_PYAUDIO or platform.system() != "Windows":
            return None
            
        try:
            p = pyaudio.PyAudio()
            wasapi_info = None
            
            for i in range(p.get_host_api_count()):
                info = p.get_host_api_info_by_index(i)
                if "WASAPI" in info.get("name", ""):
                    wasapi_info = info
                    break
            
            if not wasapi_info:
                add_log("warn", "WASAPI not found for loopback", category="audio")
                p.terminate()
                return None
            
            default_output = p.get_default_output_device_info()
            output_name = default_output.get("name", "")
            
            for i in range(p.get_device_count()):
                dev_info = p.get_device_info_by_index(i)
                dev_name = dev_info.get("name", "")
                max_input = dev_info.get("maxInputChannels", 0)
                
                if max_input > 0 and output_name.split(" (")[0] in dev_name:
                    add_log("info", f"Found loopback device: {dev_name} (index {i})", category="audio")
                    p.terminate()
                    return i
            
            p.terminate()
            return None
        except Exception as e:
            add_log("warn", f"Loopback detection error: {e}", category="audio")
            return None
    
    async def start_playback(self):
        """Play audio received from phone on PC speakers."""
        if not HAS_PYAUDIO:
            add_log("error", "PyAudio not available for playback", category="audio")
            return
            
        try:
            self.pa = pyaudio.PyAudio()
            self.output_stream = self.pa.open(
                format=self.format,
                channels=1,  # Phone sends mono
                rate=self.sample_rate,
                output=True,
                frames_per_buffer=self.chunk_size
            )
            
            add_log("info", "PC speaker playback started", category="audio")
            
            while self.running and self.ws:
                try:
                    message = await asyncio.wait_for(self.ws.recv(), timeout=0.1)
                    
                    if isinstance(message, bytes):
                        # Direct binary audio data
                        self.output_stream.write(message)
                        self.bytes_received += len(message)
                    elif isinstance(message, str):
                        data = json.loads(message)
                        if data.get("type") == "peer_disconnected":
                            add_log("info", "Phone disconnected from audio relay", category="audio")
                        elif data.get("type") == "audio":
                            audio_bytes = base64.b64decode(data["data"])
                            self.output_stream.write(audio_bytes)
                            self.bytes_received += len(audio_bytes)
                except asyncio.TimeoutError:
                    continue
                except websockets.exceptions.ConnectionClosed:
                    add_log("warn", "Audio WebSocket closed", category="audio")
                    break
                except Exception as e:
                    if self.running:
                        add_log("warn", f"Playback error: {e}", category="audio")
                    break
                    
        except Exception as e:
            add_log("error", f"Playback setup error: {e}", category="audio")
        finally:
            self._cleanup_output()
    
    async def start_capture(self):
        """Capture PC audio and send to phone."""
        if not HAS_PYAUDIO:
            add_log("error", "PyAudio not available for capture", category="audio")
            return
            
        try:
            self.pa = self.pa or pyaudio.PyAudio()
            
            input_device_index = None
            channels = 1
            
            if self.use_system_audio:
                loopback_idx = self._get_loopback_device_index()
                if loopback_idx is not None:
                    input_device_index = loopback_idx
                    channels = 2
                    add_log("info", "Using system audio (WASAPI loopback)", category="audio")
                else:
                    add_log("warn", "Loopback not available, falling back to microphone", category="audio")
            
            self.channels = channels
            
            self.input_stream = self.pa.open(
                format=self.format,
                channels=channels,
                rate=self.sample_rate,
                input=True,
                input_device_index=input_device_index,
                frames_per_buffer=self.chunk_size
            )
            
            source = "system audio" if self.use_system_audio and input_device_index else "microphone"
            add_log("info", f"PC {source} capture started", category="audio")
            
            while self.running and self.ws:
                try:
                    audio_data = self.input_stream.read(self.chunk_size, exception_on_overflow=False)
                    
                    # If stereo, convert to mono for phone
                    if channels == 2:
                        import struct
                        samples = struct.unpack(f"<{len(audio_data)//2}h", audio_data)
                        mono_samples = [(samples[i] + samples[i+1]) // 2 for i in range(0, len(samples), 2)]
                        audio_data = struct.pack(f"<{len(mono_samples)}h", *mono_samples)
                    
                    await self.ws.send(audio_data)
                    self.bytes_sent += len(audio_data)
                except websockets.exceptions.ConnectionClosed:
                    add_log("warn", "Audio WebSocket closed during capture", category="audio")
                    break
                except Exception as e:
                    if self.running:
                        add_log("warn", f"Capture error: {e}", category="audio")
                    break
                    
        except Exception as e:
            add_log("error", f"Capture setup error: {e}", category="audio")
        finally:
            self._cleanup_input()
    
    def get_stats(self) -> Dict[str, Any]:
        now = time.time()
        elapsed = max(now - self.last_stats_time, 0.001)
        return {
            "bytes_sent": self.bytes_sent,
            "bytes_received": self.bytes_received,
            "send_rate_kbps": round((self.bytes_sent * 8) / (elapsed * 1000), 2),
            "recv_rate_kbps": round((self.bytes_received * 8) / (elapsed * 1000), 2),
            "running": self.running,
            "connected": self.ws is not None,
        }
    
    def _cleanup_input(self):
        if self.input_stream:
            try:
                self.input_stream.stop_stream()
                self.input_stream.close()
            except:
                pass
            self.input_stream = None
    
    def _cleanup_output(self):
        if self.output_stream:
            try:
                self.output_stream.stop_stream()
                self.output_stream.close()
            except:
                pass
            self.output_stream = None
    
    async def stop(self):
        self.running = False
        self._cleanup_input()
        self._cleanup_output()
        
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


# ============== CAMERA STREAMER ==============
class CameraStreamer:
    """Handles PC camera streaming to phone."""
    
    def __init__(self):
        self.running = False
        self.ws = None
        self.session_id = None
        self.camera = None
        self.quality = 50
        self.fps = 10
        
        self.frame_count = 0
        self.bytes_sent = 0
        self.last_frame_time = 0
        self.last_stats_time = time.time()
        
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5
        
        # Store last error for web UI
        self.last_error: Optional[str] = None
        
    async def connect(self, session_id: str, fps: int = 10, quality: int = 50):
        if not HAS_WEBSOCKETS or not HAS_OPENCV:
            error_msg = "WebSockets or OpenCV not available"
            self.last_error = error_msg
            add_log("error", error_msg, category="camera")
            return False
            
        self.session_id = session_id
        self.fps = fps
        self.quality = quality
        self.last_error = None
        
        ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={session_id}&type=pc&fps={fps}&quality={quality}"
        add_log("info", f"Connecting camera stream", f"fps={fps}, quality={quality}", category="camera")
        
        try:
            self.ws = await websockets.connect(ws_url)
            self.running = True
            self.frame_count = 0
            self.bytes_sent = 0
            self.last_stats_time = time.time()
            self.reconnect_attempts = 0
            add_log("info", "Camera stream connected", category="camera")
            update_agent_status({"camera_streaming": True})
            return True
        except Exception as e:
            self.last_error = str(e)
            add_log("error", f"Camera stream connection failed: {e}", category="camera")
            return False
    
    async def _reconnect(self):
        if self.reconnect_attempts >= self.max_reconnect_attempts:
            self.last_error = "Max reconnect attempts reached"
            add_log("error", "Max reconnect attempts reached", category="camera")
            return False
            
        self.reconnect_attempts += 1
        add_log("info", f"Reconnecting camera... (attempt {self.reconnect_attempts}/{self.max_reconnect_attempts})", category="camera")
        
        await asyncio.sleep(1)
        
        try:
            ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={self.session_id}&type=pc&fps={self.fps}&quality={self.quality}"
            self.ws = await websockets.connect(ws_url)
            add_log("info", "Camera stream reconnected", category="camera")
            return True
        except Exception as e:
            self.last_error = f"Reconnect failed: {e}"
            add_log("error", f"Reconnect failed: {e}", category="camera")
            return False
    
    async def start_streaming(self, camera_index: int = 0):
        if not HAS_OPENCV:
            self.last_error = "OpenCV not available for camera"
            add_log("error", self.last_error, category="camera")
            return

        def _try_open(idx: int, backend: Optional[int]) -> Optional["cv2.VideoCapture"]:
            backend_name = {cv2.CAP_MSMF: "MSMF", cv2.CAP_DSHOW: "DSHOW"}.get(backend, "default") if backend else "default"
            try:
                cap = cv2.VideoCapture(idx, backend) if backend is not None else cv2.VideoCapture(idx)

                # Request a common, webcam-friendly format
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                cap.set(cv2.CAP_PROP_FPS, max(self.fps, 10))

                # MJPG helps many Windows webcams
                try:
                    fourcc = cv2.VideoWriter_fourcc(*"MJPG")
                    cap.set(cv2.CAP_PROP_FOURCC, fourcc)
                except Exception:
                    pass

                if not cap.isOpened():
                    add_log("warn", f"Camera {idx} failed to open with {backend_name}", category="camera")
                    cap.release()
                    return None

                # Warm up - try to get a frame
                for attempt in range(5):
                    ret, _ = cap.read()
                    if ret:
                        add_log("info", f"Camera {idx} opened successfully with {backend_name}", category="camera")
                        return cap
                    time.sleep(0.05)

                add_log("warn", f"Camera {idx} opened but no frames with {backend_name}", category="camera")
                cap.release()
                return None
            except Exception as e:
                add_log("warn", f"Camera {idx} exception with {backend_name}: {e}", category="camera")
                return None

        try:
            # Windows: DSHOW is the most reliable for "0 opened but 0 frames" (MSMF grabFrame errors)
            backends: List[Optional[int]] = [None]
            if platform.system() == "Windows":
                backends = [cv2.CAP_DSHOW, cv2.CAP_MSMF, None]

            candidate_indexes = [camera_index, 0, 1, 2, 3, 4]
            cap = None
            tried_combos = []

            for backend in backends:
                for idx in candidate_indexes:
                    combo = f"idx={idx}, backend={backend}"
                    tried_combos.append(combo)
                    cap = _try_open(idx, backend)
                    if cap is not None:
                        camera_index = idx
                        break
                if cap is not None:
                    break

            if cap is None:
                self.last_error = f"No camera available. Tried: {', '.join(tried_combos[:6])}"
                add_log("error", self.last_error, category="camera")
                return

            self.camera = cap
            add_log("info", f"Camera {camera_index} streaming started (target {self.fps} FPS, quality {self.quality})", category="camera")

            frame_interval = 1.0 / self.fps
            
            while self.running:
                start_time = time.time()
                
                if not self.ws:
                    if not await self._reconnect():
                        break
                    continue
                
                ret, frame = self.camera.read()
                if not ret:
                    add_log("warn", "Failed to read frame from camera", category="camera")
                    await asyncio.sleep(0.1)
                    continue
                
                frame = cv2.resize(frame, (640, 480))
                
                _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, self.quality])
                frame_base64 = base64.b64encode(buffer).decode('utf-8')
                frame_size = len(buffer)
                
                try:
                    await self.ws.send(json.dumps({
                        "type": "camera_frame",
                        "data": frame_base64,
                        "width": 640,
                        "height": 480
                    }))
                    self.frame_count += 1
                    self.bytes_sent += frame_size
                    self.last_frame_time = time.time()
                except Exception as e:
                    add_log("warn", f"Camera send error: {e}", category="camera")
                    if not await self._reconnect():
                        break
                    continue
                
                elapsed = time.time() - start_time
                if elapsed < frame_interval:
                    await asyncio.sleep(frame_interval - elapsed)
                    
        except Exception as e:
            self.last_error = str(e)
            add_log("error", f"Camera streaming error: {e}", category="camera")
        finally:
            self._cleanup()
    
    def get_stats(self) -> Dict[str, Any]:
        now = time.time()
        elapsed = max(now - self.last_stats_time, 0.001)
        return {
            "frame_count": self.frame_count,
            "bytes_sent": self.bytes_sent,
            "fps_actual": round(self.frame_count / elapsed, 1),
            "fps_target": self.fps,
            "quality": self.quality,
            "last_frame_ago_ms": round((now - self.last_frame_time) * 1000) if self.last_frame_time else None,
            "running": self.running,
            "connected": self.ws is not None,
            "last_error": self.last_error,
        }
    
    def _cleanup(self):
        if self.camera:
            try:
                self.camera.release()
            except:
                pass
            self.camera = None
    
    async def stop(self):
        self.running = False
        self._cleanup()
        
        if self.ws:
            try:
                await self.ws.close()
            except:
                pass
            self.ws = None
        
        update_agent_status({"camera_streaming": False})
        add_log("info", "Camera stream stopped", category="camera")
    
    def get_available_cameras(self) -> List[Dict[str, Any]]:
        if not HAS_OPENCV:
            return []

        cameras: List[Dict[str, Any]] = []

        def _cap_open(idx: int) -> Optional["cv2.VideoCapture"]:
            # Prefer DSHOW first on Windows (more stable than MSMF for many webcams)
            if platform.system() == "Windows":
                for backend in [cv2.CAP_DSHOW, cv2.CAP_MSMF, None]:
                    try:
                        cap = cv2.VideoCapture(idx, backend) if backend is not None else cv2.VideoCapture(idx)
                        if cap.isOpened():
                            return cap
                        cap.release()
                    except Exception:
                        pass
                return None

            try:
                cap = cv2.VideoCapture(idx)
                return cap if cap.isOpened() else None
            except Exception:
                return None

        for i in range(5):
            cap = None
            try:
                cap = _cap_open(i)
                if cap and cap.isOpened():
                    cameras.append({
                        "index": i,
                        "name": f"Camera {i}",
                        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                    })
            finally:
                try:
                    if cap:
                        cap.release()
                except Exception:
                    pass

        return cameras


# ============== PHONE WEBCAM RECEIVER ==============
class PhoneWebcamReceiver:
    """Receives phone camera frames and displays them in a window (can be captured by OBS as virtual webcam)."""
    
    def __init__(self):
        self.running = False
        self.ws = None
        self.session_id = None
        self.window_name = "Phone Camera (Virtual Webcam)"
        self.last_frame = None
        self.frame_count = 0
        self.last_frame_time = 0
        self.last_error: Optional[str] = None
        
    async def connect(self, session_id: str):
        if not HAS_WEBSOCKETS or not HAS_OPENCV:
            self.last_error = "WebSockets or OpenCV not available"
            add_log("error", self.last_error, category="phone_webcam")
            return False
            
        self.session_id = session_id
        self.last_error = None
        
        ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={session_id}&type=pc&fps=30&quality=80"
        add_log("info", f"Connecting to phone webcam relay (session: {session_id[:8]}...)", category="phone_webcam")
        
        try:
            self.ws = await websockets.connect(ws_url)
            self.running = True
            self.frame_count = 0
            add_log("info", "Phone webcam relay connected", category="phone_webcam")
            return True
        except Exception as e:
            self.last_error = str(e)
            add_log("error", f"Phone webcam connection failed: {e}", category="phone_webcam")
            return False
    
    async def start_receiving(self):
        """Receive frames from phone and display in an OpenCV window."""
        if not HAS_OPENCV:
            self.last_error = "OpenCV not available"
            add_log("error", self.last_error, category="phone_webcam")
            return
            
        add_log("info", f"Phone webcam window opened: '{self.window_name}'", category="phone_webcam")
        add_log("info", "Use OBS 'Window Capture' to capture this as a virtual webcam", category="phone_webcam")
        
        # Create a named window that can be captured by OBS
        cv2.namedWindow(self.window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(self.window_name, 640, 480)
        
        # Show a placeholder frame
        placeholder = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(placeholder, "Waiting for phone camera...", (120, 240), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.imshow(self.window_name, placeholder)
        cv2.waitKey(1)
        
        try:
            while self.running and self.ws:
                try:
                    message = await asyncio.wait_for(self.ws.recv(), timeout=0.05)
                    
                    if isinstance(message, str):
                        data = json.loads(message)
                        
                        if data.get("type") == "camera_frame" and data.get("data"):
                            # Decode base64 JPEG frame
                            frame_bytes = base64.b64decode(data["data"])
                            nparr = np.frombuffer(frame_bytes, np.uint8)
                            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                            
                            if frame is not None:
                                self.last_frame = frame
                                self.frame_count += 1
                                self.last_frame_time = time.time()
                                
                                # Display the frame
                                cv2.imshow(self.window_name, frame)
                                
                        elif data.get("type") == "peer_disconnected":
                            add_log("info", "Phone disconnected from webcam relay", category="phone_webcam")
                            
                except asyncio.TimeoutError:
                    pass
                except Exception as e:
                    if self.running:
                        add_log("warn", f"Phone webcam receive error: {e}", category="phone_webcam")
                    break
                
                # Process OpenCV window events (required for window to stay responsive)
                key = cv2.waitKey(1) & 0xFF
                if key == 27:  # ESC key to close
                    add_log("info", "Phone webcam closed by user (ESC)", category="phone_webcam")
                    break
                    
        except Exception as e:
            self.last_error = str(e)
            add_log("error", f"Phone webcam error: {e}", category="phone_webcam")
        finally:
            cv2.destroyWindow(self.window_name)
            add_log("info", "Phone webcam window closed", category="phone_webcam")
    
    def get_stats(self) -> Dict[str, Any]:
        now = time.time()
        return {
            "frame_count": self.frame_count,
            "running": self.running,
            "connected": self.ws is not None,
            "last_frame_ago_ms": round((now - self.last_frame_time) * 1000) if self.last_frame_time else None,
            "last_error": self.last_error,
        }
    
    async def stop(self):
        self.running = False
        
        if self.ws:
            try:
                await self.ws.close()
            except:
                pass
            self.ws = None
        
        try:
            cv2.destroyWindow(self.window_name)
        except:
            pass
            
        add_log("info", "Phone webcam receiver stopped", category="phone_webcam")


# Import numpy for phone webcam if available
try:
    import numpy as np
except ImportError:
    pass


# ============== JARVIS AGENT ==============
class JarvisAgent:
    def __init__(self):
        self.device_id: Optional[str] = None
        self.device_key = self._generate_device_key()
        self.pairing_code: Optional[str] = None
        self.is_locked = False
        self.running = True
        self.last_heartbeat = 0
        self.screen_streaming = False
        self.stream_quality = 50
        self.stream_fps = 5
        
        self.audio_streamer = AudioStreamer()
        self.camera_streamer = CameraStreamer()
        self.phone_webcam_receiver = PhoneWebcamReceiver()
        self.audio_session_id = None
        self.camera_session_id = None
        self.phone_webcam_session_id = None
        
        self._volume_cache = 50
        self._brightness_cache = 50
        self._last_cache_update = 0
        
    def _generate_device_key(self) -> str:
        import hashlib
        unique_string = f"{platform.node()}-{platform.machine()}-jarvis"
        return hashlib.sha256(unique_string.encode()).hexdigest()[:32]
    
    def _generate_pairing_code(self) -> str:
        """Generate a 6-character alphanumeric pairing code."""
        import random
        import string
        chars = string.ascii_uppercase + string.digits
        # Exclude confusing characters
        chars = chars.replace('O', '').replace('0', '').replace('I', '').replace('1', '').replace('L', '')
        return ''.join(random.choices(chars, k=6))
    
    def _get_system_info(self) -> Dict[str, Any]:
        return {
            "os": platform.system(),
            "os_version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "hostname": platform.node(),
            "cpu_count": psutil.cpu_count(),
            "memory_total_gb": round(psutil.virtual_memory().total / (1024**3), 2),
            "has_audio": HAS_PYAUDIO,
            "has_camera": HAS_OPENCV,
            "has_websockets": HAS_WEBSOCKETS,
        }
    
    async def register_device(self):
        add_log("info", "Registering device...", category="system")
        
        # Generate a new pairing code
        self.pairing_code = self._generate_pairing_code()
        pairing_expires = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(minutes=30)
        
        try:
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
                    "pairing_code": self.pairing_code,
                    "pairing_expires_at": pairing_expires.isoformat(),
                }).eq("id", self.device_id).execute()
                add_log("info", f"Device reconnected: {DEVICE_NAME}", category="system")
            else:
                result = supabase.table("devices").insert({
                    "user_id": str(uuid.uuid4()),
                    "device_key": self.device_key,
                    "name": DEVICE_NAME,
                    "is_online": True,
                    "system_info": self._get_system_info(),
                    "current_volume": self._get_volume(),
                    "current_brightness": self._get_brightness(),
                    "pairing_code": self.pairing_code,
                    "pairing_expires_at": pairing_expires.isoformat(),
                }).execute()
                self.device_id = result.data[0]["id"]
                add_log("info", f"Device registered: {DEVICE_NAME}", category="system")
            
            update_agent_status({
                "connected": True,
                "device_id": self.device_id,
                "device_name": DEVICE_NAME,
                "pairing_code": self.pairing_code,
            })
            
            # Display pairing code prominently
            self._display_pairing_code()
            
            return self.device_id
        except Exception as e:
            add_log("error", f"Failed to register device: {e}", category="system")
            raise
    
    def _display_pairing_code(self):
        """Display pairing code prominently - user must enter this in the web app."""
        print("\n" + "=" * 60)
        print("🤖 JARVIS PC AGENT READY")
        print("=" * 60)
        print(f"   Device: {DEVICE_NAME}")
        print()
        print("   ╔════════════════════════════════════╗")
        print(f"   ║   ACCESS CODE:  {self.pairing_code}             ║")
        print("   ╚════════════════════════════════════╝")
        print()
        print("   Enter this code in the web app to connect.")
        print("   Code expires in 30 minutes.")
        print("=" * 60 + "\n")
    
    def _get_volume(self) -> int:
        if platform.system() == "Windows":
            try:
                nircmd_path = os.path.join(os.path.dirname(__file__), "nircmd.exe")
                if os.path.exists(nircmd_path):
                    return self._volume_cache
                
                result = subprocess.run(
                    ['powershell', '-Command', 
                     "(Get-AudioDevice -PlaybackVolume).Volume"],
                    capture_output=True, text=True, timeout=2
                )
                if result.returncode == 0 and result.stdout.strip():
                    return int(float(result.stdout.strip()))
            except Exception:
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
        level = max(0, min(100, level))
        self._volume_cache = level
        update_agent_status({"volume": level})
        
        if platform.system() == "Windows":
            try:
                nircmd_path = os.path.join(os.path.dirname(__file__), "nircmd.exe")
                if os.path.exists(nircmd_path):
                    vol_value = int(level * 65535 / 100)
                    subprocess.run([nircmd_path, "setsysvolume", str(vol_value)], 
                                 capture_output=True, timeout=2)
                    add_log("info", f"Volume set to {level}% (nircmd)", category="system")
                    return {"success": True, "volume": level}
                
                subprocess.run([
                    'powershell', '-Command',
                    f'Set-AudioDevice -PlaybackVolume {level}'
                ], capture_output=True, timeout=3)
                add_log("info", f"Volume set to {level}%", category="system")
                return {"success": True, "volume": level}
            except Exception as e:
                try:
                    current = self._volume_cache
                    diff = level - current
                    steps = abs(diff) // 2
                    key = "volumeup" if diff > 0 else "volumedown"
                    for _ in range(steps):
                        pyautogui.press(key)
                    add_log("info", f"Volume adjusted to ~{level}%", category="system")
                    return {"success": True, "volume": level}
                except:
                    return {"success": False, "error": str(e)}
        elif platform.system() == "Darwin":
            subprocess.run(["osascript", "-e", f"set volume output volume {level}"])
            add_log("info", f"Volume set to {level}%", category="system")
            return {"success": True, "volume": level}
        return {"success": False, "error": "Unsupported OS"}
    
    def _get_brightness(self) -> int:
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
        level = max(0, min(100, level))
        self._brightness_cache = level
        update_agent_status({"brightness": level})
        
        if platform.system() == "Windows" and HAS_BRIGHTNESS:
            try:
                sbc.set_brightness(level, display=0)
                add_log("info", f"Brightness set to {level}%", category="system")
                return {"success": True, "brightness": level}
            except Exception as e:
                try:
                    subprocess.run([
                        'powershell', '-Command',
                        f'(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{level})'
                    ], capture_output=True, timeout=3)
                    add_log("info", f"Brightness set to {level}%", category="system")
                    return {"success": True, "brightness": level}
                except:
                    return {"success": False, "error": str(e)}
        return {"success": False, "error": "Unsupported OS or no display control"}
    
    def _shutdown(self):
        add_log("warn", "SHUTDOWN command received!", category="system")
        if platform.system() == "Windows":
            os.system("shutdown /s /t 5")
        elif platform.system() == "Darwin":
            os.system("sudo shutdown -h +1")
        else:
            os.system("shutdown -h +1")
        return {"success": True, "message": "Shutdown initiated"}
    
    def _restart(self):
        add_log("warn", "RESTART command received!", category="system")
        if platform.system() == "Windows":
            os.system("shutdown /r /t 5")
        elif platform.system() == "Darwin":
            os.system("sudo shutdown -r +1")
        else:
            os.system("shutdown -r +1")
        return {"success": True, "message": "Restart initiated"}
    
    def _sleep(self):
        add_log("info", "SLEEP command received!", category="system")
        if platform.system() == "Windows":
            os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
        elif platform.system() == "Darwin":
            os.system("pmset sleepnow")
        return {"success": True, "message": "Sleep initiated"}
    
    def _hibernate(self):
        add_log("info", "HIBERNATE command received!", category="system")
        if platform.system() == "Windows":
            os.system("shutdown /h")
        else:
            return {"success": False, "error": "Hibernate not supported on this OS"}
        return {"success": True, "message": "Hibernate initiated"}
    
    def _lock_screen(self):
        add_log("info", "LOCK command received!", category="system")
        self.is_locked = True
        update_agent_status({"is_locked": True})
        if platform.system() == "Windows":
            ctypes.windll.user32.LockWorkStation()
        elif platform.system() == "Darwin":
            os.system("/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend")
        return {"success": True, "message": "Screen locked"}
    
    def _smart_unlock(self, pin: str):
        if pin != UNLOCK_PIN:
            add_log("warn", "Invalid unlock PIN!", category="system")
            return {"success": False, "error": "Invalid PIN"}

        add_log("info", "Smart unlock initiated...", category="system")
        self.is_locked = False
        update_agent_status({"is_locked": False})

        if platform.system() == "Windows":
            try:
                pyautogui.press("space")
                time.sleep(0.6)
                pyautogui.typewrite(pin, interval=0.05)
                time.sleep(0.2)
                pyautogui.press("enter")
                add_log("info", "Smart unlock completed!", category="system")
                return {"success": True, "message": "Unlock sequence executed"}
            except Exception as e:
                return {"success": False, "error": str(e)}

        return {"success": True, "message": "PIN verified"}
    
    def _take_screenshot(self, quality: int = 70, scale: float = 0.5, monitor_index: int = 1) -> Dict[str, Any]:
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

    def _get_monitors(self) -> Dict[str, Any]:
        try:
            if not HAS_MSS:
                return {"success": True, "monitors": [{"index": 1, "name": "Primary"}]}

            with mss.mss() as sct:
                mons = []
                for i in range(1, len(sct.monitors)):
                    m = sct.monitors[i]
                    mons.append({
                        "index": i,
                        "name": f"Monitor {i}",
                        "width": m["width"],
                        "height": m["height"],
                        "left": m["left"],
                        "top": m["top"],
                    })
                return {"success": True, "monitors": mons}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _start_stream(self, fps: int = 5, quality: int = 50, scale: float = 0.6, monitor_index: int = 1):
        self.screen_streaming = True
        self.stream_quality = quality
        self.stream_fps = fps
        return {"success": True, "message": f"Screen stream started at {fps} FPS"}
    
    def _get_frame(self):
        if not self.screen_streaming:
            return {"success": False, "error": "Stream not started"}
        return self._take_screenshot(quality=self.stream_quality, scale=0.6)
    
    def _stop_stream(self):
        self.screen_streaming = False
        return {"success": True, "message": "Stream stopped"}

    def _get_system_stats(self) -> Dict[str, Any]:
        try:
            cpu = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            stats = {
                "success": True,
                "cpu_percent": cpu,
                "memory_percent": mem.percent,
                "memory_used_gb": round(mem.used / (1024**3), 2),
                "memory_total_gb": round(mem.total / (1024**3), 2),
                "disk_percent": disk.percent,
                "disk_used_gb": round(disk.used / (1024**3), 2),
                "disk_total_gb": round(disk.total / (1024**3), 2),
            }
            
            update_agent_status({
                "cpu_percent": cpu,
                "memory_percent": mem.percent,
            })
            
            try:
                battery = psutil.sensors_battery()
                if battery:
                    stats["battery_percent"] = battery.percent
                    stats["battery_plugged"] = battery.power_plugged
            except:
                pass
            
            return stats
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_cameras(self) -> Dict[str, Any]:
        cameras = self.camera_streamer.get_available_cameras()
        return {"success": True, "cameras": cameras}

    def _get_issues(self) -> Dict[str, Any]:
        """Return recent issues for the web app to display."""
        return {
            "success": True,
            "issues": log_entries[:50],
            "camera_error": self.camera_streamer.last_error,
        }

    def _boost_pc(self):
        """Aggressive Windows cleanup: temp files, prefetch, explorer restart."""
        add_log("info", "Boost mode initiated!", category="system")
        try:
            if platform.system() != "Windows":
                return {"success": False, "error": "Boost only supported on Windows"}

            # Restart explorer to free memory
            subprocess.run("taskkill /f /im explorer.exe", shell=True, capture_output=True)
            time.sleep(0.5)
            subprocess.Popen("explorer.exe", shell=True)

            cleaned = 0

            # Directories to clean
            dirs_to_clean = [
                os.environ.get("TEMP", ""),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp"),
                os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Temp"),
                os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Prefetch"),
            ]

            for d in dirs_to_clean:
                if not d or not os.path.exists(d):
                    continue
                try:
                    for entry in os.listdir(d):
                        fp = os.path.join(d, entry)
                        try:
                            if os.path.isfile(fp):
                                os.remove(fp)
                                cleaned += 1
                            elif os.path.isdir(fp):
                                import shutil
                                shutil.rmtree(fp, ignore_errors=True)
                                cleaned += 1
                        except Exception:
                            pass  # skip locked files
                except Exception:
                    pass

            add_log("info", f"Boost completed! Cleaned {cleaned} items", category="system")
            return {"success": True, "message": f"Boost completed – cleaned {cleaned} items"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _type_text(self, text: str):
        try:
            pyautogui.typewrite(text, interval=0.02)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _press_key(self, key: str):
        try:
            key_map = {
                "playpause": "playpause",
                "mediaplaypause": "playpause",
                "play_pause": "playpause",
                "nexttrack": "nexttrack",
                "medianexttrack": "nexttrack",
                "next_track": "nexttrack",
                "prevtrack": "prevtrack",
                "previoustrack": "prevtrack",
                "mediaprevioustrack": "prevtrack",
                "prev_track": "prevtrack",
                "stop": "stop",
                "mediastop": "stop",
                "volumeup": "volumeup",
                "volumedown": "volumedown",
                "volumemute": "volumemute",
                "mute": "volumemute",
            }
            
            key_lower = key.lower().strip()
            actual_key = key_map.get(key_lower, key_lower)
            
            pyautogui.press(actual_key)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _hotkey(self, keys: List[str]):
        try:
            pyautogui.hotkey(*keys)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_move(self, x: int, y: int, relative: bool = False):
        try:
            if relative:
                pyautogui.move(x, y)
            else:
                pyautogui.moveTo(x, y)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_click(self, button: str = "left", clicks: int = 1):
        try:
            pyautogui.click(button=button, clicks=clicks)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _mouse_scroll(self, amount: int):
        try:
            pyautogui.scroll(amount)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_clipboard(self) -> Dict[str, Any]:
        try:
            import pyperclip
            content = pyperclip.paste()
            return {"success": True, "content": content}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _set_clipboard(self, content: str):
        try:
            import pyperclip
            pyperclip.copy(content)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _open_app(self, app_name: str, app_id: Optional[str] = None):
        import re
        try:
            app_name = (app_name or "").strip()
            app_lower = app_name.lower().strip()
            app_id = (app_id or "").strip() or None

            add_log("info", f"Opening: {app_name}", f"app_id={app_id}", category="apps")

            if platform.system() == "Windows":
                if app_id:
                    # Security: Validate app_id to prevent command injection
                    # Windows App IDs are typically in format: Publisher.AppName_hash!App
                    # Allow only alphanumeric, dots, underscores, exclamation marks, and hyphens
                    if not re.match(r'^[a-zA-Z0-9._!-]+$', app_id):
                        add_log("warn", f"Invalid app_id format rejected: {app_id}", category="apps")
                        return {"success": False, "error": "Invalid app ID format"}
                    
                    try:
                        # Use list form to avoid shell injection
                        subprocess.Popen(
                            ['explorer', f'shell:AppsFolder\\{app_id}'],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                        add_log("info", f"Opened via AppID: {app_id}", category="apps")
                        return {"success": True, "message": f"Opened {app_name}"}
                    except Exception as e:
                        add_log("warn", f"AppID launch failed, falling back: {e}", category="apps")

                app_paths = {
                    "chrome": "chrome", "google chrome": "chrome",
                    "firefox": "firefox", "mozilla firefox": "firefox",
                    "edge": "msedge", "microsoft edge": "msedge",
                    "notepad": "notepad",
                    "calculator": "calc", "calc": "calc",
                    "spotify": "spotify",
                    "vscode": "code", "vs code": "code", "visual studio code": "code",
                    "terminal": "wt", "cmd": "cmd", "command prompt": "cmd",
                    "powershell": "powershell",
                    "explorer": "explorer", "file explorer": "explorer",
                    "vlc": "vlc", "vlc player": "vlc",
                    "task manager": "taskmgr", "taskmgr": "taskmgr",
                    "settings": "ms-settings:",
                    "paint": "mspaint",
                    "word": "winword", "microsoft word": "winword",
                    "excel": "excel", "microsoft excel": "excel",
                    "powerpoint": "powerpnt", "microsoft powerpoint": "powerpnt",
                    "outlook": "outlook", "microsoft outlook": "outlook",
                    "discord": "discord",
                    "steam": "steam",
                    "telegram": "telegram",
                    "whatsapp": "whatsapp",
                    "obs": "obs64", "obs studio": "obs64",
                    "zoom": "zoom",
                    "teams": "ms-teams", "microsoft teams": "ms-teams",
                    "slack": "slack",
                    "brave": "brave",
                    "opera": "opera",
                    "vivaldi": "vivaldi",
                }

                cmd = app_paths.get(app_lower)

                if cmd:
                    if cmd.startswith("ms-"):
                        os.system(f"start {cmd}")
                    else:
                        subprocess.Popen(f"start {cmd}", shell=True)
                    add_log("info", f"Opened via known path: {cmd}", category="apps")
                    return {"success": True, "message": f"Opened {app_name}"}

                if not app_name:
                    return {"success": False, "error": "Missing app name"}

                add_log("info", f"Searching via Windows Search: {app_name}", category="apps")
                pyautogui.press("win")
                time.sleep(0.4)
                pyautogui.typewrite(app_name, interval=0.02)
                time.sleep(0.5)
                pyautogui.press("enter")

                return {"success": True, "message": f"Searched and opened: {app_name}"}

            if platform.system() == "Darwin":
                subprocess.Popen(["open", "-a", app_name])
                return {"success": True, "message": f"Opened {app_name}"}

            subprocess.Popen([app_name])
            return {"success": True, "message": f"Opened {app_name}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def _close_app(self, app_name: str):
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
                add_log("info", f"Closed: {app_name}", category="apps")
                return {"success": True, "message": f"Closed {app_name}"}
            return {"success": False, "error": f"Process {app_name} not found"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_running_apps(self) -> Dict[str, Any]:
        try:
            apps: List[Dict[str, Any]] = []
            for proc in psutil.process_iter(['name', 'pid']):
                try:
                    name = proc.info.get('name') or ""
                    if not name:
                        continue
                    apps.append({"pid": int(proc.info.get('pid') or 0), "name": name, "memory": 0, "cpu": 0})
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

            return {"success": True, "apps": apps[:200]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_installed_apps(self) -> Dict[str, Any]:
        try:
            if platform.system() != "Windows":
                return {"success": True, "apps": []}

            ps_script = "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json"
            result = subprocess.run(['powershell', '-Command', ps_script], capture_output=True, text=True, timeout=20)

            apps: List[Dict[str, Any]] = []
            if result.returncode == 0 and result.stdout.strip():
                parsed = json.loads(result.stdout.strip())
                items = parsed if isinstance(parsed, list) else [parsed]
                for it in items:
                    name = (it.get('Name') or '').strip()
                    app_id = (it.get('AppID') or '').strip() or None
                    if name:
                        apps.append({"name": name, "app_id": app_id, "source": "startapps"})

            apps.sort(key=lambda a: a["name"].lower())
            return {"success": True, "apps": apps[:2000]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _list_files(self, path: str = "~"):
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
        try:
            add_log("info", f"Opening file: {path}", category="files")
            if platform.system() == "Windows":
                os.startfile(path)
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
            return {"success": True, "message": f"Opened {path}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _open_url(self, url: str):
        try:
            if not url.startswith("http://") and not url.startswith("https://"):
                url = "https://" + url
            
            webbrowser.open(url)
            add_log("info", f"Opened URL: {url}", category="web")
            return {"success": True, "message": f"Opened {url}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _open_website(self, site: str, query: str = ""):
        """Open a well-known website, optionally with a search query."""
        try:
            site = (site or "").strip().lower()
            query = (query or "").strip()

            if not site:
                return {"success": False, "error": "Missing site"}

            # If user provided a domain, treat it as a URL
            if "." in site and " " not in site:
                if query:
                    return self._open_url(
                        f"https://www.google.com/search?q={urllib.parse.quote(query + ' site:' + site)}"
                    )
                return self._open_url(site)

            base_map = {
                "google": "https://www.google.com",
                "youtube": "https://www.youtube.com",
                "github": "https://github.com",
                "reddit": "https://www.reddit.com",
                "twitter": "https://x.com",
                "x": "https://x.com",
                "facebook": "https://www.facebook.com",
                "instagram": "https://www.instagram.com",
                "linkedin": "https://www.linkedin.com",
                "netflix": "https://www.netflix.com",
                "chatgpt": "https://chatgpt.com",
                "perplexity": "https://www.perplexity.ai",
                "wikipedia": "https://www.wikipedia.org",
                "gmail": "https://mail.google.com",
                "drive": "https://drive.google.com",
                "maps": "https://maps.google.com",
            }

            base = base_map.get(site) or f"https://{site}.com"

            if query:
                if site == "youtube":
                    return self._open_url(
                        f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
                    )
                if site == "perplexity":
                    return self._open_url(
                        f"https://www.perplexity.ai/search?q={urllib.parse.quote(query)}"
                    )
                if site == "chatgpt":
                    return self._open_url(f"https://chatgpt.com/?q={urllib.parse.quote(query)}")
                if site == "wikipedia":
                    return self._open_url(
                        f"https://en.wikipedia.org/w/index.php?search={urllib.parse.quote(query)}"
                    )
                return self._open_url(f"https://www.google.com/search?q={urllib.parse.quote(query)}")

            return self._open_url(base)
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _search_web(self, engine: str, query: str):
        """Perform a web search on the specified engine."""
        try:
            engine = (engine or "google").strip().lower()
            query = (query or "").strip()

            if not query:
                return {"success": False, "error": "Missing query"}

            if engine == "google":
                url = f"https://www.google.com/search?q={urllib.parse.quote(query)}"
            elif engine == "bing":
                url = f"https://www.bing.com/search?q={urllib.parse.quote(query)}"
            elif engine in ["duckduckgo", "ddg"]:
                url = f"https://duckduckgo.com/?q={urllib.parse.quote(query)}"
            elif engine == "youtube":
                url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
            elif engine in ["wikipedia", "wiki"]:
                url = f"https://en.wikipedia.org/w/index.php?search={urllib.parse.quote(query)}"
            elif engine == "perplexity":
                url = f"https://www.perplexity.ai/search?q={urllib.parse.quote(query)}"
            elif engine in ["chatgpt", "openai"]:
                url = f"https://chatgpt.com/?q={urllib.parse.quote(query)}"
            else:
                url = f"https://www.google.com/search?q={urllib.parse.quote(query)}"

            return self._open_url(url)
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_media_state(self):
        """Best-effort media info (no OS-specific metadata)."""
        try:
            volume = self._get_volume()
            return {
                "success": True,
                "title": "",
                "artist": "",
                "is_playing": False,
                "position_percent": 0,
                "position_ms": 0,
                "duration_ms": 0,
                "volume": volume,
                "muted": False,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _media_seek(self, position_percent: float):
        """Not supported reliably; return a clear error."""
        return {"success": False, "error": "Seeking is not supported yet"}
    
    def _play_music(self, query: str, service: str = "youtube"):
        try:
            service_lower = (service or "youtube").lower().strip()
            query = (query or "").strip()

            if not query:
                return {"success": False, "error": "Missing query"}

            if service_lower == "youtube":
                search_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"

                try:
                    import urllib.request

                    req = urllib.request.Request(
                        search_url,
                        headers={
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                        },
                    )

                    with urllib.request.urlopen(req, timeout=8) as resp:
                        html = resp.read().decode("utf-8", errors="ignore")

                    import re
                    m = re.search(r"\/watch\?v=([a-zA-Z0-9_-]{11})", html)
                    if m:
                        video_id = m.group(1)
                        url = f"https://www.youtube.com/watch?v={video_id}&autoplay=1"
                    else:
                        url = search_url
                except Exception as scrape_err:
                    add_log("warn", f"YouTube scrape failed: {scrape_err}", category="media")
                    url = search_url

                webbrowser.open(url)
                add_log("info", f"Playing on YouTube: {query}", category="media")
                return {"success": True, "message": f"Playing {query} on YouTube"}

            service_urls = {
                "spotify": f"https://open.spotify.com/search/{urllib.parse.quote(query)}",
                "soundcloud": f"https://soundcloud.com/search?q={urllib.parse.quote(query)}",
                "apple": f"https://music.apple.com/search?term={urllib.parse.quote(query)}",
                "deezer": f"https://www.deezer.com/search/{urllib.parse.quote(query)}",
            }

            url = service_urls.get(service_lower) or f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
            webbrowser.open(url)
            add_log("info", f"Playing on {service}: {query}", category="media")
            return {"success": True, "message": f"Playing {query} on {service}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _media_control(self, action: str):
        try:
            action_lower = action.lower().strip()

            if action_lower in ["play_pause", "playpause", "play", "pause"]:
                pyautogui.press("playpause")
                add_log("info", "Media play/pause", category="media")
            elif action_lower in ["next", "nexttrack", "forward"]:
                pyautogui.press("nexttrack")
                add_log("info", "Media next track", category="media")
            elif action_lower in ["previous", "prev", "prevtrack", "back"]:
                pyautogui.press("prevtrack")
                add_log("info", "Media previous track", category="media")
            elif action_lower == "stop":
                pyautogui.press("stop")
                add_log("info", "Media stop", category="media")
            elif action_lower == "mute":
                pyautogui.press("volumemute")
                add_log("info", "Volume mute toggle", category="media")
            elif action_lower in ["volume_up", "volumeup"]:
                pyautogui.press("volumeup")
                add_log("info", "Volume up", category="media")
            elif action_lower in ["volume_down", "volumedown"]:
                pyautogui.press("volumedown")
                add_log("info", "Volume down", category="media")
            else:
                return {"success": False, "error": f"Unknown action: {action}"}

            return {"success": True, "action": action}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _handle_command(self, command_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Handle a single command."""
        try:
            # System controls
            if command_type == "set_volume":
                return self._set_volume(payload.get("level", 50))
            elif command_type == "set_brightness":
                return self._set_brightness(payload.get("level", 50))
            elif command_type == "shutdown":
                return self._shutdown()
            elif command_type == "restart":
                return self._restart()
            elif command_type == "sleep":
                return self._sleep()
            elif command_type == "hibernate":
                return self._hibernate()
            elif command_type == "lock":
                return self._lock_screen()
            elif command_type == "unlock":
                return self._smart_unlock(payload.get("pin", ""))
            elif command_type == "boost":
                return self._boost_pc()

            # Input controls
            elif command_type == "type_text":
                return self._type_text(payload.get("text", ""))
            elif command_type == "press_key":
                return self._press_key(payload.get("key", ""))
            elif command_type in ["hotkey", "key_combo"]:
                return self._hotkey(payload.get("keys", []))
            elif command_type == "mouse_move":
                return self._mouse_move(
                    payload.get("x", 0),
                    payload.get("y", 0),
                    payload.get("relative", False)
                )
            elif command_type == "mouse_click":
                return self._mouse_click(
                    payload.get("button", "left"),
                    payload.get("clicks", 1)
                )
            elif command_type == "mouse_scroll":
                return self._mouse_scroll(payload.get("amount", 0))

            # Clipboard
            elif command_type == "get_clipboard":
                return self._get_clipboard()
            elif command_type == "set_clipboard":
                return self._set_clipboard(payload.get("content", ""))

            # Apps
            elif command_type == "open_app":
                return self._open_app(
                    payload.get("app_name", ""),
                    payload.get("app_id")
                )
            elif command_type == "close_app":
                return self._close_app(payload.get("app_name", ""))
            elif command_type == "get_running_apps":
                return self._get_running_apps()
            elif command_type == "get_installed_apps":
                return self._get_installed_apps()

            # Files
            elif command_type == "list_files":
                return self._list_files(payload.get("path", "~"))
            elif command_type == "open_file":
                return self._open_file(payload.get("path", ""))

            # Web
            elif command_type == "open_url":
                return self._open_url(payload.get("url", ""))
            elif command_type == "open_website":
                return self._open_website(payload.get("site", ""), payload.get("query", ""))
            elif command_type == "search_web":
                return self._search_web(payload.get("engine", "google"), payload.get("query", ""))

            # Media
            elif command_type == "play_music":
                return self._play_music(
                    payload.get("query", ""),
                    payload.get("service", "youtube")
                )
            elif command_type == "media_control":
                return self._media_control(payload.get("action", "play_pause"))
            elif command_type == "get_media_state":
                return self._get_media_state()
            elif command_type == "media_seek":
                return self._media_seek(payload.get("position_percent", 0))

            # Screen / system info
            elif command_type == "screenshot":
                return self._take_screenshot(
                    payload.get("quality", 70),
                    payload.get("scale", 0.5),
                    payload.get("monitor_index", 1)
                )
            elif command_type == "start_stream":
                return self._start_stream(
                    fps=payload.get("fps", 5),
                    quality=payload.get("quality", 50),
                    scale=payload.get("scale", 0.6),
                    monitor_index=payload.get("monitor_index", 1),
                )
            elif command_type == "get_frame":
                return self._get_frame()
            elif command_type == "stop_stream":
                return self._stop_stream()
            elif command_type == "get_monitors":
                return self._get_monitors()
            elif command_type == "get_system_stats":
                return self._get_system_stats()
            elif command_type == "get_cameras":
                return self._get_cameras()
            elif command_type == "get_issues":
                return self._get_issues()

            # Streaming relays
            elif command_type == "start_audio_relay":
                session_id = payload.get("session_id", str(uuid.uuid4()))
                direction = payload.get("direction", "phone_to_pc")
                use_system_audio = payload.get("use_system_audio", False)
                self.audio_session_id = session_id

                connected = await self.audio_streamer.connect(session_id, direction, use_system_audio)
                if connected:
                    if direction in ["phone_to_pc", "bidirectional"]:
                        asyncio.create_task(self.audio_streamer.start_playback())
                    if direction in ["pc_to_phone", "bidirectional"]:
                        asyncio.create_task(self.audio_streamer.start_capture())
                    return {"success": True, "session_id": session_id}
                return {"success": False, "error": "Failed to connect audio relay"}

            elif command_type == "stop_audio_relay":
                await self.audio_streamer.stop()
                self.audio_session_id = None
                return {"success": True}

            elif command_type == "start_camera_stream":
                session_id = payload.get("session_id", str(uuid.uuid4()))
                camera_index = payload.get("camera_index", 0)
                fps = payload.get("fps", 10)
                quality = payload.get("quality", 50)
                self.camera_session_id = session_id

                connected = await self.camera_streamer.connect(session_id, fps, quality)
                if connected:
                    asyncio.create_task(self.camera_streamer.start_streaming(camera_index))
                    return {"success": True, "session_id": session_id}
                
                # Return the error so web can display it
                return {
                    "success": False, 
                    "error": self.camera_streamer.last_error or "Failed to connect camera stream"
                }

            elif command_type == "stop_camera_stream":
                await self.camera_streamer.stop()
                self.camera_session_id = None
                return {"success": True}

            # Phone as Webcam
            elif command_type == "start_phone_webcam":
                session_id = payload.get("session_id", str(uuid.uuid4()))
                self.phone_webcam_session_id = session_id
                
                connected = await self.phone_webcam_receiver.connect(session_id)
                if connected:
                    asyncio.create_task(self.phone_webcam_receiver.start_receiving())
                    return {"success": True, "session_id": session_id, "message": "Phone webcam window opened. Use OBS Window Capture to use as virtual webcam."}
                
                return {
                    "success": False, 
                    "error": self.phone_webcam_receiver.last_error or "Failed to start phone webcam"
                }

            elif command_type == "stop_phone_webcam":
                await self.phone_webcam_receiver.stop()
                self.phone_webcam_session_id = None
                return {"success": True}

            elif command_type == "get_phone_webcam_status":
                stats = self.phone_webcam_receiver.get_stats()
                return {"success": True, **stats}

            else:
                add_log("warn", f"Unknown command: {command_type}", category="command")
                return {"success": False, "error": f"Unknown command: {command_type}"}

        except Exception as e:
            add_log("error", f"Error executing {command_type}: {e}", category="command")
            return {"success": False, "error": str(e)}
    
    async def poll_commands(self):
        """Poll for pending commands via secure edge function."""
        import urllib.request
        import ssl
        
        poll_url = f"{SUPABASE_URL}/functions/v1/agent-poll"
        ssl_ctx = ssl.create_default_context()
        
        while self.running:
            try:
                # Call edge function to get pending commands
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
                
                with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                
                if not result.get("success"):
                    if "Invalid device key" in str(result.get("error", "")):
                        add_log("error", "Device key rejected - re-registering", category="auth")
                        await self.register_device()
                    await asyncio.sleep(POLL_INTERVAL)
                    continue
                
                commands = result.get("commands", [])
                
                for cmd in commands:
                    cmd_type = cmd["command_type"]
                    payload = cmd.get("payload") or {}
                    cmd_id = cmd["id"]
                    
                    add_log("info", f"Executing: {cmd_type}", category="command")
                    
                    # Execute command
                    result_data = await self._handle_command(cmd_type, payload)
                    
                    # Report completion via edge function
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
                        with urllib.request.urlopen(complete_req, context=ssl_ctx, timeout=10) as _:
                            pass
                    except Exception as e:
                        add_log("warn", f"Failed to report completion: {e}", category="command")
                    
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    add_log("error", "Authentication failed - check device key", category="auth")
                else:
                    add_log("warn", f"Poll HTTP error {e.code}: {e.reason}", category="polling")
            except Exception as e:
                add_log("warn", f"Poll error: {e}", category="polling")
            
            await asyncio.sleep(POLL_INTERVAL)
    
    async def heartbeat(self):
        """Send periodic heartbeats via secure edge function."""
        import urllib.request
        import ssl
        
        poll_url = f"{SUPABASE_URL}/functions/v1/agent-poll"
        ssl_ctx = ssl.create_default_context()
        
        while self.running:
            try:
                volume = self._get_volume()
                brightness = self._get_brightness()
                
                hb_data = json.dumps({
                    "action": "heartbeat",
                    "volume": volume,
                    "brightness": brightness,
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
                
                with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as _:
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
    
    async def run(self):
        """Main run loop."""
        print("\n" + "="*50)
        print("🤖 JARVIS PC Agent v2.4 (with Web UI)")
        print("="*50)
        print(f"📍 Device: {DEVICE_NAME}")
        print(f"🔗 Backend: {SUPABASE_URL}")
        print(f"📷 Camera: {'✅' if HAS_OPENCV else '❌'}")
        print(f"🎤 Audio: {'✅' if HAS_PYAUDIO else '❌'}")
        print(f"🔌 WebSockets: {'✅' if HAS_WEBSOCKETS else '❌'}")
        print(f"🌐 Local Dashboard: http://localhost:{UI_PORT}")
        print("="*50 + "\n")
        
        await self.register_device()
        
        print("\n✅ Agent running! Open the Jarvis web app to control this PC.")
        print(f"   Local dashboard: http://localhost:{UI_PORT}")
        print("   Press Ctrl+C to stop.\n")
        
        # Run polling and heartbeat concurrently
        await asyncio.gather(
            self.poll_commands(),
            self.heartbeat()
        )
    
    async def shutdown(self):
        """Clean shutdown."""
        self.running = False
        
        # Stop streamers
        await self.audio_streamer.stop()
        await self.camera_streamer.stop()
        
        # Mark device offline
        try:
            supabase.table("devices").update({
                "is_online": False,
                "last_seen": datetime.now(timezone.utc).isoformat()
            }).eq("id", self.device_id).execute()
            
            update_agent_status({"connected": False})
        except:
            pass
        
        add_log("info", "Agent stopped. Goodbye!", category="system")


# ============== WEB UI SERVER ==============
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JARVIS Agent Dashboard</title>
    <style>
        :root {
            --bg-dark: #0a0e17;
            --bg-card: #111827;
            --bg-card-elevated: #1a2332;
            --border: #1f2937;
            --primary: #3b82f6;
            --primary-glow: rgba(59, 130, 246, 0.3);
            --success: #10b981;
            --warning: #f59e0b;
            --error: #ef4444;
            --text: #f3f4f6;
            --text-muted: #9ca3af;
            --gradient-primary: linear-gradient(135deg, #3b82f6, #8b5cf6);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            background: var(--bg-dark);
            color: var(--text);
            min-height: 100vh;
            padding: 24px;
        }
        .container { max-width: 1000px; margin: 0 auto; }
        
        /* Header */
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border);
        }
        .logo { display: flex; align-items: center; gap: 12px; }
        .logo-icon {
            width: 48px; height: 48px;
            background: var(--gradient-primary);
            border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            font-size: 24px;
        }
        h1 {
            font-size: 28px;
            font-weight: 700;
            background: var(--gradient-primary);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle { font-size: 13px; color: var(--text-muted); margin-top: 2px; }
        .status-badge {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 16px; border-radius: 24px; font-size: 14px; font-weight: 500;
        }
        .status-badge.online { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.4); }
        .status-badge.offline { background: rgba(239, 68, 68, 0.15); color: var(--error); border: 1px solid rgba(239, 68, 68, 0.4); }
        .status-dot { width: 10px; height: 10px; border-radius: 50%; animation: pulse 2s infinite; }
        .status-dot.online { background: var(--success); box-shadow: 0 0 8px var(--success); }
        .status-dot.offline { background: var(--error); }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        
        /* Pairing Code Section */
        .pairing-section {
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1));
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 16px;
            padding: 28px;
            text-align: center;
            margin-bottom: 24px;
            position: relative;
            overflow: hidden;
        }
        .pairing-section::before {
            content: '';
            position: absolute;
            top: -50%; left: -50%;
            width: 200%; height: 200%;
            background: radial-gradient(circle, rgba(59, 130, 246, 0.05) 0%, transparent 60%);
            animation: shimmer 10s linear infinite;
        }
        @keyframes shimmer { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .pairing-label { font-size: 14px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; position: relative; }
        .pairing-code {
            font-size: 56px; font-weight: 800; letter-spacing: 10px;
            background: var(--gradient-primary);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-family: 'Consolas', 'Monaco', monospace;
            position: relative;
            text-shadow: 0 0 40px var(--primary-glow);
        }
        .pairing-hint { font-size: 13px; color: var(--text-muted); margin-top: 16px; position: relative; }
        .pairing-expires { font-size: 12px; color: var(--warning); margin-top: 8px; position: relative; }
        
        /* Stats Grid */
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            transition: border-color 0.2s, transform 0.2s;
        }
        .card:hover { border-color: rgba(59, 130, 246, 0.3); transform: translateY(-2px); }
        .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .card-title { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .card-icon { font-size: 18px; opacity: 0.7; }
        .stat { font-size: 32px; font-weight: 700; }
        .stat-label { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .progress-bar { width: 100%; height: 6px; background: var(--border); border-radius: 4px; margin-top: 12px; overflow: hidden; }
        .progress-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
        .progress-fill.cpu { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
        .progress-fill.memory { background: linear-gradient(90deg, #8b5cf6, #a78bfa); }
        .progress-fill.volume { background: linear-gradient(90deg, #10b981, #34d399); }
        .progress-fill.brightness { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
        
        /* Streaming Status */
        .streaming-grid { display: flex; gap: 20px; margin-top: 8px; }
        .stream-item { display: flex; align-items: center; gap: 8px; }
        .stream-indicator { width: 8px; height: 8px; border-radius: 50%; }
        .stream-indicator.on { background: var(--success); box-shadow: 0 0 8px var(--success); animation: pulse 1.5s infinite; }
        .stream-indicator.off { background: var(--border); }
        .stream-label { font-size: 13px; color: var(--text-muted); }
        .stream-status { font-size: 14px; font-weight: 600; }
        .stream-status.on { color: var(--success); }
        .stream-status.off { color: var(--text-muted); }
        
        /* Log Container */
        .log-container { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .log-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--bg-card-elevated); }
        .log-header h2 { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .log-count { background: var(--border); color: var(--text-muted); font-size: 11px; padding: 2px 8px; border-radius: 10px; }
        .btn-group { display: flex; gap: 8px; }
        .btn { padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s; }
        .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
        .btn-ghost:hover { background: var(--border); color: var(--text); }
        .btn-primary { background: var(--primary); color: white; }
        .btn-primary:hover { background: #2563eb; }
        .log-list { max-height: 350px; overflow-y: auto; }
        .log-entry { display: flex; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); transition: background 0.2s; }
        .log-entry:hover { background: rgba(255, 255, 255, 0.02); }
        .log-level { min-width: 50px; font-weight: 600; text-transform: uppercase; font-size: 10px; padding: 3px 8px; border-radius: 4px; text-align: center; }
        .log-level.error { background: rgba(239, 68, 68, 0.15); color: var(--error); }
        .log-level.warn { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
        .log-level.info { background: rgba(59, 130, 246, 0.15); color: var(--primary); }
        .log-content { flex: 1; min-width: 0; }
        .log-message { font-size: 13px; word-break: break-word; line-height: 1.4; }
        .log-details { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .log-category { font-size: 10px; color: var(--text-muted); background: var(--border); padding: 2px 6px; border-radius: 4px; margin-right: 8px; }
        .log-time { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
        .empty-state { padding: 60px 40px; text-align: center; color: var(--text-muted); }
        .empty-state-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.5; }
        .empty-state-text { font-size: 14px; }
        
        /* Scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #374151; }
        
        /* Footer */
        footer { margin-top: 24px; text-align: center; font-size: 12px; color: var(--text-muted); }
        footer a { color: var(--primary); text-decoration: none; }
        footer a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo">
                <div class="logo-icon">🤖</div>
                <div>
                    <h1>JARVIS Agent</h1>
                    <div class="subtitle" id="device-name">Initializing...</div>
                </div>
            </div>
            <div class="status-badge" id="status-badge">
                <span class="status-dot" id="status-dot"></span>
                <span id="status-text">Connecting...</span>
            </div>
        </header>
        
        <div class="pairing-section" id="pairing-section">
            <div class="pairing-label">📱 Enter this code in the mobile app</div>
            <div class="pairing-code" id="pairing-code">------</div>
            <div class="pairing-hint">Open the JARVIS app → Tap "Pair" → Enter the code above</div>
            <div class="pairing-expires">⏱️ Code expires in 30 minutes</div>
        </div>
        
        <div class="grid">
            <div class="card">
                <div class="card-header">
                    <span class="card-title">CPU Usage</span>
                    <span class="card-icon">⚡</span>
                </div>
                <div class="stat" id="cpu-percent">0%</div>
                <div class="progress-bar"><div class="progress-fill cpu" id="cpu-bar" style="width: 0%"></div></div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Memory</span>
                    <span class="card-icon">💾</span>
                </div>
                <div class="stat" id="memory-percent">0%</div>
                <div class="progress-bar"><div class="progress-fill memory" id="memory-bar" style="width: 0%"></div></div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Volume</span>
                    <span class="card-icon">🔊</span>
                </div>
                <div class="stat" id="volume">50%</div>
                <div class="progress-bar"><div class="progress-fill volume" id="volume-bar" style="width: 50%"></div></div>
            </div>
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Brightness</span>
                    <span class="card-icon">☀️</span>
                </div>
                <div class="stat" id="brightness">50%</div>
                <div class="progress-bar"><div class="progress-fill brightness" id="brightness-bar" style="width: 50%"></div></div>
            </div>
        </div>
        
        <div class="card" style="margin-bottom: 24px;">
            <div class="card-header">
                <span class="card-title">Streaming Status</span>
                <span class="card-icon">📡</span>
            </div>
            <div class="streaming-grid">
                <div class="stream-item">
                    <span class="stream-indicator" id="audio-indicator"></span>
                    <span class="stream-label">Audio Relay:</span>
                    <span class="stream-status" id="audio-status">OFF</span>
                </div>
                <div class="stream-item">
                    <span class="stream-indicator" id="camera-indicator"></span>
                    <span class="stream-label">Camera Stream:</span>
                    <span class="stream-status" id="camera-status">OFF</span>
                </div>
                <div class="stream-item">
                    <span class="stream-indicator" id="screen-indicator"></span>
                    <span class="stream-label">Screen Mirror:</span>
                    <span class="stream-status" id="screen-status">OFF</span>
                </div>
            </div>
        </div>
        
        <div class="log-container">
            <div class="log-header">
                <h2>📋 Activity Log <span class="log-count" id="log-count">0</span></h2>
                <div class="btn-group">
                    <button class="btn btn-ghost" onclick="refreshLogs()">↻ Refresh</button>
                    <button class="btn btn-ghost" onclick="clearLogs()">Clear</button>
                </div>
            </div>
            <div class="log-list" id="log-list">
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <div class="empty-state-text">No activity logged yet</div>
                </div>
            </div>
        </div>
        
        <footer>
            JARVIS Agent v2.5 • <a href="https://github.com" target="_blank">View on GitHub</a>
        </footer>
    </div>
    
    <script>
        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                updateUI(data);
            } catch (e) { console.error('Status error:', e); }
        }
        
        function updateUI(data) {
            // Status badge
            const badge = document.getElementById('status-badge');
            const dot = document.getElementById('status-dot');
            const text = document.getElementById('status-text');
            if (data.connected) {
                badge.className = 'status-badge online';
                dot.className = 'status-dot online';
                text.textContent = 'Connected';
            } else {
                badge.className = 'status-badge offline';
                dot.className = 'status-dot offline';
                text.textContent = 'Disconnected';
            }
            
            // Device name
            document.getElementById('device-name').textContent = data.device_name || 'Unknown Device';
            
            // Pairing code
            const pairingCode = data.pairing_code || '------';
            document.getElementById('pairing-code').textContent = pairingCode;
            
            // System stats
            document.getElementById('cpu-percent').textContent = Math.round(data.cpu_percent || 0) + '%';
            document.getElementById('cpu-bar').style.width = (data.cpu_percent || 0) + '%';
            document.getElementById('memory-percent').textContent = Math.round(data.memory_percent || 0) + '%';
            document.getElementById('memory-bar').style.width = (data.memory_percent || 0) + '%';
            document.getElementById('volume').textContent = (data.volume || 0) + '%';
            document.getElementById('volume-bar').style.width = (data.volume || 0) + '%';
            document.getElementById('brightness').textContent = (data.brightness || 0) + '%';
            document.getElementById('brightness-bar').style.width = (data.brightness || 0) + '%';
            
            // Streaming status
            updateStreamStatus('audio', data.audio_streaming);
            updateStreamStatus('camera', data.camera_streaming);
            updateStreamStatus('screen', data.screen_streaming);
        }
        
        function updateStreamStatus(type, isOn) {
            const indicator = document.getElementById(type + '-indicator');
            const status = document.getElementById(type + '-status');
            indicator.className = 'stream-indicator ' + (isOn ? 'on' : 'off');
            status.textContent = isOn ? 'ACTIVE' : 'OFF';
            status.className = 'stream-status ' + (isOn ? 'on' : 'off');
        }
        
        async function refreshLogs() {
            try {
                const res = await fetch('/api/logs');
                const logs = await res.json();
                renderLogs(logs);
            } catch (e) { console.error('Logs error:', e); }
        }
        
        async function clearLogs() {
            try {
                await fetch('/api/logs/clear', { method: 'POST' });
                refreshLogs();
            } catch (e) { console.error('Clear error:', e); }
        }
        
        function renderLogs(logs) {
            const container = document.getElementById('log-list');
            document.getElementById('log-count').textContent = logs ? logs.length : 0;
            
            if (!logs || logs.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No activity logged yet</div></div>';
                return;
            }
            
            container.innerHTML = logs.map(log => 
                '<div class="log-entry">' +
                    '<span class="log-level ' + log.level + '">' + log.level + '</span>' +
                    '<div class="log-content">' +
                        '<span class="log-category">' + (log.category || 'general') + '</span>' +
                        '<span class="log-message">' + escapeHtml(log.message) + '</span>' +
                        (log.details ? '<div class="log-details">' + escapeHtml(log.details) + '</div>' : '') +
                    '</div>' +
                    '<span class="log-time">' + formatTime(log.timestamp) + '</span>' +
                '</div>'
            ).join('');
        }
        
        function formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        }
        
        // Initial load
        fetchStatus();
        refreshLogs();
        
        // Auto-refresh
        setInterval(fetchStatus, 2000);
        setInterval(refreshLogs, 5000);
    </script>
</body>
</html>
"""


class AgentUIHandler(SimpleHTTPRequestHandler):
    """HTTP request handler for the agent dashboard."""

    def log_message(self, format, *args):
        pass  # Suppress default logging

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(HTML_TEMPLATE.encode())

        elif path == "/api/status":
            self.send_json(get_agent_status())

        elif path == "/api/logs":
            self.send_json(get_logs())

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/logs/clear":
            clear_logs()
            self.send_json({"success": True})
        else:
            self.send_response(404)
            self.end_headers()

    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


def run_ui_server(port: int = UI_PORT):
    """Start the UI server in a background thread."""
    try:
        server = HTTPServer(("127.0.0.1", port), AgentUIHandler)
        
        def serve():
            server.serve_forever()

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        add_log("info", f"Agent Dashboard running at http://localhost:{port}", category="system")
        return server
    except Exception as e:
        add_log("warn", f"Could not start web UI: {e}", category="system")
        return None


# ============== MAIN ==============
async def main():
    # Start the web UI server
    run_ui_server()
    
    agent = JarvisAgent()
    
    try:
        await agent.run()
    except KeyboardInterrupt:
        await agent.shutdown()
    except Exception as e:
        add_log("error", f"Fatal error: {e}", category="system")
        await agent.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
