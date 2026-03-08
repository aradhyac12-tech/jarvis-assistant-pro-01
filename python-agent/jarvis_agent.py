"""
JARVIS PC Agent v5.2.0 - Professional GUI Edition
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
AGENT_VERSION = "5.7.0"

# ============== INLINE AUTO-UPDATER ==============
import hashlib
import shutil
import numpy as np_safe  # alias to avoid conflicts

AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
VERSION_FILE = os.path.join(AGENT_DIR, ".update_version")
FIREWALL_DONE_FILE = os.path.join(AGENT_DIR, ".firewall_configured")
UPDATE_CHECK_INTERVAL = 300
BACKUP_DIR = os.path.join(AGENT_DIR, ".backups")

UPDATABLE_FILES = [
    "jarvis_agent.py", "jarvis_gui.py", "jarvis_service_installer.py", "requirements.txt",
    "skills.py",
]

TRAINING_DATA_DIR = os.path.join(AGENT_DIR, "training_data")
FACE_EMBEDDINGS_FILE = os.path.join(AGENT_DIR, "training_data", "face_embeddings.json")


def ensure_firewall_configured(p2p_port: int = 9876, log_fn=None):
    if os.path.exists(FIREWALL_DONE_FILE):
        return True
    if platform.system() != "Windows":
        _mark_firewall_done("non-windows")
        return True
    log_fn = log_fn or (lambda *a: None)
    log_fn("info", "First-run: configuring firewall rules (one-time only)...")
    success_count = 0
    for port in [p2p_port, p2p_port + 1]:
        rule_name = f"JARVIS_P2P_{port}"
        try:
            check = subprocess.run(
                ["netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name}"],
                capture_output=True, text=True, timeout=5
            )
            if check.returncode == 0 and rule_name in check.stdout:
                success_count += 1
                continue
            result = subprocess.run([
                "netsh", "advfirewall", "firewall", "add", "rule",
                f"name={rule_name}", "dir=in", "action=allow",
                "protocol=TCP", f"localport={port}", "profile=private,domain,public",
            ], capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                success_count += 1
            else:
                ps_cmd = (
                    f"Start-Process netsh -ArgumentList "
                    f"'advfirewall firewall add rule name={rule_name} dir=in action=allow protocol=TCP localport={port} profile=private,domain,public' "
                    f"-Verb RunAs -Wait -WindowStyle Hidden"
                )
                elev = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_cmd],
                    capture_output=True, text=True, timeout=30
                )
                if elev.returncode == 0:
                    success_count += 1
        except Exception:
            pass
    if success_count >= 1:
        _mark_firewall_done("success" if success_count >= 2 else "partial")
        return True
    return False


def _mark_firewall_done(status: str):
    try:
        with open(FIREWALL_DONE_FILE, "w") as f:
            json.dump({"status": status, "configured_at": datetime.now().isoformat()}, f)
    except Exception:
        pass


def is_firewall_configured() -> bool:
    return os.path.exists(FIREWALL_DONE_FILE)


def get_current_version() -> str:
    if os.path.exists(VERSION_FILE):
        try:
            with open(VERSION_FILE, "r") as f:
                return json.load(f).get("version", "0.0.0")
        except Exception:
            pass
    return AGENT_VERSION


def save_current_version(version: str):
    try:
        with open(VERSION_FILE, "w") as f:
            json.dump({"version": version, "updated_at": datetime.now().isoformat()}, f)
    except Exception:
        pass


def _version_gt(a: str, b: str) -> bool:
    try:
        ap = [int(x) for x in a.split(".")]
        bp = [int(x) for x in b.split(".")]
        while len(ap) < 3: ap.append(0)
        while len(bp) < 3: bp.append(0)
        return tuple(ap) > tuple(bp)
    except (ValueError, AttributeError):
        return a != b


def _check_for_update(supabase_url: str, supabase_key: str, device_key: str):
    url = f"{supabase_url}/functions/v1/agent-update?device_key={device_key}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("apikey", supabase_key)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            if not data.get("version"):
                return None
            if _version_gt(data["version"], get_current_version()):
                return data
            return None
    except Exception as e:
        print(f"[Updater] Check failed: {e}")
        return None


def _download_update_file(supabase_url, supabase_key, device_key, version, file_path):
    url = f"{supabase_url}/functions/v1/agent-update"
    body = json.dumps({"device_key": device_key, "version": version, "file_path": file_path}).encode()
    req = urllib.request.Request(url, data=body, method="PATCH")
    req.add_header("apikey", supabase_key)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            content_b64 = data.get("content")
            if content_b64:
                return base64.b64decode(content_b64)
    except Exception as e:
        print(f"[Updater] Download failed for {file_path}: {e}")
    return None


def _apply_update(supabase_url, supabase_key, device_key, update_info, log_fn=None, auto_restart=True):
    version = update_info["version"]
    manifest = update_info.get("file_manifest", [])
    if not manifest:
        return {"success": False, "reason": "empty_manifest"}
    log_fn = log_fn or (lambda *a: None)
    log_fn("info", f"Applying update v{version} ({len(manifest)} files)...")
    backup_dir = os.path.join(BACKUP_DIR, f"v{get_current_version()}_{int(time.time())}")
    os.makedirs(backup_dir, exist_ok=True)
    downloaded = {}
    for entry in manifest:
        fp = entry["path"]
        log_fn("info", f"Downloading: {fp}")
        content = _download_update_file(supabase_url, supabase_key, device_key, version, fp)
        if content is None:
            log_fn("error", f"Failed to download {fp}, aborting update")
            return {"success": False, "reason": f"download_failed:{fp}"}
        downloaded[fp] = content
    # Backup
    for fp in downloaded:
        full = os.path.join(AGENT_DIR, fp)
        if os.path.exists(full):
            bp = os.path.join(backup_dir, fp)
            os.makedirs(os.path.dirname(bp), exist_ok=True)
            try: shutil.copy2(full, bp)
            except Exception: pass
    # Apply
    applied = 0
    for fp, content in downloaded.items():
        full = os.path.join(AGENT_DIR, fp)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        try:
            with open(full, "wb") as f: f.write(content)
            applied += 1
        except Exception as e:
            log_fn("error", f"Failed to write {fp}: {e}")
    save_current_version(version)
    # Verify
    verified = True
    for entry in manifest:
        full = os.path.join(AGENT_DIR, entry["path"])
        if not os.path.exists(full):
            verified = False
            break
        if entry.get("hash"):
            with open(full, "rb") as f:
                actual = hashlib.sha256(f.read()).hexdigest()[:16]
            if actual != entry["hash"]:
                verified = False
                break
    log_fn("info", f"Update v{version}: {applied}/{len(manifest)} files applied. Verified: {verified}")
    result = {"success": True, "version": version, "files_applied": applied, "verified": verified}
    if auto_restart and verified:
        log_fn("info", "Auto-restarting in 3 seconds...")
        threading.Timer(3.0, _restart_agent, args=[log_fn]).start()
    return result


def _restart_agent(log_fn=None):
    log_fn = log_fn or (lambda *a: None)
    log_fn("info", "Restarting agent...")
    try:
        python_exe = sys.executable
        script = os.path.join(AGENT_DIR, "jarvis_agent.py")
        args = sys.argv[1:] if len(sys.argv) > 1 else []
        if platform.system() == "Windows":
            CREATE_NEW_PROCESS_GROUP = 0x00000200
            DETACHED_PROCESS = 0x00000008
            subprocess.Popen(
                [python_exe, script] + args,
                creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
                close_fds=True, cwd=AGENT_DIR,
            )
            time.sleep(2)
            os._exit(0)
        else:
            os.execv(python_exe, [python_exe, script] + args)
    except Exception as e:
        log_fn("error", f"Auto-restart failed: {e}. Restart manually.")


class InlineAutoUpdater:
    """Background auto-updater thread (inline, no separate file needed)."""
    def __init__(self, supabase_url, supabase_key, device_key, log_fn=None, on_update=None, auto_restart=True):
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.device_key = device_key
        self.log_fn = log_fn or (lambda *a: None)
        self.on_update = on_update
        self.auto_restart = auto_restart
        self.running = False
        self._thread = None
        self.last_check = None
        self.last_update = None
        self.last_verification = None
        self.available_version = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="auto-updater")
        self._thread.start()
        self.log_fn("info", "Auto-updater started (checking every 5 min, auto-restart enabled)")

    def stop(self):
        self.running = False

    def check_now(self):
        return _check_for_update(self.supabase_url, self.supabase_key, self.device_key)

    def apply_now(self):
        update = self.check_now()
        if update:
            result = _apply_update(self.supabase_url, self.supabase_key, self.device_key, update, self.log_fn, self.auto_restart)
            self.last_verification = result.get("verified")
            return result
        return {"success": False, "reason": "no_update_available"}

    def get_status(self):
        return {
            "running": self.running, "last_check": self.last_check,
            "last_update": self.last_update, "last_verification": self.last_verification,
            "available_version": self.available_version, "current_version": get_current_version(),
            "firewall_configured": is_firewall_configured(), "auto_restart": self.auto_restart,
        }

    def _loop(self):
        time.sleep(30)
        while self.running:
            try:
                self.last_check = datetime.now().isoformat()
                update = _check_for_update(self.supabase_url, self.supabase_key, self.device_key)
                if update:
                    self.available_version = update["version"]
                    self.log_fn("info", f"New update available: v{update['version']}")
                    result = _apply_update(
                        self.supabase_url, self.supabase_key, self.device_key,
                        update, self.log_fn, self.auto_restart
                    )
                    if result.get("success"):
                        self.last_update = datetime.now().isoformat()
                        self.last_verification = result.get("verified")
                        if self.on_update:
                            self.on_update(update["version"])
            except Exception as e:
                self.log_fn("warn", f"Auto-updater error: {e}")
            for _ in range(UPDATE_CHECK_INTERVAL):
                if not self.running: break
                time.sleep(1)

# Legacy compat - always available now
HAS_AUTO_UPDATER = True


# ============== FACE RECOGNIZER (MediaPipe) ==============
class FaceRecognizer:
    """ML-based face recognition using MediaPipe FaceMesh.
    
    Extracts normalized face landmark coordinates as embeddings,
    then compares against stored owner embeddings using cosine similarity.
    """
    
    RECOGNITION_THRESHOLD = 0.15  # cosine distance — lower = more similar
    MIN_TRAINING_FRAMES = 5
    
    def __init__(self, training_dir: str = TRAINING_DATA_DIR):
        self.training_dir = training_dir
        self._embeddings: Dict[str, List[List[float]]] = {}  # label -> list of embeddings
        self._face_mesh = None
        self._pose = None
        self._initialized = False
        self._lock = threading.Lock()
    
    def _ensure_init(self):
        if self._initialized:
            return True
        if not HAS_MEDIAPIPE or not HAS_NUMPY:
            return False
        try:
            self._face_mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=True,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
            )
            self._pose = mp.solutions.pose.Pose(
                static_image_mode=True,
                model_complexity=1,
                min_detection_confidence=0.5,
            )
            self._initialized = True
            self._load_embeddings()
            return True
        except Exception as e:
            add_log("error", f"FaceRecognizer init failed: {e}", category="recognition")
            return False
    
    def _extract_face_embedding(self, frame) -> Optional[List[float]]:
        """Extract 468-landmark face mesh embedding from a BGR frame."""
        if not self._face_mesh:
            return None
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self._face_mesh.process(rgb)
            if not results.multi_face_landmarks:
                return None
            landmarks = results.multi_face_landmarks[0]
            # Flatten to [x0,y0,z0, x1,y1,z1, ...]
            embedding = []
            for lm in landmarks.landmark:
                embedding.extend([lm.x, lm.y, lm.z])
            return embedding
        except Exception:
            return None
    
    def _extract_pose_embedding(self, frame) -> Optional[List[float]]:
        """Extract 33-landmark pose embedding from a BGR frame."""
        if not self._pose:
            return None
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self._pose.process(rgb)
            if not results.pose_landmarks:
                return None
            embedding = []
            for lm in results.pose_landmarks.landmark:
                embedding.extend([lm.x, lm.y, lm.z, lm.visibility])
            return embedding
        except Exception:
            return None
    
    def _extract_combined_embedding(self, frame) -> Optional[List[float]]:
        """Combined face + pose embedding for maximum accuracy."""
        face = self._extract_face_embedding(frame)
        pose = self._extract_pose_embedding(frame)
        if face and pose:
            return face + pose
        return face or pose
    
    def _cosine_distance(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine distance between two embeddings."""
        if HAS_SCIPY:
            try:
                return cosine_distance(a, b)
            except Exception:
                pass
        # Fallback numpy implementation
        a_arr = np.array(a, dtype=np.float64)
        b_arr = np.array(b, dtype=np.float64)
        dot = np.dot(a_arr, b_arr)
        norm_a = np.linalg.norm(a_arr)
        norm_b = np.linalg.norm(b_arr)
        if norm_a == 0 or norm_b == 0:
            return 1.0
        return 1.0 - (dot / (norm_a * norm_b))
    
    def train_from_images(self, label: str = "owner") -> Dict[str, Any]:
        """Process all training images and generate embeddings."""
        if not self._ensure_init():
            return {"success": False, "error": "MediaPipe not available"}
        
        with self._lock:
            embeddings = []
            processed = 0
            errors = 0
            
            # Scan training data directories
            for item in os.listdir(self.training_dir) if os.path.exists(self.training_dir) else []:
                item_path = os.path.join(self.training_dir, item)
                if not os.path.isdir(item_path):
                    continue
                # Match label (owner, owner_face_*, etc.)
                if not item.startswith(label):
                    continue
                
                for img_file in sorted(os.listdir(item_path)):
                    if not img_file.endswith(('.jpg', '.jpeg', '.png')):
                        continue
                    img_path = os.path.join(item_path, img_file)
                    try:
                        frame = cv2.imread(img_path)
                        if frame is None:
                            continue
                        emb = self._extract_combined_embedding(frame)
                        if emb:
                            embeddings.append(emb)
                            processed += 1
                        else:
                            errors += 1
                    except Exception:
                        errors += 1
            
            if len(embeddings) < self.MIN_TRAINING_FRAMES:
                return {
                    "success": False,
                    "error": f"Not enough face data. Got {len(embeddings)}, need {self.MIN_TRAINING_FRAMES}",
                    "processed": processed,
                }
            
            self._embeddings[label] = embeddings
            self._save_embeddings()
            
            add_log("info", f"Face recognition trained: {processed} embeddings for '{label}'", category="recognition")
            return {
                "success": True,
                "label": label,
                "embeddings_count": len(embeddings),
                "processed": processed,
                "errors": errors,
            }
    
    def recognize(self, frame) -> Dict[str, Any]:
        """Recognize a face in a BGR frame against stored embeddings.
        
        Returns:
            {
                "recognized": bool,
                "label": str or None,     # "owner" if matched
                "confidence": float,       # 0-100, higher = more confident match
                "distance": float,         # raw cosine distance
                "face_detected": bool,
            }
        """
        if not self._ensure_init():
            return {"recognized": False, "face_detected": False, "error": "ML not available"}
        
        if not self._embeddings:
            return {"recognized": False, "face_detected": False, "error": "No training data"}
        
        with self._lock:
            current_emb = self._extract_combined_embedding(frame)
            if not current_emb:
                return {"recognized": False, "face_detected": False}
            
            best_label = None
            best_distance = float("inf")
            
            for label, stored_embeddings in self._embeddings.items():
                # Compare against all stored embeddings, take the minimum distance
                distances = []
                for stored in stored_embeddings:
                    # Handle mismatched embedding sizes (face-only vs combined)
                    min_len = min(len(current_emb), len(stored))
                    if min_len < 100:
                        continue
                    d = self._cosine_distance(current_emb[:min_len], stored[:min_len])
                    distances.append(d)
                
                if distances:
                    # Use median of top-5 closest matches for robustness
                    distances.sort()
                    avg_distance = np.mean(distances[:min(5, len(distances))])
                    if avg_distance < best_distance:
                        best_distance = avg_distance
                        best_label = label
            
            recognized = best_distance < self.RECOGNITION_THRESHOLD
            confidence = max(0, min(100, int((1.0 - best_distance / self.RECOGNITION_THRESHOLD) * 100))) if recognized else 0
            
            return {
                "recognized": recognized,
                "label": best_label if recognized else None,
                "confidence": confidence,
                "distance": round(best_distance, 4),
                "face_detected": True,
            }
    
    def _save_embeddings(self):
        """Save embeddings to disk for persistence."""
        try:
            os.makedirs(os.path.dirname(FACE_EMBEDDINGS_FILE), exist_ok=True)
            data = {}
            for label, embs in self._embeddings.items():
                data[label] = [list(e) for e in embs]
            with open(FACE_EMBEDDINGS_FILE, "w") as f:
                json.dump(data, f)
        except Exception as e:
            add_log("warn", f"Failed to save embeddings: {e}", category="recognition")
    
    def _load_embeddings(self):
        """Load embeddings from disk."""
        if not os.path.exists(FACE_EMBEDDINGS_FILE):
            return
        try:
            with open(FACE_EMBEDDINGS_FILE, "r") as f:
                data = json.load(f)
            self._embeddings = {label: [list(e) for e in embs] for label, embs in data.items()}
            total = sum(len(e) for e in self._embeddings.values())
            add_log("info", f"Loaded {total} face embeddings for {len(self._embeddings)} labels", category="recognition")
        except Exception as e:
            add_log("warn", f"Failed to load embeddings: {e}", category="recognition")
    
    def get_status(self) -> Dict[str, Any]:
        self._ensure_init()
        return {
            "initialized": self._initialized,
            "has_mediapipe": HAS_MEDIAPIPE,
            "has_numpy": HAS_NUMPY,
            "labels": {label: len(embs) for label, embs in self._embeddings.items()},
            "total_embeddings": sum(len(e) for e in self._embeddings.values()),
            "threshold": self.RECOGNITION_THRESHOLD,
        }


