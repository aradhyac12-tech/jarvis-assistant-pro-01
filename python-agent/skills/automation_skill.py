"""
Automation Macros skill - record and playback automation sequences.
"""

import json
import os
import time
from typing import Any, Dict, List, Optional
from .base import Skill

# Optional imports for automation
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
            return await self._list_macros()
        elif action == "get":
            return await self._get_macro(payload.get("name", ""))
        elif action == "save":
            return await self._save_macro(
                payload.get("name", ""),
                payload.get("steps", []),
                payload.get("description", ""),
            )
        elif action == "delete":
            return await self._delete_macro(payload.get("name", ""))
        elif action == "run":
            return await self._run_macro(
                payload.get("name"),
                payload.get("steps"),
                payload.get("speed", 1.0),
            )
        elif action == "run_steps":
            return await self._run_steps(
                payload.get("steps", []),
                payload.get("speed", 1.0),
            )
        else:
            return {"success": False, "error": f"Unknown action: {action}"}

    async def _list_macros(self) -> Dict[str, Any]:
        """List all saved macros."""
        macros = []
        try:
            for filename in os.listdir(self.MACROS_DIR):
                if filename.endswith(".json"):
                    filepath = os.path.join(self.MACROS_DIR, filename)
                    with open(filepath, "r") as f:
                        data = json.load(f)
                    macros.append({
                        "name": filename[:-5],
                        "description": data.get("description", ""),
                        "steps_count": len(data.get("steps", [])),
                    })
        except Exception as e:
            return {"success": False, "error": str(e)}

        return {"success": True, "macros": macros}

    async def _get_macro(self, name: str) -> Dict[str, Any]:
        """Get a specific macro by name."""
        if not name:
            return {"success": False, "error": "Missing macro name."}

        filepath = os.path.join(self.MACROS_DIR, f"{name}.json")
        if not os.path.exists(filepath):
            return {"success": False, "error": f"Macro not found: {name}"}

        try:
            with open(filepath, "r") as f:
                data = json.load(f)
            return {"success": True, "name": name, **data}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _save_macro(self, name: str, steps: List[Dict], description: str) -> Dict[str, Any]:
        """Save a macro."""
        if not name:
            return {"success": False, "error": "Missing macro name."}
        if not steps:
            return {"success": False, "error": "Missing macro steps."}

        # Sanitize name
        safe_name = "".join(c for c in name if c.isalnum() or c in "_-")
        if not safe_name:
            return {"success": False, "error": "Invalid macro name."}

        filepath = os.path.join(self.MACROS_DIR, f"{safe_name}.json")

        try:
            with open(filepath, "w") as f:
                json.dump({
                    "description": description,
                    "steps": steps,
                    "created_at": time.time(),
                }, f, indent=2)

            return {"success": True, "name": safe_name, "path": filepath}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _delete_macro(self, name: str) -> Dict[str, Any]:
        """Delete a macro."""
        if not name:
            return {"success": False, "error": "Missing macro name."}

        filepath = os.path.join(self.MACROS_DIR, f"{name}.json")
        if not os.path.exists(filepath):
            return {"success": False, "error": f"Macro not found: {name}"}

        try:
            os.remove(filepath)
            return {"success": True, "deleted": name}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _run_macro(self, name: Optional[str], steps: Optional[List], speed: float) -> Dict[str, Any]:
        """Run a macro by name or inline steps."""
        if steps:
            return await self._run_steps(steps, speed)

        if not name:
            return {"success": False, "error": "Missing macro name or steps."}

        result = await self._get_macro(name)
        if not result.get("success"):
            return result

        return await self._run_steps(result.get("steps", []), speed)

    async def _run_steps(self, steps: List[Dict], speed: float = 1.0) -> Dict[str, Any]:
        """Execute automation steps."""
        if not HAS_PYAUTOGUI:
            return {"success": False, "error": "pyautogui not installed."}

        if not steps:
            return {"success": False, "error": "No steps to execute."}

        executed = 0
        errors = []

        # Safety: Set failsafe
        pyautogui.FAILSAFE = True

        for i, step in enumerate(steps):
            try:
                step_type = str(step.get("type", "")).lower()
                delay = float(step.get("delay", 0.1)) / speed

                if step_type == "click":
                    x, y = step.get("x", 0), step.get("y", 0)
                    button = step.get("button", "left")
                    clicks = step.get("clicks", 1)
                    pyautogui.click(x, y, clicks=clicks, button=button)

                elif step_type == "move":
                    x, y = step.get("x", 0), step.get("y", 0)
                    duration = step.get("duration", 0.2) / speed
                    pyautogui.moveTo(x, y, duration=duration)

                elif step_type == "type":
                    text = str(step.get("text", ""))
                    interval = step.get("interval", 0.02) / speed
                    pyautogui.write(text, interval=interval)

                elif step_type == "hotkey":
                    keys = step.get("keys", [])
                    if keys:
                        pyautogui.hotkey(*keys)

                elif step_type == "key":
                    key = step.get("key", "")
                    presses = step.get("presses", 1)
                    if key:
                        pyautogui.press(key, presses=presses)

                elif step_type == "scroll":
                    amount = step.get("amount", 0)
                    x, y = step.get("x"), step.get("y")
                    pyautogui.scroll(amount, x, y)

                elif step_type == "drag":
                    x, y = step.get("x", 0), step.get("y", 0)
                    duration = step.get("duration", 0.5) / speed
                    button = step.get("button", "left")
                    pyautogui.drag(x, y, duration=duration, button=button)

                elif step_type == "wait":
                    wait_time = float(step.get("seconds", 1)) / speed
                    time.sleep(wait_time)

                elif step_type == "screenshot":
                    # Take screenshot and save
                    filename = step.get("filename", f"macro_screenshot_{int(time.time())}.png")
                    filepath = os.path.join(os.path.expanduser("~"), "Pictures", filename)
                    pyautogui.screenshot(filepath)

                else:
                    errors.append(f"Step {i}: Unknown type '{step_type}'")
                    continue

                executed += 1
                if delay > 0:
                    time.sleep(delay)

            except Exception as e:
                errors.append(f"Step {i}: {str(e)}")

        result = {
            "success": executed > 0,
            "executed": executed,
            "total": len(steps),
        }

        if errors:
            result["errors"] = errors

        return result
