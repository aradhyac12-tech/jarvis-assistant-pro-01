"""
App Launcher skill - open applications, files, URLs, and system locations.
"""

import os
import subprocess
import sys
from typing import Any, Dict
from .base import Skill


class AppLauncherSkill(Skill):
    name = "app_launcher"
    description = "Launch applications, open files, URLs, or system locations."
    aliases = ["open", "launch", "start", "run_app"]

    # Common app shortcuts (Windows)
    APP_SHORTCUTS = {
        "notepad": "notepad.exe",
        "calculator": "calc.exe",
        "calc": "calc.exe",
        "paint": "mspaint.exe",
        "explorer": "explorer.exe",
        "files": "explorer.exe",
        "cmd": "cmd.exe",
        "terminal": "wt.exe",
        "powershell": "powershell.exe",
        "settings": "ms-settings:",
        "control": "control.exe",
        "control panel": "control.exe",
        "task manager": "taskmgr.exe",
        "taskmgr": "taskmgr.exe",
        "snipping tool": "snippingtool.exe",
        "snip": "snippingtool.exe",
        "wordpad": "wordpad.exe",
        "chrome": "chrome.exe",
        "firefox": "firefox.exe",
        "edge": "msedge.exe",
        "vscode": "code",
        "code": "code",
        "spotify": "spotify.exe",
        "discord": "discord.exe",
        "slack": "slack.exe",
        "zoom": "zoom.exe",
        "teams": "teams.exe",
        "outlook": "outlook.exe",
        "word": "winword.exe",
        "excel": "excel.exe",
        "powerpoint": "powerpnt.exe",
    }

    # System locations
    SYSTEM_LOCATIONS = {
        "desktop": os.path.join(os.path.expanduser("~"), "Desktop"),
        "documents": os.path.join(os.path.expanduser("~"), "Documents"),
        "downloads": os.path.join(os.path.expanduser("~"), "Downloads"),
        "pictures": os.path.join(os.path.expanduser("~"), "Pictures"),
        "music": os.path.join(os.path.expanduser("~"), "Music"),
        "videos": os.path.join(os.path.expanduser("~"), "Videos"),
        "home": os.path.expanduser("~"),
        "user": os.path.expanduser("~"),
        "temp": os.environ.get("TEMP", "/tmp"),
        "appdata": os.environ.get("APPDATA", ""),
        "program files": os.environ.get("PROGRAMFILES", "C:\\Program Files"),
        "recycle bin": "shell:RecycleBinFolder",
        "startup": "shell:startup",
    }

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        target = str(payload.get("target", "")).strip()
        args = payload.get("args", [])
        as_admin = bool(payload.get("admin", False))

        if not target:
            return {"success": False, "error": "Missing target to open/launch."}

        target_lower = target.lower()

        try:
            # Check if it's a known app shortcut
            if target_lower in self.APP_SHORTCUTS:
                app = self.APP_SHORTCUTS[target_lower]
                return await self._launch_app(app, args, as_admin)

            # Check if it's a system location
            if target_lower in self.SYSTEM_LOCATIONS:
                location = self.SYSTEM_LOCATIONS[target_lower]
                return await self._open_location(location)

            # Check if it's a URL
            if target.startswith(("http://", "https://", "www.", "ms-settings:")):
                return await self._open_url(target)

            # Check if it's a file path
            if os.path.exists(target):
                return await self._open_file(target)

            # Try to launch as executable
            return await self._launch_app(target, args, as_admin)

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _launch_app(self, app: str, args: list, as_admin: bool) -> Dict[str, Any]:
        """Launch an application."""
        try:
            if sys.platform == "win32":
                if as_admin:
                    import ctypes
                    ctypes.windll.shell32.ShellExecuteW(
                        None, "runas", app, " ".join(args) if args else None, None, 1
                    )
                else:
                    if args:
                        subprocess.Popen([app] + list(args), shell=True)
                    else:
                        subprocess.Popen(app, shell=True)
            else:
                subprocess.Popen([app] + list(args))

            return {"success": True, "action": "launched", "target": app}
        except FileNotFoundError:
            return {"success": False, "error": f"Application not found: {app}"}

    async def _open_location(self, location: str) -> Dict[str, Any]:
        """Open a folder location."""
        try:
            if sys.platform == "win32":
                os.startfile(location)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", location])
            else:
                subprocess.Popen(["xdg-open", location])

            return {"success": True, "action": "opened_location", "path": location}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _open_url(self, url: str) -> Dict[str, Any]:
        """Open a URL in default browser."""
        import webbrowser
        webbrowser.open(url)
        return {"success": True, "action": "opened_url", "url": url}

    async def _open_file(self, path: str) -> Dict[str, Any]:
        """Open a file with default application."""
        try:
            if sys.platform == "win32":
                os.startfile(path)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])

            return {"success": True, "action": "opened_file", "path": path}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_available_apps(self) -> Dict[str, str]:
        """Return list of known app shortcuts."""
        return self.APP_SHORTCUTS.copy()

    def get_system_locations(self) -> Dict[str, str]:
        """Return list of known system locations."""
        return self.SYSTEM_LOCATIONS.copy()
