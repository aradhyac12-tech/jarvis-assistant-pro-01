"""
File Search skill - search for files/folders on PC.
"""

import os
import fnmatch
from typing import Any, Dict, List
from .base import Skill


class FileSearchSkill(Skill):
    name = "file_search"
    description = "Search for files and folders on the PC."
    aliases = ["search_files", "find_file", "find_files", "locate"]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        query = str(payload.get("query", "")).strip()
        search_path = str(payload.get("path", "")).strip() or os.path.expanduser("~")
        max_results = int(payload.get("max_results", 50))
        file_type = str(payload.get("type", "all")).lower()  # all, file, folder

        if not query:
            return {"success": False, "error": "Missing search query."}

        results: List[Dict[str, Any]] = []
        pattern = f"*{query}*"

        try:
            for root, dirs, files in os.walk(search_path):
                # Skip system/hidden directories
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in [
                    'node_modules', '__pycache__', '.git', 'AppData', '$Recycle.Bin'
                ]]

                if len(results) >= max_results:
                    break

                # Search folders
                if file_type in ("all", "folder"):
                    for d in dirs:
                        if fnmatch.fnmatch(d.lower(), pattern.lower()):
                            full_path = os.path.join(root, d)
                            results.append({
                                "name": d,
                                "path": full_path,
                                "type": "folder",
                            })
                            if len(results) >= max_results:
                                break

                # Search files
                if file_type in ("all", "file") and len(results) < max_results:
                    for f in files:
                        if fnmatch.fnmatch(f.lower(), pattern.lower()):
                            full_path = os.path.join(root, f)
                            try:
                                stat = os.stat(full_path)
                                results.append({
                                    "name": f,
                                    "path": full_path,
                                    "type": "file",
                                    "size": stat.st_size,
                                    "modified": stat.st_mtime,
                                })
                            except OSError:
                                results.append({
                                    "name": f,
                                    "path": full_path,
                                    "type": "file",
                                })
                            if len(results) >= max_results:
                                break

            return {
                "success": True,
                "query": query,
                "path": search_path,
                "count": len(results),
                "results": results,
            }

        except Exception as e:
            return {"success": False, "error": str(e)}
