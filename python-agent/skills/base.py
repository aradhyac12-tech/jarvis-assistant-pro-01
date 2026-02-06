"""
Base skill interface.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List


class Skill(ABC):
    """Abstract base class for JARVIS skills."""

    # Unique name used to route commands
    name: str = ""
    # Short description for UI
    description: str = ""
    # List of command aliases this skill handles
    aliases: List[str] = []

    @abstractmethod
    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the skill with given payload and context.

        Args:
            payload: Command parameters.
            context: Agent context including supabase, user_id, device_id.

        Returns:
            A dict with at minimum {"success": True/False, ...}.
        """
        ...

    def can_handle(self, command: str) -> bool:
        cmd = command.lower().strip()
        return cmd == self.name.lower() or cmd in (a.lower() for a in self.aliases)