# Global face recognizer singleton
_face_recognizer: Optional[FaceRecognizer] = None

def get_face_recognizer() -> FaceRecognizer:
    global _face_recognizer
    if _face_recognizer is None:
        _face_recognizer = FaceRecognizer()
    return _face_recognizer


# ============== BLE GATT SERVER (Bluetooth Fallback) ==============
BLE_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0"
BLE_CMD_WRITE_UUID = "12345678-1234-5678-1234-56789abcdef1"   # Phone writes commands here
BLE_CMD_NOTIFY_UUID = "12345678-1234-5678-1234-56789abcdef2"  # PC sends responses here
BLE_CLIP_WRITE_UUID = "12345678-1234-5678-1234-56789abcdef3"  # Clipboard write from phone
BLE_CLIP_READ_UUID = "12345678-1234-5678-1234-56789abcdef4"   # Clipboard read (PC -> phone)
BLE_MTU = 512  # BLE MTU size
BLE_CHUNK_SIZE = 500  # Max bytes per chunk (header + payload)
BLE_HEADER_OVERHEAD = 10  # "[99/99]" max chars


def ble_encode_chunked(data: bytes) -> list:
    """Encode data into framed BLE chunks with [index/total] headers."""
    payload_max = BLE_CHUNK_SIZE - BLE_HEADER_OVERHEAD
    total_chunks = max(1, -(-len(data) // payload_max))  # ceil division
    chunks = []
    for i in range(total_chunks):
        start = i * payload_max
        payload = data[start:start + payload_max]
        header = f"[{i}/{total_chunks}]".encode("utf-8")
        chunks.append(header + payload)
    return chunks


def ble_parse_chunk_header(raw: bytes):
    """Parse [index/total] header from raw bytes. Returns (index, total, payload) or None."""
    if len(raw) < 4 or raw[0:1] != b'[':
        return None
    bracket_end = raw.find(b']', 1, BLE_HEADER_OVERHEAD + 2)
    if bracket_end < 0:
        return None
    header_str = raw[1:bracket_end].decode("utf-8", errors="ignore")
    parts = header_str.split("/")
    if len(parts) != 2:
        return None
    try:
        index = int(parts[0])
        total = int(parts[1])
    except ValueError:
        return None
    if total < 1:
        return None
    return index, total, raw[bracket_end + 1:]


class BleReassembler:
    """Accumulates chunked BLE writes and returns complete messages."""
    def __init__(self, timeout_sec=10.0):
        self.chunks = {}
        self.total = 0
        self.timeout_sec = timeout_sec
        self.last_receive = 0.0
    
    def feed(self, raw: bytes) -> bytes | None:
        """Feed a raw BLE write. Returns assembled bytes when complete, or None."""
        parsed = ble_parse_chunk_header(raw)
        if parsed is None:
            # No framing header — treat as single complete message (backward compat)
            return raw
        
        index, total, payload = parsed
        now = time.time()
        
        # Reset if new message or stale
        if total != self.total or (now - self.last_receive) > self.timeout_sec:
            self.chunks.clear()
            self.total = total
        
        self.last_receive = now
        self.chunks[index] = payload
        
        if len(self.chunks) == total:
            # Reassemble in order
            assembled = b"".join(self.chunks.get(i, b"") for i in range(total))
            self.chunks.clear()
            self.total = 0
            return assembled
        
        return None  # Waiting for more chunks


class BluetoothServer:
    """BLE GATT server for fallback when WiFi is unavailable.
    
    Exposes characteristics for:
    - Command send/receive (JSON)
    - Clipboard sync
    """
    
    def __init__(self, command_handler=None):
        self.command_handler = command_handler
        self.running = False
        self._server = None
        self._thread = None
        self._response_queue: deque = deque(maxlen=32)
        self._loop = None
        self._cmd_reassembler = BleReassembler()
        self._clip_reassembler = BleReassembler()
    
    def start(self):
        if not HAS_BLESS:
            add_log("warn", "bless not installed — BLE server disabled", category="bluetooth")
            return
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="ble-server")
        self._thread.start()
    
    def stop(self):
        self.running = False
        if self._server and self._loop:
            try:
                asyncio.run_coroutine_threadsafe(self._server.stop(), self._loop)
            except Exception:
                pass
    
    def _run(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._serve())
        except Exception as e:
            add_log("error", f"BLE server error: {e}", category="bluetooth")
        finally:
            self._loop.close()
    
    async def _serve(self):
        self.running = True
        try:
            server = BlessServer(name="JARVIS-PC")
            self._server = server
            
            server.read_request_func = self._on_read
            server.write_request_func = self._on_write
            
            await server.add_new_service(BLE_SERVICE_UUID)
            
            # Command write characteristic (phone -> PC)
            await server.add_new_characteristic(
                BLE_SERVICE_UUID, BLE_CMD_WRITE_UUID,
                GATTCharacteristicProperties.write,
                None,
                GATTAttributePermissions.writeable,
            )
            
            # Command notify characteristic (PC -> phone)
            await server.add_new_characteristic(
                BLE_SERVICE_UUID, BLE_CMD_NOTIFY_UUID,
                GATTCharacteristicProperties.read | GATTCharacteristicProperties.notify,
                None,
                GATTAttributePermissions.readable,
            )
            
            # Clipboard write (phone -> PC)
            await server.add_new_characteristic(
                BLE_SERVICE_UUID, BLE_CLIP_WRITE_UUID,
                GATTCharacteristicProperties.write,
                None,
                GATTAttributePermissions.writeable,
            )
            
            # Clipboard read (PC -> phone)
            await server.add_new_characteristic(
                BLE_SERVICE_UUID, BLE_CLIP_READ_UUID,
                GATTCharacteristicProperties.read | GATTCharacteristicProperties.notify,
                None,
                GATTAttributePermissions.readable,
            )
            
            await server.start()
            add_log("info", "BLE GATT server started (JARVIS-PC)", category="bluetooth")
            
            while self.running:
                await asyncio.sleep(1)
            
            await server.stop()
            add_log("info", "BLE GATT server stopped", category="bluetooth")
            
        except Exception as e:
            add_log("error", f"BLE server failed: {e}", category="bluetooth")
            self.running = False
    
    def _on_read(self, characteristic, **kwargs):
        uuid = str(characteristic.uuid).lower()
        if BLE_CMD_NOTIFY_UUID.lower() in uuid:
            # Return latest response (chunked if needed)
            if self._response_queue:
                resp = self._response_queue.popleft()
                resp_bytes = json.dumps(resp).encode("utf-8")
                # Return first chunk; phone will re-read for more if needed
                chunks = ble_encode_chunked(resp_bytes)
                return chunks[0] if chunks else b'{"type":"empty"}'
            return b'{"type":"empty"}'
        elif BLE_CLIP_READ_UUID.lower() in uuid:
            try:
                import pyperclip
                text = pyperclip.paste() or ""
                data = text.encode("utf-8")
                chunks = ble_encode_chunked(data)
                return chunks[0] if chunks else b""
            except Exception:
                return b""
        return b""
    
    def _send_chunked_notification(self, service_uuid, char_uuid, data: bytes):
        """Send chunked data via BLE notifications with error handling."""
        if not self._server:
            return
        chunks = ble_encode_chunked(data)
        for chunk in chunks:
            try:
                self._server.get_characteristic(char_uuid)
                self._server.update_value(service_uuid, char_uuid)
            except Exception as e:
                # Silently catch characteristic update errors (client disconnected mid-stream)
                pass
    
    def _on_write(self, characteristic, value, **kwargs):
        uuid = str(characteristic.uuid).lower()
        if BLE_CMD_WRITE_UUID.lower() in uuid:
            # Accumulate chunked command writes
            assembled = self._cmd_reassembler.feed(bytes(value))
            if assembled is None:
                return  # Waiting for more chunks
            
            try:
                data = json.loads(assembled.decode("utf-8"))
                cmd_type = data.get("commandType", data.get("type", ""))
                payload = data.get("payload", {})
                request_id = data.get("requestId", "")
                
                if cmd_type == "ping":
                    # Fast-path ping response
                    pong = json.dumps({"type": "pong", "t": data.get("t", 0)}).encode("utf-8")
                    self._send_chunked_notification(BLE_SERVICE_UUID, BLE_CMD_NOTIFY_UUID, pong)
                    return
                
                if self.command_handler:
                    def _handle():
                        try:
                            loop = asyncio.new_event_loop()
                            if asyncio.iscoroutinefunction(self.command_handler):
                                result = loop.run_until_complete(self.command_handler(cmd_type, payload))
                            else:
                                result = self.command_handler(cmd_type, payload)
                            loop.close()
                            resp = {
                                "type": "command_result",
                                "requestId": request_id,
                                "commandType": cmd_type,
                                "result": result,
                            }
                            self._response_queue.append(resp)
                            resp_bytes = json.dumps(resp).encode("utf-8")
                            self._send_chunked_notification(BLE_SERVICE_UUID, BLE_CMD_NOTIFY_UUID, resp_bytes)
                        except Exception as e:
                            err_resp = {
                                "type": "command_error",
                                "requestId": request_id,
                                "error": str(e),
                            }
                            self._response_queue.append(err_resp)
                            self._send_chunked_notification(
                                BLE_SERVICE_UUID, BLE_CMD_NOTIFY_UUID,
                                json.dumps(err_resp).encode("utf-8")
                            )
                    
                    threading.Thread(target=_handle, daemon=True).start()
            except Exception as e:
                add_log("error", f"BLE command parse error: {e}", category="bluetooth")
        
        elif BLE_CLIP_WRITE_UUID.lower() in uuid:
            # Accumulate chunked clipboard writes
            assembled = self._clip_reassembler.feed(bytes(value))
            if assembled is None:
                return  # Waiting for more chunks
            
            try:
                import pyperclip
                text = assembled.decode("utf-8")
                pyperclip.copy(text)
                add_log("info", f"BLE clipboard set: {text[:30]}...", category="bluetooth")
            except Exception as e:
                add_log("error", f"BLE clipboard write error: {e}", category="bluetooth")


# Global BLE server singleton
_ble_server: Optional[BluetoothServer] = None

def start_ble_server(command_handler=None) -> Optional[BluetoothServer]:
    global _ble_server
    if not HAS_BLESS:
        return None
    if _ble_server and _ble_server.running:
        return _ble_server
    _ble_server = BluetoothServer(command_handler=command_handler)
    _ble_server.start()
    return _ble_server

def stop_ble_server():
    global _ble_server
    if _ble_server:
        _ble_server.stop()
        _ble_server = None


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
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

# MediaPipe for face recognition
try:
    import mediapipe as mp
    HAS_MEDIAPIPE = True
except ImportError:
    HAS_MEDIAPIPE = False

# Scipy for distance calculations
try:
    from scipy.spatial.distance import cosine as cosine_distance
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

# BLE server (bless)
try:
    from bless import BlessServer, BlessGATTCharacteristic, GATTCharacteristicProperties, GATTAttributePermissions
    HAS_BLESS = True
except ImportError:
    HAS_BLESS = False

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
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume, ISimpleAudioVolume
        from ctypes import cast, POINTER
        from comtypes import CLSCTX_ALL
        import comtypes
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


# ============== SAFE PYCAW HELPERS (COM-thread-safe) ==============
# The key issue: pycaw's AudioUtilities.GetSpeakers() returns different wrapper
# types depending on pycaw version. We must get the raw IMMDevice COM pointer.

def _get_volume_interface():
    """Get IAudioEndpointVolume with proper COM init. Returns volume interface or None.
    
    IMPORTANT: We do NOT call CoUninitialize here — the caller's thread keeps COM alive
    until the thread exits. Calling CoUninitialize while COM pointers are still in scope
    triggers the 0xFFFFFFFF memory-read crash and VTable errors.
    """
    if not HAS_PYCAW:
        return None
    try:
        comtypes.CoInitialize()
    except Exception:
        pass
    try:
        speakers = AudioUtilities.GetSpeakers()
        if speakers is None:
            return None
        
        # Try direct Activate on the speakers object
        try:
            interface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            volume = cast(interface, POINTER(IAudioEndpointVolume))
            return volume
        except (AttributeError, ValueError, OSError):
            pass
        
        # Try extracting raw device from wrapper attributes
        for attr in ('_dev', 'dev', '_device', 'device', '_real_device'):
            raw = getattr(speakers, attr, None)
            if raw is not None:
                try:
                    interface = raw.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                    volume = cast(interface, POINTER(IAudioEndpointVolume))
                    return volume
                except (AttributeError, ValueError, OSError):
                    continue
        
        return None
    except Exception:
        return None


def _safe_pycaw_get_volume():
    """Get volume using pycaw with proper COM initialization for threading."""
    if not HAS_PYCAW:
        return _powershell_get_volume()
    try:
        endpoint = _get_volume_interface()
        if endpoint is None:
            return _powershell_get_volume()
        vol = int(endpoint.GetMasterVolumeLevelScalar() * 100)
        return vol
    except Exception:
        return _powershell_get_volume()


def _safe_pycaw_set_volume(level: int):
    """Set volume using pycaw with proper COM initialization."""
    if not HAS_PYCAW:
        add_log("warning", "pycaw not available for set_volume", category="audio")
        return False
    try:
        endpoint = _get_volume_interface()
        if endpoint is None:
            add_log("warning", "pycaw: no volume endpoint found", category="audio")
            return False
        scalar = level / 100.0
        endpoint.SetMasterVolumeLevelScalar(scalar, None)
        add_log("info", f"pycaw set volume to {level}% (scalar={scalar})", category="audio")
        return True
    except Exception as e:
        add_log("error", f"pycaw set_volume exception: {e}", category="audio")
        return False


def _safe_pycaw_get_mute():
    """Get mute state with COM init."""
    if not HAS_PYCAW:
        return None
    try:
        endpoint = _get_volume_interface()
        if endpoint is None:
            return None
        return bool(endpoint.GetMute())
    except Exception:
        return None


def _safe_pycaw_set_mute(mute: bool):
    """Set mute state with COM init."""
    if not HAS_PYCAW:
        return False
    try:
        endpoint = _get_volume_interface()
        if endpoint is None:
            return False
        endpoint.SetMute(1 if mute else 0, None)
        return True
    except Exception:
        return False


def _safe_pycaw_toggle_mute():
    """Toggle mute with COM init."""
    if not HAS_PYCAW:
        return None
    try:
        endpoint = _get_volume_interface()
        if endpoint is None:
            return None
        current = bool(endpoint.GetMute())
        endpoint.SetMute(0 if current else 1, None)
        return not current
    except Exception:
        return None


def _safe_pycaw_get_sessions():
    """Get audio sessions with per-app volume info."""
    if not HAS_PYCAW:
        return []
    try:
        comtypes.CoInitialize()
        try:
            sessions = AudioUtilities.GetAllSessions()
            result = []
            for session in sessions:
                if session.Process:
                    vol_level = 100
                    is_muted = False
                    try:
                        vol = session._ctl.QueryInterface(ISimpleAudioVolume)
                        vol_level = int(vol.GetMasterVolume() * 100)
                        is_muted = bool(vol.GetMute())
                    except Exception:
                        pass
                    result.append({
                        "id": f"app_{session.Process.pid}",
                        "name": session.Process.name(),
                        "type": "app",
                        "pid": session.Process.pid,
                        "volume": vol_level,
                        "isMuted": is_muted,
                        "isDefault": False,
                    })
            return result
        finally:
            try:
                comtypes.CoUninitialize()
            except Exception:
                pass
    except Exception:
        try:
            comtypes.CoUninitialize()
        except Exception:
            pass
        return []


def _safe_pycaw_set_session_volume(pid: int, level: int) -> bool:
    """Set per-app volume by PID."""
    if not HAS_PYCAW:
        return False
    try:
        comtypes.CoInitialize()
        try:
            sessions = AudioUtilities.GetAllSessions()
            for session in sessions:
                if session.Process and session.Process.pid == pid:
                    vol = session._ctl.QueryInterface(ISimpleAudioVolume)
                    vol.SetMasterVolume(level / 100.0, None)
                    return True
            return False
        finally:
            try:
                comtypes.CoUninitialize()
            except Exception:
                pass
    except Exception:
        return False


def _safe_pycaw_set_session_mute(pid: int, mute: bool) -> bool:
    """Set per-app mute by PID."""
    if not HAS_PYCAW:
        return False
    try:
        comtypes.CoInitialize()
        try:
            sessions = AudioUtilities.GetAllSessions()
            for session in sessions:
                if session.Process and session.Process.pid == pid:
                    vol = session._ctl.QueryInterface(ISimpleAudioVolume)
                    vol.SetMute(1 if mute else 0, None)
                    return True
            return False
        finally:
            try:
                comtypes.CoUninitialize()
            except Exception:
                pass
    except Exception:
        return False


def _get_audio_output_devices():
    """Enumerate all audio output devices with active device detection (KDE Connect style)."""
    devices = []
    try:
        # Use AudioDevice module if available, otherwise fall back to Win32_SoundDevice
        result = subprocess.run([
            "powershell", "-NoProfile", "-NonInteractive", "-c",
            """
            try {
                # Try Get-AudioDevice (AudioDeviceCmdlets module)
                $defaultDev = (Get-AudioDevice -Playback).Name
                Get-AudioDevice -List | Where-Object { $_.Type -eq 'Playback' } | ForEach-Object {
                    [PSCustomObject]@{
                        name = $_.Name
                        id = $_.ID
                        status = 'OK'
                        is_active = ($_.Name -eq $defaultDev)
                    }
                } | ConvertTo-Json -Compress
            } catch {
                # Fallback: use Win32_SoundDevice
                $default = (Get-CimInstance -Namespace root/cimv2 -ClassName Win32_SoundDevice | Where-Object { $_.StatusInfo -eq 3 } | Select-Object -First 1).Name
                Get-CimInstance Win32_SoundDevice | ForEach-Object {
                    [PSCustomObject]@{
                        name = $_.Name
                        id = $_.DeviceID
                        status = $_.Status
                        is_active = ($_.Name -eq $default)
                    }
                } | ConvertTo-Json -Compress
            }
            """
        ], capture_output=True, text=True, timeout=8)
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout.strip())
            if isinstance(data, dict):
                data = [data]
            for d in data:
                devices.append({
                    "id": d.get("id", ""),
                    "name": d.get("name", "Unknown"),
                    "status": d.get("status", "Unknown"),
                    "is_active": d.get("is_active", False),
                })
    except Exception:
        pass
    if not devices:
        devices.append({"id": "default", "name": "Default Output", "status": "OK", "is_active": True})
    return devices


