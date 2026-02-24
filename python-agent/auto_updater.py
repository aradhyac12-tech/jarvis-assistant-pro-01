"""
JARVIS Agent Auto-Updater
=========================
Checks the cloud for new agent versions and applies updates automatically.
Runs as a background thread alongside the agent.
"""

import os
import sys
import json
import time
import base64
import hashlib
import shutil
import threading
import traceback
from typing import Optional, Dict, Any
from datetime import datetime

# Agent directory (where this file lives)
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
VERSION_FILE = os.path.join(AGENT_DIR, ".update_version")
UPDATE_CHECK_INTERVAL = 300  # Check every 5 minutes
BACKUP_DIR = os.path.join(AGENT_DIR, ".backups")

# Files that should be updated (relative to python-agent/)
UPDATABLE_FILES = [
    "jarvis_agent.py",
    "jarvis_gui.py",
    "jarvis_service_installer.py",
    "requirements.txt",
    "skills/__init__.py",
    "skills/base.py",
    "skills/registry.py",
    "skills/app_launcher_skill.py",
    "skills/automation_skill.py",
    "skills/brightness_volume_skill.py",
    "skills/calendar_skill.py",
    "skills/file_search_skill.py",
    "skills/memory_skill.py",
    "skills/spotify_skill.py",
    "skills/system_control_skill.py",
    "skills/web_fetch_skill.py",
    "auto_updater.py",
]


