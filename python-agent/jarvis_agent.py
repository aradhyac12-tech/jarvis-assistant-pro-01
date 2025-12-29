"""
JARVIS PC Agent - Python Client v2.2
=====================================
Runs on your PC to execute commands from the Jarvis web dashboard.

SETUP INSTRUCTIONS:
------------------
1. Install Python 3.8+ from https://python.org

2. Install dependencies:
   pip install supabase pyautogui pillow psutil keyboard pycaw comtypes screen-brightness-control pyperclip mss pyaudio opencv-python websockets

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
# Prefer environment variables so remixes don't require code edits.
# You can set these on the PC before running:
#   - JARVIS_SUPABASE_URL
#   - JARVIS_SUPABASE_KEY
SUPABASE_URL = (
    os.environ.get("JARVIS_SUPABASE_URL")
    or os.environ.get("SUPABASE_URL")
    or "https://feridtduzdvlylaxozny.supabase.co"
)
SUPABASE_KEY = (
    os.environ.get("JARVIS_SUPABASE_KEY")
    or os.environ.get("SUPABASE_ANON_KEY")
    or os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    or "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlcmlkdGR1emR2bHlsYXhvem55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMDQ5MTAsImV4cCI6MjA4MjU4MDkxMH0.YDr2ZGqufqw32RkRK2ipuH0QaWTfffPjFDA8FM_kS3A"
)


def _project_ref_from_url(url: str) -> str:
    try:
        host = urllib.parse.urlparse(url).hostname or ""
        return host.split(".")[0] if host else "feridtduzdvlylaxozny"
    except Exception:
        return "feridtduzdvlylaxozny"


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
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


class AudioStreamer:
    """Handles bidirectional audio streaming between phone and PC.
    
    Supports:
    - Mic capture (input device)
    - System audio capture (WASAPI loopback on Windows)
    - Speaker playback (output device)
    """
    
    def __init__(self):
        self.running = False
        self.ws = None
        self.session_id = None
        self.direction = "phone_to_pc"  # or "pc_to_phone" or "bidirectional"
        self.use_system_audio = False  # When True, capture desktop audio instead of mic
        
        # Audio settings
        self.sample_rate = 44100
        self.channels = 2  # Stereo for system audio
        self.chunk_size = 1024
        self.format = pyaudio.paInt16 if HAS_PYAUDIO else None
        
        # PyAudio instances
        self.pa = None
        self.input_stream = None
        self.output_stream = None
        
        # Stats for debug
        self.bytes_sent = 0
        self.bytes_received = 0
        self.last_stats_time = time.time()
        
    async def connect(self, session_id: str, direction: str = "phone_to_pc", use_system_audio: bool = False):
        """Connect to the audio relay WebSocket."""
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
        """Find WASAPI loopback device for system audio capture (Windows only)."""
        if not HAS_PYAUDIO or platform.system() != "Windows":
            return None
            
        try:
            p = pyaudio.PyAudio()
            wasapi_info = None
            
            # Find WASAPI host API
            for i in range(p.get_host_api_count()):
                info = p.get_host_api_info_by_index(i)
                if "WASAPI" in info.get("name", ""):
                    wasapi_info = info
                    break
            
            if not wasapi_info:
                print("⚠️ WASAPI not found")
                p.terminate()
                return None
            
            # Find default output device as loopback source
            default_output = p.get_default_output_device_info()
            output_name = default_output.get("name", "")
            
            # Look for loopback device with same name
            for i in range(p.get_device_count()):
                dev_info = p.get_device_info_by_index(i)
                dev_name = dev_info.get("name", "")
                max_input = dev_info.get("maxInputChannels", 0)
                
                # Loopback devices show up as input devices with the speaker name
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
        """Start playing received audio through PC speakers."""
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
                        # Play audio data
                        self.output_stream.write(message)
                        self.bytes_received += len(message)
                    elif isinstance(message, str):
                        data = json.loads(message)
                        if data.get("type") == "peer_disconnected":
                            print("📱 Phone disconnected from audio relay")
                        elif data.get("type") == "audio":
                            # Base64 encoded audio
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
        """Start capturing PC audio (mic or system) and sending to phone."""
        if not HAS_PYAUDIO:
            print("❌ PyAudio not available for capture")
            return
            
        try:
            self.pa = self.pa or pyaudio.PyAudio()
            
            input_device_index = None
            channels = 1  # Default mono for mic
            
            # Try to use system audio (loopback) if requested
            if self.use_system_audio:
                loopback_idx = self._get_loopback_device_index()
                if loopback_idx is not None:
                    input_device_index = loopback_idx
                    channels = 2  # Stereo for system audio
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
                    # Read audio
                    audio_data = self.input_stream.read(self.chunk_size, exception_on_overflow=False)
                    
                    # Send as binary WebSocket message
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
        """Get streaming statistics."""
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
        """Stop audio streaming."""
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


# CAMERA_RELAY_WS_URL is derived from SUPABASE_URL in the CONFIGURATION section above.


class CameraStreamer:
    """Handles PC camera streaming to phone via dedicated camera-relay endpoint."""
    
    def __init__(self):
        self.running = False
        self.ws = None
        self.session_id = None
        self.camera = None
        self.quality = 50
        self.fps = 10
        
        # Stats for debug
        self.frame_count = 0
        self.bytes_sent = 0
        self.last_frame_time = 0
        self.last_stats_time = time.time()
        
        # Reconnect settings
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5
        
    async def connect(self, session_id: str, fps: int = 10, quality: int = 50):
        """Connect to dedicated camera relay WebSocket."""
        if not HAS_WEBSOCKETS or not HAS_OPENCV:
            print("❌ WebSockets or OpenCV not available")
            return False
            
        self.session_id = session_id
        self.fps = fps
        self.quality = quality
        
        # Use the dedicated camera-relay endpoint
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
        """Attempt to reconnect to the camera relay."""
        if self.reconnect_attempts >= self.max_reconnect_attempts:
            print("❌ Max reconnect attempts reached")
            return False
            
        self.reconnect_attempts += 1
        print(f"🔄 Reconnecting camera... (attempt {self.reconnect_attempts}/{self.max_reconnect_attempts})")
        
        await asyncio.sleep(1)  # Wait before reconnecting
        
        try:
            ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={self.session_id}&type=pc&fps={self.fps}&quality={self.quality}"
            self.ws = await websockets.connect(ws_url)
            print("✅ Camera stream reconnected")
            return True
        except Exception as e:
            print(f"❌ Reconnect failed: {e}")
            return False
    
    async def start_streaming(self, camera_index: int = 0):
        """Start streaming camera to phone with frame throttling."""
        if not HAS_OPENCV:
            print("❌ OpenCV not available for camera")
            return
            
        try:
            self.camera = cv2.VideoCapture(camera_index)
            if not self.camera.isOpened():
                print(f"❌ Could not open camera {camera_index}")
                return
                
            print(f"📷 Camera {camera_index} streaming started (target {self.fps} FPS, quality {self.quality})")
            
            frame_interval = 1.0 / self.fps
            
            while self.running:
                start_time = time.time()
                
                # Check WebSocket connection
                if not self.ws or not self.ws.open:
                    if not await self._reconnect():
                        break
                    continue
                
                ret, frame = self.camera.read()
                if not ret:
                    await asyncio.sleep(0.01)
                    continue
                
                # Resize for faster transfer
                frame = cv2.resize(frame, (640, 480))
                
                # Encode as JPEG
                _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, self.quality])
                frame_base64 = base64.b64encode(buffer).decode('utf-8')
                frame_size = len(buffer)
                
                # Send frame
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
                    # Try to reconnect
                    if not await self._reconnect():
                        break
                    continue
                
                # Maintain FPS
                elapsed = time.time() - start_time
                if elapsed < frame_interval:
                    await asyncio.sleep(frame_interval - elapsed)
                    
        except Exception as e:
            print(f"❌ Camera streaming error: {e}")
        finally:
            self._cleanup()
    
    def get_stats(self) -> Dict[str, Any]:
        """Get streaming statistics."""
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
        """Stop camera streaming."""
        self.running = False
        self._cleanup()
        
        if self.ws:
            await self.ws.close()
            self.ws = None
            
        print("📷 Camera stream stopped")
    
    def get_available_cameras(self) -> List[Dict[str, Any]]:
        """Get list of available cameras."""
        if not HAS_OPENCV:
            return []
            
        cameras = []
        for i in range(5):  # Check first 5 camera indices
            cap = cv2.VideoCapture(i)
            if cap.isOpened():
                cameras.append({
                    "index": i,
                    "name": f"Camera {i}",
                    "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                    "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                })
                cap.release()
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
        
        # Audio/Video streamers
        self.audio_streamer = AudioStreamer()
        self.camera_streamer = CameraStreamer()
        self.audio_session_id = None
        self.camera_session_id = None
        
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
            "has_audio": HAS_PYAUDIO,
            "has_camera": HAS_OPENCV,
            "has_websockets": HAS_WEBSOCKETS,
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
        """Get current system volume (0-100)."""
        if platform.system() == "Windows":
            try:
                result = subprocess.run(
                    ['powershell', '-Command', 
                     "(Get-AudioDevice -PlaybackVolume).Volume"],
                    capture_output=True, text=True, timeout=2
                )
                if result.returncode == 0 and result.stdout.strip():
                    return int(float(result.stdout.strip()))
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
                nircmd_path = os.path.join(os.path.dirname(__file__), "nircmd.exe")
                if os.path.exists(nircmd_path):
                    vol_value = int(level * 65535 / 100)
                    subprocess.run([nircmd_path, "setsysvolume", str(vol_value)], 
                                 capture_output=True, timeout=2)
                    print(f"🔊 Volume set to {level}% (nircmd)")
                    return {"success": True, "volume": level}
                
                subprocess.run([
                    'powershell', '-Command',
                    f'Set-AudioDevice -PlaybackVolume {level}'
                ], capture_output=True, timeout=3)
                print(f"🔊 Volume set to {level}%")
                return {"success": True, "volume": level}
            except Exception as e:
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
                ctypes.windll.user32.SetCursorPos(100, 100)
                pyautogui.move(1, 1)
                time.sleep(0.3)
                pyautogui.press('space')
                time.sleep(0.5)
                pyautogui.press('enter')
                time.sleep(0.3)
                pyautogui.typewrite(pin, interval=0.05)
                time.sleep(0.2)
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
                with mss.mss() as sct:
                    monitor = sct.monitors[1]
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
        """Press a keyboard key with comprehensive mapping."""
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

            raw = (key or "").lower().strip()
            mapped_key = key_map.get(raw, raw)

            try:
                if HAS_KEYBOARD:
                    keyboard.press_and_release(mapped_key)
                else:
                    pyautogui.press(mapped_key)

                print(f"⌨️ Key pressed: {key} -> {mapped_key}")
                return {"success": True, "key": key}
            except Exception as e:
                if raw in {
                    "mediaplaypause", "playpause", "play_pause",
                    "medianexttrack", "nexttrack", "next_track",
                    "mediaprevioustrack", "prevtrack", "prev_track",
                    "mediastop", "stop",
                }:
                    action_map = {
                        "mediaplaypause": "play_pause",
                        "playpause": "play_pause",
                        "play_pause": "play_pause",
                        "medianexttrack": "next",
                        "nexttrack": "next",
                        "next_track": "next",
                        "mediaprevioustrack": "previous",
                        "prevtrack": "previous",
                        "prev_track": "previous",
                        "mediastop": "stop",
                        "stop": "stop",
                    }
                    action = action_map.get(raw, "play_pause")
                    print(f"🎵 Media key fallback: {raw} -> media_control({action})")
                    return self._media_control(action)
                raise e

        except Exception as e:
            print(f"❌ press_key: {e}")
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
        """Move mouse cursor."""
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
    
    def _open_app(self, app_name: str, app_id: Optional[str] = None):
        """Open an application."""
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

    def _search_app(self, app_name: str):
        """Search for an app using Windows Search and open it."""
        try:
            print(f"🔍 Searching for app: {app_name}")
            if platform.system() == "Windows":
                pyautogui.press('win')
                time.sleep(0.4)
                pyautogui.typewrite(app_name, interval=0.02)
                time.sleep(0.6)
                pyautogui.press('enter')
                return {"success": True, "message": f"Searched and launched: {app_name}"}
            else:
                return self._open_app(app_name)
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
    
    def _open_url(self, url: str):
        """Open a URL in the default browser."""
        try:
            if not url.startswith("http://") and not url.startswith("https://"):
                url = "https://" + url
            
            webbrowser.open(url)
            print(f"🌐 Opened URL: {url}")
            return {"success": True, "message": f"Opened {url}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _open_website(self, site: str, query: str = ""):
        """Open a specific website, optionally with a search query."""
        try:
            site_lower = site.lower().strip()
            
            # Site URLs: (base_url, search_url_pattern)
            # For ChatGPT and Perplexity, we open and type the query directly for better UX
            site_urls = {
                "google": ("https://www.google.com", "https://www.google.com/search?q="),
                "youtube": ("https://www.youtube.com", "https://www.youtube.com/results?search_query="),
                "chatgpt": ("https://chatgpt.com", None),  # Will handle separately
                "perplexity": ("https://www.perplexity.ai", None),  # Will handle separately
                "wikipedia": ("https://www.wikipedia.org", "https://en.wikipedia.org/wiki/Special:Search?search="),
                "github": ("https://github.com", "https://github.com/search?q="),
                "reddit": ("https://www.reddit.com", "https://www.reddit.com/search/?q="),
                "twitter": ("https://twitter.com", "https://twitter.com/search?q="),
                "x": ("https://x.com", "https://x.com/search?q="),
                "facebook": ("https://www.facebook.com", "https://www.facebook.com/search/top/?q="),
                "instagram": ("https://www.instagram.com", "https://www.instagram.com/explore/tags/"),
                "linkedin": ("https://www.linkedin.com", "https://www.linkedin.com/search/results/all/?keywords="),
                "amazon": ("https://www.amazon.com", "https://www.amazon.com/s?k="),
                "ebay": ("https://www.ebay.com", "https://www.ebay.com/sch/i.html?_nkw="),
                "netflix": ("https://www.netflix.com", "https://www.netflix.com/search?q="),
                "spotify": ("https://open.spotify.com", "https://open.spotify.com/search/"),
                "twitch": ("https://www.twitch.tv", "https://www.twitch.tv/search?term="),
                "stackoverflow": ("https://stackoverflow.com", "https://stackoverflow.com/search?q="),
                "gmail": ("https://mail.google.com", None),
                "drive": ("https://drive.google.com", None),
                "maps": ("https://maps.google.com", "https://www.google.com/maps/search/"),
                "news": ("https://news.google.com", "https://news.google.com/search?q="),
            }
            
            # Special handling for ChatGPT - open and type query
            if site_lower == "chatgpt" and query:
                webbrowser.open("https://chatgpt.com")
                time.sleep(2)  # Wait for page to load
                pyautogui.typewrite(query, interval=0.02)
                time.sleep(0.3)
                pyautogui.press("enter")
                print(f"🌐 Opened ChatGPT and searched: {query}")
                return {"success": True, "message": f"Opened ChatGPT with query: {query}"}
            
            # Special handling for Perplexity - open and type query  
            if site_lower == "perplexity" and query:
                webbrowser.open("https://www.perplexity.ai")
                time.sleep(2)  # Wait for page to load
                pyautogui.typewrite(query, interval=0.02)
                time.sleep(0.3)
                pyautogui.press("enter")
                print(f"🌐 Opened Perplexity and searched: {query}")
                return {"success": True, "message": f"Opened Perplexity with query: {query}"}
            
            if site_lower in site_urls:
                base_url, search_url = site_urls[site_lower]
                if query and search_url:
                    url = search_url + urllib.parse.quote(query)
                else:
                    url = base_url
            else:
                if not site_lower.startswith("http"):
                    url = f"https://{site_lower}"
                    if "." not in site_lower:
                        url += ".com"
                else:
                    url = site
            
            webbrowser.open(url)
            print(f"🌐 Opened: {url}")
            return {"success": True, "message": f"Opened {site}" + (f" with query: {query}" if query else "")}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _search_web(self, query: str, engine: str = "google"):
        """Search the web with a query."""
        try:
            engine_lower = engine.lower()
            
            # Special handling for ChatGPT - open and type query
            if engine_lower == "chatgpt":
                webbrowser.open("https://chatgpt.com")
                time.sleep(2)  # Wait for page to load
                pyautogui.typewrite(query, interval=0.02)
                time.sleep(0.3)
                pyautogui.press("enter")
                print(f"🔎 ChatGPT: {query}")
                return {"success": True, "message": f"Searching ChatGPT for: {query}"}
            
            # Special handling for Perplexity - open and type query
            if engine_lower == "perplexity":
                webbrowser.open("https://www.perplexity.ai")
                time.sleep(2)  # Wait for page to load
                pyautogui.typewrite(query, interval=0.02)
                time.sleep(0.3)
                pyautogui.press("enter")
                print(f"🔎 Perplexity: {query}")
                return {"success": True, "message": f"Searching Perplexity for: {query}"}
            
            search_urls = {
                "google": f"https://www.google.com/search?q={urllib.parse.quote(query)}",
                "bing": f"https://www.bing.com/search?q={urllib.parse.quote(query)}",
                "duckduckgo": f"https://duckduckgo.com/?q={urllib.parse.quote(query)}",
                "youtube": f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}",
                "wikipedia": f"https://en.wikipedia.org/wiki/Special:Search?search={urllib.parse.quote(query)}",
            }
            
            url = search_urls.get(engine_lower, search_urls["google"])
            webbrowser.open(url)
            print(f"🔎 Searching {engine}: {query}")
            return {"success": True, "message": f"Searching {engine} for: {query}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _play_music(self, query: str, service: str = "youtube"):
        """Search and play music on a streaming service.

        For YouTube, this opens the FIRST video result automatically.
        """
        try:
            service_lower = (service or "youtube").lower().strip()
            query = (query or "").strip()

            if not query:
                return {"success": False, "error": "Missing query"}

            # YouTube: open first result automatically (no API key)
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

                    # Find first /watch?v=... occurrence
                    import re

                    m = re.search(r"\/watch\?v=([a-zA-Z0-9_-]{11})", html)
                    if m:
                        video_id = m.group(1)
                        url = f"https://www.youtube.com/watch?v={video_id}&autoplay=1"
                    else:
                        # fallback: open search page
                        url = search_url
                except Exception as scrape_err:
                    print(f"⚠️ YouTube scrape failed, opening search page instead: {scrape_err}")
                    url = search_url

                webbrowser.open(url)
                print(f"🎵 Playing (first result) on YouTube: {query}")
                return {"success": True, "message": f"Playing {query} on YouTube"}

            service_urls = {
                "spotify": f"https://open.spotify.com/search/{urllib.parse.quote(query)}",
                "soundcloud": f"https://soundcloud.com/search?q={urllib.parse.quote(query)}",
                "apple": f"https://music.apple.com/search?term={urllib.parse.quote(query)}",
                "deezer": f"https://www.deezer.com/search/{urllib.parse.quote(query)}",
            }

            url = service_urls.get(service_lower) or f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
            webbrowser.open(url)
            print(f"🎵 Playing music: {query} on {service_lower}")
            return {"success": True, "message": f"Playing {query} on {service_lower}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_media_state(self) -> Dict[str, Any]:
        """Get current media playback state (Windows only)."""
        try:
            if platform.system() != "Windows":
                return {"success": False, "error": "Only supported on Windows"}
            
            # Use Windows Media Session API via PowerShell
            ps_script = '''
            Add-Type -AssemblyName System.Runtime.WindowsRuntime
            $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
            $async = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
            $sessions = $null
            
            # Wait for async operation
            $task = $async.AsTask()
            $task.Wait(2000)
            
            if ($task.IsCompleted) {
                $sessions = $task.Result
                $current = $sessions.GetCurrentSession()
                
                if ($null -ne $current) {
                    $info = $current.TryGetMediaPropertiesAsync().AsTask()
                    $info.Wait(1000)
                    $props = $info.Result
                    
                    $playback = $current.GetPlaybackInfo()
                    $timeline = $current.GetTimelineProperties()
                    
                    @{
                        title = $props.Title
                        artist = $props.Artist
                        album = $props.AlbumTitle
                        is_playing = $playback.PlaybackStatus -eq 'Playing'
                        position_ms = [int]$timeline.Position.TotalMilliseconds
                        duration_ms = [int]$timeline.EndTime.TotalMilliseconds
                    } | ConvertTo-Json
                } else {
                    @{ title = ""; artist = ""; is_playing = $false; position_ms = 0; duration_ms = 0 } | ConvertTo-Json
                }
            } else {
                @{ error = "Timeout getting media session" } | ConvertTo-Json
            }
            '''
            
            result = subprocess.run(
                ['powershell', '-NoProfile', '-Command', ps_script],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout.strip():
                data = json.loads(result.stdout.strip())
                if "error" in data:
                    return {"success": False, "error": data["error"]}
                
                # Calculate position percentage
                position_percent = 0
                if data.get("duration_ms", 0) > 0:
                    position_percent = (data.get("position_ms", 0) / data["duration_ms"]) * 100
                
                return {
                    "success": True,
                    "title": data.get("title", ""),
                    "artist": data.get("artist", ""),
                    "album": data.get("album", ""),
                    "is_playing": data.get("is_playing", False),
                    "position_ms": data.get("position_ms", 0),
                    "duration_ms": data.get("duration_ms", 0),
                    "position_percent": round(position_percent, 1),
                    "volume": self._get_volume(),
                    "muted": False,  # Would need additional API for mute state
                }
            else:
                return {
                    "success": True,
                    "title": "",
                    "artist": "",
                    "is_playing": False,
                    "position_ms": 0,
                    "duration_ms": 0,
                    "position_percent": 0,
                    "volume": self._get_volume(),
                    "muted": False,
                }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Media state query timed out"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _media_seek(self, position_percent: float):
        """Seek to a position in the current media (limited support)."""
        # Note: Windows doesn't have a universal way to seek media
        # This would need app-specific implementations
        return {"success": False, "error": "Seeking not supported on all media players"}

    def _media_control(self, action: str):
        """Control media playback using Windows virtual key codes."""
        try:
            action_lower = action.lower().strip()
            
            if platform.system() == "Windows":
                VK_MEDIA_PLAY_PAUSE = 0xB3
                VK_MEDIA_NEXT_TRACK = 0xB0
                VK_MEDIA_PREV_TRACK = 0xB1
                VK_MEDIA_STOP = 0xB2
                VK_VOLUME_UP = 0xAF
                VK_VOLUME_DOWN = 0xAE
                VK_VOLUME_MUTE = 0xAD
                
                action_map = {
                    "play_pause": VK_MEDIA_PLAY_PAUSE,
                    "playpause": VK_MEDIA_PLAY_PAUSE,
                    "play": VK_MEDIA_PLAY_PAUSE,
                    "pause": VK_MEDIA_PLAY_PAUSE,
                    "next": VK_MEDIA_NEXT_TRACK,
                    "next_track": VK_MEDIA_NEXT_TRACK,
                    "nexttrack": VK_MEDIA_NEXT_TRACK,
                    "previous": VK_MEDIA_PREV_TRACK,
                    "prev": VK_MEDIA_PREV_TRACK,
                    "prev_track": VK_MEDIA_PREV_TRACK,
                    "prevtrack": VK_MEDIA_PREV_TRACK,
                    "stop": VK_MEDIA_STOP,
                    "volume_up": VK_VOLUME_UP,
                    "volumeup": VK_VOLUME_UP,
                    "volume_down": VK_VOLUME_DOWN,
                    "volumedown": VK_VOLUME_DOWN,
                    "mute": VK_VOLUME_MUTE,
                    "volumemute": VK_VOLUME_MUTE,
                }
                
                vk_code = action_map.get(action_lower)
                
                if vk_code:
                    KEYEVENTF_KEYUP = 0x0002
                    ctypes.windll.user32.keybd_event(vk_code, 0, 0, 0)
                    time.sleep(0.05)
                    ctypes.windll.user32.keybd_event(vk_code, 0, KEYEVENTF_KEYUP, 0)
                    
                    print(f"🎵 Media control: {action}")
                    return {"success": True, "action": action}
                else:
                    return {"success": False, "error": f"Unknown media action: {action}"}
            else:
                key_map = {
                    "play_pause": "playpause",
                    "next": "nexttrack",
                    "previous": "prevtrack",
                    "stop": "stop",
                }
                key = key_map.get(action_lower, action_lower)
                pyautogui.press(key)
                print(f"🎵 Media: {action}")
                return {"success": True, "action": action}
                
        except Exception as e:
            print(f"❌ media_control error: {e}")
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
            apps: List[Dict[str, Any]] = []

            if platform.system() == "Windows":
                try:
                    ps = subprocess.run(
                        [
                            "powershell",
                            "-NoProfile",
                            "-Command",
                            "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Depth 2",
                        ],
                        capture_output=True,
                        text=True,
                        timeout=8,
                    )

                    if ps.returncode == 0 and ps.stdout.strip():
                        data = json.loads(ps.stdout)
                        if isinstance(data, dict):
                            data = [data]

                        for item in data:
                            name = (item.get("Name") or "").strip()
                            app_id = (item.get("AppID") or "").strip() or None
                            if name:
                                apps.append({"name": name, "app_id": app_id, "source": "StartApps"})
                except Exception as e:
                    print(f"⚠️ Get-StartApps failed: {e}")

                if not apps:
                    start_menu = os.path.join(
                        os.environ.get("APPDATA", ""), "Microsoft\\Windows\\Start Menu\\Programs"
                    )
                    if os.path.exists(start_menu):
                        for root, _dirs, files in os.walk(start_menu):
                            for file in files:
                                if file.endswith(".lnk"):
                                    apps.append({"name": file[:-4], "app_id": None, "source": "StartMenu"})

            seen = set()
            deduped = []
            for a in sorted(apps, key=lambda x: x["name"].lower()):
                k = a["name"].lower()
                if k in seen:
                    continue
                seen.add(k)
                deduped.append(a)

            return {"success": True, "apps": deduped[:1000]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_system_stats(self) -> Dict[str, Any]:
        """Get current system statistics."""
        try:
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            battery = psutil.sensors_battery()
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
        """Boost PC performance."""
        try:
            results = []
            
            if platform.system() == "Windows":
                os.system("taskkill /f /im explorer.exe")
                time.sleep(0.5)
                os.system("start explorer.exe")
                results.append("Explorer restarted")
                
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
        print(f"📺 Screen streaming started at {self.stream_fps} FPS, quality {self.stream_quality}")
        return {"success": True, "streaming": True, "fps": self.stream_fps, "quality": self.stream_quality}
    
    def _stop_screen_stream(self):
        """Stop screen streaming mode."""
        self.screen_streaming = False
        print("📺 Screen streaming stopped")
        return {"success": True, "streaming": False, "message": "Streaming stopped"}
    
    # ==================== AUDIO/VIDEO STREAMING ====================
    
    async def _start_audio_relay(self, session_id: str, direction: str = "phone_to_pc", use_system_audio: bool = False):
        """Start audio relay - connect to WebSocket and stream audio."""
        try:
            self.audio_session_id = session_id
            connected = await self.audio_streamer.connect(session_id, direction, use_system_audio)
            
            if not connected:
                return {"success": False, "error": "Failed to connect to audio relay"}
            
            # Start appropriate streaming based on direction
            if direction == "phone_to_pc":
                asyncio.create_task(self.audio_streamer.start_playback())
            elif direction == "pc_to_phone":
                asyncio.create_task(self.audio_streamer.start_capture())
            elif direction == "bidirectional":
                asyncio.create_task(self.audio_streamer.start_playback())
                asyncio.create_task(self.audio_streamer.start_capture())
            
            return {
                "success": True, 
                "message": f"Audio relay started ({direction}, system_audio={use_system_audio})",
                "session_id": session_id,
                "direction": direction,
                "use_system_audio": use_system_audio
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _stop_audio_relay(self):
        """Stop audio relay."""
        try:
            await self.audio_streamer.stop()
            self.audio_session_id = None
            return {"success": True, "message": "Audio relay stopped"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_audio_stats(self):
        """Get audio streaming statistics."""
        return {"success": True, **self.audio_streamer.get_stats()}
    
    async def _start_camera_stream(self, session_id: str, camera_index: int = 0, fps: int = 10, quality: int = 50):
        """Start PC camera streaming to phone."""
        try:
            if not HAS_OPENCV:
                return {"success": False, "error": "OpenCV not available"}
            
            self.camera_session_id = session_id
            connected = await self.camera_streamer.connect(session_id, fps, quality)
            
            if not connected:
                return {"success": False, "error": "Failed to connect camera stream"}
            
            asyncio.create_task(self.camera_streamer.start_streaming(camera_index))
            
            return {
                "success": True,
                "message": f"Camera stream started (camera {camera_index}, {fps} FPS)",
                "session_id": session_id,
                "fps": fps,
                "quality": quality
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _stop_camera_stream(self):
        """Stop PC camera streaming."""
        try:
            await self.camera_streamer.stop()
            self.camera_session_id = None
            return {"success": True, "message": "Camera stream stopped"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_camera_stats(self):
        """Get camera streaming statistics."""
        return {"success": True, **self.camera_streamer.get_stats()}
    
    def _get_cameras(self):
        """Get list of available cameras."""
        cameras = self.camera_streamer.get_available_cameras()
        return {"success": True, "cameras": cameras}
    
    def _get_dependency_status(self):
        """Get status of all optional dependencies."""
        deps = {
            "pyaudio": {"installed": HAS_PYAUDIO, "purpose": "Audio streaming (mic/speaker)"},
            "opencv": {"installed": HAS_OPENCV, "purpose": "Camera streaming"},
            "websockets": {"installed": HAS_WEBSOCKETS, "purpose": "Real-time streaming"},
            "keyboard": {"installed": HAS_KEYBOARD, "purpose": "Keyboard control"},
            "mss": {"installed": HAS_MSS, "purpose": "Fast screenshots"},
            "pycaw": {"installed": HAS_PYCAW, "purpose": "Volume control (Windows)"},
            "brightness": {"installed": HAS_BRIGHTNESS, "purpose": "Brightness control"},
        }
        
        missing = [name for name, info in deps.items() if not info["installed"]]
        all_installed = len(missing) == 0
        
        return {
            "success": True,
            "all_installed": all_installed,
            "missing_count": len(missing),
            "missing": missing,
            "dependencies": deps,
            "install_command": "pip install pyaudio opencv-python websockets keyboard mss pycaw screen-brightness-control" if missing else None
        }

    
    def execute_command(self, command_type: str, payload: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute a command based on type."""
        payload = payload or {}
        
        # Handle async commands - spawn in background thread to avoid blocking
        async_commands = {
            "start_audio_relay",
            "stop_audio_relay",
            "start_camera_stream",
            "stop_camera_stream",
        }
        
        if command_type in async_commands:
            def run_async_command():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    if command_type == "start_audio_relay":
                        loop.run_until_complete(self._start_audio_relay(
                            payload.get("session_id", str(uuid.uuid4())),
                            payload.get("direction", "phone_to_pc"),
                            payload.get("use_system_audio", False)
                        ))
                    elif command_type == "stop_audio_relay":
                        loop.run_until_complete(self._stop_audio_relay())
                    elif command_type == "start_camera_stream":
                        loop.run_until_complete(self._start_camera_stream(
                            payload.get("session_id", str(uuid.uuid4())),
                            payload.get("camera_index", 0),
                            payload.get("fps", 10),
                            payload.get("quality", 50)
                        ))
                    elif command_type == "stop_camera_stream":
                        loop.run_until_complete(self._stop_camera_stream())
                except Exception as e:
                    print(f"❌ Async command error: {e}")
                finally:
                    loop.close()
            
            # Start in background thread
            thread = threading.Thread(target=run_async_command, daemon=True)
            thread.start()
            return {"success": True, "message": f"Started {command_type}"}
        
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
            "open_app": lambda: self._open_app(payload.get("app_name", ""), payload.get("app_id", None)),
            "search_app": lambda: self._search_app(payload.get("app_name", "")),
            "close_app": lambda: self._close_app(payload.get("app_name", "")),
            "get_running_apps": self._get_running_apps,
            "get_installed_apps": self._get_installed_apps,

            # Files
            "list_files": lambda: self._list_files(payload.get("path", "~")),
            "open_file": lambda: self._open_file(payload.get("path", "")),
            
            # Web / URLs
            "open_url": lambda: self._open_url(payload.get("url", "")),
            "open_website": lambda: self._open_website(
                payload.get("site", ""),
                payload.get("query", "")
            ),
            "search_web": lambda: self._search_web(
                payload.get("query", ""),
                payload.get("engine", "google")
            ),
            
            # Music & Media
            "play_music": lambda: self._play_music(
                payload.get("query", ""),
                payload.get("service", "youtube")
            ),
            "media_control": lambda: self._media_control(payload.get("action", "")),
            "get_media_state": self._get_media_state,
            "media_seek": lambda: self._media_seek(payload.get("position_percent", 0)),
            
            # System
            "get_system_stats": self._get_system_stats,
            "boost": self._boost_pc,
            
            # Camera & Streaming
            "get_cameras": self._get_cameras,
            "get_audio_stats": self._get_audio_stats,
            "get_camera_stats": self._get_camera_stats,
            
            # Health check
            "get_dependency_status": self._get_dependency_status,
        }
        
        handler = command_handlers.get(command_type)
        if handler:
            try:
                return handler()
            except Exception as e:
                print(f"❌ Command error ({command_type}): {e}")
                return {"success": False, "error": str(e)}
        else:
            print(f"⚠️ Unknown command: {command_type}")
            return {"success": False, "error": f"Unknown command: {command_type}"}
    
    async def update_heartbeat(self):
        """Update device heartbeat."""
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
        print("🤖 JARVIS Agent v2.2 is now running!")
        print(f"📍 Device: {DEVICE_NAME}")
        print(f"🔑 Device ID: {self.device_id[:8]}...")
        print(f"⚡ Poll interval: {POLL_INTERVAL}s (fast mode)")
        print(f"🔊 Audio relay: {'✅ Available' if HAS_PYAUDIO else '❌ Not available'}")
        print(f"📷 Camera: {'✅ Available' if HAS_OPENCV else '❌ Not available'}")
        print("="*50)
        print("\n👀 Open the Jarvis web app to see your PC connected.")
        print("📱 You can now control your PC from your phone!")
        print("🛑 Press Ctrl+C to stop.\n")
        
        try:
            await asyncio.gather(
                self.poll_commands(),
                self.update_heartbeat()
            )
        except KeyboardInterrupt:
            print("\n\n👋 Shutting down...")
            self.running = False
            
            # Cleanup streamers
            await self.audio_streamer.stop()
            await self.camera_streamer.stop()
            
            supabase.table("devices").update({
                "is_online": False,
            }).eq("id", self.device_id).execute()
            print("✅ Device marked offline. Goodbye!")


def main():
    """Main entry point."""
    print("""
    ╔═══════════════════════════════════════════════════════╗
    ║           JARVIS PC Agent v2.2                        ║
    ║       Your AI-Powered PC Assistant                    ║
    ╠═══════════════════════════════════════════════════════╣
    ║  This agent connects your PC to the Jarvis web app.   ║
    ║  Features:                                            ║
    ║  • Control volume, brightness, power                  ║
    ║  • Open apps, files, websites                        ║
    ║  • Media controls, music player                      ║
    ║  • Screen streaming                                  ║
    ║  • Audio relay (phone ↔ PC)                          ║
    ║  • Camera streaming (PC → phone)                     ║
    ║  • System monitoring                                 ║
    ╚═══════════════════════════════════════════════════════╝
    """)
    
    agent = JarvisAgent()
    
    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")


if __name__ == "__main__":
    main()
