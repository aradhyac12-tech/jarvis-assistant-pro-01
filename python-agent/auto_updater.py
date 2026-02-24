"""
JARVIS Agent Auto-Updater
=========================
Checks the cloud for new agent versions and applies updates automatically.
Runs as a background thread alongside the agent.
Features:
- One-time firewall setup (persisted, no repeated admin prompts)
- Auto-restart after update
- Update verification
"""

import os
import sys
import json
import time
import base64
import hashlib
import shutil
import threading
import subprocess
import platform
import traceback
from typing import Optional, Dict, Any
from datetime import datetime

# Agent directory (where this file lives)
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
VERSION_FILE = os.path.join(AGENT_DIR, ".update_version")
FIREWALL_DONE_FILE = os.path.join(AGENT_DIR, ".firewall_configured")
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


# ============== ONE-TIME FIREWALL SETUP ==============
def ensure_firewall_configured(p2p_port: int = 9876, log_fn=None):
    """Configure firewall rules ONCE. Skips if already done. Returns True if rules are set."""
    if os.path.exists(FIREWALL_DONE_FILE):
        return True  # Already configured, skip
    
    if platform.system() != "Windows":
        _mark_firewall_done("non-windows")
        return True
    
    log_fn = log_fn or (lambda *a: None)
    log_fn("info", "First-run: configuring firewall rules (one-time only)...")
    
    success_count = 0
    for port in [p2p_port, p2p_port + 1]:
        rule_name = f"JARVIS_P2P_{port}"
        try:
            # Check if rule already exists
            check = subprocess.run(
                ["netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name}"],
                capture_output=True, text=True, timeout=5
            )
            if check.returncode == 0 and rule_name in check.stdout:
                success_count += 1
                log_fn("info", f"Firewall rule for port {port} already exists")
                continue
            
            # Try adding rule (may need admin, but only once)
            result = subprocess.run([
                "netsh", "advfirewall", "firewall", "add", "rule",
                f"name={rule_name}", "dir=in", "action=allow",
                "protocol=TCP", f"localport={port}", "profile=private,domain,public",
            ], capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0:
                success_count += 1
                log_fn("info", f"Firewall rule added for port {port}")
            else:
                # Try elevated via PowerShell (UAC prompt - only happens once)
                log_fn("info", f"Trying elevated firewall setup for port {port}...")
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
                    log_fn("info", f"Firewall rule added (elevated) for port {port}")
                else:
                    log_fn("warn", f"Firewall setup failed for port {port}: {elev.stderr}")
        except Exception as e:
            log_fn("warn", f"Firewall setup error for port {port}: {e}")
    
    if success_count >= 2:
        _mark_firewall_done("success")
        log_fn("info", "Firewall configured successfully. Won't ask again.")
        return True
    elif success_count >= 1:
        _mark_firewall_done("partial")
        log_fn("warn", "Partial firewall setup. Some ports may not be accessible.")
        return True
    
    log_fn("error", "Firewall setup failed. Run agent as Administrator once to fix.")
    return False


def _mark_firewall_done(status: str):
    """Mark firewall as configured so we never ask again."""
    try:
        with open(FIREWALL_DONE_FILE, "w") as f:
            json.dump({"status": status, "configured_at": datetime.now().isoformat()}, f)
    except Exception:
        pass


def is_firewall_configured() -> bool:
    """Check if firewall has been configured."""
    return os.path.exists(FIREWALL_DONE_FILE)


# ============== VERSION MANAGEMENT ==============
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


# ============== UPDATE VERIFICATION ==============
def verify_update(version: str, manifest: list, log_fn=None) -> Dict[str, Any]:
    """Verify that an update was applied correctly by checking file hashes and sizes."""
    log_fn = log_fn or (lambda *a: None)
    results = {"version": version, "verified": True, "files": [], "errors": []}
    
    for entry in manifest:
        file_path = entry.get("path", "")
        expected_hash = entry.get("hash", "")
        expected_size = entry.get("size", 0)
        full_path = os.path.join(AGENT_DIR, file_path)
        
        file_result = {"path": file_path, "ok": False, "reason": ""}
        
        if not os.path.exists(full_path):
            file_result["reason"] = "file missing"
            results["verified"] = False
            results["errors"].append(f"{file_path}: missing")
        else:
            try:
                with open(full_path, "rb") as f:
                    content = f.read()
                actual_size = len(content)
                actual_hash = hashlib.sha256(content).hexdigest()[:16]
                
                if expected_size and abs(actual_size - expected_size) > 10:
                    file_result["reason"] = f"size mismatch (expected {expected_size}, got {actual_size})"
                    results["verified"] = False
                    results["errors"].append(f"{file_path}: size mismatch")
                elif expected_hash and actual_hash != expected_hash:
                    file_result["reason"] = f"hash mismatch"
                    results["verified"] = False
                    results["errors"].append(f"{file_path}: hash mismatch")
                else:
                    file_result["ok"] = True
            except Exception as e:
                file_result["reason"] = str(e)
                results["verified"] = False
                results["errors"].append(f"{file_path}: {e}")
        
        results["files"].append(file_result)
    
    log_fn("info" if results["verified"] else "error",
           f"Update v{version} verification: {'PASSED' if results['verified'] else 'FAILED'} "
           f"({sum(1 for f in results['files'] if f['ok'])}/{len(results['files'])} files)")
    
    return results


# ============== AUTO-RESTART ==============
def restart_agent(log_fn=None):
    """Restart the agent process after an update."""
    log_fn = log_fn or (lambda *a: None)
    log_fn("info", "Restarting agent to apply update...")
    
    try:
        # Get the current script and Python executable
        python_exe = sys.executable
        script = os.path.join(AGENT_DIR, "jarvis_agent.py")
        
        # Preserve original command line args
        args = sys.argv[1:] if len(sys.argv) > 1 else []
        
        if platform.system() == "Windows":
            # Use subprocess to start new process, then exit current
            cmd = [python_exe, script] + args
            log_fn("info", f"Spawning new agent process: {' '.join(cmd)}")
            
            # Start new process detached
            CREATE_NEW_PROCESS_GROUP = 0x00000200
            DETACHED_PROCESS = 0x00000008
            subprocess.Popen(
                cmd,
                creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
                close_fds=True,
                cwd=AGENT_DIR,
            )
            
            # Give the new process a moment to start
            time.sleep(2)
            log_fn("info", "New agent process started. Shutting down old process...")
            os._exit(0)
        else:
            # Unix: exec replaces the current process
            log_fn("info", "Exec-ing new agent process...")
            os.execv(python_exe, [python_exe, script] + args)
    except Exception as e:
        log_fn("error", f"Auto-restart failed: {e}. Please restart manually.")


# ============== CLOUD COMMUNICATION ==============
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


def apply_update(supabase_url: str, supabase_key: str, device_key: str, update_info: Dict[str, Any], log_fn=None, auto_restart=True) -> Dict[str, Any]:
    """Download and apply all files in the update. Returns detailed result."""
    version = update_info["version"]
    manifest = update_info.get("file_manifest", [])
    
    if not manifest:
        if log_fn:
            log_fn("warn", f"Update v{version} has empty manifest, skipping")
        return {"success": False, "reason": "empty_manifest"}
    
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
            return {"success": False, "reason": f"download_failed:{file_path}"}
        
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
    
    # Verify update
    verification = verify_update(version, manifest, log_fn)
    
    if log_fn:
        log_fn("info", f"Update v{version} applied ({applied}/{len(manifest)} files). "
               f"Verification: {'PASSED' if verification['verified'] else 'FAILED'}")
    
    result = {
        "success": True,
        "version": version,
        "files_applied": applied,
        "files_total": len(manifest),
        "verification": verification,
        "auto_restart": auto_restart and verification["verified"],
    }
    
    # Auto-restart if verified
    if auto_restart and verification["verified"]:
        if log_fn:
            log_fn("info", "Update verified. Auto-restarting in 3 seconds...")
        # Schedule restart in a separate thread so we can return the result first
        threading.Timer(3.0, restart_agent, args=[log_fn]).start()
    
    return result


def _version_gt(a: str, b: str) -> bool:
    """Compare semver strings: is a > b?"""
    try:
        a_parts = [int(x) for x in a.split(".")]
        b_parts = [int(x) for x in b.split(".")]
        while len(a_parts) < 3:
            a_parts.append(0)
        while len(b_parts) < 3:
            b_parts.append(0)
        return tuple(a_parts) > tuple(b_parts)
    except (ValueError, AttributeError):
        return a != b


class AutoUpdater:
    """Background auto-updater thread."""
    
    def __init__(self, supabase_url: str, supabase_key: str, device_key: str, log_fn=None, on_update=None, auto_restart=True):
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
        """Start the auto-updater background thread."""
        if self._thread and self._thread.is_alive():
            return
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="auto-updater")
        self._thread.start()
        self.log_fn("info", "Auto-updater started (checking every 5 min, auto-restart enabled)")
    
    def stop(self):
        self.running = False
    
    def check_now(self) -> Optional[Dict]:
        """Manual check for updates. Returns update info if available."""
        return check_for_update(self.supabase_url, self.supabase_key, self.device_key)
    
    def apply_now(self) -> Dict[str, Any]:
        """Manually trigger update application. Returns detailed result."""
        update = self.check_now()
        if update:
            result = apply_update(self.supabase_url, self.supabase_key, self.device_key, update, self.log_fn, self.auto_restart)
            self.last_verification = result.get("verification")
            return result
        return {"success": False, "reason": "no_update_available"}
    
    def get_status(self) -> Dict[str, Any]:
        """Get current updater status for diagnostics."""
        return {
            "running": self.running,
            "last_check": self.last_check,
            "last_update": self.last_update,
            "last_verification": self.last_verification,
            "available_version": self.available_version,
            "current_version": get_current_version(),
            "firewall_configured": is_firewall_configured(),
            "auto_restart": self.auto_restart,
        }
    
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
                    
                    result = apply_update(
                        self.supabase_url, self.supabase_key, self.device_key, 
                        update, self.log_fn, self.auto_restart
                    )
                    
                    if result.get("success"):
                        self.last_update = datetime.now().isoformat()
                        self.last_verification = result.get("verification")
                        if self.on_update:
                            self.on_update(update["version"])
                        # If auto_restart is enabled and verified, the restart_agent
                        # function was already scheduled by apply_update
                
            except Exception as e:
                self.log_fn("warn", f"Auto-updater error: {e}")
            
            # Wait for next check
            for _ in range(UPDATE_CHECK_INTERVAL):
                if not self.running:
                    break
                time.sleep(1)