def get_current_version() -> str:
    """Read current installed version from version file."""
    if os.path.exists(VERSION_FILE):
        try:
            with open(VERSION_FILE, "r") as f:
                data = json.load(f)
                return data.get("version", "0.0.0")
        except Exception:
            pass
    # Fall back to reading from jarvis_agent.py
    try:
        agent_file = os.path.join(AGENT_DIR, "jarvis_agent.py")
        with open(agent_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("AGENT_VERSION"):
                    return line.split('"')[1]
    except Exception:
        pass
    return "0.0.0"


def save_current_version(version: str, updated_at: str = None):
    """Save installed version."""
    data = {
        "version": version,
        "updated_at": updated_at or datetime.now().isoformat(),
    }
    try:
        with open(VERSION_FILE, "w") as f:
            json.dump(data, f)
    except Exception:
        pass


def check_for_update(supabase_url: str, supabase_key: str, device_key: str) -> Optional[Dict[str, Any]]:
    """Check cloud for new agent version."""
    import urllib.request
    import urllib.error
    
    url = f"{supabase_url}/functions/v1/agent-update?device_key={device_key}"
    
    req = urllib.request.Request(url, method="GET")
    req.add_header("apikey", supabase_key)
    req.add_header("Content-Type", "application/json")
    
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            
            if not data.get("version"):
                return None
            
            current = get_current_version()
            remote = data["version"]
            
            if _version_gt(remote, current):
                return data
            
            return None
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        print(f"[Updater] HTTP {e.code}: {body}")
        return None
    except Exception as e:
        print(f"[Updater] Check failed: {e}")
        return None


def download_file(supabase_url: str, supabase_key: str, device_key: str, version: str, file_path: str) -> Optional[bytes]:
    """Download a specific file from the update."""
    import urllib.request
    
    url = f"{supabase_url}/functions/v1/agent-update"
    
    body = json.dumps({
        "device_key": device_key,
        "version": version,
        "file_path": file_path,
    }).encode()
    
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


def apply_update(supabase_url: str, supabase_key: str, device_key: str, update_info: Dict[str, Any], log_fn=None) -> bool:
    """Download and apply all files in the update."""
    version = update_info["version"]
    manifest = update_info.get("file_manifest", [])
    
    if not manifest:
        if log_fn:
            log_fn("warn", f"Update v{version} has empty manifest, skipping")
        return False
    
    if log_fn:
        log_fn("info", f"Applying update v{version} ({len(manifest)} files)...")
    
    # Create backup
    backup_dir = os.path.join(BACKUP_DIR, f"v{get_current_version()}_{int(time.time())}")
    os.makedirs(backup_dir, exist_ok=True)
    
    downloaded_files = {}
    
    # Download all files first
    for entry in manifest:
        file_path = entry["path"]
        if log_fn:
            log_fn("info", f"Downloading: {file_path}")
        
        content = download_file(supabase_url, supabase_key, device_key, version, file_path)
        if content is None:
            if log_fn:
                log_fn("error", f"Failed to download {file_path}, aborting update")
            return False
        
        downloaded_files[file_path] = content
    
    # Backup existing files
    for file_path in downloaded_files:
        full_path = os.path.join(AGENT_DIR, file_path)
        if os.path.exists(full_path):
            backup_path = os.path.join(backup_dir, file_path)
            os.makedirs(os.path.dirname(backup_path), exist_ok=True)
            try:
                shutil.copy2(full_path, backup_path)
            except Exception as e:
                if log_fn:
                    log_fn("warn", f"Backup failed for {file_path}: {e}")
    
    # Apply files
    applied = 0
    for file_path, content in downloaded_files.items():
        full_path = os.path.join(AGENT_DIR, file_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        try:
            with open(full_path, "wb") as f:
                f.write(content)
            applied += 1
            if log_fn:
                log_fn("info", f"Updated: {file_path}")
        except Exception as e:
            if log_fn:
                log_fn("error", f"Failed to write {file_path}: {e}")
    
    # Save version
    save_current_version(version)
    
    if log_fn:
        log_fn("info", f"Update v{version} applied ({applied}/{len(manifest)} files). Restart to activate.")
    
    return True


def _version_gt(a: str, b: str) -> bool:
    """Compare semver strings: is a > b?"""
    try:
        a_parts = [int(x) for x in a.split(".")]
        b_parts = [int(x) for x in b.split(".")]
        # Pad shorter list
        while len(a_parts) < 3:
            a_parts.append(0)
        while len(b_parts) < 3:
            b_parts.append(0)
        return tuple(a_parts) > tuple(b_parts)
    except (ValueError, AttributeError):
        return a != b


class AutoUpdater:
    """Background auto-updater thread."""
    
    def __init__(self, supabase_url: str, supabase_key: str, device_key: str, log_fn=None, on_update=None):
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.device_key = device_key
        self.log_fn = log_fn or (lambda *a: None)
        self.on_update = on_update  # callback when update applied
        self.running = False
        self._thread = None
        self.last_check = None
        self.last_update = None
        self.available_version = None
    
    def start(self):
        """Start the auto-updater background thread."""
        if self._thread and self._thread.is_alive():
            return
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="auto-updater")
        self._thread.start()
        self.log_fn("info", "Auto-updater started (checking every 5 min)")
    
    def stop(self):
        self.running = False
    
    def check_now(self) -> Optional[Dict]:
        """Manual check for updates. Returns update info if available."""
        return check_for_update(self.supabase_url, self.supabase_key, self.device_key)
    
    def apply_now(self) -> bool:
        """Manually trigger update application."""
        update = self.check_now()
        if update:
            return apply_update(self.supabase_url, self.supabase_key, self.device_key, update, self.log_fn)
        return False
    
    def _loop(self):
        # Initial check after 30 seconds
        time.sleep(30)
        
        while self.running:
            try:
                self.last_check = datetime.now().isoformat()
                update = check_for_update(self.supabase_url, self.supabase_key, self.device_key)
                
                if update:
                    self.available_version = update["version"]
                    self.log_fn("info", f"New agent update available: v{update['version']}")
                    
                    success = apply_update(
                        self.supabase_url, self.supabase_key, self.device_key, 
                        update, self.log_fn
                    )
                    
                    if success:
                        self.last_update = datetime.now().isoformat()
                        if self.on_update:
                            self.on_update(update["version"])
                
            except Exception as e:
                self.log_fn("warn", f"Auto-updater error: {e}")
            
            # Wait for next check
            for _ in range(UPDATE_CHECK_INTERVAL):
                if not self.running:
                    break
                time.sleep(1)
