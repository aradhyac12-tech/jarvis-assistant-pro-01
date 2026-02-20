"""
JARVIS Skills - All-in-one consolidated module
===============================================
Contains: Base Skill, SkillRegistry, and all built-in skills.
Import with: from skills import get_skill_registry
"""

import os
import sys
import json
import time
import asyncio
import subprocess
import fnmatch
import urllib.parse
import urllib.request
import urllib.error
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

# Optional imports
try:
    import pyautogui
    HAS_PYAUTOGUI = True
except ImportError:
    HAS_PYAUTOGUI = False

try:
    import keyboard
    HAS_KEYBOARD = True
except ImportError:
    HAS_KEYBOARD = False


# ======================= BASE SKILL =======================

class Skill(ABC):
    """Abstract base class for JARVIS skills."""
    name: str = ""
    description: str = ""
    aliases: List[str] = []

    @abstractmethod
    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        ...

    def can_handle(self, command: str) -> bool:
        cmd = command.lower().strip()
        return cmd == self.name.lower() or cmd in (a.lower() for a in self.aliases)


# ======================= SKILL REGISTRY =======================

class SkillRegistry:
    def __init__(self):
        self._skills: Dict[str, Skill] = {}

    def register(self, skill: Skill) -> None:
        self._skills[skill.name.lower()] = skill

    def get(self, name: str) -> Optional[Skill]:
        return self._skills.get(name.lower())

    def can_dispatch(self, command: str) -> bool:
        return any(s.can_handle(command) for s in self._skills.values())

    def find_skill(self, command: str) -> Optional[Skill]:
        for skill in self._skills.values():
            if skill.can_handle(command):
                return skill
        return None

    async def dispatch(self, command: str, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        skill = self.find_skill(command)
        if not skill:
            return {"success": False, "error": f"No skill for command: {command}"}
        return await skill.execute(payload, context)

    def list_skills(self) -> List[Dict[str, Any]]:
        return [
            {"name": s.name, "description": s.description, "aliases": s.aliases}
            for s in self._skills.values()
        ]


# ======================= MEMORY SKILL =======================

class MemorySkill(Skill):
    name = "memory"
    description = "Store and retrieve persistent memories."
    aliases = ["remember", "recall", "forget"]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        supabase = context.get("supabase")
        user_id = context.get("user_id")
        device_id = context.get("device_id")
        action = str(payload.get("action", "get")).lower()
        key = str(payload.get("key", "")).strip()
        value = payload.get("value")
        category = str(payload.get("category", "general")).strip() or "general"

        if not user_id or not supabase:
            return {"success": False, "error": "User not authenticated."}

        if action in ("set", "remember"):
            if not key:
                return {"success": False, "error": "Missing key."}
            result = supabase.table("assistant_memories").upsert({
                "user_id": user_id, "device_id": device_id, "key": key,
                "value": value if isinstance(value, dict) else {"v": value},
                "category": category,
            }, on_conflict="user_id,key").execute()
            if hasattr(result, "error") and result.error:
                return {"success": False, "error": str(result.error)}
            return {"success": True, "key": key}

        elif action in ("get", "recall"):
            if not key:
                return {"success": False, "error": "Missing key."}
            result = supabase.table("assistant_memories").select("value").eq("user_id", user_id).eq("key", key).limit(1).execute()
            if result.data:
                raw = result.data[0].get("value") or {}
                return {"success": True, "key": key, "value": raw.get("v") if "v" in raw else raw}
            return {"success": False, "error": "Memory not found."}

        elif action in ("delete", "forget"):
            if not key:
                return {"success": False, "error": "Missing key."}
            supabase.table("assistant_memories").delete().eq("user_id", user_id).eq("key", key).execute()
            return {"success": True, "key": key}

        elif action == "list":
            result = supabase.table("assistant_memories").select("key,value,category").eq("user_id", user_id).order("updated_at", desc=True).limit(50).execute()
            memories = []
            for row in result.data or []:
                raw = row.get("value") or {}
                memories.append({"key": row.get("key"), "value": raw.get("v") if "v" in raw else raw, "category": row.get("category")})
            return {"success": True, "memories": memories}

        return {"success": False, "error": f"Unknown memory action: {action}"}


# ======================= FILE SEARCH SKILL =======================

class FileSearchSkill(Skill):
    name = "file_search"
    description = "Search for files and folders on the PC."
    aliases = ["search_files", "find_file", "find_files", "locate"]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        query = str(payload.get("query", "")).strip()
        search_path = str(payload.get("path", "")).strip() or os.path.expanduser("~")
        max_results = int(payload.get("max_results", 50))
        file_type = str(payload.get("type", "all")).lower()
        if not query:
            return {"success": False, "error": "Missing search query."}

        results: List[Dict[str, Any]] = []
        pattern = f"*{query}*"
        try:
            for root, dirs, files in os.walk(search_path):
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', '__pycache__', '.git', 'AppData', '$Recycle.Bin']]
                if len(results) >= max_results:
                    break
                if file_type in ("all", "folder"):
                    for d in dirs:
                        if fnmatch.fnmatch(d.lower(), pattern.lower()):
                            results.append({"name": d, "path": os.path.join(root, d), "type": "folder"})
                            if len(results) >= max_results: break
                if file_type in ("all", "file") and len(results) < max_results:
                    for f in files:
                        if fnmatch.fnmatch(f.lower(), pattern.lower()):
                            full_path = os.path.join(root, f)
                            try:
                                stat = os.stat(full_path)
                                results.append({"name": f, "path": full_path, "type": "file", "size": stat.st_size, "modified": stat.st_mtime})
                            except OSError:
                                results.append({"name": f, "path": full_path, "type": "file"})
                            if len(results) >= max_results: break
            return {"success": True, "query": query, "path": search_path, "count": len(results), "results": results}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ======================= APP LAUNCHER SKILL =======================

class AppLauncherSkill(Skill):
    name = "app_launcher"
    description = "Launch applications, open files, URLs, or system locations."
    aliases = ["open", "launch", "start", "run_app"]

    APP_SHORTCUTS = {
        "notepad": "notepad.exe", "calculator": "calc.exe", "calc": "calc.exe",
        "paint": "mspaint.exe", "explorer": "explorer.exe", "files": "explorer.exe",
        "cmd": "cmd.exe", "terminal": "wt.exe", "powershell": "powershell.exe",
        "settings": "ms-settings:", "control": "control.exe", "control panel": "control.exe",
        "task manager": "taskmgr.exe", "taskmgr": "taskmgr.exe",
        "snipping tool": "snippingtool.exe", "snip": "snippingtool.exe",
        "chrome": "chrome.exe", "firefox": "firefox.exe", "edge": "msedge.exe",
        "vscode": "code", "code": "code", "spotify": "spotify.exe",
        "discord": "discord.exe", "slack": "slack.exe", "zoom": "zoom.exe",
        "teams": "teams.exe", "outlook": "outlook.exe", "word": "winword.exe",
        "excel": "excel.exe", "powerpoint": "powerpnt.exe",
    }

    SYSTEM_LOCATIONS = {
        "desktop": os.path.join(os.path.expanduser("~"), "Desktop"),
        "documents": os.path.join(os.path.expanduser("~"), "Documents"),
        "downloads": os.path.join(os.path.expanduser("~"), "Downloads"),
        "pictures": os.path.join(os.path.expanduser("~"), "Pictures"),
        "music": os.path.join(os.path.expanduser("~"), "Music"),
        "videos": os.path.join(os.path.expanduser("~"), "Videos"),
        "home": os.path.expanduser("~"), "user": os.path.expanduser("~"),
        "temp": os.environ.get("TEMP", "/tmp"),
        "appdata": os.environ.get("APPDATA", ""),
        "program files": os.environ.get("PROGRAMFILES", "C:\\Program Files"),
        "recycle bin": "shell:RecycleBinFolder", "startup": "shell:startup",
    }

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        target = str(payload.get("target", "")).strip()
        args = payload.get("args", [])
        as_admin = bool(payload.get("admin", False))
        if not target:
            return {"success": False, "error": "Missing target to open/launch."}
        target_lower = target.lower()
        try:
            if target_lower in self.APP_SHORTCUTS:
                return await self._launch(self.APP_SHORTCUTS[target_lower], args, as_admin)
            if target_lower in self.SYSTEM_LOCATIONS:
                loc = self.SYSTEM_LOCATIONS[target_lower]
                if sys.platform == "win32": os.startfile(loc)
                elif sys.platform == "darwin": subprocess.Popen(["open", loc])
                else: subprocess.Popen(["xdg-open", loc])
                return {"success": True, "action": "opened_location", "path": loc}
            if target.startswith(("http://", "https://", "www.", "ms-settings:")):
                import webbrowser; webbrowser.open(target)
                return {"success": True, "action": "opened_url", "url": target}
            if os.path.exists(target):
                if sys.platform == "win32": os.startfile(target)
                elif sys.platform == "darwin": subprocess.Popen(["open", target])
                else: subprocess.Popen(["xdg-open", target])
                return {"success": True, "action": "opened_file", "path": target}
            return await self._launch(target, args, as_admin)
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _launch(self, app, args, as_admin):
        try:
            if sys.platform == "win32":
                if as_admin:
                    import ctypes
                    ctypes.windll.shell32.ShellExecuteW(None, "runas", app, " ".join(args) if args else None, None, 1)
                else:
                    subprocess.Popen([app] + list(args) if args else app, shell=True)
            else:
                subprocess.Popen([app] + list(args))
            return {"success": True, "action": "launched", "target": app}
        except FileNotFoundError:
            return {"success": False, "error": f"Application not found: {app}"}


# ======================= WEB FETCH SKILL =======================

class WebFetchSkill(Skill):
    name = "web_fetch"
    description = "Fetch content from URLs (HTML, JSON, text)."
    aliases = ["fetch", "http", "get_url", "curl", "web_request"]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        url = str(payload.get("url", "")).strip()
        method = str(payload.get("method", "GET")).upper()
        headers = payload.get("headers", {})
        body = payload.get("body")
        timeout = int(payload.get("timeout", 30))
        if not url:
            return {"success": False, "error": "Missing URL."}
        if not url.startswith(("http://", "https://")): url = "https://" + url
        try:
            req = urllib.request.Request(url, method=method)
            req.add_header("User-Agent", "JarvisAgent/1.0")
            req.add_header("Accept", "application/json, text/html, */*")
            for k, v in headers.items(): req.add_header(k, str(v))
            data = None
            if body and method in ("POST", "PUT", "PATCH"):
                data = json.dumps(body).encode("utf-8") if isinstance(body, dict) else str(body).encode("utf-8")
                if isinstance(body, dict): req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, data=data, timeout=timeout) as resp:
                status = resp.getcode()
                ct = resp.headers.get("Content-Type", "")
                raw = resp.read()
                enc = resp.headers.get_content_charset() or "utf-8"
                try: content = raw.decode(enc)
                except: content = raw.decode("utf-8", errors="replace")
                result = {"success": True, "url": url, "status_code": status, "content_type": ct, "content_length": len(raw)}
                if "json" in ct.lower():
                    try: result["data"] = json.loads(content)
                    except: result["content"] = content[:10000]
                else:
                    result["content"] = content[:10000]
                    if len(content) > 10000: result["truncated"] = True
                return result
        except urllib.error.HTTPError as e:
            return {"success": False, "url": url, "status_code": e.code, "error": str(e.reason)}
        except urllib.error.URLError as e:
            return {"success": False, "url": url, "error": f"Connection error: {e.reason}"}
        except Exception as e:
            return {"success": False, "url": url, "error": str(e)}


