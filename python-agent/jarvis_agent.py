"""
JARVIS PC Agent - Python Client v2.3
=====================================
Runs on your PC to execute commands from the Jarvis web dashboard.

SETUP INSTRUCTIONS:
------------------
1. Install Python 3.8+ from https://python.org

2. Install dependencies:
   pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip mss pyaudio opencv-python websockets

3. Set environment variables (REQUIRED for remixed projects):
   export JARVIS_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
   export JARVIS_SUPABASE_KEY="YOUR_ANON_KEY"

4. Run the agent:
   python jarvis_agent.py

5. Open the Jarvis web app and you'll see your PC connected!

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
import webbrowser
import urllib.parse

# Third-party imports
try:
    from supabase import create_client, Client
    import pyautogui
    from PIL import Image
    import psutil
except ImportError as e:
    print(f"❌ Missing dependency: {e}")
    print("\n📦 Install required packages with:")
    print("   pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip mss pyaudio opencv-python websockets")
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
# IMPORTANT: For remixed projects, set these environment variables!
# export JARVIS_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
# export JARVIS_SUPABASE_KEY="YOUR_ANON_KEY"

SUPABASE_URL = (
    os.environ.get("JARVIS_SUPABASE_URL")
    or os.environ.get("SUPABASE_URL")
    or "https://zcpclccisfnjiziqnzds.supabase.co"  # Updated for remixed project
)
SUPABASE_KEY = (
    os.environ.get("JARVIS_SUPABASE_KEY")
    or os.environ.get("SUPABASE_ANON_KEY")
    or os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    or "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjcGNsY2Npc2Zuaml6aXFuemRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMjk5NjAsImV4cCI6MjA4MjYwNTk2MH0.2mtHp3K634cD98xWLwArVfRLqAqcvQdSqqRFqAtZEog"  # Updated for remixed project
)


def _project_ref_from_url(url: str) -> str:
    try:
        host = urllib.parse.urlparse(url).hostname or ""
        return host.split(".")[0] if host else "zcpclccisfnjiziqnzds"
    except Exception:
        return "zcpclccisfnjiziqnzds"


PROJECT_REF = _project_ref_from_url(SUPABASE_URL)

# WebSocket endpoints for realtime streaming (Edge Functions domain)
AUDIO_RELAY_WS_URL = f"wss://{PROJECT_REF}.functions.supabase.co/functions/v1/audio-relay"
CAMERA_RELAY_WS_URL = f"wss://{PROJECT_REF}.functions.supabase.co/functions/v1/camera-relay"

DEVICE_NAME = platform.node() or "My PC"
UNLOCK_PIN = "1212"
POLL_INTERVAL = 0.5  # Faster polling for less lag
HEARTBEAT_INTERVAL = 5  # Separate heartbeat

# PyAutoGUI settings for less lag
pyautogui.PAUSE = 0.01
pyautogui.FAILSAFE = False

# ============== SUPABASE CLIENT ==============
print(f"🔗 Connecting to: {SUPABASE_URL}")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


class AudioStreamer:
    """Handles bidirectional audio streaming between phone and PC."""
    
    def __init__(self):
        self.running = False
        self.ws = None
        self.session_id = None
        self.direction = "phone_to_pc"
        self.use_system_audio = False
        
        self.sample_rate = 44100
        self.channels = 2
        self.chunk_size = 1024
        self.format = pyaudio.paInt16 if HAS_PYAUDIO else None
        
        self.pa = None
        self.input_stream = None
        self.output_stream = None
        
        self.bytes_sent = 0
        self.bytes_received = 0
        self.last_stats_time = time.time()
        
    async def connect(self, session_id: str, direction: str = "phone_to_pc", use_system_audio: bool = False):
        if not HAS_WEBSOCKETS:
            print("❌ WebSockets not available")
            return False
            
        self.session_id = session_id
        self.direction = direction
        self.use_system_audio = use_system_audio
        
        ws_url = f"{AUDIO_RELAY_WS_URL}?sessionId={session_id}&type=pc&direction={direction}"
        print(f"🔊 Connecting to audio relay: {ws_url}")
        
        try:
            self.ws = await websockets.connect(ws_url)
            self.running = True
            self.bytes_sent = 0
            self.bytes_received = 0
            self.last_stats_time = time.time()
            print(f"✅ Audio relay connected (direction: {direction}, system_audio: {use_system_audio})")
            return True
        except Exception as e:
            print(f"❌ Audio relay connection failed: {e}")
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
                print("⚠️ WASAPI not found")
                p.terminate()
                return None
            
            default_output = p.get_default_output_device_info()
            output_name = default_output.get("name", "")
            
            for i in range(p.get_device_count()):
                dev_info = p.get_device_info_by_index(i)
                dev_name = dev_info.get("name", "")
                max_input = dev_info.get("maxInputChannels", 0)
                
                if max_input > 0 and output_name.split(" (")[0] in dev_name:
                    print(f"🔊 Found loopback device: {dev_name} (index {i})")
                    p.terminate()
                    return i
            
            p.terminate()
            return None
        except Exception as e:
            print(f"⚠️ Loopback detection error: {e}")
            return None
    
    async def start_playback(self):
        if not HAS_PYAUDIO:
            print("❌ PyAudio not available for playback")
            return
            
        try:
            self.pa = pyaudio.PyAudio()
            self.output_stream = self.pa.open(
                format=self.format,
                channels=self.channels,
                rate=self.sample_rate,
                output=True,
                frames_per_buffer=self.chunk_size
            )
            
            print("🔊 PC speaker playback started")
            
            while self.running and self.ws:
                try:
                    message = await asyncio.wait_for(self.ws.recv(), timeout=0.1)
                    
                    if isinstance(message, bytes):
                        self.output_stream.write(message)
                        self.bytes_received += len(message)
                    elif isinstance(message, str):
                        data = json.loads(message)
                        if data.get("type") == "peer_disconnected":
                            print("📱 Phone disconnected from audio relay")
                        elif data.get("type") == "audio":
                            audio_bytes = base64.b64decode(data["data"])
                            self.output_stream.write(audio_bytes)
                            self.bytes_received += len(audio_bytes)
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    if self.running:
                        print(f"⚠️ Playback error: {e}")
                    break
                    
        except Exception as e:
            print(f"❌ Playback setup error: {e}")
        finally:
            self._cleanup_output()
    
    async def start_capture(self):
        if not HAS_PYAUDIO:
            print("❌ PyAudio not available for capture")
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
                    print("🔊 Using system audio (WASAPI loopback)")
                else:
                    print("⚠️ Loopback not available, falling back to microphone")
            
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
            print(f"🎤 PC {source} capture started")
            
            while self.running and self.ws:
                try:
                    audio_data = self.input_stream.read(self.chunk_size, exception_on_overflow=False)
                    await self.ws.send(audio_data)
                    self.bytes_sent += len(audio_data)
                except Exception as e:
                    if self.running:
                        print(f"⚠️ Capture error: {e}")
                    break
                    
        except Exception as e:
            print(f"❌ Capture setup error: {e}")
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
            "connected": self.ws is not None and self.ws.open if self.ws else False,
        }
    
    def _cleanup_input(self):
        if self.input_stream:
            self.input_stream.stop_stream()
            self.input_stream.close()
            self.input_stream = None
    
    def _cleanup_output(self):
        if self.output_stream:
            self.output_stream.stop_stream()
            self.output_stream.close()
            self.output_stream = None
    
    async def stop(self):
        self.running = False
        self._cleanup_input()
        self._cleanup_output()
        
        if self.pa:
            self.pa.terminate()
            self.pa = None
            
        if self.ws:
            await self.ws.close()
            self.ws = None
            
        print("🔇 Audio relay stopped")


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
        
    async def connect(self, session_id: str, fps: int = 10, quality: int = 50):
        if not HAS_WEBSOCKETS or not HAS_OPENCV:
            print("❌ WebSockets or OpenCV not available")
            return False
            
        self.session_id = session_id
        self.fps = fps
        self.quality = quality
        
        ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={session_id}&type=pc&fps={fps}&quality={quality}"
        print(f"📷 Connecting camera stream: {ws_url}")
        
        try:
            self.ws = await websockets.connect(ws_url)
            self.running = True
            self.frame_count = 0
            self.bytes_sent = 0
            self.last_stats_time = time.time()
            self.reconnect_attempts = 0
            print("✅ Camera stream connected")
            return True
        except Exception as e:
            print(f"❌ Camera stream connection failed: {e}")
            return False
    
    async def _reconnect(self):
        if self.reconnect_attempts >= self.max_reconnect_attempts:
            print("❌ Max reconnect attempts reached")
            return False
            
        self.reconnect_attempts += 1
        print(f"🔄 Reconnecting camera... (attempt {self.reconnect_attempts}/{self.max_reconnect_attempts})")
        
        await asyncio.sleep(1)
        
        try:
            ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={self.session_id}&type=pc&fps={self.fps}&quality={self.quality}"
            self.ws = await websockets.connect(ws_url)
            print("✅ Camera stream reconnected")
            return True
        except Exception as e:
            print(f"❌ Reconnect failed: {e}")
            return False
    
    async def start_streaming(self, camera_index: int = 0):
        if not HAS_OPENCV:
            print("❌ OpenCV not available for camera")
            return
            
        try:
            # Try different camera backends on Windows
            if platform.system() == "Windows":
                self.camera = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
            else:
                self.camera = cv2.VideoCapture(camera_index)
                
            if not self.camera.isOpened():
                print(f"❌ Could not open camera {camera_index}")
                # Try alternative camera index
                for alt_index in [0, 1, 2]:
                    if alt_index != camera_index:
                        self.camera = cv2.VideoCapture(alt_index)
                        if self.camera.isOpened():
                            print(f"📷 Using alternative camera index {alt_index}")
                            break
                            
            if not self.camera.isOpened():
                print("❌ No camera available")
                return
                
            print(f"📷 Camera {camera_index} streaming started (target {self.fps} FPS, quality {self.quality})")
            
            frame_interval = 1.0 / self.fps
            
            while self.running:
                start_time = time.time()
                
                if not self.ws or not self.ws.open:
                    if not await self._reconnect():
                        break
                    continue
                
                ret, frame = self.camera.read()
                if not ret:
                    await asyncio.sleep(0.01)
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
                    print(f"⚠️ Camera send error: {e}")
                    if not await self._reconnect():
                        break
                    continue
                
                elapsed = time.time() - start_time
                if elapsed < frame_interval:
                    await asyncio.sleep(frame_interval - elapsed)
                    
        except Exception as e:
            print(f"❌ Camera streaming error: {e}")
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
            "connected": self.ws is not None and self.ws.open if self.ws else False,
        }
    
    def _cleanup(self):
        if self.camera:
            self.camera.release()
            self.camera = None
    
    async def stop(self):
        self.running = False
        self._cleanup()
        
        if self.ws:
            await self.ws.close()
            self.ws = None
            
        print("📷 Camera stream stopped")
    
    def get_available_cameras(self) -> List[Dict[str, Any]]:
        if not HAS_OPENCV:
            return []
            
        cameras = []
        for i in range(5):
            try:
                if platform.system() == "Windows":
                    cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
                else:
                    cap = cv2.VideoCapture(i)
                    
                if cap.isOpened():
                    cameras.append({
                        "index": i,
                        "name": f"Camera {i}",
                        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                    })
                    cap.release()
            except Exception:
                pass
        return cameras


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
        
        self.audio_streamer = AudioStreamer()
        self.camera_streamer = CameraStreamer()
        self.audio_session_id = None
        self.camera_session_id = None
        
        self._volume_cache = 50
        self._brightness_cache = 50
        self._last_cache_update = 0
        
        # Issue log
        self.issue_log: List[Dict[str, Any]] = []
        
    def _log_issue(self, category: str, message: str, level: str = "warning"):
        """Log an issue for debugging."""
        issue = {
            "timestamp": datetime.now().isoformat(),
            "category": category,
            "message": message,
            "level": level
        }
        self.issue_log.append(issue)
        if len(self.issue_log) > 100:
            self.issue_log = self.issue_log[-100:]
        print(f"[{level.upper()}] {category}: {message}")
        
    def _generate_device_key(self) -> str:
        import hashlib
        unique_string = f"{platform.node()}-{platform.machine()}-jarvis"
        return hashlib.sha256(unique_string.encode()).hexdigest()[:32]
    
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
        print("📡 Registering device...")
        
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
        except Exception as e:
            self._log_issue("registration", f"Failed to register device: {e}", "error")
            raise
    
    def _get_volume(self) -> int:
        if platform.system() == "Windows":
            try:
                # Try nircmd first (faster)
                nircmd_path = os.path.join(os.path.dirname(__file__), "nircmd.exe")
                if os.path.exists(nircmd_path):
                    return self._volume_cache
                
                # Try PowerShell AudioDeviceCmdlets
                result = subprocess.run(
                    ['powershell', '-Command', 
                     "(Get-AudioDevice -PlaybackVolume).Volume"],
                    capture_output=True, text=True, timeout=2
                )
                if result.returncode == 0 and result.stdout.strip():
                    return int(float(result.stdout.strip()))
            except Exception as e:
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
        
        if platform.system() == "Windows":
            try:
                # Try nircmd first (fastest)
                nircmd_path = os.path.join(os.path.dirname(__file__), "nircmd.exe")
                if os.path.exists(nircmd_path):
                    vol_value = int(level * 65535 / 100)
                    subprocess.run([nircmd_path, "setsysvolume", str(vol_value)], 
                                 capture_output=True, timeout=2)
                    print(f"🔊 Volume set to {level}% (nircmd)")
                    return {"success": True, "volume": level}
                
                # Try PowerShell AudioDeviceCmdlets
                subprocess.run([
                    'powershell', '-Command',
                    f'Set-AudioDevice -PlaybackVolume {level}'
                ], capture_output=True, timeout=3)
                print(f"🔊 Volume set to {level}%")
                return {"success": True, "volume": level}
            except Exception as e:
                try:
                    # Fallback: use media keys
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
        
        if platform.system() == "Windows" and HAS_BRIGHTNESS:
            try:
                sbc.set_brightness(level, display=0)
                print(f"☀️ Brightness set to {level}%")
                return {"success": True, "brightness": level}
            except Exception as e:
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
        print("⚠️ SHUTDOWN command received!")
        if platform.system() == "Windows":
            os.system("shutdown /s /t 5")
        elif platform.system() == "Darwin":
            os.system("sudo shutdown -h +1")
        else:
            os.system("shutdown -h +1")
        return {"success": True, "message": "Shutdown initiated"}
    
    def _restart(self):
        print("🔄 RESTART command received!")
        if platform.system() == "Windows":
            os.system("shutdown /r /t 5")
        elif platform.system() == "Darwin":
            os.system("sudo shutdown -r +1")
        else:
            os.system("shutdown -r +1")
        return {"success": True, "message": "Restart initiated"}
    
    def _sleep(self):
        print("😴 SLEEP command received!")
        if platform.system() == "Windows":
            os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
        elif platform.system() == "Darwin":
            os.system("pmset sleepnow")
        return {"success": True, "message": "Sleep initiated"}
    
    def _hibernate(self):
        print("❄️ HIBERNATE command received!")
        if platform.system() == "Windows":
            os.system("shutdown /h")
        else:
            return {"success": False, "error": "Hibernate not supported on this OS"}
        return {"success": True, "message": "Hibernate initiated"}
    
    def _lock_screen(self):
        print("🔒 LOCK command received!")
        self.is_locked = True
        if platform.system() == "Windows":
            ctypes.windll.user32.LockWorkStation()
        elif platform.system() == "Darwin":
            os.system("/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend")
        return {"success": True, "message": "Screen locked"}
    
    def _smart_unlock(self, pin: str):
        if pin != UNLOCK_PIN:
            print("❌ Invalid unlock PIN!")
            return {"success": False, "error": "Invalid PIN"}

        print("🔓 Smart unlock initiated...")
        self.is_locked = False

        if platform.system() == "Windows":
            try:
                # Wake the lock screen + focus PIN entry
                pyautogui.press("space")
                time.sleep(0.6)

                # Type PIN then confirm
                pyautogui.typewrite(pin, interval=0.05)
                time.sleep(0.2)
                pyautogui.press("enter")

                print("🔓 Smart unlock completed!")
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
        """Returns available monitor indices for capture (1..N)."""
        try:
            if not HAS_MSS:
                return {"success": True, "monitors": [{"index": 1, "name": "Primary"}]}

            with mss.mss() as sct:
                # mss.monitors[0] is "all"; 1..N are individual monitors
                mons = []
                for i in range(1, len(sct.monitors)):
                    m = sct.monitors[i]
                    mons.append({"index": i, "name": f"Monitor {i} ({m['width']}x{m['height']})"})
                return {"success": True, "monitors": mons}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _start_stream(self, fps: int = 5, quality: int = 50, scale: float = 0.6, monitor_index: int = 1) -> Dict[str, Any]:
        self.screen_streaming = True
        self.stream_fps = max(1, min(int(fps), 30))
        self.stream_quality = max(10, min(int(quality), 95))
        self._stream_scale = max(0.2, min(float(scale), 1.0))
        self._stream_monitor_index = int(monitor_index)
        return {"success": True, "fps": self.stream_fps, "quality": self.stream_quality, "scale": self._stream_scale, "monitor_index": self._stream_monitor_index}

    def _get_frame(self) -> Dict[str, Any]:
        if not self.screen_streaming:
            return {"success": False, "error": "Stream not started"}
        return self._take_screenshot(quality=self.stream_quality, scale=self._stream_scale, monitor_index=getattr(self, "_stream_monitor_index", 1))

    def _stop_stream(self) -> Dict[str, Any]:
        self.screen_streaming = False
        return {"success": True}
    
    def _type_text(self, text: str):
        try:
            if HAS_KEYBOARD:
                keyboard.write(text, delay=0.01)
            else:
                pyautogui.typewrite(text, interval=0.01)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _press_key(self, key: str):
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
        try:
            app_name = (app_name or "").strip()
            app_lower = app_name.lower().strip()
            app_id = (app_id or "").strip() or None

            print(f"🚀 Opening: {app_name} | app_id={app_id}")

            if platform.system() == "Windows":
                if app_id:
                    try:
                        subprocess.Popen(
                            f'explorer shell:AppsFolder\\{app_id}',
                            shell=True,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                        print(f"✅ Opened via AppID: {app_id}")
                        return {"success": True, "message": f"Opened {app_name}"}
                    except Exception as e:
                        print(f"⚠️ AppID launch failed, falling back to search: {e}")

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
                    print(f"✅ Opened via known path: {cmd}")
                    return {"success": True, "message": f"Opened {app_name}"}

                if not app_name:
                    return {"success": False, "error": "Missing app name"}

                print(f"🔍 Searching via Windows Search: {app_name}")
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
                print(f"❌ Closed: {app_name}")
                return {"success": True, "message": f"Closed {app_name}"}
            return {"success": False, "error": f"Process {app_name} not found"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_running_apps(self) -> Dict[str, Any]:
        """Best-effort list of running apps/processes."""
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
        """Windows: returns Start menu apps (Name + AppID). Other OS: empty list."""
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
    
    def _open_url(self, url: str):
        try:
            if not url.startswith("http://") and not url.startswith("https://"):
                url = "https://" + url
            
            webbrowser.open(url)
            print(f"🌐 Opened URL: {url}")
            return {"success": True, "message": f"Opened {url}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
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
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
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
                    print(f"⚠️ YouTube scrape failed, opening search page instead: {scrape_err}")
                    url = search_url

                webbrowser.open(url)
                print(f"🎵 Playing on YouTube: {query}")
                return {"success": True, "message": f"Playing {query} on YouTube"}

            service_urls = {
                "spotify": f"https://open.spotify.com/search/{urllib.parse.quote(query)}",
                "soundcloud": f"https://soundcloud.com/search?q={urllib.parse.quote(query)}",
                "apple": f"https://music.apple.com/search?term={urllib.parse.quote(query)}",
                "deezer": f"https://www.deezer.com/search/{urllib.parse.quote(query)}",
            }

            url = service_urls.get(service_lower) or f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
            webbrowser.open(url)
            print(f"🎵 Playing on {service}: {query}")
            return {"success": True, "message": f"Playing {query} on {service}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _media_control(self, action: str):
        """Control media playback (play/pause, next, previous, stop, mute, volume up/down)."""
        try:
            action_lower = action.lower().strip()

            if action_lower in ["play_pause", "playpause", "play", "pause"]:
                pyautogui.press("playpause")
                print("⏯️ Media play/pause")
            elif action_lower in ["next", "nexttrack", "forward"]:
                pyautogui.press("nexttrack")
                print("⏭️ Media next track")
            elif action_lower in ["previous", "prev", "prevtrack", "back"]:
                pyautogui.press("prevtrack")
                print("⏮️ Media previous track")
            elif action_lower == "stop":
                pyautogui.press("stop")
                print("⏹️ Media stop")
            elif action_lower == "mute":
                pyautogui.press("volumemute")
                print("🔇 Volume mute toggle")
            elif action_lower in ["volume_up", "volumeup"]:
                pyautogui.press("volumeup")
                print("🔊 Volume up")
            elif action_lower in ["volume_down", "volumedown"]:
                pyautogui.press("volumedown")
                print("🔉 Volume down")
            else:
                return {"success": False, "error": f"Unknown action: {action}"}

            return {"success": True, "action": action}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_media_state(self) -> Dict[str, Any]:
        """Get current media playback state (Windows only)."""
        try:
            if platform.system() != "Windows":
                return {"success": False, "error": "Only supported on Windows"}
            
            # Use PowerShell to query Windows Media Session
            ps_script = """
            Add-Type -AssemblyName System.Runtime.WindowsRuntime
            $async = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]::RequestAsync()
            $result = $async.GetAwaiter().GetResult()
            $session = $result.GetCurrentSession()
            if ($session) {
                $info = $session.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()
                $timeline = $session.GetTimelineProperties()
                $playback = $session.GetPlaybackInfo()
                @{
                    title = $info.Title
                    artist = $info.Artist
                    album = $info.AlbumTitle
                    is_playing = ($playback.PlaybackStatus -eq 'Playing')
                    position_ms = [int]$timeline.Position.TotalMilliseconds
                    duration_ms = [int]$timeline.EndTime.TotalMilliseconds
                    position_percent = if ($timeline.EndTime.TotalMilliseconds -gt 0) { [math]::Round(($timeline.Position.TotalMilliseconds / $timeline.EndTime.TotalMilliseconds) * 100, 1) } else { 0 }
                } | ConvertTo-Json
            } else {
                @{ title = ''; artist = ''; is_playing = $false; position_ms = 0; duration_ms = 0; position_percent = 0 } | ConvertTo-Json
            }
            """
            
            result = subprocess.run(
                ['powershell', '-Command', ps_script],
                capture_output=True, text=True, timeout=5
            )
            
            if result.returncode == 0 and result.stdout.strip():
                state = json.loads(result.stdout.strip())
                state["success"] = True
                state["volume"] = self._volume_cache
                state["muted"] = False
                return state
            
            # Fallback: return basic state
            return {
                "success": True,
                "title": "Unknown",
                "artist": "Unknown",
                "is_playing": False,
                "position_ms": 0,
                "duration_ms": 0,
                "position_percent": 0,
                "volume": self._volume_cache,
                "muted": False
            }
        except Exception as e:
            self._log_issue("media", f"Failed to get media state: {e}", "warning")
            return {
                "success": False,
                "error": str(e),
                "title": "No media",
                "artist": "",
                "is_playing": False
            }
    
    def _media_seek(self, position_percent: float):
        """Seek to position in current media (limited support)."""
        try:
            # This is limited - most apps don't support direct seeking via system
            print(f"⏩ Media seek to {position_percent}% (limited support)")
            return {"success": True, "message": "Seek command sent (limited support)"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_system_stats(self) -> Dict[str, Any]:
        """Get comprehensive system statistics."""
        try:
            cpu_percent = psutil.cpu_percent(interval=0.5)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            stats = {
                "success": True,
                "cpu_percent": cpu_percent,
                "memory_percent": memory.percent,
                "memory_used_gb": round(memory.used / (1024**3), 2),
                "memory_total_gb": round(memory.total / (1024**3), 2),
                "disk_percent": disk.percent,
                "disk_used_gb": round(disk.used / (1024**3), 2),
                "disk_total_gb": round(disk.total / (1024**3), 2),
            }
            
            # Battery info (if available)
            try:
                battery = psutil.sensors_battery()
                if battery:
                    stats["battery_percent"] = battery.percent
                    stats["battery_plugged"] = battery.power_plugged
            except:
                stats["battery_percent"] = None
                stats["battery_plugged"] = None
            
            return stats
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _boost_pc(self):
        """Boost PC performance by clearing temp files and refreshing explorer."""
        try:
            results = []
            
            if platform.system() == "Windows":
                # Clear temp files
                temp_dir = os.environ.get("TEMP", "")
                if temp_dir and os.path.exists(temp_dir):
                    deleted = 0
                    for item in os.listdir(temp_dir):
                        try:
                            item_path = os.path.join(temp_dir, item)
                            if os.path.isfile(item_path):
                                os.remove(item_path)
                                deleted += 1
                        except:
                            pass
                    results.append(f"Cleared {deleted} temp files")
                
                # Refresh Windows Explorer
                subprocess.run(["taskkill", "/f", "/im", "explorer.exe"], 
                             capture_output=True, timeout=5)
                subprocess.Popen(["explorer.exe"])
                results.append("Refreshed Windows Explorer")
                
            print(f"⚡ Boost completed: {', '.join(results)}")
            return {"success": True, "message": "; ".join(results)}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_cameras(self) -> Dict[str, Any]:
        """Get list of available cameras."""
        cameras = self.camera_streamer.get_available_cameras()
        return {"success": True, "cameras": cameras}
    
    def _get_issues(self) -> Dict[str, Any]:
        """Get recent issues from the log."""
        return {"success": True, "issues": self.issue_log[-50:]}
    
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
                return {"success": False, "error": "Failed to connect camera stream"}

            elif command_type == "stop_camera_stream":
                await self.camera_streamer.stop()
                self.camera_session_id = None
                return {"success": True}

            else:
                self._log_issue("command", f"Unknown command: {command_type}", "warning")
                return {"success": False, "error": f"Unknown command: {command_type}"}

        except Exception as e:
            self._log_issue("command", f"Error executing {command_type}: {e}", "error")
            return {"success": False, "error": str(e)}
    
    async def poll_commands(self):
        """Poll for pending commands."""
        while self.running:
            try:
                result = supabase.table("commands").select("*").eq(
                    "device_id", self.device_id
                ).eq("status", "pending").order("created_at").limit(10).execute()
                
                for cmd in result.data:
                    cmd_type = cmd["command_type"]
                    payload = cmd.get("payload") or {}
                    cmd_id = cmd["id"]
                    
                    print(f"📥 Executing: {cmd_type}")
                    
                    # Execute command
                    result_data = await self._handle_command(cmd_type, payload)
                    
                    # Update command status
                    supabase.table("commands").update({
                        "status": "completed" if result_data.get("success") else "failed",
                        "result": result_data,
                        "executed_at": datetime.now(timezone.utc).isoformat()
                    }).eq("id", cmd_id).execute()
                    
            except Exception as e:
                self._log_issue("polling", f"Poll error: {e}", "warning")
            
            await asyncio.sleep(POLL_INTERVAL)
    
    async def heartbeat(self):
        """Send periodic heartbeats."""
        while self.running:
            try:
                supabase.table("devices").update({
                    "is_online": True,
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "current_volume": self._get_volume(),
                    "current_brightness": self._get_brightness(),
                }).eq("id", self.device_id).execute()
            except Exception as e:
                self._log_issue("heartbeat", f"Heartbeat error: {e}", "warning")
            
            await asyncio.sleep(HEARTBEAT_INTERVAL)
    
    async def run(self):
        """Main run loop."""
        print("\n" + "="*50)
        print("🤖 JARVIS PC Agent v2.3")
        print("="*50)
        print(f"📍 Device: {DEVICE_NAME}")
        print(f"🔗 Backend: {SUPABASE_URL}")
        print(f"📷 Camera: {'✅' if HAS_OPENCV else '❌'}")
        print(f"🎤 Audio: {'✅' if HAS_PYAUDIO else '❌'}")
        print(f"🔌 WebSockets: {'✅' if HAS_WEBSOCKETS else '❌'}")
        print("="*50 + "\n")
        
        await self.register_device()
        
        print("\n✅ Agent running! Open the Jarvis web app to control this PC.")
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
        except:
            pass
        
        print("\n👋 Agent stopped. Goodbye!")


async def main():
    agent = JarvisAgent()
    
    try:
        await agent.run()
    except KeyboardInterrupt:
        await agent.shutdown()
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        await agent.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