def _powershell_get_volume():
    """Get volume via PowerShell as fallback."""
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-c",
             "(Get-AudioDevice -PlaybackVolume).Replace('%','')"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            return int(float(result.stdout.strip()))
    except Exception:
        pass
    return None


def _powershell_set_volume(level: int):
    """Set volume via PowerShell as fallback - multiple methods."""
    # Method 1: AudioDeviceCmdlets module
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-c",
             f"Set-AudioDevice -PlaybackVolume {level}"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            add_log("info", f"PowerShell AudioDeviceCmdlets set volume to {level}%", category="audio")
            return True
    except Exception:
        pass
    
    # Method 2: Direct COM via PowerShell (no module needed)
    try:
        ps_script = f"""
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {{
    int _0(); int _1(); int _2(); int _3(); int _4(); int _5(); int _6(); int _7(); int _8(); int _9(); int _10(); int _11();
    int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
}}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {{
    int Activate(ref System.Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {{
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject {{}}
public class Audio {{
    public static void SetVolume(float level) {{
        var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
        IMMDevice dev;
        enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
        var iid = typeof(IAudioEndpointVolume).GUID;
        object o;
        dev.Activate(ref iid, 23, IntPtr.Zero, out o);
        var vol = (IAudioEndpointVolume)o;
        vol.SetMasterVolumeLevelScalar(level, System.Guid.Empty);
    }}
}}
'@
[Audio]::SetVolume({level / 100.0})
"""
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-c", ps_script],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            add_log("info", f"PowerShell COM set volume to {level}%", category="audio")
            return True
        else:
            add_log("warning", f"PowerShell COM set_volume failed: {result.stderr[:200]}", category="audio")
    except Exception as e:
        add_log("error", f"PowerShell COM set_volume exception: {e}", category="audio")
    
    return False


def _find_wasapi_loopback_device(pa):
    """Find the WASAPI loopback device index for system audio capture."""
    try:
        wasapi_info = None
        for i in range(pa.get_host_api_count()):
            info = pa.get_host_api_info_by_index(i)
            if "WASAPI" in info.get("name", ""):
                wasapi_info = info
                break
        if not wasapi_info:
            return None
        
        # Find loopback-capable input devices on WASAPI
        best_device = None
        for i in range(pa.get_device_count()):
            try:
                dev = pa.get_device_info_by_index(i)
            except Exception:
                continue
            if dev.get("hostApi") == wasapi_info["index"] and dev.get("maxInputChannels") > 0:
                name = dev.get("name", "").lower()
                if "loopback" in name or "stereo mix" in name or "what u hear" in name or "wave out" in name:
                    return i
                # Remember any WASAPI input as fallback
                if best_device is None:
                    best_device = i
        
        return best_device
    except Exception:
        return None

# ============== CONFIGURATION ==============
# CRITICAL: These MUST match the web app's Supabase project
DEFAULT_JARVIS_URL = "https://hzfmgmodkqrrrlieqsop.supabase.co"
DEFAULT_JARVIS_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6Zm1nbW9ka3FycnJsaWVxc29wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NTAzMzcsImV4cCI6MjA4NzUyNjMzN30.hur36j_hFDjOQm9lEYd_I58I0An6fowouZijAwDueik"