# ======================= AUTOMATION SKILL =======================

class AutomationSkill(Skill):
    name = "automation"
    description = "Create, save, and run automation macros (mouse/keyboard sequences)."
    aliases = ["macro", "automate", "script", "run_macro", "record_macro"]
    MACROS_DIR = os.path.join(os.path.expanduser("~"), ".jarvis", "macros")

    def __init__(self):
        super().__init__()
        os.makedirs(self.MACROS_DIR, exist_ok=True)

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        action = str(payload.get("action", "list")).lower()
        if action == "list":
            macros = []
            for fn in os.listdir(self.MACROS_DIR):
                if fn.endswith(".json"):
                    with open(os.path.join(self.MACROS_DIR, fn)) as f: data = json.load(f)
                    macros.append({"name": fn[:-5], "description": data.get("description", ""), "steps_count": len(data.get("steps", []))})
            return {"success": True, "macros": macros}
        elif action == "save":
            name = "".join(c for c in str(payload.get("name", "")) if c.isalnum() or c in "_-")
            if not name: return {"success": False, "error": "Invalid macro name."}
            with open(os.path.join(self.MACROS_DIR, f"{name}.json"), "w") as f:
                json.dump({"description": payload.get("description", ""), "steps": payload.get("steps", []), "created_at": time.time()}, f, indent=2)
            return {"success": True, "name": name}
        elif action == "delete":
            name = payload.get("name", "")
            fp = os.path.join(self.MACROS_DIR, f"{name}.json")
            if os.path.exists(fp): os.remove(fp); return {"success": True}
            return {"success": False, "error": "Not found"}
        elif action in ("run", "run_steps"):
            steps = payload.get("steps")
            if not steps and payload.get("name"):
                fp = os.path.join(self.MACROS_DIR, f"{payload['name']}.json")
                if os.path.exists(fp):
                    with open(fp) as f: steps = json.load(f).get("steps", [])
            return await self._run_steps(steps or [], payload.get("speed", 1.0))
        return {"success": False, "error": f"Unknown action: {action}"}

    async def _run_steps(self, steps, speed=1.0):
        if not HAS_PYAUTOGUI: return {"success": False, "error": "pyautogui not installed."}
        if not steps: return {"success": False, "error": "No steps."}
        pyautogui.FAILSAFE = True
        executed, errors = 0, []
        for i, step in enumerate(steps):
            try:
                t = str(step.get("type", "")).lower()
                delay = float(step.get("delay", 0.1)) / speed
                if t == "click": pyautogui.click(step.get("x", 0), step.get("y", 0), clicks=step.get("clicks", 1), button=step.get("button", "left"))
                elif t == "move": pyautogui.moveTo(step.get("x", 0), step.get("y", 0), duration=step.get("duration", 0.2) / speed)
                elif t == "type": pyautogui.write(str(step.get("text", "")), interval=step.get("interval", 0.02) / speed)
                elif t == "hotkey": pyautogui.hotkey(*step.get("keys", []))
                elif t == "key": pyautogui.press(step.get("key", ""), presses=step.get("presses", 1))
                elif t == "scroll": pyautogui.scroll(step.get("amount", 0), step.get("x"), step.get("y"))
                elif t == "wait": time.sleep(float(step.get("seconds", 1)) / speed)
                else: errors.append(f"Step {i}: Unknown '{t}'"); continue
                executed += 1
                if delay > 0: time.sleep(delay)
            except Exception as e: errors.append(f"Step {i}: {e}")
        result = {"success": executed > 0, "executed": executed, "total": len(steps)}
        if errors: result["errors"] = errors
        return result


