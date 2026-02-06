"""
Web Fetch skill - fetch content from URLs.
"""

import json
import urllib.request
import urllib.error
from typing import Any, Dict
from .base import Skill


class WebFetchSkill(Skill):
    name = "web_fetch"
    description = "Fetch content from URLs (HTML, JSON, text)."
    aliases = ["fetch", "http", "get_url", "curl", "web_request"]

    async def execute(self, payload: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        url = str(payload.get("url", "")).strip()
        method = str(payload.get("method", "GET")).upper()
        headers = payload.get("headers", {})
        body = payload.get("body")
        timeout = int(payload.get("timeout", 30))
        parse_json = bool(payload.get("parse_json", True))

        if not url:
            return {"success": False, "error": "Missing URL."}

        # Ensure URL has protocol
        if not url.startswith(("http://", "https://")):
            url = "https://" + url

        try:
            # Prepare request
            req = urllib.request.Request(url, method=method)

            # Set default headers
            req.add_header("User-Agent", "JarvisAgent/1.0")
            req.add_header("Accept", "application/json, text/html, */*")

            # Add custom headers
            for key, value in headers.items():
                req.add_header(key, str(value))

            # Add body for POST/PUT
            data = None
            if body and method in ("POST", "PUT", "PATCH"):
                if isinstance(body, dict):
                    data = json.dumps(body).encode("utf-8")
                    req.add_header("Content-Type", "application/json")
                else:
                    data = str(body).encode("utf-8")

            # Make request
            with urllib.request.urlopen(req, data=data, timeout=timeout) as response:
                status_code = response.getcode()
                content_type = response.headers.get("Content-Type", "")
                raw_content = response.read()

                # Decode content
                encoding = response.headers.get_content_charset() or "utf-8"
                try:
                    content = raw_content.decode(encoding)
                except UnicodeDecodeError:
                    content = raw_content.decode("utf-8", errors="replace")

                # Try to parse as JSON
                parsed = None
                if parse_json and "json" in content_type.lower():
                    try:
                        parsed = json.loads(content)
                    except json.JSONDecodeError:
                        pass

                result = {
                    "success": True,
                    "url": url,
                    "status_code": status_code,
                    "content_type": content_type,
                    "content_length": len(raw_content),
                }

                if parsed is not None:
                    result["data"] = parsed
                else:
                    # Truncate large text responses
                    if len(content) > 10000:
                        result["content"] = content[:10000]
                        result["truncated"] = True
                    else:
                        result["content"] = content

                return result

        except urllib.error.HTTPError as e:
            return {
                "success": False,
                "url": url,
                "status_code": e.code,
                "error": str(e.reason),
            }
        except urllib.error.URLError as e:
            return {
                "success": False,
                "url": url,
                "error": f"Connection error: {e.reason}",
            }
        except Exception as e:
            return {"success": False, "url": url, "error": str(e)}
