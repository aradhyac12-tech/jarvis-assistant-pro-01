"""
Spotify Playback Control Skill
Controls Spotify via hotkeys and app automation
"""

import subprocess
import asyncio
from typing import Any, Dict
from .base import Skill

# Windows hotkeys for Spotify (requires Spotify app running)
SPOTIFY_HOTKEYS = {
    "play_pause": "nircmd.exe mediaplay",  # Uses media keys
    "next": "nircmd.exe medianext",
    "previous": "nircmd.exe mediaprev",
}


class SpotifySkill(Skill):
    name = "spotify"
    description = "Control Spotify playback - play, pause, next, previous, search and play songs"
    aliases = ["spotify_control", "music_control"]

    def can_handle(self, command: str) -> bool:
        cmd_lower = command.lower()
        return cmd_lower in [
            "spotify", "spotify_control", "music_control",
            "spotify_play", "spotify_pause", "spotify_next", "spotify_prev",
            "spotify_search", "spotify_open"
        ]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        action = payload.get("action", "play_pause")
        query = payload.get("query", "")

        try:
            if action == "open":
                return await self._open_spotify()
            elif action == "play_pause":
                return await self._media_key("play_pause")
            elif action == "next":
                return await self._media_key("next")
            elif action == "previous":
                return await self._media_key("previous")
            elif action == "search" and query:
                return await self._search_and_play(query)
            elif action == "play" and query:
                return await self._search_and_play(query)
            else:
                return {"success": False, "error": f"Unknown action: {action}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _open_spotify(self) -> Dict[str, Any]:
        """Open Spotify application"""
        try:
            # Try Microsoft Store version first
            subprocess.Popen(
                ["cmd", "/c", "start", "spotify:"],
                shell=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            await asyncio.sleep(1)
            return {"success": True, "message": "Spotify opened"}
        except Exception as e:
            # Try desktop version
            try:
                subprocess.Popen(
                    ["cmd", "/c", "start", "", "%APPDATA%\\Spotify\\Spotify.exe"],
                    shell=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                return {"success": True, "message": "Spotify opened"}
            except:
                return {"success": False, "error": str(e)}

    async def _media_key(self, action: str) -> Dict[str, Any]:
        """Send media key via PowerShell"""
        ps_script = ""
        
        if action == "play_pause":
            ps_script = """
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^{BREAK}')
$wshell = New-Object -ComObject wscript.shell
$wshell.SendKeys([char]179)
"""
        elif action == "next":
            ps_script = """
$wshell = New-Object -ComObject wscript.shell
$wshell.SendKeys([char]176)
"""
        elif action == "previous":
            ps_script = """
$wshell = New-Object -ComObject wscript.shell
$wshell.SendKeys([char]177)
"""
        
        try:
            # Use pyautogui for more reliable media control
            import pyautogui
            if action == "play_pause":
                pyautogui.press("playpause")
            elif action == "next":
                pyautogui.press("nexttrack")
            elif action == "previous":
                pyautogui.press("prevtrack")
            return {"success": True, "message": f"Media {action} executed"}
        except ImportError:
            # Fallback to PowerShell
            result = subprocess.run(
                ["powershell", "-Command", ps_script],
                capture_output=True,
                text=True,
                timeout=5
            )
            return {"success": True, "message": f"Media {action} executed"}

    async def _search_and_play(self, query: str) -> Dict[str, Any]:
        """Search and play on Spotify"""
        try:
            # Open Spotify search URI
            import urllib.parse
            encoded = urllib.parse.quote(query)
            uri = f"spotify:search:{encoded}"
            
            subprocess.Popen(
                ["cmd", "/c", "start", "", uri],
                shell=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            
            # Wait for Spotify to open and focus, then press Enter to play first result
            await asyncio.sleep(2)
            
            try:
                import pyautogui
                # Tab to first result and play
                await asyncio.sleep(0.5)
                pyautogui.press("tab")
                await asyncio.sleep(0.2)
                pyautogui.press("enter")
            except ImportError:
                pass
            
            return {"success": True, "message": f"Playing '{query}' on Spotify"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