# ======================= SPOTIFY SKILL =======================

class SpotifySkill(Skill):
    name = "spotify"
    description = "Control Spotify playback"
    aliases = ["spotify_control", "music_control"]

    def can_handle(self, command: str) -> bool:
        return command.lower() in ["spotify", "spotify_control", "music_control", "spotify_play", "spotify_pause", "spotify_next", "spotify_prev", "spotify_search", "spotify_open"]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        action = payload.get("action", "play_pause")
        query = payload.get("query", "")
        try:
            if action == "open":
                subprocess.Popen(["cmd", "/c", "start", "spotify:"], shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return {"success": True, "message": "Spotify opened"}
            elif action in ("play_pause", "next", "previous"):
                try:
                    import pyautogui
                    key_map = {"play_pause": "playpause", "next": "nexttrack", "previous": "prevtrack"}
                    pyautogui.press(key_map[action])
                except ImportError: pass
                return {"success": True, "message": f"Media {action} executed"}
            elif action in ("search", "play") and query:
                encoded = urllib.parse.quote(query)
                subprocess.Popen(["cmd", "/c", "start", "", f"spotify:search:{encoded}"], shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                await asyncio.sleep(2)
                try:
                    import pyautogui; await asyncio.sleep(0.5); pyautogui.press("tab"); await asyncio.sleep(0.2); pyautogui.press("enter")
                except ImportError: pass
                return {"success": True, "message": f"Playing '{query}' on Spotify"}
            return {"success": False, "error": f"Unknown action: {action}"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ======================= SYSTEM CONTROL SKILL =======================

class SystemControlSkill(Skill):
    name = "system_control"
    description = "Control system: shutdown, restart, sleep, lock, hibernate, boost"
    aliases = ["system", "power", "lock", "sleep", "restart", "shutdown", "hibernate", "boost"]

    def can_handle(self, command: str) -> bool:
        return command.lower() in ["system_control", "system", "power", "lock", "sleep", "restart", "shutdown", "hibernate", "boost", "lock_screen", "power_options", "boost_pc"]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        action = payload.get("action", "lock")
        try:
            if action == "lock":
                import ctypes; ctypes.windll.user32.LockWorkStation()
                return {"success": True, "message": "Screen locked"}
            elif action == "sleep":
                os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
                return {"success": True, "message": "System going to sleep"}
            elif action == "hibernate":
                os.system("shutdown /h"); return {"success": True, "message": "Hibernating"}
            elif action == "restart":
                d = payload.get("delay", 0); os.system(f"shutdown /r /t {d or 1}")
                return {"success": True, "message": f"Restarting{f' in {d}s' if d else ''}"}
            elif action == "shutdown":
                d = payload.get("delay", 0); os.system(f"shutdown /s /t {d or 1}")
                return {"success": True, "message": f"Shutting down{f' in {d}s' if d else ''}"}
            elif action == "cancel_shutdown":
                os.system("shutdown /a"); return {"success": True, "message": "Shutdown cancelled"}
            elif action == "screen_off":
                import ctypes; ctypes.windll.user32.SendMessageW(0xFFFF, 0x0112, 0xF170, 2)
                return {"success": True, "message": "Screen off"}
            elif action == "boost":
                results = []
                temp_paths = [os.environ.get("TEMP", ""), os.environ.get("TMP", ""), os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp")]
                cleared = 0
                for tp in temp_paths:
                    if tp and os.path.exists(tp):
                        for item in os.listdir(tp):
                            try: os.unlink(os.path.join(tp, item)); cleared += 1
                            except: pass
                results.append(f"Cleared {cleared} temp files")
                subprocess.run(["powercfg", "/s", "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"], capture_output=True, timeout=5)
                results.append("High performance plan set")
                subprocess.run(["ipconfig", "/flushdns"], capture_output=True, timeout=5)
                results.append("DNS flushed")
                return {"success": True, "message": "PC boosted", "actions": results}
            return {"success": False, "error": f"Unknown action: {action}"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ======================= CALENDAR SKILL =======================

class CalendarSkill(Skill):
    name = "calendar"
    description = "Calendar, notes, reminders, and todos"
    aliases = ["calendar_control", "schedule", "events", "notes", "reminders", "todo"]

    def __init__(self):
        self.notes_dir = os.path.join(os.path.expanduser("~"), ".jarvis", "notes")
        os.makedirs(self.notes_dir, exist_ok=True)

    def can_handle(self, command: str) -> bool:
        return command.lower() in ["calendar", "calendar_control", "schedule", "events", "notes", "reminders", "todo", "add_note", "get_notes", "add_reminder", "get_reminders", "open_calendar"]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        action = payload.get("action", "open")
        try:
            if action == "open":
                subprocess.Popen(["cmd", "/c", "start", "outlookcal:"], shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return {"success": True, "message": "Calendar opened"}
            elif action == "add_note":
                title = payload.get("title", "Untitled")
                nid = datetime.now().strftime("%Y%m%d%H%M%S")
                note = {"id": nid, "title": title, "content": payload.get("content", ""), "tags": payload.get("tags", []), "created_at": datetime.now().isoformat()}
                with open(os.path.join(self.notes_dir, f"{nid}.json"), "w") as f: json.dump(note, f, indent=2)
                return {"success": True, "message": f"Note '{title}' created", "note_id": nid}
            elif action == "get_notes":
                notes = []
                q = payload.get("query", "").lower()
                for fn in os.listdir(self.notes_dir):
                    if fn.endswith(".json") and not fn.startswith(("reminder_", "todo_")):
                        try:
                            with open(os.path.join(self.notes_dir, fn)) as f: n = json.load(f)
                            if not q or q in n.get("title", "").lower() or q in n.get("content", "").lower(): notes.append(n)
                        except: pass
                return {"success": True, "notes": sorted(notes, key=lambda x: x.get("created_at", ""), reverse=True)[:20]}
            elif action == "add_todo":
                tid = datetime.now().strftime("%Y%m%d%H%M%S")
                todo = {"id": tid, "title": payload.get("title", "Todo"), "priority": payload.get("priority", "medium"), "created_at": datetime.now().isoformat(), "completed": False}
                with open(os.path.join(self.notes_dir, f"todo_{tid}.json"), "w") as f: json.dump(todo, f, indent=2)
                return {"success": True, "todo_id": tid}
            elif action == "list_todos":
                todos = []
                for fn in os.listdir(self.notes_dir):
                    if fn.startswith("todo_"):
                        try:
                            with open(os.path.join(self.notes_dir, fn)) as f: todos.append(json.load(f))
                        except: pass
                return {"success": True, "todos": todos, "pending": len([t for t in todos if not t.get("completed")])}
            elif action == "complete_todo":
                fp = os.path.join(self.notes_dir, f"todo_{payload.get('todo_id', '')}.json")
                if os.path.exists(fp):
                    with open(fp) as f: t = json.load(f)
                    t["completed"] = True; t["completed_at"] = datetime.now().isoformat()
                    with open(fp, "w") as f: json.dump(t, f, indent=2)
                    return {"success": True}
                return {"success": False, "error": "Not found"}
            return {"success": False, "error": f"Unknown action: {action}"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ======================= BRIGHTNESS/VOLUME SKILL =======================

class BrightnessVolumeSkill(Skill):
    name = "brightness_volume"
    description = "Control system brightness and volume levels"
    aliases = ["brightness", "volume", "set_brightness", "set_volume", "mute", "unmute"]

    def can_handle(self, command: str) -> bool:
        return command.lower() in ["brightness_volume", "brightness", "volume", "set_brightness", "set_volume", "get_volume", "get_brightness", "mute", "unmute", "toggle_mute", "volume_up", "volume_down"]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        action = payload.get("action", "")
        level = payload.get("level")
        try:
            if action == "set_brightness":
                lv = max(0, min(100, int(level or payload.get("brightness", 50))))
                subprocess.run(["powershell", "-Command", f"(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{lv})"], capture_output=True, timeout=10)
                return {"success": True, "level": lv}
            elif action == "get_brightness":
                r = subprocess.run(["powershell", "-Command", "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"], capture_output=True, text=True, timeout=10)
                return {"success": True, "level": int(r.stdout.strip())} if r.stdout.strip() else {"success": False, "error": "Cannot read"}
            elif action == "set_volume":
                lv = max(0, min(100, int(level or payload.get("volume", 50))))
                try:
                    from ctypes import cast, POINTER
                    from comtypes import CLSCTX_ALL
                    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
                    devices = AudioUtilities.GetSpeakers()
                    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                    vol = cast(interface, POINTER(IAudioEndpointVolume))
                    vol.SetMasterVolumeLevelScalar(lv / 100, None)
                except ImportError:
                    subprocess.run(["nircmd", "setsysvolume", str(int(lv * 655.35))], capture_output=True, timeout=5)
                return {"success": True, "level": lv}
            elif action == "get_volume":
                try:
                    from ctypes import cast, POINTER
                    from comtypes import CLSCTX_ALL
                    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
                    devices = AudioUtilities.GetSpeakers()
                    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                    vol = cast(interface, POINTER(IAudioEndpointVolume))
                    return {"success": True, "level": int(vol.GetMasterVolumeLevelScalar() * 100), "muted": bool(vol.GetMute())}
                except ImportError:
                    return {"success": False, "error": "pycaw not installed"}
            elif action in ("mute", "unmute", "toggle_mute"):
                try:
                    from ctypes import cast, POINTER
                    from comtypes import CLSCTX_ALL
                    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
                    devices = AudioUtilities.GetSpeakers()
                    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                    vol = cast(interface, POINTER(IAudioEndpointVolume))
                    if action == "toggle_mute":
                        cur = vol.GetMute(); vol.SetMute(0 if cur else 1, None)
                    else:
                        vol.SetMute(1 if action == "mute" else 0, None)
                    return {"success": True}
                except ImportError:
                    subprocess.run(["nircmd", "mutesysvolume", "2" if action == "toggle_mute" else ("1" if action == "mute" else "0")], capture_output=True, timeout=5)
                    return {"success": True}
            elif action in ("volume_up", "volume_down"):
                delta = payload.get("amount", 10)
                if action == "volume_down": delta = -delta
                try:
                    from ctypes import cast, POINTER
                    from comtypes import CLSCTX_ALL
                    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
                    devices = AudioUtilities.GetSpeakers()
                    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                    vol = cast(interface, POINTER(IAudioEndpointVolume))
                    cur = vol.GetMasterVolumeLevelScalar() * 100
                    new_lv = max(0, min(100, cur + delta))
                    vol.SetMasterVolumeLevelScalar(new_lv / 100, None)
                    return {"success": True, "level": int(new_lv)}
                except ImportError:
                    import pyautogui
                    for _ in range(abs(delta) // 2): pyautogui.press("volumeup" if delta > 0 else "volumedown")
                    return {"success": True}
            return {"success": False, "error": f"Unknown action: {action}"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# ======================= SINGLETON REGISTRY =======================

_registry: Optional[SkillRegistry] = None

def get_skill_registry() -> SkillRegistry:
    global _registry
    if _registry is None:
        _registry = SkillRegistry()
        _registry.register(MemorySkill())
        _registry.register(FileSearchSkill())
        _registry.register(AppLauncherSkill())
        _registry.register(WebFetchSkill())
        _registry.register(AutomationSkill())
        _registry.register(SpotifySkill())
        _registry.register(SystemControlSkill())
        _registry.register(CalendarSkill())
        _registry.register(BrightnessVolumeSkill())
    return _registry
