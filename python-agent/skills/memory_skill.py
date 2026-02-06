"""
Memory skill - persist/recall facts/preferences via Supabase.
"""

from typing import Any, Dict
from .base import Skill


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

        if action == "set" or action == "remember":
            if not key:
                return {"success": False, "error": "Missing key."}
            # Upsert by (user_id, key)
            result = supabase.table("assistant_memories").upsert({
                "user_id": user_id,
                "device_id": device_id,
                "key": key,
                "value": value if isinstance(value, dict) else {"v": value},
                "category": category,
            }, on_conflict="user_id,key").execute()

            if hasattr(result, "error") and result.error:
                return {"success": False, "error": str(result.error)}

            return {"success": True, "key": key}

        elif action in ("get", "recall"):
            if not key:
                return {"success": False, "error": "Missing key."}

            result = supabase.table("assistant_memories").select("value").eq(
                "user_id", user_id
            ).eq("key", key).limit(1).execute()

            if result.data:
                raw = result.data[0].get("value") or {}
                return {"success": True, "key": key, "value": raw.get("v") if "v" in raw else raw}

            return {"success": False, "error": "Memory not found."}

        elif action in ("delete", "forget"):
            if not key:
                return {"success": False, "error": "Missing key."}
            supabase.table("assistant_memories").delete().eq(
                "user_id", user_id
            ).eq("key", key).execute()
            return {"success": True, "key": key}

        elif action == "list":
            result = supabase.table("assistant_memories").select("key,value,category").eq(
                "user_id", user_id
            ).order("updated_at", desc=True).limit(50).execute()

            memories = []
            for row in result.data or []:
                raw = row.get("value") or {}
                memories.append({
                    "key": row.get("key"),
                    "value": raw.get("v") if "v" in raw else raw,
                    "category": row.get("category"),
                })
            return {"success": True, "memories": memories}

        else:
            return {"success": False, "error": f"Unknown memory action: {action}"}