# Optional: where the "Open Web App" button should navigate.
DEFAULT_APP_URL = os.environ.get("JARVIS_APP_URL", "https://id-preview--d1b9acd5-529c-4761-84e6-7717f3667310.lovable.app")

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
        self._actual_port = port
        self.command_handler = command_handler
        self.running = False
        self.server = None
        self.clients: Set = set()
        self.local_ips: List[str] = []
        self._server_thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ready = threading.Event()
        
    # Track streaming clients by path
    _camera_clients: Set = set()
    _screen_clients: Set = set()
    _audio_clients: Dict[str, Any] = {}  # ws -> {direction, ...}

    async def handle_client(self, websocket, path=None):
        """Handle P2P client - routes by path for streaming or commands."""
        client_ip = "unknown"
        try:
            if hasattr(websocket, 'remote_address') and websocket.remote_address:
                client_ip = websocket.remote_address[0]
        except Exception:
            pass

        # Determine path from websocket
        ws_path = "/p2p"
        try:
            if hasattr(websocket, 'path'):
                ws_path = websocket.path or "/p2p"
            elif hasattr(websocket, 'request') and hasattr(websocket.request, 'path'):
                ws_path = websocket.request.path or "/p2p"
        except Exception:
            pass

        # Route based on path
        if ws_path.startswith("/camera"):
            await self._handle_camera_client(websocket, client_ip)
            return
        elif ws_path.startswith("/screen"):
            await self._handle_screen_client(websocket, client_ip)
            return
        elif ws_path.startswith("/audio"):
            await self._handle_audio_client(websocket, client_ip, ws_path)
            return

        # Default: command P2P client
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

    async def _handle_camera_client(self, websocket, client_ip):
        """Stream camera frames directly to local P2P client."""
        add_log("info", f"P2P camera client connected: {client_ip}", category="camera")
        self._camera_clients.add(websocket)
        try:
            # Parse query params from path
            import urllib.parse
            qs = {}
            try:
                path = websocket.path if hasattr(websocket, 'path') else ""
                if '?' in path:
                    qs = dict(urllib.parse.parse_qsl(path.split('?', 1)[1]))
            except Exception:
                pass

            camera_index = int(qs.get("camera_index", "0"))
            fps = int(qs.get("fps", "30"))
            quality = int(qs.get("quality", "70"))

            if not HAS_OPENCV:
                await websocket.send(json.dumps({"type": "error", "message": "OpenCV not installed"}))
                return

            if platform.system() == "Windows":
                cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
            else:
                cap = cv2.VideoCapture(camera_index)

            if not cap.isOpened():
                await websocket.send(json.dumps({"type": "error", "message": f"Failed to open camera {camera_index}"}))
                return

            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            cap.set(cv2.CAP_PROP_FPS, fps)

            await websocket.send(json.dumps({"type": "peer_connected"}))

            interval = 1.0 / max(1, fps)
            while websocket in self._camera_clients:
                ret, frame = cap.read()
                if not ret:
                    await asyncio.sleep(0.01)
                    continue
                try:
                    _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
                    await websocket.send(buffer.tobytes())
                except Exception:
                    break
                await asyncio.sleep(interval)

            cap.release()
        except Exception as e:
            add_log("warn", f"P2P camera client error: {e}", category="camera")
        finally:
            self._camera_clients.discard(websocket)
            add_log("info", f"P2P camera client disconnected: {client_ip}", category="camera")

    async def _handle_screen_client(self, websocket, client_ip):
        """Stream screen frames directly to local P2P client."""
        add_log("info", f"P2P screen client connected: {client_ip}", category="screen")
        self._screen_clients.add(websocket)
        try:
            import urllib.parse
            qs = {}
            try:
                path = websocket.path if hasattr(websocket, 'path') else ""
                if '?' in path:
                    qs = dict(urllib.parse.parse_qsl(path.split('?', 1)[1]))
            except Exception:
                pass

            fps = int(qs.get("fps", "30"))
            quality = int(qs.get("quality", "70"))
            scale = float(qs.get("scale", "0.5"))
            monitor_index = int(qs.get("monitor_index", "1"))

            if not HAS_MSS:
                await websocket.send(json.dumps({"type": "error", "message": "mss not installed"}))
                return

            await websocket.send(json.dumps({"type": "peer_connected"}))

            interval = 1.0 / max(1, fps)
            import mss
            import numpy as np
            with mss.mss() as sct:
                monitors = sct.monitors
                mon_idx = min(monitor_index, len(monitors) - 1)
                monitor = monitors[mon_idx]

                while websocket in self._screen_clients:
                    try:
                        img = sct.grab(monitor)
                        frame = np.array(img)
                        frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
                        if scale != 1.0:
                            h, w = frame.shape[:2]
                            frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
                        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
                        await websocket.send(buffer.tobytes())
                    except Exception:
                        break
                    await asyncio.sleep(interval)

        except Exception as e:
            add_log("warn", f"P2P screen client error: {e}", category="screen")
        finally:
            self._screen_clients.discard(websocket)
            add_log("info", f"P2P screen client disconnected: {client_ip}", category="screen")

    async def _handle_audio_client(self, websocket, client_ip, ws_path):
        """Bidirectional audio relay directly via local P2P."""
        add_log("info", f"P2P audio client connected: {client_ip}", category="audio")
        try:
            import urllib.parse
            qs = {}
            try:
                if '?' in ws_path:
                    qs = dict(urllib.parse.parse_qsl(ws_path.split('?', 1)[1]))
            except Exception:
                pass

            direction = qs.get("direction", "bidirectional")
            use_system_audio = qs.get("use_system_audio", "false").lower() == "true"

            if not HAS_PYAUDIO:
                await websocket.send(json.dumps({"type": "error", "message": "PyAudio not installed"}))
                return

            await websocket.send(json.dumps({"type": "peer_connected"}))

            FORMAT = pyaudio.paInt16
            CHANNELS = 1
            RATE = 16000
            CHUNK = 1024
            pa = pyaudio.PyAudio()

            mic_stream = None
            speaker_stream = None
            running = True

            if direction in ("pc_to_phone", "bidirectional"):
                try:
                    if use_system_audio and platform.system() == "Windows":
                        # Try WASAPI loopback
                        loopback_idx = None
                        for i in range(pa.get_device_count()):
                            try:
                                info = pa.get_device_info_by_index(i)
                                if info.get("maxInputChannels", 0) > 0 and "loopback" in info.get("name", "").lower():
                                    loopback_idx = i
                                    break
                            except Exception:
                                continue
                        if loopback_idx is not None:
                            dev_info = pa.get_device_info_by_index(loopback_idx)
                            dev_rate = int(dev_info.get("defaultSampleRate", RATE))
                            dev_channels = min(dev_info.get("maxInputChannels", 1), 2)
                            mic_stream = pa.open(format=FORMAT, channels=dev_channels, rate=dev_rate,
                                                 input=True, frames_per_buffer=CHUNK, input_device_index=loopback_idx)
                        else:
                            mic_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
                    else:
                        mic_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
                except Exception as e:
                    add_log("warn", f"P2P audio input error: {e}", category="audio")

            if direction in ("phone_to_pc", "bidirectional"):
                try:
                    speaker_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, output=True, frames_per_buffer=CHUNK)
                except Exception as e:
                    add_log("warn", f"P2P audio output error: {e}", category="audio")

            # Send mic data in a background thread
            def send_mic():
                while running and mic_stream:
                    try:
                        data = mic_stream.read(CHUNK, exception_on_overflow=False)
                        asyncio.run_coroutine_threadsafe(websocket.send(data), self._loop)
                    except Exception:
                        break

            if mic_stream:
                mic_thread = threading.Thread(target=send_mic, daemon=True)
                mic_thread.start()

            # Receive audio from phone
            async for message in websocket:
                if isinstance(message, bytes) and speaker_stream:
                    try:
                        speaker_stream.write(message)
                    except Exception:
                        pass
                elif isinstance(message, str):
                    try:
                        data = json.loads(message)
                        if data.get("type") == "ping":
                            await websocket.send(json.dumps({"type": "pong"}))
                    except Exception:
                        pass

            running = False
            if mic_stream:
                try: mic_stream.stop_stream(); mic_stream.close()
                except Exception: pass
            if speaker_stream:
                try: speaker_stream.stop_stream(); speaker_stream.close()
                except Exception: pass
            pa.terminate()

        except Exception as e:
            add_log("warn", f"P2P audio client error: {e}", category="audio")
        finally:
            add_log("info", f"P2P audio client disconnected: {client_ip}", category="audio")

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
        _add_firewall_rule(self.port)
        
        try:
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

            serve_kwargs = {
                "ping_interval": 20,
                "ping_timeout": 10,
                "max_size": 10 * 1024 * 1024,
            }
            if not WS_V10_PLUS:
                serve_kwargs["reuse_port"] = False if platform.system() == "Windows" else True

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
                    self.server = await websockets.serve(
                        self.handle_client, "0.0.0.0", self._actual_port,
                        ping_interval=20, ping_timeout=10, max_size=10*1024*1024,
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
        
        self._ready.wait(timeout=5)
        
        # Start the HTTP API alongside WebSocket
        self._start_http_server()
        
        return True
    
    def _start_http_server(self):
        """Start a simple HTTP server for P2P probe/command via fetch() (CapacitorHttp)."""
        import http.server
        import urllib.parse as urlparse

        p2p_server = self

        class P2PHttpHandler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass  # Suppress default logging

            def _send_cors_headers(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

            def do_OPTIONS(self):
                self.send_response(200)
                self._send_cors_headers()
                self.end_headers()

            def do_GET(self):
                parsed = urlparse.urlparse(self.path)
                if parsed.path in ("/ping", "/p2p/ping"):
                    self.send_response(200)
                    self._send_cors_headers()
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    resp = {
                        "type": "pong",
                        "server": "jarvis_local_p2p",
                        "version": AGENT_VERSION,
                        "local_ips": p2p_server.local_ips,
                        "port": p2p_server._actual_port,
                    }
                    self.wfile.write(json.dumps(resp).encode())
                elif parsed.path in ("/info", "/p2p/info"):
                    self.send_response(200)
                    self._send_cors_headers()
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    resp = {
                        "type": "info",
                        "local_ips": p2p_server.local_ips,
                        "port": p2p_server._actual_port,
                        "clients": len(p2p_server.clients),
                        "network_prefix": get_network_prefix(p2p_server.local_ips[0]) if p2p_server.local_ips else "",
                    }
                    self.wfile.write(json.dumps(resp).encode())
                else:
                    self.send_response(404)
                    self._send_cors_headers()
                    self.end_headers()

            def do_POST(self):
                parsed = urlparse.urlparse(self.path)
                if parsed.path in ("/command", "/p2p/command"):
                    content_length = int(self.headers.get("Content-Length", 0))
                    body = self.rfile.read(content_length)
                    try:
                        data = json.loads(body)
                        command_type = data.get("commandType", "")
                        payload = data.get("payload", {})
                        request_id = data.get("requestId", str(uuid.uuid4()))

                        if p2p_server.command_handler:
                            if asyncio.iscoroutinefunction(p2p_server.command_handler):
                                loop = p2p_server._loop
                                if loop and loop.is_running():
                                    future = asyncio.run_coroutine_threadsafe(
                                        p2p_server.command_handler(command_type, payload), loop
                                    )
                                    result = future.result(timeout=30)
                                else:
                                    result = asyncio.run(p2p_server.command_handler(command_type, payload))
                            else:
                                result = p2p_server.command_handler(command_type, payload)

                            self.send_response(200)
                            self._send_cors_headers()
                            self.send_header("Content-Type", "application/json")
                            self.end_headers()
                            self.wfile.write(json.dumps({
                                "type": "command_result",
                                "requestId": request_id,
                                "commandType": command_type,
                                "result": result,
                            }).encode())
                        else:
                            self.send_response(500)
                            self._send_cors_headers()
                            self.send_header("Content-Type", "application/json")
                            self.end_headers()
                            self.wfile.write(json.dumps({"type": "command_error", "error": "No handler"}).encode())
                    except Exception as e:
                        self.send_response(500)
                        self._send_cors_headers()
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps({"type": "command_error", "error": str(e)}).encode())
                else:
                    self.send_response(404)
                    self._send_cors_headers()
                    self.end_headers()

        http_port = self._actual_port + 1  # HTTP on port 9877

        def run_http():
            try:
                server = http.server.HTTPServer(("0.0.0.0", http_port), P2PHttpHandler)
                add_log("info", f"Local P2P HTTP API started on port {http_port}", category="p2p")
                for ip in self.local_ips:
                    add_log("info", f"  → http://{ip}:{http_port}/ping", category="p2p")
                _add_firewall_rule(http_port)
                server.serve_forever()
            except Exception as e:
                add_log("warn", f"P2P HTTP server failed: {e}", category="p2p")

        self._http_thread = threading.Thread(target=run_http, daemon=True)
        self._http_thread.start()

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
        self.is_locked = self._detect_lock_state()
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
        vol = _safe_pycaw_get_volume()
        if vol is not None:
            self._volume_cache = vol
        return self._volume_cache
    
    def _set_volume(self, level: int) -> Dict[str, Any]:
        try:
            level = max(0, min(100, level))
            add_log("info", f"set_volume called with level={level}", category="audio")
            
            if platform.system() == "Windows":
                # Method 1: pycaw
                if _safe_pycaw_set_volume(level):
                    self._volume_cache = level
                    # Update device DB
                    self._update_device_field("current_volume", level)
                    return {"success": True, "volume": level, "method": "pycaw"}
                
                # Method 2: nircmd
                try:
                    r = subprocess.run(
                        ["nircmd", "setsysvolume", str(int(level / 100 * 65535))],
                        capture_output=True, timeout=5
                    )
                    if r.returncode == 0:
                        self._volume_cache = level
                        self._update_device_field("current_volume", level)
                        add_log("info", f"nircmd set volume to {level}%", category="audio")
                        return {"success": True, "volume": level, "method": "nircmd"}
                except (FileNotFoundError, subprocess.TimeoutExpired) as e:
                    add_log("warning", f"nircmd fallback failed: {e}", category="audio")
                
                # Method 3: PowerShell COM (no module needed)
                if _powershell_set_volume(level):
                    self._volume_cache = level
                    self._update_device_field("current_volume", level)
                    return {"success": True, "volume": level, "method": "powershell"}
            
            # Method 4: Keyboard fallback (always works)
            add_log("info", "Using keyboard fallback for volume", category="audio")
            current = self._volume_cache
            diff = level - current
            steps = abs(diff) // 2
            key = "volumeup" if diff > 0 else "volumedown"
            for _ in range(min(steps, 50)):
                pyautogui.press(key)
                import time
                time.sleep(0.05)
            self._volume_cache = level
            self._update_device_field("current_volume", level)
            return {"success": True, "volume": level, "method": "keyboard"}
        except Exception as e:
            add_log("error", f"set_volume failed: {e}", category="audio")
            return {"success": False, "error": str(e)}
    
    def _update_device_field(self, field: str, value):
        """Update a single field on the device record in Supabase."""
        try:
            if hasattr(self, 'device_id') and self.device_id:
                self.supabase.table("devices").update({field: value}).eq("id", self.device_id).execute()
        except Exception:
            pass
    
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
    
    @staticmethod
    def _detect_lock_state() -> bool:
        """Detect if Windows workstation is locked using desktop check."""
        if platform.system() != "Windows":
            return False
        try:
            import ctypes
            user32 = ctypes.windll.user32
            # OpenInputDesktop returns 0 when the secure desktop (lock screen) is active
            hDesktop = user32.OpenInputDesktop(0, False, 0x0100)  # DESKTOP_READOBJECTS
            if hDesktop == 0:
                return True  # locked – secure desktop is active
            user32.CloseDesktop(hDesktop)
            return False
        except Exception:
            return False

    def _smart_unlock(self, pin: str) -> Dict[str, Any]:
        """Unlock Windows lock screen: spacebar -> 4s wait -> type PIN -> 2s wait -> Enter"""
        if pin != UNLOCK_PIN:
            return {"success": False, "error": "Invalid PIN"}
        
        # Check if actually locked
        if not self._detect_lock_state():
            self.is_locked = False
            return {"success": True, "message": "PC was already unlocked"}
        
        try:
            def _do_unlock():
                try:
                    # Step 1: Press spacebar to dismiss lock screen artwork
                    pyautogui.press("space")
                    add_log("info", "Unlock: pressed spacebar, waiting 4s...", category="system")
                    
                    # Step 2: Wait 4 seconds for password field to appear
                    time.sleep(4)
                    
                    # Step 3: Type the PIN
                    pyautogui.typewrite(pin, interval=0.05)
                    add_log("info", "Unlock: typed PIN, waiting 2s...", category="system")
                    
                    # Step 4: Wait 2 seconds
                    time.sleep(2)
                    
                    # Step 5: Press Enter to submit
                    pyautogui.press("enter")
                    add_log("info", "Unlock: pressed Enter", category="system")
                    
                    # Step 6: Wait and verify
                    time.sleep(3)
                    if not JarvisAgent._detect_lock_state():
                        self.is_locked = False
                        add_log("info", "PC unlocked successfully", category="system")
                    else:
                        self.is_locked = True
                        add_log("warn", "PC may still be locked after unlock attempt", category="system")
                except Exception as e:
                    add_log("error", f"Unlock keystroke error: {e}", category="system")
            
            # Run in thread since it has blocking sleeps
            unlock_thread = threading.Thread(target=_do_unlock, daemon=True)
            unlock_thread.start()
            
            self.is_locked = False  # Optimistically set
            return {"success": True, "message": "Unlock sequence started (spacebar → 4s → PIN → 2s → Enter)"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
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
        vol = self._get_volume()
        bright = self._get_brightness()
        return {
            "success": True,
            "volume": vol,
            "brightness": bright,
            "is_locked": self._detect_lock_state(),
        }
    
    # ============== CLIPBOARD (KDE Connect / Phone Link style) ==============
    _last_clipboard_hash: str = ""
    _last_clipboard_content: str = ""
    
    def _get_clipboard(self) -> Dict[str, Any]:
        """Fast clipboard read using pyperclip, with hash for change detection."""
        try:
            import pyperclip
            content = pyperclip.paste() or ""
            import hashlib
            content_hash = hashlib.md5(content.encode("utf-8", errors="replace")).hexdigest()
            changed = content_hash != self._last_clipboard_hash
            self._last_clipboard_hash = content_hash
            self._last_clipboard_content = content
            return {"success": True, "content": content, "hash": content_hash, "changed": changed}
        except Exception:
            # Fallback to PowerShell
            try:
                result = subprocess.run(["powershell", "-c", "Get-Clipboard"], capture_output=True, text=True, timeout=3)
                content = result.stdout.rstrip("\n")
                import hashlib
                content_hash = hashlib.md5(content.encode("utf-8", errors="replace")).hexdigest()
                changed = content_hash != self._last_clipboard_hash
                self._last_clipboard_hash = content_hash
                self._last_clipboard_content = content
                return {"success": True, "content": content, "hash": content_hash, "changed": changed}
            except Exception as e:
                return {"success": False, "error": str(e)}
    
    def _check_clipboard_hash(self) -> Dict[str, Any]:
        """Ultra-fast hash-only check — no content transfer unless changed."""
        try:
            import pyperclip
            content = pyperclip.paste() or ""
            import hashlib
            content_hash = hashlib.md5(content.encode("utf-8", errors="replace")).hexdigest()
            changed = content_hash != self._last_clipboard_hash
            if changed:
                self._last_clipboard_hash = content_hash
                self._last_clipboard_content = content
                return {"success": True, "changed": True, "content": content, "hash": content_hash}
            return {"success": True, "changed": False, "hash": content_hash}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _set_clipboard(self, text: str) -> Dict[str, Any]:
        """Fast clipboard write using pyperclip."""
        try:
            import pyperclip
            pyperclip.copy(text)
            import hashlib
            self._last_clipboard_hash = hashlib.md5(text.encode("utf-8", errors="replace")).hexdigest()
            self._last_clipboard_content = text
            return {"success": True}
        except Exception:
            # Fallback to PowerShell
            try:
                # Convert newlines for powershell properly
                ps_text = text.replace('\n', '`n').replace('"', '`"')
                process = subprocess.Popen(["powershell", "-c", f"Set-Clipboard -Value \"{ps_text}\""],
                                           stdin=subprocess.PIPE, capture_output=True, timeout=3)
                process.communicate(timeout=3)
                return {"success": True}
            except Exception as e:
                return {"success": False, "error": str(e)}
    
    # ============== MEDIA ==============
    def _media_control(self, action: str, position: int = None) -> Dict[str, Any]:
        try:
            if action == "seek" and position is not None:
                return self._media_seek(position)
            key_map = {
                "play_pause": "playpause",
                "play": "playpause",
                "pause": "playpause",
                "next": "nexttrack",
                "previous": "prevtrack",
                "stop": "stop",
                "volume_up": "volumeup",
                "volume_down": "volumedown",
                "mute": "volumemute",
            }
            key = key_map.get(action, action)
            if key in ("shuffle", "repeat"):
                return {"success": True, "message": f"{key} not directly mapped"}
            pyautogui.press(key)
            return {"success": True, "action": action}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _media_seek(self, position: int) -> Dict[str, Any]:
        """Seek to position in current media using SMTC."""
        try:
            if platform.system() == "Windows":
                result = subprocess.run([
                    "powershell", "-NoProfile", "-c",
                    f"""
                    Add-Type -AssemblyName System.Runtime.WindowsRuntime
                    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
                    $async = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
                    $session = $async.GetAwaiter().GetResult()
                    $current = $session.GetCurrentSession()
                    if ($current) {{
                        $pos = [TimeSpan]::FromSeconds({position})
                        $current.TryChangePlaybackPositionAsync($pos.Ticks).GetAwaiter().GetResult()
                        'OK'
                    }} else {{ 'No session' }}
                    """
                ], capture_output=True, text=True, timeout=5)
                return {"success": True, "position": position}
            return {"success": False, "error": "Seek not supported on this platform"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_media_state(self, include_thumbnail: bool = False) -> Dict[str, Any]:
        """Get current media info with position/duration and optional album art using Windows SMTC."""
        try:
            if platform.system() == "Windows":
                try:
                    thumb_script = ""
                    if include_thumbnail:
                        thumb_script = """
                        $thumb = $info.Thumbnail
                        $thumbB64 = ''
                        if ($thumb) {
                            try {
                                $stream = $thumb.OpenReadAsync().GetAwaiter().GetResult()
                                $reader = New-Object System.IO.BinaryReader($stream.AsStreamForRead())
                                $bytes = $reader.ReadBytes($stream.Size)
                                $reader.Close()
                                $stream.Close()
                                $thumbB64 = [Convert]::ToBase64String($bytes)
                            } catch {}
                        }
                        """
                    result = subprocess.run([
                        "powershell", "-NoProfile", "-c",
                        f"""
                        Add-Type -AssemblyName System.Runtime.WindowsRuntime
                        $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
                        $async = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
                        $session = $async.GetAwaiter().GetResult()
                        $current = $session.GetCurrentSession()
                        if ($current) {{
                            $info = $current.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()
                            $playback = $current.GetPlaybackInfo()
                            $timeline = $current.GetTimelineProperties()
                            {thumb_script}
                            $obj = @{{
                                title = $info.Title
                                artist = $info.Artist
                                album = $info.AlbumTitle
                                playing = ($playback.PlaybackStatus -eq 'Playing')
                                position = [int]$timeline.Position.TotalSeconds
                                duration = [int]$timeline.EndTime.TotalSeconds
                                app = $current.SourceAppUserModelId
                            }}
                            {"'$obj[\"thumbnail\"] = $thumbB64' | Invoke-Expression" if include_thumbnail else ""}
                            $obj | ConvertTo-Json
                        }} else {{ '{{}}' }}
                        """
                    ], capture_output=True, text=True, timeout=8)
                    if result.returncode == 0 and result.stdout.strip():
                        data = json.loads(result.stdout.strip())
                        return {"success": True, **data}
                except Exception:
                    pass
            return {"success": True, "title": None, "artist": None, "playing": False, "position": 0, "duration": 0}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _download_from_url(self, url: str, file_name: str, save_folder: str = "") -> Dict[str, Any]:
        """Download a file from a URL and save it locally."""
        try:
            save_dir = save_folder or os.path.join(os.path.expanduser("~"), "Downloads", "Jarvis")
            os.makedirs(save_dir, exist_ok=True)
            dest = os.path.join(save_dir, file_name)
            
            urllib.request.urlretrieve(url, dest)
            file_size = os.path.getsize(dest)
            return {"success": True, "path": dest, "size": file_size}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== AUDIO DEVICES ==============
    def _get_audio_devices(self) -> Dict[str, Any]:
        """Get master volume, output devices, and per-app audio sessions with volume."""
        try:
            master_volume = self._get_volume()
            is_muted = _safe_pycaw_get_mute() or False
            sessions = _safe_pycaw_get_sessions()
            output_devices = _get_audio_output_devices()
            return {
                "success": True,
                "master_volume": int(master_volume),
                "is_muted": bool(is_muted),
                "output_devices": output_devices,
                "sessions": sessions,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _set_session_volume(self, pid: int, level: int) -> Dict[str, Any]:
        ok = _safe_pycaw_set_session_volume(pid, level)
        return {"success": ok, "pid": pid, "volume": level}

    def _set_session_mute(self, pid: int, mute: bool) -> Dict[str, Any]:
        ok = _safe_pycaw_set_session_mute(pid, mute)
        return {"success": ok, "pid": pid, "muted": mute}

    def _set_audio_output(self, device_id: str) -> Dict[str, Any]:
        """Switch default audio playback device using AudioDeviceCmdlets or nircmd."""
        try:
            device_id = (device_id or "").strip() or "default"
            # Try AudioDeviceCmdlets first
            result = subprocess.run([
                "powershell", "-NoProfile", "-NonInteractive", "-c",
                f'Set-AudioDevice -ID "{device_id}"'
            ], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                return {"success": True, "device_id": device_id}
            # Fallback: try by index
            result2 = subprocess.run([
                "powershell", "-NoProfile", "-NonInteractive", "-c",
                f"""
                $devices = Get-AudioDevice -List | Where-Object {{ $_.Type -eq 'Playback' }}
                $target = $devices | Where-Object {{ $_.ID -eq '{device_id}' -or $_.Name -like '*{device_id}*' }}
                if ($target) {{ Set-AudioDevice -ID $target.ID }}
                """
            ], capture_output=True, text=True, timeout=5)
            return {"success": result2.returncode == 0, "device_id": device_id}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _list_audio_outputs(self) -> Dict[str, Any]:
        return self._get_audio_devices()

    def _toggle_mute(self) -> Dict[str, Any]:
        try:
            result = _safe_pycaw_toggle_mute()
            if result is not None:
                return {"success": True, "is_muted": result}
            pyautogui.press("volumemute")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ============== NOTIFICATION DISPLAY (KDE Connect style) ==============
    def _show_notification(self, title: str, message: str, app: str = "") -> Dict[str, Any]:
        """Show a Windows toast notification — mirrors phone notifications to PC like KDE Connect."""
        try:
            if HAS_TOAST:
                toaster = ToastNotifier()
                display_title = f"📱 {app}" if app else "📱 Phone Notification"
                toaster.show_toast(
                    display_title,
                    f"{title}\n{message}" if title else message,
                    duration=5,
                    threaded=True,
                )
                add_log("info", f"Toast: {display_title} - {title}", category="notification")
                return {"success": True, "shown": True}
            else:
                add_log("warn", "win10toast not installed, notification not shown", category="notification")
                return {"success": True, "shown": False, "note": "win10toast not installed"}
        except Exception as e:
            add_log("error", f"Toast error: {e}", category="notification")
            return {"success": False, "error": str(e)}

    # Track background zoom join task
    _zoom_join_task = None
    _zoom_join_result = None
    _zoom_meeting_active = False

    async def _join_zoom(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Non-blocking Zoom join — launches background task and returns immediately."""
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

            # Check if Zoom is already running
            zoom_already_running = self._is_zoom_running()

            add_log("info", "Opening Zoom meeting via native protocol", details=link[:140], category="zoom")

            if platform.system() == "Windows":
                os.startfile(link)
            else:
                webbrowser.open(link)

            if zoom_already_running:
                initial_wait = 15
                add_log("info", "Zoom already running — skipping long wait (15s)", category="zoom")
            else:
                initial_wait = int(payload.get("initial_wait", 240))
                add_log("info", f"Zoom not running — waiting {initial_wait}s for load", category="zoom")

            # Launch background task so agent keeps accepting commands
            bg_payload = {
                "initial_wait": initial_wait,
                "mute_audio": mute_audio,
                "mute_video": mute_video,
                "take_screenshot": take_screenshot,
                "screenshot_wait": int(payload.get("screenshot_wait", 10)),
                "zoom_already_running": zoom_already_running,
            }
            self._zoom_join_task = asyncio.create_task(self._zoom_join_background(bg_payload))
            self._zoom_meeting_active = True

            return {
                "success": True,
                "message": f"Zoom join started (wait {initial_wait}s). Agent accepting commands.",
                "muted_audio": mute_audio,
                "muted_video": mute_video,
                "zoom_was_running": zoom_already_running,
                "background": True,
            }
        except Exception as e:
            add_log("error", f"Zoom join error: {e}", category="zoom")
            return {"success": False, "error": str(e)}

    def _is_zoom_running(self) -> bool:
        """Check if Zoom process is running."""
        for proc in psutil.process_iter(['name']):
            try:
                if proc.info['name'] and 'zoom' in proc.info['name'].lower():
                    return True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return False

    async def _zoom_join_background(self, payload: Dict[str, Any]) -> None:
        """Background task: wait for Zoom, handle pre-join screen, toggle mic/cam."""
        try:
            initial_wait = payload["initial_wait"]
            mute_audio = payload["mute_audio"]
            mute_video = payload["mute_video"]
            take_screenshot = payload["take_screenshot"]
            screenshot_wait = payload["screenshot_wait"]

            add_log("info", f"[Zoom BG] Waiting {initial_wait}s for Zoom to load...", category="zoom")
            
            # Wait in small increments so we don't block forever
            for i in range(initial_wait):
                await asyncio.sleep(1)
                # Every 10s check if Zoom meeting window appeared early
                if i > 10 and i % 10 == 0:
                    if self._is_zoom_meeting_window_active():
                        add_log("info", f"[Zoom BG] Meeting window detected at {i}s — skipping rest of wait", category="zoom")
                        break

            add_log("info", "[Zoom BG] Wait complete, handling pre-join/meeting controls", category="zoom")

            if platform.system() == "Windows":
                # Try to detect and handle the pre-join screen
                # The pre-join screen has "Join" button with mic/video toggles
                # Strategy: Use Tab to navigate, detect state via accessibility
                await self._handle_zoom_prejoin(mute_audio, mute_video)

            # Take screenshot after joining
            screenshot_base64 = None
            if take_screenshot:
                await asyncio.sleep(screenshot_wait)
                shot = self.screenshot_handler.capture_sync(quality=70, scale=0.5)
                if shot.get("success") and shot.get("image"):
                    screenshot_base64 = shot["image"]
                    add_log("info", "[Zoom BG] Screenshot captured", category="zoom")

            self._zoom_join_result = {
                "success": True,
                "muted_audio": mute_audio,
                "muted_video": mute_video,
                "screenshot": screenshot_base64,
            }
            add_log("info", "[Zoom BG] Join process complete", category="zoom")

        except Exception as e:
            add_log("error", f"[Zoom BG] Error: {e}", category="zoom")
            self._zoom_join_result = {"success": False, "error": str(e)}

    def _is_zoom_meeting_window_active(self) -> bool:
        """Check if the Zoom meeting window is visible (Windows only)."""
        if platform.system() != "Windows":
            return False
        try:
            import ctypes
            import ctypes.wintypes
            
            EnumWindows = ctypes.windll.user32.EnumWindows
            GetWindowTextW = ctypes.windll.user32.GetWindowTextW
            IsWindowVisible = ctypes.windll.user32.IsWindowVisible
            
            found = [False]
            
            @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
            def enum_callback(hwnd, _):
                if IsWindowVisible(hwnd):
                    title = ctypes.create_unicode_buffer(256)
                    GetWindowTextW(hwnd, title, 256)
                    t = title.value.lower()
                    # Zoom meeting window titles contain "zoom meeting" or "zoom"
                    if 'zoom meeting' in t or ('zoom' in t and 'installer' not in t):
                        found[0] = True
                        return False  # Stop enumeration
                return True
            
            EnumWindows(enum_callback, 0)
            return found[0]
        except Exception:
            return False

    async def _handle_zoom_prejoin(self, mute_audio: bool, mute_video: bool) -> None:
        """Handle the Zoom pre-join screen: ensure mic/video are in desired state, then click Join."""
        try:
            add_log("info", "[Zoom] Handling pre-join screen", category="zoom")
            
            # Give a moment for the pre-join dialog to fully render
            await asyncio.sleep(3)
            
            # On the Zoom pre-join screen:
            # - There are mic and video toggle icons
            # - Below them is the "Join" button
            # Use Zoom's keyboard shortcuts which work on the pre-join screen too
            
            # First, try to focus the Zoom window
            if platform.system() == "Windows":
                try:
                    import ctypes
                    import ctypes.wintypes
                    
                    EnumWindows = ctypes.windll.user32.EnumWindows
                    GetWindowTextW = ctypes.windll.user32.GetWindowTextW
                    IsWindowVisible = ctypes.windll.user32.IsWindowVisible
                    SetForegroundWindow = ctypes.windll.user32.SetForegroundWindow
                    
                    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
                    def find_zoom(hwnd, _):
                        if IsWindowVisible(hwnd):
                            title = ctypes.create_unicode_buffer(256)
                            GetWindowTextW(hwnd, title, 256)
                            t = title.value.lower()
                            if 'zoom' in t and 'installer' not in t:
                                SetForegroundWindow(hwnd)
                                return False
                        return True
                    
                    EnumWindows(find_zoom, 0)
                    await asyncio.sleep(1)
                except Exception as e:
                    add_log("warn", f"[Zoom] Could not focus window: {e}", category="zoom")
            
            # On pre-join screen, the checkboxes are:
            # "Don't connect to audio" and "Turn off my video"
            # We can use Tab + Space to toggle them, or use pyautogui to find and click
            
            # Most reliable approach: Use Zoom's settings via registry/config
            # to pre-set audio/video off, then just click Join
            # But for now, use the keyboard approach on the actual meeting:
            
            # After joining, use Alt+A for audio toggle, Alt+V for video toggle
            # These only work once IN the meeting, not on pre-join
            
            # For pre-join: Tab through to find the Join button and click it
            # The pre-join typically has: mic icon, video icon, Join button
            # We can use Tab to reach Join and Enter to click it
            
            # Press Tab a few times to reach Join button, then Enter
            for _ in range(3):
                pyautogui.press("tab")
                await asyncio.sleep(0.2)
            pyautogui.press("enter")
            
            add_log("info", "[Zoom] Pressed Join on pre-join screen", category="zoom")
            
            # Wait for meeting to actually load after clicking Join
            await asyncio.sleep(10)
            
            # Now we're in the meeting — use Alt+A / Alt+V to control mic/camera
            # These hotkeys TOGGLE the state, so we need to be careful
            # Strategy: Press the hotkey once, then verify state via a brief check
            
            if mute_audio:
                # Alt+A toggles mic in Zoom meeting
                pyautogui.hotkey("alt", "a")
                await asyncio.sleep(0.5)
                add_log("info", "[Zoom] Toggled mic (Alt+A) — target: muted", category="zoom")
            
            if mute_video:
                # Alt+V toggles video in Zoom meeting  
                pyautogui.hotkey("alt", "v")
                await asyncio.sleep(0.5)
                add_log("info", "[Zoom] Toggled video (Alt+V) — target: off", category="zoom")
            
            # Wait and verify — take a quick screenshot to check state
            await asyncio.sleep(2)
            
            # Don't re-toggle: the user's issue was that toggling 3x flipped it back on
            # We only toggle ONCE, not in a loop
            
            add_log("info", "[Zoom] Pre-join handling complete", category="zoom")
            
        except Exception as e:
            add_log("error", f"[Zoom] Pre-join handling error: {e}", category="zoom")

    async def _zoom_toggle_mic(self) -> Dict[str, Any]:
        """Toggle Zoom microphone via Alt+A hotkey."""
        try:
            pyautogui.hotkey("alt", "a")
            return {"success": True, "message": "Toggled Zoom microphone (Alt+A)"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _zoom_toggle_camera(self) -> Dict[str, Any]:
        """Toggle Zoom camera via Alt+V hotkey."""
        try:
            pyautogui.hotkey("alt", "v")
            return {"success": True, "message": "Toggled Zoom camera (Alt+V)"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _zoom_screenshot(self) -> Dict[str, Any]:
        """Take a screenshot of the current Zoom meeting."""
        try:
            shot = self.screenshot_handler.capture_sync(quality=70, scale=0.5)
            if shot.get("success") and shot.get("image"):
                return {"success": True, "image": shot["image"], "message": "Zoom screenshot captured"}
            return {"success": False, "error": "Screenshot capture failed"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    _siren_running = False
    _siren_thread = None

    def _get_surveillance_dir(self) -> str:
        """Get or create the surveillance folder next to the agent script."""
        agent_dir = os.path.dirname(os.path.abspath(__file__))
        surv_dir = os.path.join(agent_dir, "surveillance")
        os.makedirs(surv_dir, exist_ok=True)
        # Auto-delete files older than 15 days
        try:
            cutoff = time.time() - 15 * 24 * 60 * 60
            for f in os.listdir(surv_dir):
                fp = os.path.join(surv_dir, f)
                if os.path.isfile(fp) and os.path.getmtime(fp) < cutoff:
                    os.remove(fp)
        except Exception:
            pass
        return surv_dir

    def _save_surveillance_event_to_cloud(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Save a surveillance event to the cloud database from agent side."""
        try:
            event_type = payload.get("event_type", "motion")
            confidence = int(payload.get("confidence", 0))
            recognized = bool(payload.get("recognized", False))
            recognized_label = payload.get("recognized_label")
            recognition_confidence = int(payload.get("recognition_confidence", 0))
            metadata = payload.get("metadata", {})
            
            # Upload screenshot if image data provided
            screenshot_url = None
            image_data = payload.get("image_data", "")
            if image_data and self.device_id:
                if "," in image_data:
                    image_data = image_data.split(",", 1)[1]
                img_bytes = base64.b64decode(image_data)
                user_id = getattr(self, "current_user_id", "") or ""
                filename = f"{user_id}/{self.device_id}/{int(time.time())}.jpg"
                try:
                    self.supabase.storage.from_("surveillance-screenshots").upload(
                        filename, img_bytes, {"content-type": "image/jpeg"}
                    )
                    signed = self.supabase.storage.from_("surveillance-screenshots").create_signed_url(
                        filename, 60 * 60 * 24 * 15
                    )
                    screenshot_url = signed.get("signedURL") if isinstance(signed, dict) else None
                except Exception as e:
                    _log("warn", f"Screenshot upload failed: {e}")
            
            # Insert event
            user_id = getattr(self, "current_user_id", "") or ""
            if self.device_id and user_id:
                self.supabase.table("surveillance_events").insert({
                    "device_id": self.device_id,
                    "user_id": user_id,
                    "event_type": event_type,
                    "confidence": confidence,
                    "recognized": recognized,
                    "recognized_label": recognized_label,
                    "recognition_confidence": recognition_confidence,
                    "screenshot_url": screenshot_url,
                    "metadata": metadata,
                }).execute()
                _log("info", f"Surveillance event saved to cloud: {event_type} (confidence: {confidence}%)")
                return {"success": True, "event_type": event_type}
            return {"success": False, "error": "No device/user ID"}
        except Exception as e:
            _log("error", f"Failed to save surveillance event: {e}")
            return {"success": False, "error": str(e)}

        """Save a surveillance clip snapshot to the surveillance folder."""
        try:
            surv_dir = self._get_surveillance_dir()
            clip_id = payload.get("clip_id", str(uuid.uuid4()))
            timestamp = payload.get("timestamp", datetime.now().isoformat())
            trigger = payload.get("trigger", "unknown")
            image_data = payload.get("image_data", "")
            
            # Save image data (base64 data URL or raw base64)
            filename = f"clip_{trigger}_{timestamp.replace(':', '-').replace('.', '-')}_{clip_id[:8]}.jpg"
            filepath = os.path.join(surv_dir, filename)
            
            if image_data:
                # Strip data URL prefix if present
                if "," in image_data:
                    image_data = image_data.split(",", 1)[1]
                img_bytes = base64.b64decode(image_data)
                with open(filepath, "wb") as f:
                    f.write(img_bytes)
                _log("info", f"Surveillance clip saved: {filename}")
                return {"success": True, "path": filepath, "filename": filename}
            
            return {"success": False, "error": "No image data provided"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _delete_surveillance_clip(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Delete a surveillance clip from the surveillance folder."""
        try:
            surv_dir = self._get_surveillance_dir()
            clip_id = payload.get("clip_id", "")
            if not clip_id:
                return {"success": False, "error": "No clip_id"}
            
            # Find and delete matching file
            for f in os.listdir(surv_dir):
                if clip_id[:8] in f:
                    os.remove(os.path.join(surv_dir, f))
                    return {"success": True, "deleted": f}
            return {"success": True, "message": "File not found (may already be deleted)"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _play_alarm(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Play alarm with real siren sound using winsound frequency sweep. Supports start/stop toggle."""
        try:
            alarm_type = payload.get("type", "beep")
            duration = int(payload.get("duration", 5))
            action = payload.get("action", "start")  # "start", "stop", or "toggle"
            
            # Handle stop
            if action == "stop" or (action == "toggle" and self._siren_running):
                self._siren_running = False
                return {"success": True, "type": alarm_type, "status": "stopped"}
            
            # Handle start
            if self._siren_running:
                return {"success": True, "type": alarm_type, "status": "already_running"}
            
            self._siren_running = True
            
            def play_siren():
                if sys.platform == "win32":
                    import winsound
                    try:
                        # Try to play siren.mp3 if it exists
                        siren_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "siren.mp3")
                        if os.path.exists(siren_path) and alarm_type == "siren":
                            try:
                                import subprocess
                                # Use Windows Media Player to play mp3
                                proc = subprocess.Popen(
                                    ["powershell", "-NoProfile", "-c",
                                     f"$player = New-Object System.Media.SoundPlayer; "
                                     f"Add-Type -AssemblyName presentationCore; "
                                     f"$mp = New-Object System.Windows.Media.MediaPlayer; "
                                     f"$mp.Open('{siren_path}'); $mp.Play(); "
                                     f"while ($true) {{ Start-Sleep -Milliseconds 500 }}"],
                                    creationflags=subprocess.CREATE_NO_WINDOW
                                )
                                while self._siren_running:
                                    time.sleep(0.5)
                                proc.terminate()
                                return
                            except Exception:
                                pass
                        
                        if alarm_type == "siren":
                            while self._siren_running:
                                for freq in range(400, 1600, 100):
                                    if not self._siren_running:
                                        return
                                    winsound.Beep(freq, 50)
                                for freq in range(1600, 400, -100):
                                    if not self._siren_running:
                                        return
                                    winsound.Beep(freq, 50)
                        else:
                            winsound.Beep(800, 1000)
                    finally:
                        self._siren_running = False
                else:
                    print("\a" * 10)
                    self._siren_running = False
            
            self._siren_thread = threading.Thread(target=play_siren, daemon=True)
            self._siren_thread.start()
            return {"success": True, "type": alarm_type, "status": "started"}
        except Exception as e:
            self._siren_running = False
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
                "lock": threading.Lock()
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
                            loopback_idx = None
                            if direction in ("pc_to_phone", "bidirectional"):
                                try:
                                    if use_system_audio and platform.system() == "Windows":
                                        # Try WASAPI loopback for system audio
                                        loopback_idx = _find_wasapi_loopback_device(pa)
                                        if loopback_idx is not None:
                                            try:
                                                dev_info = pa.get_device_info_by_index(loopback_idx)
                                                dev_rate = int(dev_info.get("defaultSampleRate", 44100))
                                                dev_channels = min(dev_info.get("maxInputChannels", 2), 2)
                                                mic_stream = pa.open(
                                                    format=FORMAT,
                                                    channels=dev_channels,
                                                    rate=dev_rate,
                                                    input=True,
                                                    frames_per_buffer=CHUNK,
                                                    input_device_index=loopback_idx,
                                                )
                                                add_log("info", f"System audio (WASAPI device {loopback_idx}, {dev_rate}Hz, {dev_channels}ch) opened", category="audio")
                                            except Exception as loop_err:
                                                add_log("warn", f"WASAPI loopback open failed: {loop_err}", category="audio")
                                                mic_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
                                                add_log("info", "Fallback to PC microphone", category="audio")
                                        else:
                                            mic_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
                                            add_log("info", "No WASAPI loopback found, using PC microphone", category="audio")
                                    else:
                                        mic_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
                                        add_log("info", "PC microphone opened for audio relay", category="audio")
                                except Exception as e:
                                    add_log("warn", f"Could not open PC audio input: {e}", category="audio")

                            speaker_stream = None
                            if direction in ("phone_to_pc", "bidirectional"):
                                try:
                                    speaker_stream = pa.open(format=FORMAT, channels=CHANNELS, rate=RATE, output=True, frames_per_buffer=CHUNK)
                                    add_log("info", "PC speakers opened for audio relay", category="audio")
                                except Exception as e:
                                    add_log("warn", f"Could not open PC speakers: {e}", category="audio")

                            # Track source audio format for resampling
                            src_rate = RATE
                            src_channels = CHANNELS
                            if mic_stream and use_system_audio and platform.system() == "Windows" and loopback_idx is not None:
                                try:
                                    dev_info_mic = pa.get_device_info_by_index(loopback_idx)
                                    src_rate = int(dev_info_mic.get("defaultSampleRate", RATE))
                                    src_channels = min(dev_info_mic.get("maxInputChannels", 1), 2)
                                except Exception:
                                    pass

                            def _resample_to_16k_mono(raw_bytes, from_rate, from_channels):
                                """Resample raw int16 audio to 16kHz mono for relay."""
                                import array
                                samples = array.array('h')
                                samples.frombytes(raw_bytes)
                                
                                # Convert stereo to mono by averaging pairs
                                if from_channels == 2:
                                    mono = array.array('h', [
                                        (samples[i] + samples[i+1]) // 2
                                        for i in range(0, len(samples) - 1, 2)
                                    ])
                                else:
                                    mono = samples
                                
                                # Resample if rates differ
                                if from_rate != 16000 and from_rate > 0:
                                    ratio = 16000 / from_rate
                                    out_len = int(len(mono) * ratio)
                                    resampled = array.array('h', [0] * out_len)
                                    for i in range(out_len):
                                        src_idx = i / ratio
                                        idx_floor = int(src_idx)
                                        idx_ceil = min(idx_floor + 1, len(mono) - 1)
                                        frac = src_idx - idx_floor
                                        resampled[i] = int(mono[idx_floor] * (1 - frac) + mono[idx_ceil] * frac)
                                    return resampled.tobytes()
                                
                                return mono.tobytes()

                            def send_mic():
                                while self._audio_streamer and self._audio_streamer.get("running") and mic_stream:
                                    try:
                                        data = mic_stream.read(CHUNK, exception_on_overflow=False)
                                        # Resample to 16kHz mono if needed
                                        if src_rate != RATE or src_channels != CHANNELS:
                                            data = _resample_to_16k_mono(data, src_rate, src_channels)
                                        ws.send(data)
                                    except Exception:
                                        break

                            if mic_stream:
                                threading.Thread(target=send_mic, daemon=True).start()

                            while self._audio_streamer and self._audio_streamer.get("running"):
                                try:
                                    msg = ws.recv(timeout=1.0)
                                    if isinstance(msg, bytes) and speaker_stream:
                                        speaker_stream.write(msg)
                                    elif isinstance(msg, str):
                                        try:
                                            data = json.loads(msg)
                                            if data.get("type") == "peer_connected":
                                                add_log("info", "Audio peer connected", category="audio")
                                        except json.JSONDecodeError:
                                            pass
                                except TimeoutError:
                                    # Normal timeout — no data received, just loop
                                    pass
                                except Exception as recv_err:
                                    err_str = str(recv_err).lower()
                                    if "closed" in err_str or "eof" in err_str:
                                        add_log("warn", f"Audio WS closed: {recv_err}", category="audio")
                                        break
                                    # Transient error, continue
                                    pass

                            if mic_stream:
                                try:
                                    mic_stream.stop_stream()
                                    mic_stream.close()
                                except Exception:
                                    pass
                            if speaker_stream:
                                try:
                                    speaker_stream.stop_stream()
                                    speaker_stream.close()
                                except Exception:
                                    pass
                            pa.terminate()

                    except Exception as e:
                        if not (self._audio_streamer and self._audio_streamer.get("running")):
                            break
                        add_log("warn", f"Audio relay error (attempt {attempt}): {e} — retrying in {retry_delay}s", category="audio")
                        time.sleep(retry_delay)
                        retry_delay = min(retry_delay * 2, max_retry_delay)
                add_log("info", "Audio relay ended", category="audio")

            threading.Thread(target=stream_audio, daemon=True).start()
            add_log("info", f"Audio relay started: direction={direction}, system_audio={use_system_audio}", category="audio")
            return {"success": True, "session_id": session_id, "direction": direction}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _stop_audio_relay(self) -> Dict[str, Any]:
        try:
            if self._audio_streamer:
                with self._audio_streamer.get("lock", threading.Lock()):
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
    
    # Key name mapping: app sends these -> keyboard library expects these
    KEY_MAP = {
        "backspace": "backspace", "enter": "enter", "return": "enter",
        "tab": "tab", "escape": "escape", "esc": "escape",
        "space": "space", "delete": "delete", "del": "delete",
        "insert": "insert", "ins": "insert",
        "home": "home", "end": "end",
        "pageup": "page up", "pagedown": "page down",
        "pgup": "page up", "pgdn": "page down",
        "up": "up", "down": "down", "left": "left", "right": "right",
        "capslock": "caps lock", "numlock": "num lock", "scrolllock": "scroll lock",
        "printscreen": "print screen", "prtsc": "print screen",
        "pause": "pause",
        "win": "left windows", "lwin": "left windows", "rwin": "right windows",
        "ctrl": "ctrl", "lctrl": "left ctrl", "rctrl": "right ctrl",
        "alt": "alt", "lalt": "left alt", "ralt": "right alt",
        "shift": "shift", "lshift": "left shift", "rshift": "right shift",
        "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
        "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
        "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
        # Symbol keys
        "grave": "`", "minus": "-", "equal": "=",
        "bracketleft": "[", "bracketright": "]", "backslash": "\\",
        "semicolon": ";", "quote": "'", "comma": ",", "period": ".", "slash": "/",
    }

    def _resolve_key(self, key: str) -> str:
        """Resolve a key name from the app to the keyboard library format."""
        k = key.strip().lower()
        return self.KEY_MAP.get(k, k)

    def _key_press(self, key: str) -> Dict[str, Any]:
        try:
            if "+" in key:
                keys = [self._resolve_key(k) for k in key.split("+")]
                if HAS_KEYBOARD:
                    keyboard.press_and_release("+".join(keys))
                else:
                    pyautogui.hotkey(*keys)
            else:
                resolved = self._resolve_key(key)
                if HAS_KEYBOARD:
                    keyboard.press_and_release(resolved)
                else:
                    pyautogui.press(resolved)
            return {"success": True}
        except Exception as e:
            add_log("error", f"key_press failed for '{key}': {e}", category="input")
            return {"success": False, "error": str(e)}
    
    def _key_combo(self, keys: List[str]) -> Dict[str, Any]:
        try:
            resolved = [self._resolve_key(k) for k in keys]
            if HAS_KEYBOARD:
                keyboard.press_and_release("+".join(resolved))
            else:
                pyautogui.hotkey(*resolved)
            return {"success": True}
        except Exception as e:
            add_log("error", f"key_combo failed for {keys}: {e}", category="input")
            return {"success": False, "error": str(e)}
    
    def _type_text(self, text: str) -> Dict[str, Any]:
        """Type text using clipboard paste for reliability with all characters."""
        try:
            import pyperclip
            # Save current clipboard
            try:
                old_clip = pyperclip.paste()
            except Exception:
                old_clip = ""
            
            # Copy text to clipboard and paste it
            pyperclip.copy(text)
            time.sleep(0.05)
            
            if HAS_KEYBOARD:
                keyboard.press_and_release("ctrl+v")
            else:
                pyautogui.hotkey("ctrl", "v")
            
            time.sleep(0.1)
            
            # Restore old clipboard
            try:
                pyperclip.copy(old_clip)
            except Exception:
                pass
            
            return {"success": True}
        except Exception as e:
            add_log("error", f"type_text failed: {e}", category="input")
            # Fallback: try keyboard.write for ASCII
            try:
                if HAS_KEYBOARD:
                    keyboard.write(text, delay=0.02)
                    return {"success": True}
                else:
                    pyautogui.typewrite(text, interval=0.02)
                    return {"success": True}
            except Exception as e2:
                return {"success": False, "error": str(e2)}
    
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
    
    def _gesture_4_finger(self, direction: str = "right") -> Dict[str, Any]:
        try:
            if platform.system() == "Windows":
                if direction == "right":
                    pyautogui.hotkey("win", "ctrl", "right")
                else:
                    pyautogui.hotkey("win", "ctrl", "left")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== APPS ==============
    def _open_app(self, app_name: str, app_id: str = None) -> Dict[str, Any]:
        try:
            if not app_name and not app_id:
                return {"success": False, "error": "Missing app_name or app_id"}
            name = (app_name or "").strip().lower()
            
            well_known = {
                "notepad": "notepad.exe", "calculator": "calc.exe", "paint": "mspaint.exe",
                "terminal": "wt.exe", "cmd": "cmd.exe", "powershell": "powershell.exe",
                "explorer": "explorer.exe", "task manager": "taskmgr.exe",
                "settings": "ms-settings:", "control panel": "control.exe",
                "chrome": "chrome.exe", "firefox": "firefox.exe", "edge": "msedge.exe",
                "spotify": "spotify.exe", "discord": "discord.exe", "slack": "slack.exe",
                "zoom": "zoom.exe", "teams": "msteams.exe",
                "vscode": "code.exe", "code": "code.exe",
                "word": "winword.exe", "excel": "excel.exe", "powerpoint": "powerpnt.exe",
                "outlook": "outlook.exe", "onenote": "onenote.exe",
                "obs": "obs64.exe", "obs studio": "obs64.exe",
                "vlc": "vlc.exe", "steam": "steam.exe", "epic": "EpicGamesLauncher.exe",
                "whatsapp": "WhatsApp.exe", "telegram": "Telegram.exe",
            }
            
            # Method 1: Well-known app shortcuts
            target = well_known.get(name)
            if target:
                try:
                    if target.startswith("ms-") or target.endswith(":"):
                        os.startfile(target)
                    else:
                        subprocess.Popen([target], shell=True)
                    return {"success": True, "app": name, "method": "well_known"}
                except Exception:
                    pass  # Fall through to other methods
            
            if platform.system() == "Windows":
                # Method 2: Get-StartApps search
                try:
                    result = subprocess.run(
                        ["powershell", "-NoProfile", "-c", 
                         f"(Get-StartApps | Where-Object {{$_.Name -like '*{name}*'}} | Select-Object -First 1).AppID"],
                        capture_output=True, text=True, timeout=10
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        app_id_found = result.stdout.strip()
                        os.startfile(f"shell:AppsFolder\\{app_id_found}")
                        return {"success": True, "app": name, "method": "start_apps"}
                except Exception:
                    pass
                
                # Method 3: Search Start Menu .lnk shortcuts
                try:
                    start_dirs = [
                        os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"), "Microsoft\\Windows\\Start Menu\\Programs"),
                        os.path.join(os.environ.get("APPDATA", ""), "Microsoft\\Windows\\Start Menu\\Programs"),
                    ]
                    for start_dir in start_dirs:
                        if not os.path.exists(start_dir):
                            continue
                        for root, dirs, files_list in os.walk(start_dir):
                            for f in files_list:
                                if f.lower().endswith('.lnk') and name in f.lower():
                                    lnk_path = os.path.join(root, f)
                                    os.startfile(lnk_path)
                                    return {"success": True, "app": name, "method": "start_menu_lnk"}
                except Exception:
                    pass

                # Method 4: Shell start command
                try:
                    subprocess.Popen(f'start "" "{app_name}"', shell=True)
                    return {"success": True, "app": name, "method": "start_cmd"}
                except Exception:
                    pass

                # Method 5: Registry install location search
                try:
                    import winreg
                    for hive, reg_path in [
                        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
                        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                    ]:
                        try:
                            key = winreg.OpenKey(hive, reg_path)
                            for i in range(winreg.QueryInfoKey(key)[0]):
                                try:
                                    subkey_name = winreg.EnumKey(key, i)
                                    subkey = winreg.OpenKey(key, subkey_name)
                                    try:
                                        display_name = winreg.QueryValueEx(subkey, "DisplayName")[0]
                                        if name in display_name.lower():
                                            try:
                                                install_loc = winreg.QueryValueEx(subkey, "InstallLocation")[0]
                                                if install_loc and os.path.isdir(install_loc):
                                                    for item in os.listdir(install_loc):
                                                        if item.lower().endswith('.exe') and name.split()[0] in item.lower():
                                                            exe_path = os.path.join(install_loc, item)
                                                            subprocess.Popen([exe_path])
                                                            winreg.CloseKey(subkey)
                                                            winreg.CloseKey(key)
                                                            return {"success": True, "app": name, "method": "registry_exe"}
                                            except (FileNotFoundError, OSError):
                                                pass
                                    except (FileNotFoundError, OSError):
                                        pass
                                    finally:
                                        winreg.CloseKey(subkey)
                                except (OSError,):
                                    continue
                            winreg.CloseKey(key)
                        except (FileNotFoundError, OSError):
                            continue
                except Exception:
                    pass
            
            return {"success": False, "error": f"Could not find or open: {app_name}. Tried all search methods."}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _close_app(self, app_name: str) -> Dict[str, Any]:
        try:
            closed = 0
            for proc in psutil.process_iter(['name', 'pid']):
                if app_name.lower() in proc.info['name'].lower():
                    try:
                        proc.kill()
                        closed += 1
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue
            return {"success": closed > 0, "closed": closed}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_running_apps(self) -> Dict[str, Any]:
        try:
            apps = []
            seen = set()
            total_memory = psutil.virtual_memory().total
            for proc in psutil.process_iter(['name', 'pid', 'cpu_percent', 'memory_percent', 'status']):
                try:
                    info = proc.info
                    name = info['name']
                    if name in seen or name.lower() in ("system", "idle", "registry", "smss.exe", "csrss.exe", "wininit.exe", "services.exe", "lsass.exe", "svchost.exe", "conhost.exe", "dwm.exe", "fontdrvhost.exe", "winlogon.exe", "lsaiso.exe"):
                        continue
                    seen.add(name)
                    mem_pct = round(info.get('memory_percent', 0) or 0, 1)
                    mem_mb = round((mem_pct / 100.0) * (total_memory / (1024 * 1024)), 1)
                    apps.append({
                        "pid": info['pid'],
                        "name": name,
                        "cpu": round(info.get('cpu_percent', 0) or 0, 1),
                        "memory": mem_pct,
                        "memory_mb": mem_mb,
                        "status": info.get('status', 'unknown'),
                    })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            apps.sort(key=lambda x: x.get("memory", 0), reverse=True)
            return {"success": True, "apps": apps}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_installed_apps(self) -> Dict[str, Any]:
        try:
            apps = []
            if platform.system() == "Windows":
                import winreg
                paths = [
                    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
                    (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                ]
                seen = set()
                for root, path in paths:
                    try:
                        key = winreg.OpenKey(root, path)
                        for i in range(0, winreg.QueryInfoKey(key)[0]):
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
            # Support both field names: "data" (new) and "chunk_data" (old FileTransfer component)
            data_base64 = payload.get("data", "") or payload.get("chunk_data", "")
            file_name = payload.get("file_name", "received_file")
            # Support both field names: "save_folder" (new) and "save_path" (old)
            save_folder = payload.get("save_folder") or payload.get("save_path") or ""
            
            # Default save location: ~/Downloads/Jarvis
            if not save_folder or save_folder.strip() == "":
                save_folder = os.path.join(os.path.expanduser("~"), "Downloads", "Jarvis")
            elif save_folder.startswith("~"):
                save_folder = os.path.expanduser(save_folder)
            
            if not data_base64:
                return {"success": False, "error": "No file data received (missing 'data' or 'chunk_data' field)"}
            
            chunk_data = base64.b64decode(data_base64)
            os.makedirs(save_folder, exist_ok=True)
            file_path = os.path.join(save_folder, file_name)
            mode = "wb" if chunk_index == 0 else "ab"
            
            with open(file_path, mode) as f:
                f.write(chunk_data)
            
            progress = int((chunk_index + 1) / total_chunks * 100)
            completed = chunk_index + 1 == total_chunks
            
            if completed:
                file_size = os.path.getsize(file_path)
                add_log("info", f"File received: {file_name} ({file_size} bytes) -> {file_path}", category="file")
                notification_manager.notify("File Received", f"{file_name} saved to {save_folder}")
            
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
        """Start sending test color frames to verify streaming pipeline."""
        session_id = payload.get("session_id", "")
        if not session_id:
            return {"success": False, "error": "Missing session_id"}
        
        session_token = self._get_session_token()
        if not session_token:
            return {"success": False, "error": "No session token"}
        
        ws_base = self._get_ws_base()
        
        def send_patterns():
            import websockets.sync.client as ws_client
            ws_url = f"{ws_base}/functions/v1/camera-relay?sessionId={session_id}&type=phone&binary=true&session_token={session_token}"
            try:
                with ws_client.connect(ws_url, open_timeout=10) as ws:
                    colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]
                    for i in range(20):
                        r, g, b = colors[i % len(colors)]
                        img = Image.new('RGB', (320, 240), (r, g, b))
                        buf = io.BytesIO()
                        img.save(buf, format="JPEG", quality=50)
                        ws.send(buf.getvalue())
                        time.sleep(0.5)
            except Exception as e:
                add_log("error", f"Test pattern error: {e}", category="camera")
        
        threading.Thread(target=send_patterns, daemon=True).start()
        return {"success": True}
    
    def _get_streaming_stats(self) -> Dict[str, Any]:
        return {
            "success": True,
            "camera_active": bool(self._camera_streamer and self._camera_streamer.get("running")),
            "screen_active": bool(self._screen_streamer and self._screen_streamer.get("running")),
            "audio_active": bool(self._audio_streamer and self._audio_streamer.get("running")),
        }
    
    def _get_cameras(self) -> Dict[str, Any]:
        cameras = []
        if HAS_OPENCV:
            for i in range(5):
                try:
                    cap = cv2.VideoCapture(i, cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY)
                    if cap.isOpened():
                        cameras.append({"index": i, "name": f"Camera {i}"})
                        cap.release()
                except Exception:
                    pass
        return {"success": True, "cameras": cameras}
    
    # ============== BOOST ==============
    def _boost_ram(self) -> Dict[str, Any]:
        try:
            if platform.system() == "Windows":
                os.system("taskkill /F /IM SearchUI.exe 2>nul")
                os.system("taskkill /F /IM SearchApp.exe 2>nul")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _clear_temp_files(self) -> Dict[str, Any]:
        try:
            import shutil
            temp_dirs = [os.environ.get("TEMP", ""), os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp")]
            cleaned = 0
            for temp_dir in temp_dirs:
                if temp_dir and os.path.exists(temp_dir):
                    for item in os.listdir(temp_dir):
                        item_path = os.path.join(temp_dir, item)
                        try:
                            if os.path.isfile(item_path):
                                os.unlink(item_path)
                                cleaned += 1
                            elif os.path.isdir(item_path):
                                shutil.rmtree(item_path)
                                cleaned += 1
                        except Exception:
                            continue
            return {"success": True, "cleaned": cleaned}
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
                guid = plans.get(plan, plans["high_performance"])
                os.system(f"powercfg /setactive {guid}")
                return {"success": True, "plan": plan}
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _restart_explorer(self) -> Dict[str, Any]:
        try:
            os.system("taskkill /f /im explorer.exe")
            time.sleep(1)
            subprocess.Popen("explorer.exe")
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _gaming_mode(self, enable: bool = True) -> Dict[str, Any]:
        try:
            if enable:
                self._set_power_plan("high_performance")
                for proc_name in ["SearchUI.exe", "SearchApp.exe", "OneDrive.exe"]:
                    os.system(f"taskkill /F /IM {proc_name} 2>nul")
                return {"success": True, "mode": "gaming"}
            else:
                self._set_power_plan("balanced")
                return {"success": True, "mode": "balanced"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _optimize_drives(self, drive: str = "C:", flags: str = "/O") -> Dict[str, Any]:
        """Run defrag/TRIM optimization on a drive"""
        try:
            result = subprocess.run(
                ["defrag", drive, flags],
                capture_output=True, text=True, timeout=300
            )
            output = result.stdout or result.stderr or "Optimization complete"
            return {"success": result.returncode == 0, "message": f"Drive {drive} optimized", "output": output.strip()[:500]}
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Optimization timed out (5 min limit)"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== NETWORK INFO ==============
    def _get_network_info(self) -> Dict[str, Any]:
        local_ips = get_local_ips()
        network_prefix = get_network_prefix(local_ips[0]) if local_ips else ""
        p2p_server = get_local_p2p_server()
        return {
            "success": True,
            "local_ips": local_ips,
            "network_prefix": network_prefix,
            "hostname": socket.gethostname(),
            "p2p_port": p2p_server._actual_port if p2p_server else LOCAL_P2P_PORT,
            "p2p_server_running": p2p_server is not None and p2p_server.running,
            "p2p_clients": len(p2p_server.clients) if p2p_server else 0,
        }
    
    # ============== P2P FIREWALL & DIAGNOSTICS ==============
    def _open_p2p_firewall_ports(self) -> Dict[str, Any]:
        """Open firewall ports 9876 and 9877 for P2P connections."""
        if platform.system() != "Windows":
            return {"success": True, "message": "Not Windows, no firewall changes needed"}
        
        results = []
        for port in [LOCAL_P2P_PORT, LOCAL_P2P_PORT + 1]:
            rule_name = f"JARVIS_P2P_{port}"
            try:
                # Delete existing rule first
                subprocess.run(
                    ["netsh", "advfirewall", "firewall", "delete", "rule", f"name={rule_name}"],
                    capture_output=True, text=True, timeout=5
                )
                # Add inbound TCP rule
                result = subprocess.run([
                    "netsh", "advfirewall", "firewall", "add", "rule",
                    f"name={rule_name}", "dir=in", "action=allow",
                    "protocol=TCP", f"localport={port}", "profile=private,domain",
                ], capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    results.append(f"Port {port} opened")
                    add_log("info", f"Firewall rule added for port {port}", category="p2p")
                else:
                    results.append(f"Port {port} failed: {result.stderr.strip()}")
                    add_log("warn", f"Firewall rule failed for port {port}: {result.stderr}", category="p2p")
            except Exception as e:
                results.append(f"Port {port} error: {str(e)}")
        
        return {"success": True, "results": results, "hint": "If failed, run agent as Administrator"}
    
    def _test_p2p_server_status(self) -> Dict[str, Any]:
        """Test if the local P2P server is running and accessible."""
        p2p = get_local_p2p_server()
        local_ips = get_local_ips()
        
        ws_port = p2p._actual_port if p2p else LOCAL_P2P_PORT
        http_port = ws_port + 1
        
        # Test if ports are listening
        port_status = {}
        for port in [ws_port, http_port]:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(1)
                result = sock.connect_ex(("127.0.0.1", port))
                port_status[str(port)] = "listening" if result == 0 else "closed"
                sock.close()
            except Exception:
                port_status[str(port)] = "error"
        
        # Check firewall rules
        fw_rules = {}
        if platform.system() == "Windows":
            for port in [ws_port, http_port]:
                try:
                    check = subprocess.run(
                        ["netsh", "advfirewall", "firewall", "show", "rule", f"name=JARVIS_P2P_{port}"],
                        capture_output=True, text=True, timeout=5
                    )
                    fw_rules[str(port)] = "exists" if check.returncode == 0 and "No rules match" not in check.stdout else "missing"
                except Exception:
                    fw_rules[str(port)] = "unknown"
        
        return {
            "success": True,
            "p2p_running": p2p is not None and p2p.running,
            "ws_port": ws_port,
            "http_port": http_port,
            "local_ips": local_ips,
            "port_status": port_status,
            "firewall_rules": fw_rules,
            "clients": len(p2p.clients) if p2p else 0,
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

            # ============== AUTO-UPDATE COMMANDS ==============
            if cmd == "check_update":
                if self._auto_updater:
                    update = self._auto_updater.check_now()
                    status = self._auto_updater.get_status()
                    return {
                        "success": True,
                        "current_version": AGENT_VERSION,
                        "update_available": update is not None,
                        "available_version": update["version"] if update else None,
                        "last_check": status["last_check"],
                        "last_update": status["last_update"],
                        "last_verification": status["last_verification"],
                        "firewall_configured": status["firewall_configured"],
                        "auto_restart": status["auto_restart"],
                    }
                return {"success": True, "current_version": AGENT_VERSION, "update_available": False}
            
            elif cmd == "apply_update":
                if self._auto_updater:
                    return self._auto_updater.apply_now()
                return {"success": False, "error": "Auto-updater not initialized"}
            
            elif cmd == "get_agent_version":
                return {
                    "success": True, "version": AGENT_VERSION,
                    "has_auto_updater": True,
                    "firewall_configured": is_firewall_configured(),
                }
            
            # ============== FACE/POSTURE TRAINING & RECOGNITION ==============
            elif cmd == "start_face_training":
                return self._start_face_training(payload)
            elif cmd == "capture_training_frame":
                return self._capture_training_frame(payload)
            elif cmd == "get_training_status":
                return self._get_training_status()
            elif cmd == "clear_training_data":
                return self._clear_training_data()
            elif cmd == "build_face_model":
                return self._build_face_model(payload)
            elif cmd == "recognize_face":
                return self._recognize_face_from_camera(payload)
            elif cmd == "get_recognition_status":
                return get_face_recognizer().get_status()
            elif cmd == "recognize_frame":
                return self._recognize_from_base64(payload)
            elif cmd == "save_surveillance_event":
                return self._save_surveillance_event_to_cloud(payload)

            elif cmd == "open_p2p_ports":
                return self._open_p2p_firewall_ports()

            elif cmd == "test_p2p_server":
                return self._test_p2p_server_status()

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
            
            # Notifications (KDE Connect style - phone → PC toast)
            elif cmd == "show_notification":
                return self._show_notification(
                    payload.get("title", ""),
                    payload.get("message", ""),
                    payload.get("app", ""),
                )
            elif cmd in ["start_notification_sync", "stop_notification_sync"]:
                return {"success": True, "message": f"Notification sync {cmd.replace('_', ' ')}"}
            
            # Clipboard
            elif cmd == "get_clipboard":
                return self._get_clipboard()
            elif cmd == "set_clipboard":
                return self._set_clipboard(payload.get("content", payload.get("text", "")))
            elif cmd == "clipboard_check":
                return self._check_clipboard_hash()
            
            # Media
            elif cmd == "media_control":
                return self._media_control(payload.get("action", "play_pause"), position=payload.get("position"))
            elif cmd in ["get_media_state", "get_media_info"]:
                return self._get_media_state(include_thumbnail=payload.get("include_thumbnail", False))
            elif cmd == "download_from_url":
                return self._download_from_url(payload.get("url", ""), payload.get("file_name", "file"), payload.get("save_folder", ""))
            elif cmd == "join_zoom":
                return await self._join_zoom(payload)
            elif cmd == "zoom_mic_toggle":
                return await self._zoom_toggle_mic()
            elif cmd == "zoom_camera_toggle":
                return await self._zoom_toggle_camera()
            elif cmd == "zoom_screenshot":
                return await self._zoom_screenshot()
            elif cmd == "zoom_status":
                return {
                    "success": True,
                    "zoom_running": self._is_zoom_running(),
                    "meeting_active": self._zoom_meeting_active,
                    "join_result": self._zoom_join_result,
                }
            elif cmd in ["mute_pc", "mute"]:
                _safe_pycaw_set_mute(True)
                return {"success": True}
            elif cmd in ["unmute_pc", "unmute"]:
                _safe_pycaw_set_mute(False)
                return {"success": True}
            
            elif cmd in ["list_audio_outputs", "get_audio_outputs"]:
                return self._list_audio_outputs()
            elif cmd == "set_session_volume":
                return self._set_session_volume(int(payload.get("pid", 0)), int(payload.get("level", 50)))
            elif cmd == "set_session_mute":
                return self._set_session_mute(int(payload.get("pid", 0)), bool(payload.get("mute", False)))
            elif cmd in ["get_audio_devices", "audio_mixer"]:
                return self._get_audio_devices()
            
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
                    # Open YouTube search results
                    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
                    webbrowser.open(url)
                    if auto_play:
                        # Wait for page to fully load (20s for slow connections)
                        await asyncio.sleep(20)
                        # Click on the first video thumbnail using JavaScript via keyboard
                        # Press Escape first to clear any focus
                        pyautogui.press("escape")
                        await asyncio.sleep(0.5)
                        # Use Tab to navigate to first video result
                        for _ in range(5):
                            pyautogui.press("tab")
                            await asyncio.sleep(0.15)
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
                        await asyncio.sleep(20)
                        # Use clipboard paste for reliable text input (supports all characters)
                        try:
                            import pyperclip
                            pyperclip.copy(query)
                            pyautogui.hotkey("ctrl", "v")
                        except ImportError:
                            pyautogui.typewrite(query, interval=0.02)
                        await asyncio.sleep(0.5)
                        pyautogui.press("enter")
                    return {"success": True, "message": f"Searching '{query}' on ChatGPT"}
                elif engine == "gemini":
                    webbrowser.open("https://gemini.google.com/app")
                    if auto_enter:
                        await asyncio.sleep(20)
                        try:
                            import pyperclip
                            pyperclip.copy(query)
                            pyautogui.hotkey("ctrl", "v")
                        except ImportError:
                            pyautogui.typewrite(query, interval=0.02)
                        await asyncio.sleep(0.5)
                        pyautogui.press("enter")
                    return {"success": True, "message": f"Searching '{query}' on Gemini"}
                elif engine == "perplexity":
                    # Perplexity supports direct URL query - auto submits
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
            elif cmd == "optimize_drives":
                return self._optimize_drives(payload.get("drive", "C:"), payload.get("flags", "/O"))
            
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
            
            # Surveillance clips
            elif cmd == "save_surveillance_clip":
                return self._save_surveillance_clip(payload)
            elif cmd == "delete_surveillance_clip":
                return self._delete_surveillance_clip(payload)
            
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
                }
            
            # Ghost mode / service mode
            elif cmd == "ghost_mode":
                return self._enable_ghost_mode(payload)
            elif cmd == "disable_ghost_mode":
                return self._disable_ghost_mode()
            elif cmd == "open_file":
                fpath = payload.get("path", "")
                if fpath:
                    try:
                        if platform.system() == "Windows":
                            os.startfile(fpath)
                        else:
                            subprocess.Popen(["xdg-open", fpath])
                        return {"success": True, "path": fpath}
                    except Exception as e:
                        return {"success": False, "error": str(e)}
                return {"success": False, "error": "No path provided"}
            
            elif cmd == "run_command":
                cmd_str = payload.get("command", "")
                if not cmd_str:
                    return {"success": False, "error": "No command provided"}
                try:
                    result = subprocess.run(cmd_str, shell=True, capture_output=True, text=True, timeout=30)
                    return {"success": True, "stdout": result.stdout[:2000], "stderr": result.stderr[:500], "returncode": result.returncode}
                except subprocess.TimeoutExpired:
                    return {"success": False, "error": "Command timed out (30s)"}
                except Exception as e:
                    return {"success": False, "error": str(e)}
            
            elif cmd == "open_file_manager":
                try:
                    if platform.system() == "Windows":
                        os.startfile(os.path.expanduser("~"))
                    else:
                        subprocess.Popen(["xdg-open", os.path.expanduser("~")])
                    return {"success": True}
                except Exception as e:
                    return {"success": False, "error": str(e)}
            
            else:
                return {"success": False, "error": f"Unknown command: {command_type}"}
        except Exception as e:
            add_log("error", f"Command handler error: {e}", details=traceback.format_exc(), category="command")
            return {"success": False, "error": str(e)}
    
    # ============== GHOST MODE (Background Service) ==============
    def _enable_ghost_mode(self, payload: Dict[str, Any] = {}) -> Dict[str, Any]:
        """Hide agent GUI window and convert to background service. Also install auto-start."""
        try:
            auto_start = payload.get("auto_start", True)
            
            if platform.system() == "Windows":
                # 1. HIDE the current GUI window (convert to shadow/background process)
                try:
                    # Hide console window
                    kernel32 = ctypes.windll.kernel32
                    hwnd = kernel32.GetConsoleWindow()
                    if hwnd:
                        ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
                    
                    # Hide all tkinter windows if GUI is running
                    try:
                        import tkinter as _tk
                        for widget in _tk._default_root.winfo_children() if _tk._default_root else []:
                            pass
                        if _tk._default_root:
                            _tk._default_root.withdraw()
                    except Exception:
                        pass
                    
                    # Hide any Python window by title
                    try:
                        enum_windows = ctypes.windll.user32.EnumWindows
                        enum_windows_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
                        get_pid = ctypes.windll.user32.GetWindowThreadProcessId
                        
                        current_pid = os.getpid()
                        
                        def hide_callback(hwnd, lParam):
                            pid = ctypes.c_ulong()
                            get_pid(hwnd, ctypes.byref(pid))
                            if pid.value == current_pid:
                                ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
                            return True
                        
                        enum_windows(enum_windows_proc(hide_callback), 0)
                    except Exception:
                        pass
                    
                    add_log("info", "Ghost mode: GUI window hidden", category="system")
                except Exception as hide_err:
                    add_log("warn", f"Ghost mode: could not hide window: {hide_err}", category="system")
                
                # 2. Install startup scheduled task (runs before login)
                if auto_start:
                    agent_path = os.path.abspath(__file__)
                    python_path = sys.executable
                    task_name = "JARVIS_Ghost_Agent"
                    
                    # Create XML for scheduled task that runs at boot
                    xml_content = f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>JARVIS PC Agent - Ghost Mode</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger><Enabled>true</Enabled></BootTrigger>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions>
    <Exec>
      <Command>"{python_path}"</Command>
      <Arguments>"{agent_path}" --headless</Arguments>
      <WorkingDirectory>{os.path.dirname(agent_path)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>"""
                    
                    xml_path = os.path.join(os.path.dirname(agent_path), "ghost_task.xml")
                    with open(xml_path, "w", encoding="utf-16") as f:
                        f.write(xml_content)
                    
                    # Delete existing task if any
                    subprocess.run(
                        ["schtasks", "/Delete", "/TN", task_name, "/F"],
                        capture_output=True, timeout=10
                    )
                    
                    # Create new task
                    result = subprocess.run(
                        ["schtasks", "/Create", "/TN", task_name, "/XML", xml_path],
                        capture_output=True, text=True, timeout=10
                    )
                    
                    try:
                        os.remove(xml_path)
                    except:
                        pass
                    
                    if result.returncode != 0:
                        add_log("warn", f"Ghost mode task creation failed: {result.stderr}", category="system")
                    else:
                        add_log("info", "Ghost mode: startup task installed", category="system")
                
                # 2. Also add to registry Run key as backup
                try:
                    import winreg
                    agent_path = os.path.abspath(__file__)
                    python_path = sys.executable
                    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                         r"Software\Microsoft\Windows\CurrentVersion\Run",
                                         0, winreg.KEY_SET_VALUE)
                    winreg.SetValueEx(key, "JARVIS_Ghost", 0, winreg.REG_SZ,
                                      f'"{python_path}" "{agent_path}" --headless')
                    winreg.CloseKey(key)
                    add_log("info", "Ghost mode: registry startup added", category="system")
                except Exception as reg_err:
                    add_log("warn", f"Registry startup failed: {reg_err}", category="system")
            
            add_log("info", "Ghost mode enabled — agent will run as background service", category="system")
            return {"success": True, "message": "Ghost mode enabled. Agent will auto-start on boot and run in background."}
        except Exception as e:
            add_log("error", f"Ghost mode failed: {e}", category="system")
            return {"success": False, "error": str(e)}
    
    def _disable_ghost_mode(self) -> Dict[str, Any]:
        """Restore GUI window and remove ghost mode startup entries."""
        try:
            if platform.system() == "Windows":
                # 1. Restore/show the console window
                try:
                    kernel32 = ctypes.windll.kernel32
                    hwnd = kernel32.GetConsoleWindow()
                    if hwnd:
                        ctypes.windll.user32.ShowWindow(hwnd, 5)  # SW_SHOW
                    
                    # Show all windows for this process
                    try:
                        current_pid = os.getpid()
                        enum_windows = ctypes.windll.user32.EnumWindows
                        enum_windows_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
                        get_pid = ctypes.windll.user32.GetWindowThreadProcessId
                        
                        def show_callback(hwnd, lParam):
                            pid = ctypes.c_ulong()
                            get_pid(hwnd, ctypes.byref(pid))
                            if pid.value == current_pid:
                                ctypes.windll.user32.ShowWindow(hwnd, 5)  # SW_SHOW
                            return True
                        
                        enum_windows(enum_windows_proc(show_callback), 0)
                    except Exception:
                        pass
                    
                    # Restore tkinter root if available
                    try:
                        import tkinter as _tk
                        if _tk._default_root:
                            _tk._default_root.deiconify()
                    except Exception:
                        pass
                    
                    add_log("info", "Ghost mode: GUI window restored", category="system")
                except Exception as show_err:
                    add_log("warn", f"Ghost mode: could not restore window: {show_err}", category="system")
                
                # 2. Remove scheduled task
                subprocess.run(
                    ["schtasks", "/Delete", "/TN", "JARVIS_Ghost_Agent", "/F"],
                    capture_output=True, timeout=10
                )
                # 3. Remove registry entry
                try:
                    import winreg
                    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                         r"Software\Microsoft\Windows\CurrentVersion\Run",
                                         0, winreg.KEY_SET_VALUE)
                    winreg.DeleteValue(key, "JARVIS_Ghost")
                    winreg.CloseKey(key)
                except Exception:
                    pass
            
            add_log("info", "Ghost mode disabled — window restored, startup entries removed", category="system")
            return {"success": True, "message": "Ghost mode disabled. GUI restored, agent will no longer auto-start."}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ============== FACE/POSTURE TRAINING ==============
    def _start_face_training(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Start a training session: capture face/posture frames from PC camera."""
        mode = payload.get("mode", "face")  # face, posture, both
        num_frames = int(payload.get("num_frames", 20))
        interval_ms = int(payload.get("interval_ms", 500))
        label = payload.get("label", "owner")
        
        if not HAS_OPENCV:
            return {"success": False, "error": "OpenCV not available on PC"}
        
        os.makedirs(TRAINING_DATA_DIR, exist_ok=True)
        session_dir = os.path.join(TRAINING_DATA_DIR, f"{label}_{mode}_{int(time.time())}")
        os.makedirs(session_dir, exist_ok=True)
        
        def _capture_loop():
            cap = cv2.VideoCapture(0)
            if not cap.isOpened():
                add_log("error", "Training: cannot open camera", category="training")
                return
            captured = 0
            try:
                for i in range(num_frames):
                    ret, frame = cap.read()
                    if not ret:
                        continue
                    fname = os.path.join(session_dir, f"{mode}_{i:03d}.jpg")
                    cv2.imwrite(fname, frame)
                    captured += 1
                    time.sleep(interval_ms / 1000.0)
            finally:
                cap.release()
            
            # Generate metadata
            meta = {
                "label": label, "mode": mode, "frames": captured,
                "timestamp": datetime.now().isoformat(),
                "session_dir": session_dir,
            }
            with open(os.path.join(session_dir, "meta.json"), "w") as f:
                json.dump(meta, f)
            add_log("info", f"Training: captured {captured} {mode} frames for '{label}'", category="training")
        
        t = threading.Thread(target=_capture_loop, daemon=True)
        t.start()
        
        return {
            "success": True,
            "message": f"Training started: capturing {num_frames} {mode} frames",
            "session_dir": session_dir,
            "estimated_seconds": round(num_frames * interval_ms / 1000),
        }
    
    def _capture_training_frame(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Capture a single training frame and return it as base64."""
        if not HAS_OPENCV:
            return {"success": False, "error": "OpenCV not available"}
        label = payload.get("label", "owner")
        mode = payload.get("mode", "face")
        
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            return {"success": False, "error": "Cannot open camera"}
        try:
            ret, frame = cap.read()
            if not ret:
                return {"success": False, "error": "Cannot read frame"}
            
            # Save to training dir
            os.makedirs(TRAINING_DATA_DIR, exist_ok=True)
            label_dir = os.path.join(TRAINING_DATA_DIR, label)
            os.makedirs(label_dir, exist_ok=True)
            fname = f"{mode}_{int(time.time())}.jpg"
            fpath = os.path.join(label_dir, fname)
            cv2.imwrite(fpath, frame)
            
            # Return thumbnail
            _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
            b64 = base64.b64encode(buf.tobytes()).decode()
            
            return {
                "success": True,
                "image": b64,
                "saved_to": fpath,
                "label": label,
                "mode": mode,
            }
        finally:
            cap.release()
    
    def _get_training_status(self) -> Dict[str, Any]:
        """Get training data summary."""
        if not os.path.exists(TRAINING_DATA_DIR):
            return {"success": True, "labels": {}, "total_frames": 0}
        
        labels = {}
        total = 0
        for item in os.listdir(TRAINING_DATA_DIR):
            item_path = os.path.join(TRAINING_DATA_DIR, item)
            if os.path.isdir(item_path):
                count = len([f for f in os.listdir(item_path) if f.endswith('.jpg')])
                labels[item] = count
                total += count
        
        return {"success": True, "labels": labels, "total_frames": total}
    
    def _clear_training_data(self) -> Dict[str, Any]:
        """Clear all training data and embeddings."""
        if os.path.exists(TRAINING_DATA_DIR):
            shutil.rmtree(TRAINING_DATA_DIR, ignore_errors=True)
        # Reset recognizer
        global _face_recognizer
        _face_recognizer = None
        return {"success": True, "message": "Training data and embeddings cleared"}
    
    def _build_face_model(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Process training images and build face recognition embeddings."""
        label = payload.get("label", "owner")
        recognizer = get_face_recognizer()
        result = recognizer.train_from_images(label)
        return result
    
    def _recognize_face_from_camera(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Capture multiple frames from camera for better accuracy and run face recognition."""
        if not HAS_OPENCV:
            return {"success": False, "error": "OpenCV not available"}
        camera_index = int(payload.get("camera_index", 0))
        num_captures = int(payload.get("num_captures", 3))  # Multiple frames for accuracy
        cap = cv2.VideoCapture(camera_index)
        if not cap.isOpened():
            return {"success": False, "error": "Cannot open camera"}
        try:
            recognizer = get_face_recognizer()
            best_result = None
            best_confidence = -1
            best_frame = None
            
            for i in range(num_captures):
                ret, frame = cap.read()
                if not ret:
                    continue
                result = recognizer.recognize(frame)
                conf = result.get("confidence", 0)
                if result.get("face_detected", False) and conf > best_confidence:
                    best_confidence = conf
                    best_result = result
                    best_frame = frame
                if i < num_captures - 1:
                    time.sleep(0.15)  # Small delay between captures
            
            if best_result is None:
                # Fall back to single frame
                ret, frame = cap.read()
                if not ret:
                    return {"success": False, "error": "Cannot capture frame"}
                best_result = recognizer.recognize(frame)
                best_frame = frame
            
            # Return a small thumbnail
            _, buf = cv2.imencode('.jpg', best_frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
            best_result["image"] = base64.b64encode(buf.tobytes()).decode()
            best_result["success"] = True
            best_result["captures_used"] = num_captures
            return best_result
        finally:
            cap.release()
    
    def _recognize_from_base64(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Recognize face from a base64-encoded image (sent from phone during surveillance)."""
        image_data = payload.get("image_data", "")
        if not image_data:
            return {"success": False, "error": "No image data"}
        if not HAS_OPENCV or not HAS_NUMPY:
            return {"success": False, "error": "OpenCV/NumPy not available"}
        try:
            # Strip data URL prefix
            if "," in image_data:
                image_data = image_data.split(",", 1)[1]
            img_bytes = base64.b64decode(image_data)
            nparr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                return {"success": False, "error": "Cannot decode image"}
            recognizer = get_face_recognizer()
            result = recognizer.recognize(frame)
            result["success"] = True
            return result
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ============== REGISTRATION & HEARTBEAT ==============
    def register_device(self) -> bool:
        try:
            local_ips = get_local_ips()
            p2p_server = get_local_p2p_server()
            system_info = {
                "platform": platform.system(),
                "hostname": socket.gethostname(),
                "agent_version": AGENT_VERSION,
                "local_ips": local_ips,
                "p2p_port": p2p_server._actual_port if p2p_server else LOCAL_P2P_PORT,
                "cpu_percent": psutil.cpu_percent(),
                "memory_percent": psutil.virtual_memory().percent,
            }
            
            result = self.supabase.table("devices").select("id, user_id").eq("device_key", self.device_key).execute()
            # Emulate maybeSingle: pick first row or None
            result.data = result.data[0] if result.data and len(result.data) > 0 else None
            
            if result.data:
                self.device_id = result.data["id"]
                self.current_user_id = result.data.get("user_id")
                self.supabase.table("devices").update({
                    "name": DEVICE_NAME,
                    "is_online": True,
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "system_info": system_info,
                    "current_volume": self._get_volume(),
                    "current_brightness": self._get_brightness(),
                }).eq("id", self.device_id).execute()
            else:
                pairing_code = str(uuid.uuid4())[:6].upper()
                expires = (datetime.now(timezone.utc) + timedelta(minutes=PAIRING_CODE_LIFETIME_MINUTES)).isoformat()
                insert_result = self.supabase.table("devices").insert({
                    "device_key": self.device_key,
                    "name": DEVICE_NAME,
                    "is_online": True,
                    "pairing_code": pairing_code,
                    "pairing_expires_at": expires,
                    "system_info": system_info,
                    "user_id": "00000000-0000-0000-0000-000000000000",
                }).execute()
                if insert_result.data:
                    self.device_id = insert_result.data[0]["id"]
                    self.pairing_code = pairing_code
            
            update_agent_status({
                "connected": True,
                "device_id": self.device_id,
                "volume": self._get_volume(),
                "brightness": self._get_brightness(),
                "local_ips": local_ips,
            })
            
            add_log("info", f"Device registered: {self.device_id[:8]}...", category="system")
            return True
        except Exception as e:
            add_log("error", f"Registration failed: {e}", category="system")
            return False
    
    def heartbeat(self):
        try:
            p2p_server = get_local_p2p_server()
            local_ips = get_local_ips()
            system_info = {
                "platform": platform.system(),
                "hostname": socket.gethostname(),
                "agent_version": AGENT_VERSION,
                "local_ips": local_ips,
                "p2p_port": p2p_server._actual_port if p2p_server else LOCAL_P2P_PORT,
                "cpu_percent": psutil.cpu_percent(),
                "memory_percent": psutil.virtual_memory().percent,
            }
            
            self.supabase.table("devices").update({
                "is_online": True,
                "last_seen": datetime.now(timezone.utc).isoformat(),
                "system_info": system_info,
                "current_volume": self._get_volume(),
                "current_brightness": self._get_brightness(),
                "is_locked": self._detect_lock_state(),
            }).eq("id", self.device_id).execute()
            
            update_agent_status({
                "last_heartbeat": datetime.now().isoformat(),
                "cpu_percent": system_info["cpu_percent"],
                "memory_percent": system_info["memory_percent"],
                "local_ips": local_ips,
            })
        except Exception as e:
            add_log("warn", f"Heartbeat failed: {e}", category="system")
    
    def poll_commands(self):
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
            result = self.supabase.table("commands").select("*").eq(
                "device_id", self.device_id
            ).eq("status", "pending").gt("created_at", cutoff).order("created_at").execute()
            
            if not result.data:
                return
            
            for cmd_row in result.data:
                cmd_type = cmd_row.get("command_type", "")
                payload = cmd_row.get("payload", {}) or {}
                cmd_id = cmd_row["id"]
                
                add_log("info", f"Command executed: {cmd_type}", category="command")
                
                try:
                    self.supabase.table("commands").update({
                        "status": "processing",
                        "executed_at": datetime.now(timezone.utc).isoformat()
                    }).eq("id", cmd_id).execute()
                    
                    loop = asyncio.new_event_loop()
                    result_data = loop.run_until_complete(self._handle_command(cmd_type, payload))
                    loop.close()
                    
                    self.supabase.table("commands").update({
                        "status": "completed",
                        "result": result_data,
                    }).eq("id", cmd_id).execute()
                    
                    self.consecutive_failures = 0
                    self.backoff_seconds = 1
                except Exception as e:
                    add_log("error", f"Command '{cmd_type}' failed: {e}", category="command")
                    self.supabase.table("commands").update({
                        "status": "failed",
                        "result": {"success": False, "error": str(e)},
                    }).eq("id", cmd_id).execute()
        except Exception as e:
            self.consecutive_failures += 1
            if "rate limit" not in str(e).lower():
                add_log("warn", f"Poll error: {e}", category="system")
    
    def run(self):
        add_log("info", f"JARVIS Agent v{AGENT_VERSION} starting...", category="system")
        
        # Start P2P server
        p2p_server = start_local_p2p_server(
            command_handler=self._handle_command,
            port=LOCAL_P2P_PORT
        )
        
        # Wait for P2P server to be ready
        time.sleep(1)
        
        if not self.register_device():
            add_log("error", "Initial registration failed. Retrying...", category="system")
            time.sleep(5)
            if not self.register_device():
                add_log("error", "Registration failed after retry.", category="system")
                return
        
        add_log("info", "Agent ready and polling for commands", category="system")
        
        # One-time firewall setup (never asks admin again after first success)
        if HAS_AUTO_UPDATER:
            try:
                ensure_firewall_configured(
                    p2p_port=LOCAL_P2P_PORT,
                    log_fn=lambda level, msg: add_log(level, f"[Firewall] {msg}", category="p2p")
                )
            except Exception as e:
                add_log("warn", f"Firewall setup check failed: {e}", category="p2p")
        
        # Start inline auto-updater with auto-restart
        self._auto_updater = None
        try:
            self._auto_updater = InlineAutoUpdater(
                supabase_url=SUPABASE_URL,
                supabase_key=SUPABASE_KEY,
                device_key=self.device_key,
                log_fn=lambda level, msg: add_log(level, f"[AutoUpdate] {msg}", category="system"),
                on_update=lambda v: add_log("info", f"Agent auto-updated to v{v}! Auto-restarting...", category="system"),
                auto_restart=True,
            )
            self._auto_updater.start()
            save_current_version(AGENT_VERSION)
        except Exception as e:
            add_log("warn", f"Auto-updater init failed: {e}", category="system")
        
        # Start BLE server as fallback transport
        try:
            ble = start_ble_server(command_handler=self._handle_command)
            if ble:
                add_log("info", "BLE fallback transport started", category="bluetooth")
        except Exception as e:
            add_log("warn", f"BLE server init failed (optional): {e}", category="bluetooth")
        
        # Pre-load face recognizer if training data exists
        try:
            if os.path.exists(FACE_EMBEDDINGS_FILE):
                recognizer = get_face_recognizer()
                add_log("info", f"Face recognizer loaded: {recognizer.get_status()}", category="recognition")
        except Exception as e:
            add_log("warn", f"Face recognizer pre-load failed: {e}", category="recognition")
        
        last_heartbeat = 0
        
        while self.running:
            try:
                now = time.time()
                
                # Heartbeat
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    try:
                        self.heartbeat()
                    except Exception as hb_err:
                        add_log("warn", f"Heartbeat error (non-fatal): {hb_err}", category="system")
                    last_heartbeat = now
                
                # Poll commands
                try:
                    self.poll_commands()
                except Exception as poll_err:
                    add_log("warn", f"Poll error (non-fatal): {poll_err}", category="system")
                
                # Sleep
                time.sleep(POLL_INTERVAL)
                
            except KeyboardInterrupt:
                add_log("info", "Agent stopped by user", category="system")
                break
            except Exception as e:
                add_log("error", f"Main loop error: {e}", details=traceback.format_exc(), category="system")
                time.sleep(5)
        
        # Cleanup
        self._stop_camera_stream()
        self._stop_screen_stream()
        self._stop_audio_relay()
        stop_local_p2p_server()
        stop_ble_server()
        
        try:
            self.supabase.table("devices").update({"is_online": False}).eq("id", self.device_id).execute()
        except Exception:
            pass
        
        add_log("info", "Agent stopped.", category="system")

# ============== SUPPRESS COM CLEANUP ERRORS ==============
import atexit
import warnings

def _suppress_com_errors():
    """Suppress COM VTable errors during Python shutdown."""
    try:
        warnings.filterwarnings("ignore", "COM method call without VTable")
    except Exception:
        pass

atexit.register(_suppress_com_errors)

# Completely suppress COM __del__ — prevents the 0xFFFFFFFF memory crash
if HAS_PYCAW:
    try:
        import comtypes._post_coinit.unknwn as _unknwn
        # Replace __del__ with a no-op to prevent VTable crashes during GC
        _unknwn._compointer_base.__del__ = lambda self: None
    except Exception:
        pass


# ============== DRAG-TO-AGENT FILE HANDLER ==============
def handle_dragged_files(file_paths: list):
    """Handle files dragged onto the .py/.exe — queue them for transfer."""
    save_folder = os.path.join(os.path.expanduser("~"), "Downloads", "Jarvis", "Received")
    os.makedirs(save_folder, exist_ok=True)
    
    for src_path in file_paths:
        if not os.path.exists(src_path):
            print(f"[Drag] File not found: {src_path}")
            continue
        
        file_name = os.path.basename(src_path)
        dest_path = os.path.join(save_folder, file_name)
        
        try:
            import shutil
            file_size = os.path.getsize(src_path)
            print(f"[Drag] Transferring: {file_name} ({file_size:,} bytes)")
            
            start_time = time.time()
            shutil.copy2(src_path, dest_path)
            elapsed = time.time() - start_time
            speed = file_size / elapsed if elapsed > 0 else 0
            
            speed_str = f"{speed / 1024:.1f} KB/s" if speed < 1024 * 1024 else f"{speed / (1024*1024):.1f} MB/s"
            print(f"[Drag] ✓ {file_name} -> {dest_path} ({speed_str})")
            add_log("info", f"Drag-received: {file_name} ({speed_str})", category="file")
            
            if HAS_TOAST:
                notification_manager.notify("File Received", f"{file_name} ({speed_str})")
        except Exception as e:
            print(f"[Drag] ✗ Failed to copy {file_name}: {e}")
            add_log("error", f"Drag-receive failed: {file_name}: {e}", category="file")

# ============== MAIN ENTRY ==============
def main():
    parser = argparse.ArgumentParser(description="JARVIS PC Agent")
    parser.add_argument("--gui", action="store_true", help="Launch with GUI (default)")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode (no GUI)")
    parser.add_argument("--no-gui", action="store_true", help="Alias for --headless")
    parser.add_argument("files", nargs="*", help="Files dragged onto the agent")
    args = parser.parse_args()
    
    # Handle dragged files first
    if args.files:
        handle_dragged_files(args.files)
    
    agent = JarvisAgent()
    
    # Determine if GUI should launch
    headless = args.headless or args.no_gui
    use_gui = not headless  # GUI is default now
    
    if use_gui and HAS_TKINTER:
        # Launch GUI with agent in background thread
        try:
            from jarvis_gui import JarvisGUI
            
            # Run agent in background
            agent_thread = threading.Thread(target=_run_agent_loop, args=(agent,), daemon=True)
            agent_thread.start()
            
            # Launch GUI on main thread
            gui = JarvisGUI(agent=agent)
            gui.run()
        except ImportError:
            add_log("warn", "jarvis_gui.py not found, falling back to headless mode", category="system")
            _run_agent_loop(agent)
        except Exception as e:
            add_log("error", f"GUI failed: {e}, falling back to headless", category="system")
            _run_agent_loop(agent)
    else:
        # Headless mode
        _run_agent_loop(agent)


def _run_agent_loop(agent):
    """Auto-restart agent loop with exception recovery."""
    while True:
        try:
            agent.run()
            break
        except KeyboardInterrupt:
            break
        except Exception as e:
            add_log("error", f"Fatal error, restarting in 10s: {e}", details=traceback.format_exc(), category="system")
            time.sleep(10)
            agent = JarvisAgent()


if __name__ == "__main__":
    main()
