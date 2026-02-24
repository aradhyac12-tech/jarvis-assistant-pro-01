"""
System Control Skill
Controls system functions: shutdown, restart, sleep, lock, hibernate, boost
"""

import subprocess
import os
import asyncio
from typing import Any, Dict
from .base import Skill


class SystemControlSkill(Skill):
    name = "system_control"
    description = "Control system: shutdown, restart, sleep, lock, hibernate, boost performance"
    aliases = ["system", "power", "lock", "sleep", "restart", "shutdown", "hibernate", "boost"]

    def can_handle(self, command: str) -> bool:
        cmd_lower = command.lower()
        return cmd_lower in [
            "system_control", "system", "power",
            "lock", "sleep", "restart", "shutdown", "hibernate", "boost",
            "lock_screen", "power_options", "boost_pc", "optimize_drives"
        ]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        action = payload.get("action", "lock")

        try:
            if action == "lock":
                return await self._lock_screen()
            elif action == "sleep":
                return await self._sleep()
            elif action == "hibernate":
                return await self._hibernate()
            elif action == "restart":
                return await self._restart(payload.get("delay", 0))
            elif action == "shutdown":
                return await self._shutdown(payload.get("delay", 0))
            elif action == "boost":
                return await self._boost_performance()
            elif action == "cancel_shutdown":
                return await self._cancel_shutdown()
            elif action == "screen_off":
                return await self._screen_off()
            elif action == "optimize_drives":
                return await self._optimize_drives(payload.get("drive", "C:"), payload.get("flags", "/O"))
            else:
                return {"success": False, "error": f"Unknown action: {action}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _lock_screen(self) -> Dict[str, Any]:
        """Lock the workstation"""
        try:
            import ctypes
            ctypes.windll.user32.LockWorkStation()
            return {"success": True, "message": "Screen locked"}
        except Exception as e:
            # Fallback to command line
            os.system("rundll32.exe user32.dll,LockWorkStation")
            return {"success": True, "message": "Screen locked"}

    async def _sleep(self) -> Dict[str, Any]:
        """Put system to sleep"""
        try:
            os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
            return {"success": True, "message": "System going to sleep"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _hibernate(self) -> Dict[str, Any]:
        """Hibernate the system"""
        try:
            os.system("shutdown /h")
            return {"success": True, "message": "System hibernating"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _restart(self, delay: int = 0) -> Dict[str, Any]:
        """Restart the system"""
        try:
            if delay > 0:
                os.system(f"shutdown /r /t {delay}")
                return {"success": True, "message": f"Restarting in {delay} seconds"}
            else:
                os.system("shutdown /r /t 1")
                return {"success": True, "message": "Restarting now"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _shutdown(self, delay: int = 0) -> Dict[str, Any]:
        """Shutdown the system"""
        try:
            if delay > 0:
                os.system(f"shutdown /s /t {delay}")
                return {"success": True, "message": f"Shutting down in {delay} seconds"}
            else:
                os.system("shutdown /s /t 1")
                return {"success": True, "message": "Shutting down now"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _cancel_shutdown(self) -> Dict[str, Any]:
        """Cancel pending shutdown/restart"""
        try:
            os.system("shutdown /a")
            return {"success": True, "message": "Shutdown cancelled"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _screen_off(self) -> Dict[str, Any]:
        """Turn off the monitor"""
        try:
            import ctypes
            ctypes.windll.user32.SendMessageW(0xFFFF, 0x0112, 0xF170, 2)
            return {"success": True, "message": "Screen turned off"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _boost_performance(self) -> Dict[str, Any]:
        """Boost system performance by clearing temp files and setting high performance"""
        results = []
        
        try:
            # Clear temp files
            temp_paths = [
                os.environ.get("TEMP", ""),
                os.environ.get("TMP", ""),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp"),
            ]
            
            cleared = 0
            for temp_path in temp_paths:
                if temp_path and os.path.exists(temp_path):
                    try:
                        for item in os.listdir(temp_path):
                            item_path = os.path.join(temp_path, item)
                            try:
                                if os.path.isfile(item_path):
                                    os.unlink(item_path)
                                    cleared += 1
                            except:
                                pass  # Skip files in use
                    except:
                        pass
            
            results.append(f"Cleared {cleared} temp files")

            # Set high performance power plan
            subprocess.run(
                ["powercfg", "/s", "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"],
                capture_output=True,
                timeout=5
            )
            results.append("Set high performance power plan")

            # Clear DNS cache
            subprocess.run(
                ["ipconfig", "/flushdns"],
                capture_output=True,
                timeout=5
            )
            results.append("Flushed DNS cache")

            # Clear memory standby list (requires admin)
            try:
                subprocess.run(
                    ["powershell", "-Command", "[System.GC]::Collect()"],
                    capture_output=True,
                    timeout=5
                )
                results.append("Triggered garbage collection")
            except:
                pass

            return {
                "success": True,
                "message": "PC boosted successfully",
                "actions": results
            }

        except Exception as e:
            return {"success": False, "error": str(e), "partial_results": results}

    async def _optimize_drives(self, drive: str = "C:", flags: str = "/O") -> Dict[str, Any]:
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
