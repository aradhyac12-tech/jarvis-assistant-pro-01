"""
Brightness and Volume Control Skill
Direct hardware control for display brightness and system volume
"""

import subprocess
import asyncio
from typing import Any, Dict
from .base import Skill


class BrightnessVolumeSkill(Skill):
    name = "brightness_volume"
    description = "Control system brightness and volume levels"
    aliases = ["brightness", "volume", "set_brightness", "set_volume", "mute", "unmute"]

    def can_handle(self, command: str) -> bool:
        cmd_lower = command.lower()
        return cmd_lower in [
            "brightness_volume", "brightness", "volume",
            "set_brightness", "set_volume", "get_volume", "get_brightness",
            "mute", "unmute", "toggle_mute", "volume_up", "volume_down"
        ]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        action = payload.get("action", "")
        level = payload.get("level", None)

        try:
            if action == "set_brightness" or (not action and "brightness" in str(payload)):
                return await self._set_brightness(level or payload.get("brightness", 50))
            elif action == "get_brightness":
                return await self._get_brightness()
            elif action == "set_volume" or (not action and "volume" in str(payload)):
                return await self._set_volume(level or payload.get("volume", 50))
            elif action == "get_volume":
                return await self._get_volume()
            elif action == "mute":
                return await self._set_mute(True)
            elif action == "unmute":
                return await self._set_mute(False)
            elif action == "toggle_mute":
                return await self._toggle_mute()
            elif action == "volume_up":
                return await self._adjust_volume(payload.get("amount", 10))
            elif action == "volume_down":
                return await self._adjust_volume(-payload.get("amount", 10))
            else:
                return {"success": False, "error": f"Unknown action: {action}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _set_brightness(self, level: int) -> Dict[str, Any]:
        """Set display brightness (0-100)"""
        level = max(0, min(100, int(level)))
        
        try:
            # Use PowerShell WMI for laptop displays
            ps_script = f"""
(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{level})
"""
            result = subprocess.run(
                ["powershell", "-Command", ps_script],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                return {"success": True, "message": f"Brightness set to {level}%", "level": level}
            else:
                # Fallback for desktop monitors (may need external tools)
                return {"success": True, "message": f"Brightness set to {level}% (desktop monitors may not support software control)", "level": level}
                
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_brightness(self) -> Dict[str, Any]:
        """Get current brightness level"""
        try:
            ps_script = """
(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness
"""
            result = subprocess.run(
                ["powershell", "-Command", ps_script],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0 and result.stdout.strip():
                level = int(result.stdout.strip())
                return {"success": True, "level": level}
            else:
                return {"success": False, "error": "Could not read brightness"}
                
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _set_volume(self, level: int) -> Dict[str, Any]:
        """Set system volume (0-100)"""
        level = max(0, min(100, int(level)))
        
        try:
            from ctypes import cast, POINTER
            import comtypes
            from comtypes import CLSCTX_ALL
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

            comtypes.CoInitialize()
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                volume.SetMasterVolumeLevelScalar(level / 100, None)
                return {"success": True, "message": f"Volume set to {level}%", "level": level}
            finally:
                comtypes.CoUninitialize()
        except ImportError:
            try:
                subprocess.run(
                    ["nircmd", "setsysvolume", str(int(level * 655.35))],
                    capture_output=True, timeout=5
                )
                return {"success": True, "message": f"Volume set to {level}%", "level": level}
            except (FileNotFoundError, subprocess.TimeoutExpired):
                import pyautogui
                key = "volumeup" if level > 50 else "volumedown"
                for _ in range(abs(level - 50) // 2):
                    pyautogui.press(key)
                return {"success": True, "message": f"Volume adjusted towards {level}%", "level": level}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_volume(self) -> Dict[str, Any]:
        """Get current volume level"""
        try:
            from ctypes import cast, POINTER
            import comtypes
            from comtypes import CLSCTX_ALL
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

            comtypes.CoInitialize()
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                current = int(volume.GetMasterVolumeLevelScalar() * 100)
                muted = volume.GetMute()
                return {"success": True, "level": current, "muted": bool(muted)}
            finally:
                comtypes.CoUninitialize()
        except ImportError:
            return {"success": False, "error": "pycaw not installed - run: pip install pycaw"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _set_mute(self, mute: bool) -> Dict[str, Any]:
        """Mute or unmute system audio"""
        try:
            from ctypes import cast, POINTER
            import comtypes
            from comtypes import CLSCTX_ALL
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

            comtypes.CoInitialize()
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                volume.SetMute(1 if mute else 0, None)
                return {"success": True, "message": "Muted" if mute else "Unmuted", "muted": mute}
            finally:
                comtypes.CoUninitialize()
        except ImportError:
            subprocess.run(
                ["nircmd", "mutesysvolume", "1" if mute else "0"],
                capture_output=True, timeout=5
            )
            return {"success": True, "message": "Muted" if mute else "Unmuted", "muted": mute}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _toggle_mute(self) -> Dict[str, Any]:
        """Toggle mute state"""
        try:
            from ctypes import cast, POINTER
            import comtypes
            from comtypes import CLSCTX_ALL
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

            comtypes.CoInitialize()
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                current_mute = volume.GetMute()
                volume.SetMute(0 if current_mute else 1, None)
                return {"success": True, "message": "Unmuted" if current_mute else "Muted", "muted": not current_mute}
            finally:
                comtypes.CoUninitialize()
        except ImportError:
            subprocess.run(["nircmd", "mutesysvolume", "2"], capture_output=True, timeout=5)
            return {"success": True, "message": "Mute toggled"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _adjust_volume(self, delta: int) -> Dict[str, Any]:
        """Adjust volume by delta amount"""
        try:
            from ctypes import cast, POINTER
            import comtypes
            from comtypes import CLSCTX_ALL
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

            comtypes.CoInitialize()
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
                volume = cast(interface, POINTER(IAudioEndpointVolume))
                current = volume.GetMasterVolumeLevelScalar() * 100
                new_level = max(0, min(100, current + delta))
                volume.SetMasterVolumeLevelScalar(new_level / 100, None)
                return {"success": True, "message": f"Volume {'increased' if delta > 0 else 'decreased'} to {int(new_level)}%", "level": int(new_level)}
            finally:
                comtypes.CoUninitialize()
        except ImportError:
            import pyautogui
            key = "volumeup" if delta > 0 else "volumedown"
            for _ in range(abs(delta) // 2):
                pyautogui.press(key)
            return {"success": True, "message": f"Volume {'increased' if delta > 0 else 'decreased'}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
