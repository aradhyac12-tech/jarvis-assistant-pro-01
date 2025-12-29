"""
JARVIS Agent Web UI
====================
A local web dashboard for monitoring and controlling the JARVIS PC Agent.
Runs on http://localhost:8765

Features:
- Real-time status monitoring
- Issue/error log viewer
- Quick controls (volume, brightness, media)
- Connection status
"""

import asyncio
import json
import os
import sys
import threading
import webbrowser
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Any, Dict, List
import urllib.parse

# Log storage (shared with main agent)
log_entries: List[Dict[str, Any]] = []
MAX_LOGS = 100

def add_log(level: str, message: str, details: str = ""):
    """Add a log entry."""
    global log_entries
    entry = {
        "id": len(log_entries),
        "timestamp": datetime.now().isoformat(),
        "level": level,
        "message": message,
        "details": details
    }
    log_entries.insert(0, entry)
    log_entries = log_entries[:MAX_LOGS]

def get_logs():
    """Get all log entries."""
    return log_entries

def clear_logs():
    """Clear all log entries."""
    global log_entries
    log_entries = []

# Status storage
agent_status = {
    "connected": False,
    "device_name": "",
    "device_id": "",
    "last_heartbeat": "",
    "volume": 50,
    "brightness": 50,
    "is_locked": False,
    "cpu_percent": 0,
    "memory_percent": 0,
    "audio_streaming": False,
    "camera_streaming": False,
}

def update_status(new_status: Dict[str, Any]):
    """Update agent status."""
    global agent_status
    agent_status.update(new_status)

def get_status():
    """Get current status."""
    return agent_status


HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JARVIS Agent Dashboard</title>
    <style>
        :root {
            --bg-dark: #0a0e17;
            --bg-card: #111827;
            --border: #1f2937;
            --primary: #3b82f6;
            --primary-glow: rgba(59, 130, 246, 0.5);
            --success: #10b981;
            --warning: #f59e0b;
            --error: #ef4444;
            --text: #f3f4f6;
            --text-muted: #9ca3af;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: var(--bg-dark);
            color: var(--text);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border);
        }

        h1 {
            font-size: 24px;
            font-weight: 600;
            background: linear-gradient(135deg, var(--primary), #8b5cf6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 0 30px var(--primary-glow);
        }

        .status-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 500;
        }

        .status-badge.online {
            background: rgba(16, 185, 129, 0.2);
            color: var(--success);
            border: 1px solid var(--success);
        }

        .status-badge.offline {
            background: rgba(239, 68, 68, 0.2);
            color: var(--error);
            border: 1px solid var(--error);
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        .status-dot.online { background: var(--success); }
        .status-dot.offline { background: var(--error); }

        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.2); }
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
        }

        .card-title {
            font-size: 14px;
            color: var(--text-muted);
            margin-bottom: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .stat {
            font-size: 32px;
            font-weight: 600;
        }

        .stat-label {
            font-size: 14px;
            color: var(--text-muted);
            margin-top: 4px;
        }

        .progress-bar {
            width: 100%;
            height: 8px;
            background: var(--border);
            border-radius: 4px;
            overflow: hidden;
            margin-top: 12px;
        }

        .progress-fill {
            height: 100%;
            border-radius: 4px;
            transition: width 0.3s ease;
        }

        .progress-fill.cpu { background: var(--primary); }
        .progress-fill.memory { background: #8b5cf6; }
        .progress-fill.volume { background: var(--success); }
        .progress-fill.brightness { background: var(--warning); }

        .log-container {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            overflow: hidden;
        }

        .log-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid var(--border);
        }

        .log-header h2 {
            font-size: 16px;
            font-weight: 600;
        }

        .log-actions {
            display: flex;
            gap: 8px;
        }

        .btn {
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
        }

        .btn-primary {
            background: var(--primary);
            color: white;
        }

        .btn-primary:hover {
            background: #2563eb;
            box-shadow: 0 0 20px var(--primary-glow);
        }

        .btn-ghost {
            background: transparent;
            color: var(--text-muted);
            border: 1px solid var(--border);
        }

        .btn-ghost:hover {
            background: var(--border);
            color: var(--text);
        }

        .log-list {
            max-height: 400px;
            overflow-y: auto;
        }

        .log-entry {
            display: flex;
            gap: 12px;
            padding: 12px 20px;
            border-bottom: 1px solid var(--border);
            font-size: 14px;
        }

        .log-entry:last-child {
            border-bottom: none;
        }

        .log-level {
            width: 60px;
            flex-shrink: 0;
            font-weight: 500;
            text-transform: uppercase;
            font-size: 12px;
        }

        .log-level.error { color: var(--error); }
        .log-level.warn { color: var(--warning); }
        .log-level.info { color: var(--primary); }

        .log-message {
            flex: 1;
            color: var(--text);
            word-break: break-word;
        }

        .log-time {
            color: var(--text-muted);
            font-size: 12px;
            flex-shrink: 0;
        }

        .empty-state {
            padding: 40px;
            text-align: center;
            color: var(--text-muted);
        }

        .controls-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 12px;
        }

        .control-btn {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 16px;
            background: var(--border);
            border: none;
            border-radius: 8px;
            color: var(--text);
            cursor: pointer;
            transition: all 0.2s;
        }

        .control-btn:hover {
            background: var(--primary);
            box-shadow: 0 0 20px var(--primary-glow);
        }

        .control-btn svg {
            width: 24px;
            height: 24px;
        }

        .control-btn span {
            font-size: 12px;
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 6px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--border);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--text-muted);
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🤖 JARVIS Agent Dashboard</h1>
            <div class="status-badge" id="status-badge">
                <span class="status-dot" id="status-dot"></span>
                <span id="status-text">Checking...</span>
            </div>
        </header>

        <div class="grid">
            <div class="card">
                <div class="card-title">Device</div>
                <div class="stat" id="device-name">-</div>
                <div class="stat-label" id="device-id">Not connected</div>
            </div>

            <div class="card">
                <div class="card-title">CPU Usage</div>
                <div class="stat" id="cpu-percent">0%</div>
                <div class="progress-bar">
                    <div class="progress-fill cpu" id="cpu-bar" style="width: 0%"></div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">Memory Usage</div>
                <div class="stat" id="memory-percent">0%</div>
                <div class="progress-bar">
                    <div class="progress-fill memory" id="memory-bar" style="width: 0%"></div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">Volume</div>
                <div class="stat" id="volume">50%</div>
                <div class="progress-bar">
                    <div class="progress-fill volume" id="volume-bar" style="width: 50%"></div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">Brightness</div>
                <div class="stat" id="brightness">50%</div>
                <div class="progress-bar">
                    <div class="progress-fill brightness" id="brightness-bar" style="width: 50%"></div>
                </div>
            </div>

            <div class="card">
                <div class="card-title">Streaming</div>
                <div style="display: flex; gap: 12px; margin-top: 8px;">
                    <div>
                        <div class="stat" id="audio-status">OFF</div>
                        <div class="stat-label">Audio</div>
                    </div>
                    <div>
                        <div class="stat" id="camera-status">OFF</div>
                        <div class="stat-label">Camera</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="log-container">
            <div class="log-header">
                <h2>📋 Issue Log</h2>
                <div class="log-actions">
                    <button class="btn btn-ghost" onclick="refreshLogs()">Refresh</button>
                    <button class="btn btn-ghost" onclick="clearLogs()">Clear</button>
                </div>
            </div>
            <div class="log-list" id="log-list">
                <div class="empty-state">No issues logged</div>
            </div>
        </div>
    </div>

    <script>
        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                updateUI(data);
            } catch (e) {
                console.error('Status fetch error:', e);
            }
        }

        function updateUI(data) {
            const badge = document.getElementById('status-badge');
            const dot = document.getElementById('status-dot');
            const text = document.getElementById('status-text');

            if (data.connected) {
                badge.className = 'status-badge online';
                dot.className = 'status-dot online';
                text.textContent = 'Connected';
            } else {
                badge.className = 'status-badge offline';
                dot.className = 'status-dot offline';
                text.textContent = 'Disconnected';
            }

            document.getElementById('device-name').textContent = data.device_name || '-';
            document.getElementById('device-id').textContent = data.device_id ? `ID: ${data.device_id.slice(0, 8)}...` : 'Not connected';

            document.getElementById('cpu-percent').textContent = `${Math.round(data.cpu_percent || 0)}%`;
            document.getElementById('cpu-bar').style.width = `${data.cpu_percent || 0}%`;

            document.getElementById('memory-percent').textContent = `${Math.round(data.memory_percent || 0)}%`;
            document.getElementById('memory-bar').style.width = `${data.memory_percent || 0}%`;

            document.getElementById('volume').textContent = `${data.volume || 0}%`;
            document.getElementById('volume-bar').style.width = `${data.volume || 0}%`;

            document.getElementById('brightness').textContent = `${data.brightness || 0}%`;
            document.getElementById('brightness-bar').style.width = `${data.brightness || 0}%`;

            document.getElementById('audio-status').textContent = data.audio_streaming ? 'ON' : 'OFF';
            document.getElementById('audio-status').style.color = data.audio_streaming ? '#10b981' : '#9ca3af';

            document.getElementById('camera-status').textContent = data.camera_streaming ? 'ON' : 'OFF';
            document.getElementById('camera-status').style.color = data.camera_streaming ? '#10b981' : '#9ca3af';
        }

        async function refreshLogs() {
            try {
                const res = await fetch('/api/logs');
                const logs = await res.json();
                renderLogs(logs);
            } catch (e) {
                console.error('Logs fetch error:', e);
            }
        }

        async function clearLogs() {
            try {
                await fetch('/api/logs/clear', { method: 'POST' });
                refreshLogs();
            } catch (e) {
                console.error('Clear logs error:', e);
            }
        }

        function renderLogs(logs) {
            const container = document.getElementById('log-list');
            if (!logs || logs.length === 0) {
                container.innerHTML = '<div class="empty-state">No issues logged</div>';
                return;
            }

            container.innerHTML = logs.map(log => `
                <div class="log-entry">
                    <span class="log-level ${log.level}">${log.level}</span>
                    <span class="log-message">${escapeHtml(log.message)}${log.details ? '<br><small style="color: #6b7280;">' + escapeHtml(log.details) + '</small>' : ''}</span>
                    <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
            `).join('');
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Initial fetch and polling
        fetchStatus();
        refreshLogs();
        setInterval(fetchStatus, 2000);
        setInterval(refreshLogs, 5000);
    </script>
</body>
</html>
"""


class AgentUIHandler(SimpleHTTPRequestHandler):
    """HTTP request handler for the agent dashboard."""

    def log_message(self, format, *args):
        pass  # Suppress default logging

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(HTML_TEMPLATE.encode())

        elif path == "/api/status":
            self.send_json(get_status())

        elif path == "/api/logs":
            self.send_json(get_logs())

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/logs/clear":
            clear_logs()
            self.send_json({"success": True})
        else:
            self.send_response(404)
            self.end_headers()

    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


def run_ui_server(port: int = 8765, open_browser: bool = True):
    """Start the UI server in a background thread."""
    server = HTTPServer(("127.0.0.1", port), AgentUIHandler)
    
    def serve():
        print(f"🌐 Agent Dashboard running at http://localhost:{port}")
        server.serve_forever()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()

    if open_browser:
        webbrowser.open(f"http://localhost:{port}")

    return server


if __name__ == "__main__":
    # Test the UI server standalone
    add_log("info", "Agent UI started")
    add_log("warn", "This is a test warning")
    add_log("error", "This is a test error", "Some details here")
    
    update_status({
        "connected": True,
        "device_name": "Test PC",
        "device_id": "abc123def456",
        "cpu_percent": 45,
        "memory_percent": 62,
        "volume": 80,
        "brightness": 70,
    })
    
    run_ui_server(open_browser=True)
    
    try:
        while True:
            pass
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")
