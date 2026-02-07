"""
Calendar & Notes Skill
Access Windows Calendar, Outlook, and note-taking applications
"""

import subprocess
import os
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from .base import Skill


class CalendarSkill(Skill):
    name = "calendar"
    description = "Access calendar, create events, view schedule, manage notes and reminders"
    aliases = ["calendar_control", "schedule", "events", "notes", "reminders", "todo"]

    def __init__(self):
        self.notes_dir = os.path.join(os.path.expanduser("~"), ".jarvis", "notes")
        os.makedirs(self.notes_dir, exist_ok=True)

    def can_handle(self, command: str) -> bool:
        cmd_lower = command.lower()
        return cmd_lower in [
            "calendar", "calendar_control", "schedule", "events",
            "notes", "reminders", "todo", "add_note", "get_notes",
            "add_reminder", "get_reminders", "open_calendar"
        ]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        action = payload.get("action", "open")

        try:
            if action == "open":
                return await self._open_calendar()
            elif action == "open_outlook":
                return await self._open_outlook()
            elif action == "add_note":
                return await self._add_note(payload)
            elif action == "get_notes":
                return await self._get_notes(payload.get("query", ""))
            elif action == "delete_note":
                return await self._delete_note(payload.get("note_id", ""))
            elif action == "add_reminder":
                return await self._add_reminder(payload)
            elif action == "get_reminders":
                return await self._get_reminders()
            elif action == "create_event":
                return await self._create_calendar_event(payload)
            elif action == "list_todos":
                return await self._list_todos()
            elif action == "add_todo":
                return await self._add_todo(payload)
            elif action == "complete_todo":
                return await self._complete_todo(payload.get("todo_id", ""))
            else:
                return {"success": False, "error": f"Unknown action: {action}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _open_calendar(self) -> Dict[str, Any]:
        """Open Windows Calendar app"""
        try:
            subprocess.Popen(
                ["cmd", "/c", "start", "outlookcal:"],
                shell=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return {"success": True, "message": "Calendar opened"}
        except:
            # Fallback to Windows Calendar
            subprocess.Popen(
                ["cmd", "/c", "start", "ms-calendar:"],
                shell=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return {"success": True, "message": "Calendar opened"}

    async def _open_outlook(self) -> Dict[str, Any]:
        """Open Outlook application"""
        try:
            subprocess.Popen(
                ["cmd", "/c", "start", "outlook"],
                shell=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return {"success": True, "message": "Outlook opened"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _add_note(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Add a note to local storage"""
        title = payload.get("title", "Untitled")
        content = payload.get("content", "")
        tags = payload.get("tags", [])

        note_id = datetime.now().strftime("%Y%m%d%H%M%S")
        note = {
            "id": note_id,
            "title": title,
            "content": content,
            "tags": tags,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }

        note_path = os.path.join(self.notes_dir, f"{note_id}.json")
        with open(note_path, "w", encoding="utf-8") as f:
            json.dump(note, f, ensure_ascii=False, indent=2)

        return {
            "success": True,
            "message": f"Note '{title}' created",
            "note_id": note_id
        }

    async def _get_notes(self, query: str = "") -> Dict[str, Any]:
        """Get all notes, optionally filtered by query"""
        notes = []
        
        for filename in os.listdir(self.notes_dir):
            if filename.endswith(".json") and not filename.startswith("reminder_") and not filename.startswith("todo_"):
                try:
                    with open(os.path.join(self.notes_dir, filename), "r", encoding="utf-8") as f:
                        note = json.load(f)
                        if not query or query.lower() in note.get("title", "").lower() or query.lower() in note.get("content", "").lower():
                            notes.append(note)
                except:
                    pass

        notes.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        return {
            "success": True,
            "notes": notes[:20],  # Limit to 20 most recent
            "count": len(notes)
        }

    async def _delete_note(self, note_id: str) -> Dict[str, Any]:
        """Delete a note"""
        note_path = os.path.join(self.notes_dir, f"{note_id}.json")
        if os.path.exists(note_path):
            os.unlink(note_path)
            return {"success": True, "message": "Note deleted"}
        return {"success": False, "error": "Note not found"}

    async def _add_reminder(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Add a reminder"""
        title = payload.get("title", "Reminder")
        remind_at = payload.get("remind_at", "")
        
        reminder_id = datetime.now().strftime("%Y%m%d%H%M%S")
        reminder = {
            "id": reminder_id,
            "title": title,
            "remind_at": remind_at,
            "created_at": datetime.now().isoformat(),
            "completed": False
        }

        reminder_path = os.path.join(self.notes_dir, f"reminder_{reminder_id}.json")
        with open(reminder_path, "w", encoding="utf-8") as f:
            json.dump(reminder, f, ensure_ascii=False, indent=2)

        return {
            "success": True,
            "message": f"Reminder '{title}' set",
            "reminder_id": reminder_id
        }

    async def _get_reminders(self) -> Dict[str, Any]:
        """Get all reminders"""
        reminders = []
        
        for filename in os.listdir(self.notes_dir):
            if filename.startswith("reminder_") and filename.endswith(".json"):
                try:
                    with open(os.path.join(self.notes_dir, filename), "r", encoding="utf-8") as f:
                        reminder = json.load(f)
                        reminders.append(reminder)
                except:
                    pass

        reminders.sort(key=lambda x: x.get("remind_at", ""))
        
        return {
            "success": True,
            "reminders": reminders,
            "count": len(reminders)
        }

    async def _add_todo(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Add a todo item"""
        title = payload.get("title", "Todo")
        priority = payload.get("priority", "medium")
        
        todo_id = datetime.now().strftime("%Y%m%d%H%M%S")
        todo = {
            "id": todo_id,
            "title": title,
            "priority": priority,
            "created_at": datetime.now().isoformat(),
            "completed": False,
            "completed_at": None
        }

        todo_path = os.path.join(self.notes_dir, f"todo_{todo_id}.json")
        with open(todo_path, "w", encoding="utf-8") as f:
            json.dump(todo, f, ensure_ascii=False, indent=2)

        return {
            "success": True,
            "message": f"Todo '{title}' added",
            "todo_id": todo_id
        }

    async def _list_todos(self) -> Dict[str, Any]:
        """List all todos"""
        todos = []
        
        for filename in os.listdir(self.notes_dir):
            if filename.startswith("todo_") and filename.endswith(".json"):
                try:
                    with open(os.path.join(self.notes_dir, filename), "r", encoding="utf-8") as f:
                        todo = json.load(f)
                        todos.append(todo)
                except:
                    pass

        # Sort: incomplete first, then by priority, then by date
        priority_order = {"high": 0, "medium": 1, "low": 2}
        todos.sort(key=lambda x: (
            x.get("completed", False),
            priority_order.get(x.get("priority", "medium"), 1),
            x.get("created_at", "")
        ))
        
        return {
            "success": True,
            "todos": todos,
            "count": len(todos),
            "pending": len([t for t in todos if not t.get("completed")])
        }

    async def _complete_todo(self, todo_id: str) -> Dict[str, Any]:
        """Mark a todo as completed"""
        todo_path = os.path.join(self.notes_dir, f"todo_{todo_id}.json")
        if os.path.exists(todo_path):
            with open(todo_path, "r", encoding="utf-8") as f:
                todo = json.load(f)
            
            todo["completed"] = True
            todo["completed_at"] = datetime.now().isoformat()
            
            with open(todo_path, "w", encoding="utf-8") as f:
                json.dump(todo, f, ensure_ascii=False, indent=2)
            
            return {"success": True, "message": "Todo completed"}
        return {"success": False, "error": "Todo not found"}

    async def _create_calendar_event(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Create a calendar event via Outlook"""
        title = payload.get("title", "New Event")
        start = payload.get("start", "")
        end = payload.get("end", "")
        location = payload.get("location", "")
        body = payload.get("body", "")

        # Construct Outlook calendar URL
        outlook_url = f"outlookcal://quickcompose?subject={title}"
        if location:
            outlook_url += f"&location={location}"
        if body:
            outlook_url += f"&body={body}"

        try:
            subprocess.Popen(
                ["cmd", "/c", "start", "", outlook_url],
                shell=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return {"success": True, "message": f"Creating event: {title}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
