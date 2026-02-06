"""
Skill registry & dispatcher.
"""

from typing import Any, Dict, List, Optional
from .base import Skill


class SkillRegistry:
    def __init__(self):
        self._skills: Dict[str, Skill] = {}

    def register(self, skill: Skill) -> None:
        self._skills[skill.name.lower()] = skill

    def get(self, name: str) -> Optional[Skill]:
        return self._skills.get(name.lower())

    def can_dispatch(self, command: str) -> bool:
        for skill in self._skills.values():
            if skill.can_handle(command):
                return True
        return False

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


# Singleton instance
_registry: Optional[SkillRegistry] = None


def get_skill_registry() -> SkillRegistry:
    global _registry
    if _registry is None:
        _registry = SkillRegistry()
        # Register built-in skills
        from .memory_skill import MemorySkill
        from .file_search_skill import FileSearchSkill
        from .app_launcher_skill import AppLauncherSkill
        from .web_fetch_skill import WebFetchSkill
        from .automation_skill import AutomationSkill

        _registry.register(MemorySkill())
        _registry.register(FileSearchSkill())
        _registry.register(AppLauncherSkill())
        _registry.register(WebFetchSkill())
        _registry.register(AutomationSkill())
    return _registry
