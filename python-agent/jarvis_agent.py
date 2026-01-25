"""
JARVIS PC Agent - Python Client v2.5 (AI Voice Control Edition)
================================================================
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
- App Control: Open/close applications, list running apps, search and launch
- File Browser: Navigate, search, and open files/folders
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

AI VOICE FEATURES (v2.5):
-------------------------
- Voice-controlled app opening/closing
- Voice search for files
- Voice-triggered media playback
- Voice volume/brightness control
- Voice lock/unlock/sleep/restart/shutdown
- Mobile integration: Make calls, send SMS, WhatsApp, Email via voice
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

# Native GUI
try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext
    HAS_TKINTER = True
except ImportError:
    HAS_TKINTER = False
    print("⚠️  tkinter not available - GUI disabled")


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

# Voice Recognition for wake word
try:
    import speech_recognition as sr
    HAS_SPEECH_RECOGNITION = True
except ImportError:
    HAS_SPEECH_RECOGNITION = False
    print("⚠️  SpeechRecognition not installed - voice control disabled")

# Text-to-Speech (offline)
try:
    import pyttsx3
    HAS_TTS = True
except ImportError:
    HAS_TTS = False
    print("⚠️  pyttsx3 not installed - voice responses disabled")

# System Tray
try:
    import pystray
    from pystray import MenuItem as item
    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False
    print("⚠️  pystray not installed - system tray disabled")

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
        print("⚠️  win10toast not installed - notifications disabled")

# Windows-specific imports
if platform.system() == "Windows":
    try:
        from pycaw.pycaw import AudioUtilities, ISimpleAudioVolume, IAudioEndpointVolume
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
DEFAULT_JARVIS_URL = "https://giihgligzrokdzonyzjo.supabase.co"
DEFAULT_JARVIS_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpaWhnbGlnenJva2R6b255empvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNDM0MzEsImV4cCI6MjA4NDYxOTQzMX0.u1-OYznEnWr-i0PIJIDolcxxVh79HNBolfBpWa6ffAU"
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
    "voice_listening": False,
    "voice_active": False,
    "last_voice_command": "",
}


# ============== NOTIFICATION SYSTEM ==============
class NotificationManager:
    """Handles Windows notifications."""
    
    def __init__(self):
        self.toaster = None
        if HAS_TOAST:
            try:
                self.toaster = ToastNotifier()
            except Exception as e:
                print(f"⚠️  Toast notification init failed: {e}")
    
    def notify(self, title: str, message: str, duration: int = 5):
        """Show a Windows notification."""
        if self.toaster:
            try:
                self.toaster.show_toast(
                    title,
                    message,
                    duration=duration,
                    threaded=True,
                    icon_path=None
                )
            except Exception as e:
                add_log("warn", f"Notification failed: {e}", category="system")
        else:
            add_log("info", f"[Notification] {title}: {message}", category="system")


notification_manager = NotificationManager()


# ============== VOICE LISTENER (Wake Word Detection) ==============
class VoiceListener:
    """Continuous voice listener with wake word detection."""
    
    def __init__(self, wake_word: str = "jarvis", on_command=None):
        self.wake_word = wake_word.lower()
        self.on_command = on_command
        self.running = False
        self.listening = False
        self.recognizer = None
        self.microphone = None
        self.tts_engine = None
        self.command_callback = None
        self.last_command = ""
        self.listen_thread = None
        
        # Initialize speech recognition
        if HAS_SPEECH_RECOGNITION:
            self.recognizer = sr.Recognizer()
            self.recognizer.energy_threshold = 300
            self.recognizer.dynamic_energy_threshold = True
            self.recognizer.pause_threshold = 0.8
        
        # Initialize TTS
        if HAS_TTS:
            try:
                self.tts_engine = pyttsx3.init()
                voices = self.tts_engine.getProperty('voices')
                # Try to find a male English voice
                for voice in voices:
                    if 'male' in voice.name.lower() or 'david' in voice.name.lower():
                        self.tts_engine.setProperty('voice', voice.id)
                        break
                self.tts_engine.setProperty('rate', 180)
                self.tts_engine.setProperty('volume', 0.9)
            except Exception as e:
                print(f"⚠️  TTS init failed: {e}")
                self.tts_engine = None
    
    def speak(self, text: str):
        """Speak text using TTS."""
        if self.tts_engine:
            try:
                self.tts_engine.say(text)
                self.tts_engine.runAndWait()
            except Exception as e:
                add_log("warn", f"TTS error: {e}", category="voice")
    
    def start(self):
        """Start continuous listening."""
        if not HAS_SPEECH_RECOGNITION:
            add_log("error", "Speech recognition not available", category="voice")
            return False
        
        if self.running:
            return True
        
        self.running = True
        self.listen_thread = threading.Thread(target=self._listen_loop, daemon=True)
        self.listen_thread.start()
        
        add_log("info", f"Voice listener started (wake word: '{self.wake_word}')", category="voice")
        notification_manager.notify("JARVIS Voice Active", f"Say '{self.wake_word.capitalize()}' to activate")
        update_agent_status({"voice_listening": True})
        return True
    
    def stop(self):
        """Stop listening."""
        self.running = False
        self.listening = False
        update_agent_status({"voice_listening": False, "voice_active": False})
        add_log("info", "Voice listener stopped", category="voice")
    
    def _listen_loop(self):
        """Main listening loop running in background thread."""
        try:
            with sr.Microphone() as source:
                add_log("info", "Calibrating microphone...", category="voice")
                self.recognizer.adjust_for_ambient_noise(source, duration=1)
                add_log("info", "Microphone ready. Listening for wake word...", category="voice")
                
                while self.running:
                    try:
                        self.listening = True
                        update_agent_status({"voice_listening": True})
                        
                        # Listen for audio
                        audio = self.recognizer.listen(source, timeout=5, phrase_time_limit=10)
                        
                        # Recognize speech
                        try:
                            text = self.recognizer.recognize_google(audio).lower()
                            add_log("info", f"Heard: {text}", category="voice")
                            
                            # Check for wake word
                            if self.wake_word in text:
                                update_agent_status({"voice_active": True})
                                
                                # Extract command after wake word
                                wake_index = text.find(self.wake_word)
                                command = text[wake_index + len(self.wake_word):].strip()
                                
                                if command:
                                    self._process_command(command)
                                else:
                                    # Wake word detected but no command - wait for command
                                    self.speak("Yes sir?")
                                    notification_manager.notify("JARVIS", "Listening for command...")
                                    
                                    # Listen for follow-up command
                                    try:
                                        follow_up = self.recognizer.listen(source, timeout=5, phrase_time_limit=10)
                                        command = self.recognizer.recognize_google(follow_up).lower()
                                        self._process_command(command)
                                    except sr.WaitTimeoutError:
                                        self.speak("Command not received, sir.")
                                        update_agent_status({"voice_active": False})
                                    except sr.UnknownValueError:
                                        self.speak("I didn't catch that, sir.")
                                        update_agent_status({"voice_active": False})
                                
                                update_agent_status({"voice_active": False})
                                
                        except sr.UnknownValueError:
                            pass  # Could not understand audio
                        except sr.RequestError as e:
                            add_log("error", f"Speech recognition error: {e}", category="voice")
                            time.sleep(1)
                    
                    except sr.WaitTimeoutError:
                        pass  # No speech detected, continue listening
                    except Exception as e:
                        add_log("warn", f"Listen error: {e}", category="voice")
                        time.sleep(0.5)
        
        except Exception as e:
            add_log("error", f"Voice listener crashed: {e}", category="voice")
            self.running = False
            update_agent_status({"voice_listening": False})
    
    def _process_command(self, command: str):
        """Process a voice command - calls AI backend and executes commands locally."""
        self.last_command = command
        update_agent_status({"last_voice_command": command})
        
        add_log("info", f"Processing command: {command}", category="voice")
        notification_manager.notify("JARVIS Command", command)
        
        # Acknowledge
        self.speak(f"Processing: {command}")
        
        # Try to call AI backend for intelligent command parsing
        try:
            ai_result = self._call_ai_backend(command)
            if ai_result:
                response_text = ai_result.get("response", "")
                commands = ai_result.get("commands", [])
                
                # Speak the AI response
                if response_text:
                    self.speak(response_text)
                
                # Execute commands locally
                if commands:
                    self._execute_commands_async(commands)
                return
        except Exception as e:
            add_log("warn", f"AI backend unavailable, using local parsing: {e}", category="voice")
        
        # Fallback to local command parsing if AI is unavailable
        result = self._parse_and_execute_locally(command)
        if result:
            self.speak(result)
        
        # Also call the command callback if set
        if self.on_command:
            try:
                result = self.on_command(command)
                if result:
                    self.speak(result)
            except Exception as e:
                add_log("error", f"Command execution error: {e}", category="voice")
                self.speak("I encountered an error, sir.")
    
    def _call_ai_backend(self, message: str) -> Optional[Dict[str, Any]]:
        """Call the jarvis-chat edge function to get AI-parsed commands."""
        import urllib.request
        import ssl
        
        chat_url = f"{SUPABASE_URL}/functions/v1/jarvis-chat"
        ssl_ctx = ssl.create_default_context()
        
        try:
            req_data = json.dumps({"message": message}).encode("utf-8")
            req = urllib.request.Request(
                chat_url,
                data=req_data,
                headers={
                    "Content-Type": "application/json",
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                },
                method="POST"
            )
            
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=15) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            
            if "error" in result:
                add_log("warn", f"AI backend error: {result.get('error')}", category="voice")
                return None
            
            add_log("info", f"AI response received with {len(result.get('commands', []))} commands", category="voice")
            return result
            
        except Exception as e:
            add_log("warn", f"AI backend call failed: {e}", category="voice")
            return None
    
    def _execute_commands_async(self, commands: List[Dict[str, Any]]):
        """Execute AI-returned commands in a background thread."""
        def execute():
            for cmd in commands:
                try:
                    action = cmd.get("action", "")
                    result = self._execute_single_command(action, cmd)
                    add_log("info", f"Executed: {action}", f"Result: {result.get('success', False)}", category="voice")
                    time.sleep(0.5)  # Small delay between commands
                except Exception as e:
                    add_log("error", f"Command execution error: {e}", category="voice")
        
        threading.Thread(target=execute, daemon=True).start()
    
    def _execute_single_command(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a single command locally based on AI output."""
        global jarvis_agent_instance
        
        if not jarvis_agent_instance:
            # Try local execution without full agent
            return self._execute_simple_command(action, params)
        
        # Map AI actions to agent command types
        command_map = {
            "open_app": ("open_app", {"app_name": params.get("app_name", "")}),
            "close_app": ("close_app", {"app_name": params.get("app_name", "")}),
            "list_apps": ("list_apps", {}),
            "play_music": ("play_music", {"query": params.get("query", ""), "service": "youtube"}),
            "media_control": ("media_control", {"action": params.get("control", "play_pause")}),
            "set_volume": ("set_volume", {"level": params.get("level", 50)}),
            "set_brightness": ("set_brightness", {"level": params.get("level", 50)}),
            "lock": ("lock", {}),
            "sleep": ("sleep", {}),
            "restart": ("restart", {}),
            "shutdown": ("shutdown", {}),
            "screenshot": ("screenshot", {}),
            "search_files": ("search_files", {"query": params.get("query", "")}),
            "open_file": ("open_file", {"path": params.get("path", "")}),
            "open_folder": ("open_folder", {"path": params.get("path", "")}),
            "open_website": ("open_website", {"site": params.get("site", ""), "query": params.get("query", "")}),
            "search_web": ("search_web", {"engine": params.get("engine", "google"), "query": params.get("query", "")}),
            "open_url": ("open_url", {"url": params.get("url", "")}),
            "type_text": ("type_text", {"text": params.get("text", "")}),
            "key_combo": ("hotkey", {"keys": params.get("keys", "")}),
            "make_call": ("make_call", {"contact": params.get("contact", ""), "number": params.get("number", "")}),
            "send_sms": ("send_sms", {"contact": params.get("contact", ""), "number": params.get("number", ""), "message": params.get("message", "")}),
            "send_whatsapp": ("send_whatsapp", {"contact": params.get("contact", ""), "message": params.get("message", "")}),
            "send_email": ("send_email", {"to": params.get("to", ""), "subject": params.get("subject", ""), "body": params.get("body", "")}),
        }
        
        if action in command_map:
            cmd_type, payload = command_map[action]
            loop = asyncio.new_event_loop()
            try:
                result = loop.run_until_complete(jarvis_agent_instance._handle_command(cmd_type, payload))
                return result
            finally:
                loop.close()
        
        return {"success": False, "error": f"Unknown action: {action}"}
    
    def _execute_simple_command(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute simple commands without full agent (fallback)."""
        try:
            if action == "open_app":
                app_name = params.get("app_name", "")
                if app_name:
                    subprocess.Popen(f'start {app_name}', shell=True)
                    return {"success": True}
            elif action == "play_music":
                query = params.get("query", "")
                if query:
                    webbrowser.open(f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}")
                    return {"success": True}
            elif action == "open_url":
                url = params.get("url", "")
                if url:
                    webbrowser.open(url)
                    return {"success": True}
            elif action == "lock":
                if platform.system() == "Windows":
                    ctypes.windll.user32.LockWorkStation()
                    return {"success": True}
            elif action == "media_control":
                control = params.get("action", "play_pause")
                key_map = {"play_pause": "playpause", "next": "nexttrack", "previous": "prevtrack", "mute": "volumemute"}
                key = key_map.get(control, "playpause")
                pyautogui.press(key)
                return {"success": True}
            elif action == "set_volume":
                level = params.get("level", 50)
                # Simple volume adjustment via key presses
                current = 50
                diff = level - current
                steps = abs(diff) // 2
                key = "volumeup" if diff > 0 else "volumedown"
                for _ in range(steps):
                    pyautogui.press(key)
                return {"success": True, "volume": level}
        except Exception as e:
            return {"success": False, "error": str(e)}
        
        return {"success": False, "error": f"Cannot execute {action} without agent"}
    
    def _parse_and_execute_locally(self, command: str) -> Optional[str]:
        """Parse and execute common commands locally without AI backend."""
        command_lower = command.lower().strip()
        
        # Volume control
        if "volume" in command_lower:
            if "up" in command_lower or "increase" in command_lower:
                pyautogui.press("volumeup")
                pyautogui.press("volumeup")
                pyautogui.press("volumeup")
                return "Volume increased, sir."
            elif "down" in command_lower or "decrease" in command_lower:
                pyautogui.press("volumedown")
                pyautogui.press("volumedown")
                pyautogui.press("volumedown")
                return "Volume decreased, sir."
            elif "mute" in command_lower:
                pyautogui.press("volumemute")
                return "Volume muted, sir."
            # Try to extract number
            import re
            numbers = re.findall(r'\d+', command_lower)
            if numbers:
                level = int(numbers[0])
                if 0 <= level <= 100:
                    return f"Setting volume to {level}%, sir."
        
        # Media control
        if "pause" in command_lower or "stop" in command_lower:
            pyautogui.press("playpause")
            return "Media paused, sir."
        if "play" in command_lower and "music" not in command_lower:
            pyautogui.press("playpause")
            return "Playing, sir."
        if "next" in command_lower and ("track" in command_lower or "song" in command_lower):
            pyautogui.press("nexttrack")
            return "Next track, sir."
        if "previous" in command_lower and ("track" in command_lower or "song" in command_lower):
            pyautogui.press("prevtrack")
            return "Previous track, sir."
        
        # System control
        if "lock" in command_lower and ("screen" in command_lower or "pc" in command_lower or "computer" in command_lower):
            if platform.system() == "Windows":
                ctypes.windll.user32.LockWorkStation()
            return "Locking the computer, sir."
        
        # App opening
        if command_lower.startswith("open "):
            app_name = command_lower.replace("open ", "").strip()
            webbrowser.open(f"https://www.google.com/search?q={urllib.parse.quote(app_name)}")
            return f"Opening {app_name}, sir."
        
        # Web search
        if "search" in command_lower or "google" in command_lower:
            query = command_lower.replace("search for", "").replace("search", "").replace("google", "").strip()
            if query:
                webbrowser.open(f"https://www.google.com/search?q={urllib.parse.quote(query)}")
                return f"Searching for {query}, sir."
        
        # Play music
        if "play" in command_lower and ("music" in command_lower or "song" in command_lower):
            query = command_lower.replace("play music", "").replace("play song", "").replace("play", "").strip()
            if query:
                webbrowser.open(f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}")
                return f"Playing {query}, sir."
        
        return None


# Global voice listener instance
voice_listener: Optional[VoiceListener] = None


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
    
    # STANDARDIZED SAMPLE RATE: 16kHz for better browser compatibility
    # Web AudioContext on mobile often defaults to 16kHz or has issues with 44.1kHz
    STANDARD_SAMPLE_RATE = 16000
    
    def __init__(self):
        self.running = False
        self.ws = None
        self.session_id = None
        self.direction = "phone_to_pc"
        self.use_system_audio = False
        
        self.sample_rate = self.STANDARD_SAMPLE_RATE  # Use standardized 16kHz
        self.channels = 1  # Mono for mic, stereo for system audio
        self.chunk_size = 2048  # Smaller chunks for lower latency at 16kHz
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
            
            # Find a valid output device
            output_device_index = None
            try:
                default_output = self.pa.get_default_output_device_info()
                output_device_index = default_output.get("index")
                add_log("info", f"Using audio output: {default_output.get('name', 'default')}", category="audio")
            except Exception as e:
                add_log("warn", f"Could not get default output device: {e}", category="audio")
            
            self.output_stream = self.pa.open(
                format=self.format,
                channels=1,  # Phone sends mono
                rate=self.sample_rate,
                output=True,
                output_device_index=output_device_index,
                frames_per_buffer=self.chunk_size
            )
            
            add_log("info", "PC speaker playback started", category="audio")
            
            # Pre-fill buffer to reduce latency issues
            silence = b'\x00' * (self.chunk_size * 2)
            self.output_stream.write(silence)
            
            consecutive_errors = 0
            max_consecutive_errors = 10
            
            while self.running and self.ws:
                try:
                    message = await asyncio.wait_for(self.ws.recv(), timeout=0.1)
                    consecutive_errors = 0  # Reset on successful receive
                    
                    if isinstance(message, bytes):
                        # Direct binary audio data (Int16 PCM)
                        try:
                            self.output_stream.write(message)
                            self.bytes_received += len(message)
                        except Exception as write_err:
                            add_log("warn", f"Audio write error: {write_err}", category="audio")
                    elif isinstance(message, str):
                        try:
                            data = json.loads(message)
                            if data.get("type") == "peer_disconnected":
                                add_log("info", "Phone disconnected from audio relay", category="audio")
                            elif data.get("type") == "peer_connected":
                                add_log("info", "Phone connected to audio relay", category="audio")
                            elif data.get("type") == "audio" and data.get("data"):
                                audio_bytes = base64.b64decode(data["data"])
                                self.output_stream.write(audio_bytes)
                                self.bytes_received += len(audio_bytes)
                        except json.JSONDecodeError:
                            pass
                except asyncio.TimeoutError:
                    continue
                except websockets.exceptions.ConnectionClosed:
                    add_log("warn", "Audio WebSocket closed", category="audio")
                    break
                except Exception as e:
                    consecutive_errors += 1
                    if consecutive_errors >= max_consecutive_errors:
                        add_log("error", f"Too many playback errors, stopping: {e}", category="audio")
                        break
                    if self.running:
                        add_log("warn", f"Playback error ({consecutive_errors}): {e}", category="audio")
                    await asyncio.sleep(0.05)
                    
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
        self.quality = 100  # Max quality for best image
        self.fps = 90       # High FPS for smooth streaming
        
        self.frame_count = 0
        self.bytes_sent = 0
        self.last_frame_time = 0
        self.last_stats_time = time.time()
        
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5
        
        # Store last error for web UI
        self.last_error: Optional[str] = None
        
    async def connect(self, session_id: str, fps: int = 30, quality: int = 70):
        if not HAS_WEBSOCKETS or not HAS_OPENCV:
            error_msg = "WebSockets or OpenCV not available"
            self.last_error = error_msg
            add_log("error", error_msg, category="camera")
            return False
            
        self.session_id = session_id
        self.fps = fps
        self.quality = quality
        self.last_error = None
        
        # CRITICAL: Connect as 'phone' type - this is the SENDER
        # The web frontend connects as 'pc' type - this is the RECEIVER
        # The relay forwards from phone->pc, so we must be 'phone' to send frames
        ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={session_id}&type=phone&fps={fps}&quality={quality}&binary=true"
        add_log("info", f"Connecting camera stream as sender (phone)", f"fps={fps}, quality={quality}", category="camera")
        
        try:
            self.ws = await websockets.connect(ws_url)
            self.running = True
            self.frame_count = 0
            self.bytes_sent = 0
            self.last_stats_time = time.time()
            self.reconnect_attempts = 0
            add_log("info", "Camera stream connected as sender", category="camera")
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
            # CRITICAL: Reconnect as 'phone' type (sender)
            ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={self.session_id}&type=phone&fps={self.fps}&quality={self.quality}&binary=true"
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
                    # Try to reopen camera
                    try:
                        self.camera.release()
                        await asyncio.sleep(0.5)
                        self.camera = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY)
                        self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                        self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                        self.camera.set(cv2.CAP_PROP_FPS, max(self.fps, 10))
                        add_log("info", f"Camera {camera_index} reopened after frame failure", category="camera")
                    except Exception as reopen_err:
                        add_log("error", f"Camera reopen failed: {reopen_err}", category="camera")
                    await asyncio.sleep(0.1)
                    continue
                
                # Resize frame for streaming
                frame = cv2.resize(frame, (640, 480))
                
                # Encode frame as JPEG binary (NOT base64 - send raw bytes for performance)
                _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, self.quality])
                frame_bytes = buffer.tobytes()
                frame_size = len(frame_bytes)
                
                try:
                    # Send raw binary JPEG data directly (much faster than base64 JSON)
                    await self.ws.send(frame_bytes)
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
    
    def update_settings(self, fps: Optional[int] = None, quality: Optional[int] = None) -> bool:
        """Update streaming settings in real-time without restarting."""
        if not self.running:
            return False
        
        if fps is not None:
            self.fps = max(1, min(90, fps))  # Clamp to 1-90
            add_log("info", f"Camera FPS updated to {self.fps}", category="camera")
        
        if quality is not None:
            self.quality = max(10, min(100, quality))  # Clamp to 10-100
            add_log("info", f"Camera quality updated to {self.quality}", category="camera")
        
        return True
    
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


# ============== SCREEN STREAMER ==============
class ScreenStreamer:
    """High-performance screen mirroring to phone via camera-relay (binary JPEG frames)."""

    def __init__(self):
        self.running = False
        self.ws = None
        self.session_id = None

        self.quality = 70
        self.fps = 30
        self.scale = 0.6
        self.monitor_index = 1

        self.frame_count = 0
        self.bytes_sent = 0
        self.last_frame_time = 0
        self.last_stats_time = time.time()
        self.last_error: Optional[str] = None

        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5

    async def connect(self, session_id: str, fps: int = 30, quality: int = 70, scale: float = 0.6, monitor_index: int = 1):
        if not HAS_WEBSOCKETS:
            self.last_error = "WebSockets not available"
            add_log("error", self.last_error, category="screen")
            return False

        if not HAS_MSS:
            self.last_error = "mss not available for screen capture"
            add_log("error", self.last_error, category="screen")
            return False

        # OpenCV is strongly preferred for fast JPEG encode, but we can still proceed without it.
        self.session_id = session_id
        self.fps = max(1, min(90, int(fps)))
        self.quality = max(10, min(100, int(quality)))
        self.scale = max(0.1, min(1.0, float(scale)))
        self.monitor_index = int(monitor_index) if monitor_index else 1
        self.last_error = None
        self.reconnect_attempts = 0

        # CRITICAL: Connect as 'phone' type (sender). Web connects as 'pc' (receiver).
        ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={session_id}&type=phone&fps={self.fps}&quality={self.quality}&binary=true"
        add_log("info", "Connecting screen stream as sender (phone)", f"fps={self.fps}, quality={self.quality}, scale={self.scale}", category="screen")

        try:
            self.ws = await websockets.connect(ws_url)
            self.running = True
            self.frame_count = 0
            self.bytes_sent = 0
            self.last_frame_time = 0
            self.last_stats_time = time.time()
            add_log("info", "Screen stream connected as sender", category="screen")
            update_agent_status({"screen_streaming": True})
            return True
        except Exception as e:
            self.last_error = str(e)
            add_log("error", f"Screen stream connection failed: {e}", category="screen")
            return False

    async def _reconnect(self) -> bool:
        if self.reconnect_attempts >= self.max_reconnect_attempts:
            self.last_error = "Max reconnect attempts reached"
            add_log("error", self.last_error, category="screen")
            return False

        self.reconnect_attempts += 1
        add_log("info", f"Reconnecting screen... (attempt {self.reconnect_attempts}/{self.max_reconnect_attempts})", category="screen")
        await asyncio.sleep(1)

        try:
            ws_url = f"{CAMERA_RELAY_WS_URL}?sessionId={self.session_id}&type=phone&fps={self.fps}&quality={self.quality}&binary=true"
            self.ws = await websockets.connect(ws_url)
            add_log("info", "Screen stream reconnected", category="screen")
            return True
        except Exception as e:
            self.last_error = f"Reconnect failed: {e}"
            add_log("error", self.last_error, category="screen")
            return False

    async def start_streaming(self):
        if not HAS_MSS:
            self.last_error = "mss not available"
            add_log("error", self.last_error, category="screen")
            return

        try:
            import mss

            # Import numpy/cv2 lazily (they may not be available in minimal installs)
            np = None
            cv2_local = None
            try:
                import numpy as np  # type: ignore
            except Exception:
                pass
            try:
                import cv2 as cv2_local  # type: ignore
            except Exception:
                pass

            frame_interval = 1.0 / max(self.fps, 1)

            with mss.mss() as sct:
                monitors = sct.monitors
                idx = self.monitor_index if 0 < self.monitor_index < len(monitors) else 1
                mon = monitors[idx]
                add_log("info", f"Screen streaming started (monitor {idx})", f"target={self.fps}fps quality={self.quality} scale={self.scale}", category="screen")

                while self.running:
                    start_time = time.time()

                    if not self.ws:
                        if not await self._reconnect():
                            break
                        continue

                    shot = sct.grab(mon)  # BGRA

                    # Fast path: numpy + opencv
                    if np is not None and cv2_local is not None:
                        frame = np.array(shot)  # BGRA
                        frame = cv2_local.cvtColor(frame, cv2_local.COLOR_BGRA2BGR)
                        if self.scale != 1.0:
                            h, w = frame.shape[:2]
                            frame = cv2_local.resize(frame, (max(1, int(w * self.scale)), max(1, int(h * self.scale))))
                        ok, buf = cv2_local.imencode('.jpg', frame, [cv2_local.IMWRITE_JPEG_QUALITY, int(self.quality)])
                        if not ok:
                            raise RuntimeError("Failed to encode screen frame")
                        frame_bytes = buf.tobytes()
                    else:
                        # Fallback: Pillow
                        img = Image.frombytes('RGB', shot.size, shot.bgra, 'raw', 'BGRX')
                        if self.scale != 1.0:
                            img = img.resize((max(1, int(img.width * self.scale)), max(1, int(img.height * self.scale))), Image.BILINEAR)
                        buffer = io.BytesIO()
                        img.save(buffer, format='JPEG', quality=int(self.quality), optimize=True)
                        frame_bytes = buffer.getvalue()

                    try:
                        await self.ws.send(frame_bytes)
                        self.frame_count += 1
                        self.bytes_sent += len(frame_bytes)
                        self.last_frame_time = time.time()
                    except Exception as e:
                        add_log("warn", f"Screen send error: {e}", category="screen")
                        if not await self._reconnect():
                            break

                    elapsed = time.time() - start_time
                    if elapsed < frame_interval:
                        await asyncio.sleep(frame_interval - elapsed)

        except Exception as e:
            self.last_error = str(e)
            add_log("error", f"Screen streaming error: {e}", category="screen")
        finally:
            await self.stop()

    def update_settings(self, fps: Optional[int] = None, quality: Optional[int] = None, scale: Optional[float] = None) -> bool:
        if not self.running:
            return False
        if fps is not None:
            self.fps = max(1, min(90, int(fps)))
            add_log("info", f"Screen FPS updated to {self.fps}", category="screen")
        if quality is not None:
            self.quality = max(10, min(100, int(quality)))
            add_log("info", f"Screen quality updated to {self.quality}", category="screen")
        if scale is not None:
            self.scale = max(0.1, min(1.0, float(scale)))
            add_log("info", f"Screen scale updated to {self.scale}", category="screen")
        return True

    def get_stats(self) -> Dict[str, Any]:
        now = time.time()
        elapsed = max(now - self.last_stats_time, 0.001)
        return {
            "frame_count": self.frame_count,
            "bytes_sent": self.bytes_sent,
            "fps_actual": round(self.frame_count / elapsed, 1),
            "fps_target": self.fps,
            "quality": self.quality,
            "scale": self.scale,
            "monitor_index": self.monitor_index,
            "last_frame_ago_ms": round((now - self.last_frame_time) * 1000) if self.last_frame_time else None,
            "running": self.running,
            "connected": self.ws is not None,
            "last_error": self.last_error,
        }

    async def stop(self):
        self.running = False
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.ws = None
        update_agent_status({"screen_streaming": False})
        add_log("info", "Screen stream stopped", category="screen")


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
        self.screen_streamer = ScreenStreamer()
        self.phone_webcam_receiver = PhoneWebcamReceiver()
        self.audio_session_id = None
        self.camera_session_id = None
        self.screen_session_id = None
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
        # IMPORTANT: keep previous cache for fallback key-press adjustments.
        prev_level = int(getattr(self, "_volume_cache", 50) or 50)
        level = max(0, min(100, int(level)))
        self._volume_cache = level
        update_agent_status({"volume": level})
        
        if platform.system() == "Windows":
            try:
                # Best-effort: use PyCAW when available (reliable on Windows).
                if HAS_PYCAW:
                    try:
                        devices = AudioUtilities.GetSpeakers()
                        interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                        endpoint = cast(interface, POINTER(IAudioEndpointVolume))
                        endpoint.SetMasterVolumeLevelScalar(level / 100.0, None)
                        add_log("info", f"Volume set to {level}% (pycaw)", category="system")
                        return {"success": True, "volume": level}
                    except Exception as pycaw_err:
                        add_log("warn", f"pycaw volume set failed: {pycaw_err}", category="system")

                nircmd_path = os.path.join(os.path.dirname(__file__), "nircmd.exe")
                if os.path.exists(nircmd_path):
                    vol_value = int(level * 65535 / 100)
                    subprocess.run([nircmd_path, "setsysvolume", str(vol_value)], 
                                 capture_output=True, timeout=2)
                    add_log("info", f"Volume set to {level}% (nircmd)", category="system")
                    return {"success": True, "volume": level}

                # PowerShell route (only works if user has the right module installed).
                ps = subprocess.run(
                    [
                        "powershell",
                        "-NoProfile",
                        "-Command",
                        f"Set-AudioDevice -PlaybackVolume {level}",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                if ps.returncode == 0:
                    add_log("info", f"Volume set to {level}% (powershell)", category="system")
                    return {"success": True, "volume": level}
                raise RuntimeError((ps.stderr or ps.stdout or "PowerShell volume set failed").strip())
            except Exception as e:
                try:
                    # Fallback: approximate using volume keys. Use PREVIOUS volume to compute steps.
                    diff = level - prev_level
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

    def _get_system_state(self) -> Dict[str, Any]:
        """Get current volume, brightness, and lock state for frontend sync."""
        try:
            return {
                "success": True,
                "volume": self._get_volume(),
                "brightness": self._get_brightness(),
                "is_locked": self.is_locked,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_issues(self) -> Dict[str, Any]:
        """Return recent issues for the web app to display."""
        return {
            "success": True,
            "issues": log_entries[:50],
            "camera_error": self.camera_streamer.last_error,
        }

    def _get_streaming_stats(self) -> Dict[str, Any]:
        """Return comprehensive streaming diagnostics for the web panel."""
        try:
            camera_stats = self.camera_streamer.get_stats()
            audio_stats = self.audio_streamer.get_stats()
            screen_stats = self.screen_streamer.get_stats()
            
            return {
                "success": True,
                "camera": {
                    "frame_count": camera_stats.get("frame_count", 0),
                    "bytes_sent": camera_stats.get("bytes_sent", 0),
                    "fps": camera_stats.get("fps_actual", camera_stats.get("fps", 0)),
                    "last_error": self.camera_streamer.last_error,
                    "running": self.camera_streamer.running,
                    "quality": self.camera_streamer.quality,
                    "target_fps": self.camera_streamer.fps,
                },
                "audio": {
                    "bytes_sent": audio_stats.get("bytes_sent", 0),
                    "bytes_received": audio_stats.get("bytes_received", 0),
                    "running": audio_stats.get("running", False),
                    "send_rate_kbps": audio_stats.get("send_rate_kbps", 0),
                    "recv_rate_kbps": audio_stats.get("recv_rate_kbps", 0),
                    "sample_rate": self.audio_streamer.sample_rate,
                },
                "screen": {
                    "frame_count": screen_stats.get("frame_count", 0),
                    "bytes_sent": screen_stats.get("bytes_sent", 0),
                    "fps": screen_stats.get("fps_actual", 0),
                    "last_error": self.screen_streamer.last_error,
                    "running": self.screen_streamer.running,
                    "quality": self.screen_streamer.quality,
                    "target_fps": self.screen_streamer.fps,
                },
                "phone_webcam": self.phone_webcam_receiver.get_stats() if hasattr(self, 'phone_webcam_receiver') else None,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

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
                    if not re.match(r'^[a-zA-Z0-9._!-]+$', app_id):
                        add_log("warn", f"Invalid app_id format rejected: {app_id}", category="apps")
                        return {"success": False, "error": "Invalid app ID format"}
                    
                    try:
                        subprocess.Popen(
                            ['explorer', f'shell:AppsFolder\\{app_id}'],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                        add_log("info", f"Opened via AppID: {app_id}", category="apps")
                        return {"success": True, "message": f"Opened {app_name}"}
                    except Exception as e:
                        add_log("warn", f"AppID launch failed, falling back: {e}", category="apps")

                # Extended app mappings for common applications
                app_paths = {
                    # Browsers
                    "chrome": "chrome", "google chrome": "chrome",
                    "firefox": "firefox", "mozilla firefox": "firefox",
                    "edge": "msedge", "microsoft edge": "msedge",
                    "brave": "brave", "opera": "opera", "vivaldi": "vivaldi",
                    # System
                    "notepad": "notepad", "calculator": "calc", "calc": "calc",
                    "terminal": "wt", "cmd": "cmd", "command prompt": "cmd",
                    "powershell": "powershell",
                    "explorer": "explorer", "file explorer": "explorer", "files": "explorer",
                    "task manager": "taskmgr", "taskmgr": "taskmgr",
                    "settings": "ms-settings:", "control panel": "control",
                    "paint": "mspaint", "snipping tool": "snippingtool",
                    # Dev tools
                    "vscode": "code", "vs code": "code", "visual studio code": "code",
                    "visual studio": "devenv",
                    # Office
                    "word": "winword", "microsoft word": "winword",
                    "excel": "excel", "microsoft excel": "excel",
                    "powerpoint": "powerpnt", "microsoft powerpoint": "powerpnt",
                    "outlook": "outlook", "microsoft outlook": "outlook",
                    "onenote": "onenote",
                    # Media
                    "spotify": "spotify", "vlc": "vlc", "vlc player": "vlc",
                    "obs": "obs64", "obs studio": "obs64",
                    # Communication
                    "discord": "discord", "telegram": "telegram",
                    "whatsapp": "whatsapp", "zoom": "zoom",
                    "teams": "ms-teams", "microsoft teams": "ms-teams",
                    "slack": "slack", "skype": "skype",
                    # Gaming
                    "steam": "steam", "epic games": "epicgameslauncher",
                    # Utilities
                    "winrar": "winrar", "7zip": "7zfm",
                    "everything": "everything",
                }

                cmd = app_paths.get(app_lower)

                if cmd:
                    try:
                        if cmd.startswith("ms-"):
                            os.system(f"start {cmd}")
                        else:
                            subprocess.Popen(f"start {cmd}", shell=True, 
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        add_log("info", f"Opened via known path: {cmd}", category="apps")
                        return {"success": True, "message": f"Opened {app_name}"}
                    except Exception as e:
                        add_log("warn", f"Direct launch failed: {e}, trying search", category="apps")

                if not app_name:
                    return {"success": False, "error": "Missing app name"}

                # Smart search: check if app is installed first
                add_log("info", f"Searching via Windows Search: {app_name}", category="apps")
                pyautogui.press("win")
                time.sleep(0.4)
                pyautogui.typewrite(app_name, interval=0.02)
                time.sleep(0.6)
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
            path = os.path.expanduser(path)
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

    def _open_folder(self, path: str):
        """Open a folder in file explorer."""
        try:
            path = os.path.expanduser(path)
            add_log("info", f"Opening folder: {path}", category="files")
            if platform.system() == "Windows":
                subprocess.Popen(f'explorer "{path}"', shell=True)
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
            return {"success": True, "message": f"Opened folder: {path}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _search_files(self, query: str, path: str = "~"):
        """Search for files matching the query."""
        try:
            path = os.path.expanduser(path)
            add_log("info", f"Searching for files: {query} in {path}", category="files")
            
            results = []
            query_lower = query.lower()
            
            # Walk through directory tree (limit depth for performance)
            max_results = 50
            max_depth = 4
            
            for root, dirs, files in os.walk(path):
                # Calculate current depth
                depth = root[len(path):].count(os.sep)
                if depth >= max_depth:
                    dirs.clear()  # Don't go deeper
                    continue
                
                # Skip hidden directories
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                
                for file in files:
                    if query_lower in file.lower():
                        full_path = os.path.join(root, file)
                        try:
                            size = os.path.getsize(full_path)
                            modified = os.path.getmtime(full_path)
                        except:
                            size = 0
                            modified = 0
                        
                        results.append({
                            "name": file,
                            "path": full_path,
                            "size": size,
                            "modified": modified,
                        })
                        
                        if len(results) >= max_results:
                            break
                
                if len(results) >= max_results:
                    break
            
            add_log("info", f"Found {len(results)} files matching '{query}'", category="files")
            return {"success": True, "results": results, "query": query}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _list_apps(self):
        """Alias for get_running_apps for AI commands."""
        return self._get_running_apps()

    # ============== MOBILE ACTIONS (via desktop) ==============
    def _make_call(self, contact: str = "", number: str = ""):
        """Initiate a phone call - opens tel: URL or phone app."""
        try:
            phone = number or contact
            if not phone:
                return {"success": False, "error": "No contact or number provided"}
            
            # Clean up number
            phone_clean = ''.join(c for c in phone if c.isdigit() or c == '+')
            
            if phone_clean:
                # Use tel: protocol
                webbrowser.open(f"tel:{phone_clean}")
                add_log("info", f"Initiating call to: {phone}", category="mobile")
                return {"success": True, "message": f"Calling {phone}"}
            else:
                # Search for contact in phone app
                if platform.system() == "Windows":
                    # Open Your Phone app on Windows
                    os.system("start ms-people:")
                    time.sleep(1)
                    pyautogui.typewrite(contact, interval=0.02)
                add_log("info", f"Opening contacts for: {contact}", category="mobile")
                return {"success": True, "message": f"Searching for contact: {contact}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _send_sms(self, contact: str = "", number: str = "", message: str = ""):
        """Send an SMS message - opens SMS URL or messaging app."""
        try:
            phone = number or contact
            if not phone:
                return {"success": False, "error": "No contact or number provided"}
            
            phone_clean = ''.join(c for c in phone if c.isdigit() or c == '+')
            
            if phone_clean:
                # Use sms: protocol with message
                sms_url = f"sms:{phone_clean}"
                if message:
                    sms_url += f"?body={urllib.parse.quote(message)}"
                webbrowser.open(sms_url)
                add_log("info", f"Sending SMS to: {phone}", category="mobile")
                return {"success": True, "message": f"Opening SMS to {phone}"}
            else:
                # Open Your Phone / Messages app on Windows
                if platform.system() == "Windows":
                    os.system("start ms-chat:")
                add_log("info", f"Opening messaging app for: {contact}", category="mobile")
                return {"success": True, "message": f"Opening messaging app"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _send_whatsapp(self, contact: str = "", message: str = ""):
        """Send a WhatsApp message - opens WhatsApp Web or app."""
        try:
            if not contact:
                return {"success": False, "error": "No contact provided"}
            
            # Clean up number if it looks like a phone number
            phone_clean = ''.join(c for c in contact if c.isdigit() or c == '+')
            
            if phone_clean:
                # Use WhatsApp API with phone number
                wa_url = f"https://wa.me/{phone_clean.lstrip('+')}"
                if message:
                    wa_url += f"?text={urllib.parse.quote(message)}"
                webbrowser.open(wa_url)
                add_log("info", f"Opening WhatsApp for: {contact}", category="mobile")
                return {"success": True, "message": f"Opening WhatsApp for {contact}"}
            else:
                # Try to open WhatsApp desktop app
                self._open_app("whatsapp")
                add_log("info", f"Opening WhatsApp app", category="mobile")
                return {"success": True, "message": "Opening WhatsApp app"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _send_email(self, to: str = "", subject: str = "", body: str = ""):
        """Compose and send an email - opens mailto: URL."""
        try:
            if not to:
                return {"success": False, "error": "No recipient provided"}
            
            # Build mailto URL
            mailto_url = f"mailto:{to}"
            params = []
            if subject:
                params.append(f"subject={urllib.parse.quote(subject)}")
            if body:
                params.append(f"body={urllib.parse.quote(body)}")
            
            if params:
                mailto_url += "?" + "&".join(params)
            
            webbrowser.open(mailto_url)
            add_log("info", f"Composing email to: {to}", category="mobile")
            return {"success": True, "message": f"Opening email to {to}"}
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

    def _search_web(self, engine: str, query: str, press_enter: bool = True):
        """Perform a web search on the specified engine."""
        try:
            engine = (engine or "google").strip().lower()
            query = (query or "").strip()

            if not query:
                return {"success": False, "error": "Missing query"}

            # For ChatGPT, open and then type the query and press enter
            if engine in ["chatgpt", "openai"]:
                webbrowser.open("https://chatgpt.com")
                time.sleep(2.5)  # Wait for page to load
                pyautogui.typewrite(query, interval=0.02)
                if press_enter:
                    time.sleep(0.3)
                    pyautogui.press("enter")
                add_log("info", f"Searched ChatGPT: {query}", category="web")
                return {"success": True, "message": f"Searched ChatGPT for: {query}"}
            
            # For Perplexity, similar approach
            if engine == "perplexity":
                webbrowser.open(f"https://www.perplexity.ai/search?q={urllib.parse.quote(query)}")
                add_log("info", f"Searched Perplexity: {query}", category="web")
                return {"success": True, "message": f"Searched Perplexity for: {query}"}

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
            else:
                url = f"https://www.google.com/search?q={urllib.parse.quote(query)}"

            result = self._open_url(url)
            add_log("info", f"Searched {engine}: {query}", category="web")
            return result
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_media_state(self):
        """Get current media state including playing info."""
        try:
            volume = self._get_volume()
            title = ""
            artist = ""
            is_playing = False
            
            # Try to get window title for media detection on Windows
            if platform.system() == "Windows":
                try:
                    import ctypes
                    user32 = ctypes.windll.user32
                    hwnd = user32.GetForegroundWindow()
                    length = user32.GetWindowTextLengthW(hwnd) + 1
                    buffer = ctypes.create_unicode_buffer(length)
                    user32.GetWindowTextW(hwnd, buffer, length)
                    window_title = buffer.value
                    
                    # Check common media players
                    media_keywords = ['spotify', 'youtube', 'vlc', 'music', 'media player', 'groove']
                    for keyword in media_keywords:
                        if keyword.lower() in window_title.lower():
                            # Parse title for song info
                            if ' - ' in window_title:
                                parts = window_title.split(' - ')
                                if len(parts) >= 2:
                                    artist = parts[0].strip()
                                    title = parts[1].strip()
                                    # Clean up common suffixes
                                    for suffix in ['- YouTube', '- Spotify', 'VLC media player']:
                                        title = title.replace(suffix, '').strip()
                            else:
                                title = window_title
                            is_playing = True
                            break
                except Exception as e:
                    add_log("warn", f"Could not get window title: {e}", category="media")
            
            return {
                "success": True,
                "title": title,
                "artist": artist,
                "is_playing": is_playing,
                "playing": is_playing,  # Alias for compatibility
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
            elif command_type == "list_apps":
                return self._list_apps()
            elif command_type == "get_installed_apps":
                return self._get_installed_apps()

            # Files
            elif command_type == "list_files":
                return self._list_files(payload.get("path", "~"))
            elif command_type == "open_file":
                return self._open_file(payload.get("path", ""))
            elif command_type == "open_folder":
                return self._open_folder(payload.get("path", ""))
            elif command_type == "search_files":
                return self._search_files(
                    payload.get("query", ""),
                    payload.get("path", "~")
                )

            # Web
            elif command_type == "open_url":
                return self._open_url(payload.get("url", ""))
            elif command_type == "open_website":
                return self._open_website(payload.get("site", ""), payload.get("query", ""))
            elif command_type == "search_web":
                return self._search_web(
                    payload.get("engine", "google"), 
                    payload.get("query", ""),
                    payload.get("press_enter", True)
                )

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
            elif command_type == "get_media_info":
                return self._get_media_state()  # Alias
            elif command_type == "media_seek":
                return self._media_seek(payload.get("position_percent", 0))

            # Mobile actions (via desktop)
            elif command_type == "make_call":
                return self._make_call(
                    payload.get("contact", ""),
                    payload.get("number", "")
                )
            elif command_type == "send_sms":
                return self._send_sms(
                    payload.get("contact", ""),
                    payload.get("number", ""),
                    payload.get("message", "")
                )
            elif command_type == "send_whatsapp":
                return self._send_whatsapp(
                    payload.get("contact", ""),
                    payload.get("message", "")
                )
            elif command_type == "send_email":
                return self._send_email(
                    payload.get("to", ""),
                    payload.get("subject", ""),
                    payload.get("body", "")
                )

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
            elif command_type == "get_system_state":
                return self._get_system_state()
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

            elif command_type == "update_camera_settings":
                fps = payload.get("fps")
                quality = payload.get("quality")
                updated = self.camera_streamer.update_settings(fps, quality)
                if updated:
                    return {"success": True, "fps": self.camera_streamer.fps, "quality": self.camera_streamer.quality}
                return {"success": False, "error": "Camera not streaming"}

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

            # Streaming diagnostics
            elif command_type == "get_streaming_stats":
                return self._get_streaming_stats()

            # Ping for connectivity check
            elif command_type == "ping":
                return {"success": True, "pong": True, "timestamp": time.time()}

            # Screen streaming via WebSocket relay
            elif command_type == "start_screen_stream":
                session_id = payload.get("session_id", str(uuid.uuid4()))
                fps = payload.get("fps", 30)
                quality = payload.get("quality", 70)
                scale = payload.get("scale", 0.6)
                monitor_index = payload.get("monitor_index", 1)
                self.screen_session_id = session_id

                connected = await self.screen_streamer.connect(session_id, fps, quality, scale, monitor_index)
                if connected:
                    asyncio.create_task(self.screen_streamer.start_streaming())
                    return {"success": True, "session_id": session_id}
                
                return {
                    "success": False, 
                    "error": self.screen_streamer.last_error or "Failed to start screen stream"
                }

            elif command_type == "stop_screen_stream":
                await self.screen_streamer.stop()
                self.screen_session_id = None
                return {"success": True}

            elif command_type == "update_screen_settings":
                fps = payload.get("fps")
                quality = payload.get("quality")
                scale = payload.get("scale")
                updated = self.screen_streamer.update_settings(fps, quality, scale)
                if updated:
                    return {
                        "success": True, 
                        "fps": self.screen_streamer.fps, 
                        "quality": self.screen_streamer.quality,
                        "scale": self.screen_streamer.scale
                    }
                return {"success": False, "error": "Screen not streaming"}

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
        print("🤖 JARVIS PC Agent v2.5 (AI Voice Edition)")
        print("="*50)
        print(f"📍 Device: {DEVICE_NAME}")
        print(f"🔗 Backend: {SUPABASE_URL}")
        print(f"📷 Camera: {'✅' if HAS_OPENCV else '❌'}")
        print(f"🎤 Audio: {'✅' if HAS_PYAUDIO else '❌'}")
        print(f"🗣️ Voice: {'✅' if HAS_SPEECH_RECOGNITION else '❌'}")
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
        await self.screen_streamer.stop()
        
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


# ============== SYSTEM TRAY ==============
class SystemTray:
    """Windows system tray icon with menu."""
    
    def __init__(self, gui_callback=None, voice_toggle_callback=None, quit_callback=None):
        self.icon = None
        self.gui_callback = gui_callback
        self.voice_toggle_callback = voice_toggle_callback
        self.quit_callback = quit_callback
        self.running = False
    
    def create_image(self):
        """Create a simple icon image."""
        # Create a simple blue circle icon
        size = 64
        image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        
        # Draw a circle
        for x in range(size):
            for y in range(size):
                dx = x - size // 2
                dy = y - size // 2
                distance = (dx * dx + dy * dy) ** 0.5
                if distance < size // 2 - 2:
                    # Blue gradient
                    intensity = int(200 - distance * 2)
                    image.putpixel((x, y), (59, 130, 246, intensity))
                elif distance < size // 2:
                    # Border
                    image.putpixel((x, y), (30, 64, 175, 255))
        
        return image
    
    def start(self):
        """Start the system tray icon."""
        if not HAS_TRAY:
            add_log("warn", "System tray not available", category="system")
            return False
        
        def on_show_gui(icon, item):
            if self.gui_callback:
                self.gui_callback()
        
        def on_toggle_voice(icon, item):
            if self.voice_toggle_callback:
                self.voice_toggle_callback()
        
        def on_quit(icon, item):
            icon.stop()
            if self.quit_callback:
                self.quit_callback()
        
        menu = pystray.Menu(
            item('Show Window', on_show_gui, default=True),
            item('Toggle Voice', on_toggle_voice),
            pystray.Menu.SEPARATOR,
            item('Quit', on_quit)
        )
        
        self.icon = pystray.Icon(
            "jarvis",
            self.create_image(),
            "JARVIS Agent",
            menu
        )
        
        self.running = True
        threading.Thread(target=self.icon.run, daemon=True).start()
        add_log("info", "System tray icon started", category="system")
        return True
    
    def stop(self):
        """Stop the tray icon."""
        if self.icon:
            try:
                self.icon.stop()
            except:
                pass
        self.running = False


# ============== NATIVE GUI (TKINTER) ==============
class JarvisGUI:
    """Native desktop GUI for the JARVIS Agent using Tkinter."""
    
    def __init__(self):
        self.root = None
        self.running = False
        self.update_interval = 1000  # ms
        self.minimized_to_tray = False
        self.tray = None
        
        # References to UI elements
        self.pairing_label = None
        self.status_label = None
        self.device_label = None
        self.cpu_label = None
        self.mem_label = None
        self.vol_label = None
        self.bright_label = None
        self.cpu_bar = None
        self.mem_bar = None
        self.vol_bar = None
        self.bright_bar = None
        self.audio_status = None
        self.camera_status = None
        self.screen_status = None
        self.voice_status = None
        self.voice_btn = None
        self.last_command_label = None
        self.log_text = None
        self.last_log_count = 0
    
    def start(self):
        """Start the GUI in the main thread."""
        if not HAS_TKINTER:
            print("⚠️  Tkinter not available. Running in headless mode.")
            return False
        
        self.running = True
        self.root = tk.Tk()
        self.root.title("JARVIS Agent v2.5")
        self.root.geometry("700x850")
        self.root.configure(bg="#0a0e17")
        self.root.resizable(True, True)
        
        # Handle window close - minimize to tray instead
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        
        # Configure styles
        self._setup_styles()
        
        # Build UI
        self._build_ui()
        
        # Start system tray
        self.tray = SystemTray(
            gui_callback=self._show_window,
            voice_toggle_callback=self._toggle_voice,
            quit_callback=self._quit_app
        )
        self.tray.start()
        
        # Start update loop
        self.root.after(500, self._update_ui)
        
        return True
    
    def _on_close(self):
        """Handle window close - minimize to tray."""
        if HAS_TRAY and self.tray and self.tray.running:
            self.root.withdraw()
            self.minimized_to_tray = True
            notification_manager.notify("JARVIS Agent", "Minimized to system tray. Click icon to restore.")
        else:
            self._quit_app()
    
    def _show_window(self):
        """Show the main window."""
        if self.root:
            self.root.deiconify()
            self.root.lift()
            self.root.focus_force()
            self.minimized_to_tray = False
    
    def _toggle_voice(self):
        """Toggle voice listener."""
        global voice_listener
        if voice_listener and voice_listener.running:
            voice_listener.stop()
            notification_manager.notify("JARVIS Voice", "Voice control disabled")
        else:
            self._start_voice_listener()
    
    def _start_voice_listener(self):
        """Start the voice listener."""
        global voice_listener
        if not HAS_SPEECH_RECOGNITION:
            notification_manager.notify("JARVIS Voice", "Speech recognition not installed")
            return
        
        # Create voice listener with command callback
        voice_listener = VoiceListener(
            wake_word="jarvis",
            on_command=self._handle_voice_command
        )
        voice_listener.start()
    
    def _handle_voice_command(self, command: str) -> str:
        """Handle a voice command and return response."""
        # Send command to the AI backend
        add_log("info", f"Voice command: {command}", category="voice")
        
        # For now, return a simple acknowledgement
        # The actual command execution happens through the web dashboard
        return f"I'll process that for you, sir."
    
    def _quit_app(self):
        """Quit the application."""
        global voice_listener
        
        # Stop voice listener
        if voice_listener:
            voice_listener.stop()
        
        # Stop tray
        if self.tray:
            self.tray.stop()
        
        self.running = False
        if self.root:
            try:
                self.root.quit()
                self.root.destroy()
            except:
                pass
    
    def _setup_styles(self):
        """Configure ttk styles for dark theme."""
        style = ttk.Style()
        style.theme_use('clam')
        
        # Colors
        bg_dark = "#0a0e17"
        bg_card = "#111827"
        border = "#1f2937"
        primary = "#3b82f6"
        success = "#10b981"
        warning = "#f59e0b"
        error = "#ef4444"
        text = "#f3f4f6"
        text_muted = "#9ca3af"
        
        # Configure TFrame
        style.configure("Card.TFrame", background=bg_card)
        style.configure("Main.TFrame", background=bg_dark)
        
        # Configure TLabel
        style.configure("Title.TLabel", background=bg_dark, foreground=primary, font=("Segoe UI", 24, "bold"))
        style.configure("Subtitle.TLabel", background=bg_dark, foreground=text_muted, font=("Segoe UI", 10))
        style.configure("Pairing.TLabel", background=bg_card, foreground=primary, font=("Consolas", 42, "bold"))
        style.configure("PairingHint.TLabel", background=bg_card, foreground=text_muted, font=("Segoe UI", 10))
        style.configure("Status.TLabel", background=bg_dark, foreground=success, font=("Segoe UI", 11, "bold"))
        style.configure("StatusOff.TLabel", background=bg_dark, foreground=error, font=("Segoe UI", 11, "bold"))
        style.configure("Card.TLabel", background=bg_card, foreground=text, font=("Segoe UI", 10))
        style.configure("CardTitle.TLabel", background=bg_card, foreground=text_muted, font=("Segoe UI", 9))
        style.configure("Stat.TLabel", background=bg_card, foreground=text, font=("Segoe UI", 18, "bold"))
        style.configure("StreamOn.TLabel", background=bg_card, foreground=success, font=("Segoe UI", 10, "bold"))
        style.configure("StreamOff.TLabel", background=bg_card, foreground=text_muted, font=("Segoe UI", 10))
        
        # Configure TProgressbar
        style.configure("CPU.Horizontal.TProgressbar", background=primary, troughcolor=border, thickness=8)
        style.configure("Mem.Horizontal.TProgressbar", background="#8b5cf6", troughcolor=border, thickness=8)
        style.configure("Vol.Horizontal.TProgressbar", background=success, troughcolor=border, thickness=8)
        style.configure("Bright.Horizontal.TProgressbar", background=warning, troughcolor=border, thickness=8)
    
    def _build_ui(self):
        """Build the GUI layout."""
        bg_dark = "#0a0e17"
        bg_card = "#111827"
        border = "#1f2937"
        primary = "#3b82f6"
        text = "#f3f4f6"
        text_muted = "#9ca3af"
        
        # Main container with scrollbar
        main_frame = ttk.Frame(self.root, style="Main.TFrame")
        main_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)
        
        # Header
        header_frame = tk.Frame(main_frame, bg=bg_dark)
        header_frame.pack(fill=tk.X, pady=(0, 15))
        
        title_label = ttk.Label(header_frame, text="🤖 JARVIS Agent", style="Title.TLabel")
        title_label.pack(side=tk.LEFT)
        
        self.status_label = ttk.Label(header_frame, text="● Connecting...", style="StatusOff.TLabel")
        self.status_label.pack(side=tk.RIGHT, padx=5)
        
        self.device_label = ttk.Label(header_frame, text="", style="Subtitle.TLabel")
        self.device_label.pack(side=tk.RIGHT, padx=10)
        
        # Pairing Section
        pairing_frame = tk.Frame(main_frame, bg=bg_card, highlightbackground=primary, highlightthickness=2)
        pairing_frame.pack(fill=tk.X, pady=(0, 15), ipady=15)
        
        pairing_title = ttk.Label(pairing_frame, text="📱 Enter this code in the mobile app", style="PairingHint.TLabel")
        pairing_title.pack(pady=(15, 5))
        
        self.pairing_label = ttk.Label(pairing_frame, text="------", style="Pairing.TLabel")
        self.pairing_label.pack(pady=10)
        
        pairing_hint = ttk.Label(pairing_frame, text="Open JARVIS app → Tap 'Pair' → Enter code", style="PairingHint.TLabel")
        pairing_hint.pack(pady=(5, 15))
        
        # Stats Grid - 2x2 layout
        stats_frame = tk.Frame(main_frame, bg=bg_dark)
        stats_frame.pack(fill=tk.X, pady=(0, 15))
        
        for i in range(2):
            stats_frame.columnconfigure(i, weight=1)
        
        # Row 1: CPU and Memory
        cpu_card = tk.Frame(stats_frame, bg=bg_card, highlightbackground=border, highlightthickness=1)
        cpu_card.grid(row=0, column=0, padx=(0, 5), pady=5, sticky="nsew")
        ttk.Label(cpu_card, text="⚡ CPU", style="CardTitle.TLabel").pack(anchor=tk.W, padx=10, pady=(10, 3))
        self.cpu_label = ttk.Label(cpu_card, text="0%", style="Stat.TLabel")
        self.cpu_label.pack(anchor=tk.W, padx=10)
        self.cpu_bar = ttk.Progressbar(cpu_card, style="CPU.Horizontal.TProgressbar", length=150, mode='determinate')
        self.cpu_bar.pack(fill=tk.X, padx=10, pady=(3, 10))
        
        mem_card = tk.Frame(stats_frame, bg=bg_card, highlightbackground=border, highlightthickness=1)
        mem_card.grid(row=0, column=1, padx=(5, 0), pady=5, sticky="nsew")
        ttk.Label(mem_card, text="💾 Memory", style="CardTitle.TLabel").pack(anchor=tk.W, padx=10, pady=(10, 3))
        self.mem_label = ttk.Label(mem_card, text="0%", style="Stat.TLabel")
        self.mem_label.pack(anchor=tk.W, padx=10)
        self.mem_bar = ttk.Progressbar(mem_card, style="Mem.Horizontal.TProgressbar", length=150, mode='determinate')
        self.mem_bar.pack(fill=tk.X, padx=10, pady=(3, 10))
        
        # Row 2: Volume and Brightness
        vol_card = tk.Frame(stats_frame, bg=bg_card, highlightbackground=border, highlightthickness=1)
        vol_card.grid(row=1, column=0, padx=(0, 5), pady=5, sticky="nsew")
        ttk.Label(vol_card, text="🔊 Volume", style="CardTitle.TLabel").pack(anchor=tk.W, padx=10, pady=(10, 3))
        self.vol_label = ttk.Label(vol_card, text="50%", style="Stat.TLabel")
        self.vol_label.pack(anchor=tk.W, padx=10)
        self.vol_bar = ttk.Progressbar(vol_card, style="Vol.Horizontal.TProgressbar", length=150, mode='determinate')
        self.vol_bar.pack(fill=tk.X, padx=10, pady=(3, 10))
        
        bright_card = tk.Frame(stats_frame, bg=bg_card, highlightbackground=border, highlightthickness=1)
        bright_card.grid(row=1, column=1, padx=(5, 0), pady=5, sticky="nsew")
        ttk.Label(bright_card, text="☀️ Brightness", style="CardTitle.TLabel").pack(anchor=tk.W, padx=10, pady=(10, 3))
        self.bright_label = ttk.Label(bright_card, text="50%", style="Stat.TLabel")
        self.bright_label.pack(anchor=tk.W, padx=10)
        self.bright_bar = ttk.Progressbar(bright_card, style="Bright.Horizontal.TProgressbar", length=150, mode='determinate')
        self.bright_bar.pack(fill=tk.X, padx=10, pady=(3, 10))
        
        # Voice Control Section
        voice_frame = tk.Frame(main_frame, bg=bg_card, highlightbackground="#10b981", highlightthickness=2)
        voice_frame.pack(fill=tk.X, pady=(0, 15), ipady=10)
        
        voice_header = tk.Frame(voice_frame, bg=bg_card)
        voice_header.pack(fill=tk.X, padx=15, pady=(10, 5))
        
        ttk.Label(voice_header, text="🎤 Voice Control (Wake Word: 'Jarvis')", style="CardTitle.TLabel").pack(side=tk.LEFT)
        
        self.voice_btn = tk.Button(voice_header, text="🎙️ Start Voice", bg="#10b981", fg="white",
                                   activebackground="#059669", activeforeground="white",
                                   bd=0, padx=15, pady=5, cursor="hand2",
                                   font=("Segoe UI", 10, "bold"),
                                   command=self._toggle_voice)
        self.voice_btn.pack(side=tk.RIGHT)
        
        voice_status_row = tk.Frame(voice_frame, bg=bg_card)
        voice_status_row.pack(fill=tk.X, padx=15, pady=(5, 5))
        
        self.voice_status = ttk.Label(voice_status_row, text="🔇 Voice: OFF", style="StreamOff.TLabel")
        self.voice_status.pack(side=tk.LEFT)
        
        self.last_command_label = ttk.Label(voice_status_row, text="", style="PairingHint.TLabel")
        self.last_command_label.pack(side=tk.RIGHT)
        
        # Streaming Status
        stream_frame = tk.Frame(main_frame, bg=bg_card, highlightbackground=border, highlightthickness=1)
        stream_frame.pack(fill=tk.X, pady=(0, 15), ipady=8)
        
        ttk.Label(stream_frame, text="📡 Streaming Status", style="CardTitle.TLabel").pack(anchor=tk.W, padx=15, pady=(10, 8))
        
        stream_row = tk.Frame(stream_frame, bg=bg_card)
        stream_row.pack(fill=tk.X, padx=15, pady=(0, 10))
        
        self.audio_status = ttk.Label(stream_row, text="🔇 Audio: OFF", style="StreamOff.TLabel")
        self.audio_status.pack(side=tk.LEFT, padx=(0, 25))
        
        self.camera_status = ttk.Label(stream_row, text="📷 Camera: OFF", style="StreamOff.TLabel")
        self.camera_status.pack(side=tk.LEFT, padx=(0, 25))
        
        self.screen_status = ttk.Label(stream_row, text="🖥️ Screen: OFF", style="StreamOff.TLabel")
        self.screen_status.pack(side=tk.LEFT)
        
        # Activity Log
        log_frame = tk.Frame(main_frame, bg=bg_card, highlightbackground=border, highlightthickness=1)
        log_frame.pack(fill=tk.BOTH, expand=True)
        
        log_header = tk.Frame(log_frame, bg=bg_card)
        log_header.pack(fill=tk.X, padx=15, pady=(10, 5))
        
        ttk.Label(log_header, text="📋 Activity Log", style="CardTitle.TLabel").pack(side=tk.LEFT)
        
        clear_btn = tk.Button(log_header, text="Clear", bg="#1f2937", fg=text_muted, 
                             activebackground="#374151", activeforeground=text,
                             bd=0, padx=10, pady=3, cursor="hand2",
                             command=self._clear_logs)
        clear_btn.pack(side=tk.RIGHT)
        
        # Log text area
        self.log_text = scrolledtext.ScrolledText(log_frame, bg="#0d1117", fg=text, 
                                                   font=("Consolas", 9), wrap=tk.WORD,
                                                   insertbackground=text, bd=0, 
                                                   highlightthickness=0, height=10)
        self.log_text.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        self.log_text.configure(state=tk.DISABLED)
        
        # Configure log text tags
        self.log_text.tag_configure("error", foreground="#ef4444")
        self.log_text.tag_configure("warn", foreground="#f59e0b")
        self.log_text.tag_configure("info", foreground="#3b82f6")
        self.log_text.tag_configure("voice", foreground="#10b981")
        self.log_text.tag_configure("time", foreground="#6b7280")
        self.log_text.tag_configure("category", foreground="#9ca3af")
    
    def _update_ui(self):
        """Update UI with current agent status."""
        if not self.running or not self.root:
            return
        
        try:
            status = get_agent_status()
            
            # Update status
            if status.get("connected"):
                self.status_label.configure(text="● Connected", style="Status.TLabel")
            else:
                self.status_label.configure(text="● Disconnected", style="StatusOff.TLabel")
            
            # Update device name
            self.device_label.configure(text=status.get("device_name", ""))
            
            # Update pairing code
            pairing_code = status.get("pairing_code", "------")
            self.pairing_label.configure(text=pairing_code if pairing_code else "------")
            
            # Update stats
            cpu = int(status.get("cpu_percent", 0))
            mem = int(status.get("memory_percent", 0))
            vol = int(status.get("volume", 50))
            bright = int(status.get("brightness", 50))
            
            self.cpu_label.configure(text=f"{cpu}%")
            self.cpu_bar["value"] = cpu
            
            self.mem_label.configure(text=f"{mem}%")
            self.mem_bar["value"] = mem
            
            self.vol_label.configure(text=f"{vol}%")
            self.vol_bar["value"] = vol
            
            self.bright_label.configure(text=f"{bright}%")
            self.bright_bar["value"] = bright
            
            # Update streaming status
            if status.get("audio_streaming"):
                self.audio_status.configure(text="🔊 Audio: ACTIVE", style="StreamOn.TLabel")
            else:
                self.audio_status.configure(text="🔇 Audio: OFF", style="StreamOff.TLabel")
            
            if status.get("camera_streaming"):
                self.camera_status.configure(text="📹 Camera: ACTIVE", style="StreamOn.TLabel")
            else:
                self.camera_status.configure(text="📷 Camera: OFF", style="StreamOff.TLabel")
            
            if status.get("screen_streaming"):
                self.screen_status.configure(text="🖥️ Screen: ACTIVE", style="StreamOn.TLabel")
            else:
                self.screen_status.configure(text="🖥️ Screen: OFF", style="StreamOff.TLabel")
            
            # Update voice status
            if self.voice_status:
                if status.get("voice_active"):
                    self.voice_status.configure(text="🎤 Voice: ACTIVE (listening)", style="StreamOn.TLabel")
                elif status.get("voice_listening"):
                    self.voice_status.configure(text="🎤 Voice: Waiting for 'Jarvis'", style="StreamOn.TLabel")
                else:
                    self.voice_status.configure(text="🔇 Voice: OFF", style="StreamOff.TLabel")
            
            # Update voice button state
            if self.voice_btn:
                global voice_listener
                if voice_listener and voice_listener.running:
                    self.voice_btn.configure(text="🛑 Stop Voice", bg="#ef4444")
                else:
                    self.voice_btn.configure(text="🎙️ Start Voice", bg="#10b981")
            
            # Update last command
            if self.last_command_label:
                last_cmd = status.get("last_voice_command", "")
                if last_cmd:
                    self.last_command_label.configure(text=f"Last: \"{last_cmd[:40]}{'...' if len(last_cmd) > 40 else ''}\"")
            
            # Update logs
            logs = get_logs()
            if len(logs) != self.last_log_count:
                self._render_logs(logs)
                self.last_log_count = len(logs)
            
        except Exception as e:
            print(f"GUI update error: {e}")
        
        # Schedule next update
        if self.running and self.root:
            self.root.after(self.update_interval, self._update_ui)
    
    def _render_logs(self, logs):
        """Render logs to text widget."""
        if not self.log_text:
            return
        
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.delete(1.0, tk.END)
        
        for log in logs[:50]:  # Show last 50 logs
            timestamp = log.get("timestamp", "")
            try:
                time_str = datetime.fromisoformat(timestamp).strftime("%H:%M:%S")
            except:
                time_str = timestamp[:8] if len(timestamp) >= 8 else timestamp
            
            level = log.get("level", "info")
            category = log.get("category", "general")
            message = log.get("message", "")
            details = log.get("details", "")
            
            # Insert timestamp
            self.log_text.insert(tk.END, f"[{time_str}] ", "time")
            
            # Insert level
            level_text = f"[{level.upper()}] "
            self.log_text.insert(tk.END, level_text, level)
            
            # Insert category
            self.log_text.insert(tk.END, f"({category}) ", "category")
            
            # Insert message
            self.log_text.insert(tk.END, message)
            
            if details:
                self.log_text.insert(tk.END, f" | {details}", "category")
            
            self.log_text.insert(tk.END, "\n")
        
        self.log_text.configure(state=tk.DISABLED)
    
    def _clear_logs(self):
        """Clear the activity log."""
        clear_logs()
        self.last_log_count = 0
        if self.log_text:
            self.log_text.configure(state=tk.NORMAL)
            self.log_text.delete(1.0, tk.END)
            self.log_text.configure(state=tk.DISABLED)
    
    def run_mainloop(self):
        """Run the tkinter main loop (blocking)."""
        if self.root:
            try:
                self.root.mainloop()
            except KeyboardInterrupt:
                self.stop()
    
    def stop(self):
        """Stop the GUI."""
        global voice_listener
        
        self.running = False
        
        # Stop voice listener
        if voice_listener:
            voice_listener.stop()
            voice_listener = None
        
        # Stop tray
        if self.tray:
            self.tray.stop()
            self.tray = None
        
        if self.root:
            try:
                self.root.quit()
                self.root.destroy()
            except:
                pass
            self.root = None


# Global GUI instance
jarvis_gui: Optional[JarvisGUI] = None

# Global agent instance (for voice commands)
jarvis_agent_instance: Optional["JarvisAgent"] = None

# ============== MAIN ==============
async def run_agent():
    """Run the agent with async operations."""
    global jarvis_agent_instance
    
    agent = JarvisAgent()
    jarvis_agent_instance = agent  # Store global reference for voice commands
    
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
    """Main entry point - starts GUI and agent."""
    global jarvis_gui, voice_listener
    
    print("\n" + "="*60)
    print("🤖 JARVIS PC Agent v2.5 - AI Voice Edition")
    print("="*60)
    print("Features:")
    print("  🎤 Voice Control - Say 'Jarvis' to activate")
    print("  🔔 System Tray - Minimize to tray")
    print("  📱 Windows Notifications")
    print("  🌐 All PC Control Features")
    print("="*60 + "\n")
    
    try:
        if HAS_TKINTER:
            # Create and start GUI
            jarvis_gui = JarvisGUI()
            
            if jarvis_gui.start():
                # Show startup notification
                notification_manager.notify(
                    "JARVIS Agent Started",
                    "Say 'Jarvis' to use voice control"
                )
                
                # Run agent in background thread
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
                
                # Run GUI in main thread (required by tkinter)
                try:
                    jarvis_gui.run_mainloop()
                except KeyboardInterrupt:
                    pass
                finally:
                    jarvis_gui.stop()
            else:
                # Fallback to headless mode
                print("⚠️  GUI failed to start. Running in headless mode.")
                asyncio.run(run_agent())
        else:
            # No tkinter - run headless
            print("⚠️  Tkinter not available. Running in headless mode.")
            print("   Install tkinter with: pip install tk (or via system package manager)")
            asyncio.run(run_agent())
    except Exception as e:
        print("\n" + "=" * 60)
        print("❌ FATAL ERROR - Agent crashed")
        print("=" * 60)
        print(f"\nError: {e}")
        print("\nPossible fixes:")
        print("  1. Run: python -m pip install -r requirements.txt")
        print("  2. Make sure you have Python 3.10-3.12")
        print("  3. Check your internet connection")
        print("  4. For voice: pip install SpeechRecognition pyttsx3")
        print("\nPress Enter to exit...")
        try:
            input()
        except:
            time.sleep(10)


if __name__ == "__main__":
    main()
