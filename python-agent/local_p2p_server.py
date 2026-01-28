"""
Local P2P WebSocket Server for JARVIS Agent
============================================
Runs on localhost:9876 to provide ultra-low latency (2-5ms) direct connections
when phone and PC are on the same network.

This bypasses Supabase entirely for same-network scenarios, achieving true
local P2P performance.
"""

import asyncio
import json
import socket
import threading
from datetime import datetime
from typing import Optional, Dict, Any, Callable, Set

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False
    print("⚠️  websockets not installed - local P2P server disabled")

# Default port for local P2P
LOCAL_P2P_PORT = 9876


class LocalP2PServer:
    """Local WebSocket server for direct same-network connections."""
    
    def __init__(self, command_handler: Optional[Callable] = None, port: int = LOCAL_P2P_PORT):
        self.port = port
        self.command_handler = command_handler
        self.running = False
        self.server = None
        self.clients: Set[WebSocketServerProtocol] = set()
        self.local_ips: list = []
        self._server_thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        
    def get_local_ips(self) -> list:
        """Get all local IP addresses for this machine."""
        ips = []
        hostname = socket.gethostname()
        
        try:
            # Get all IPs from hostname
            for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
                ip = info[4][0]
                if not ip.startswith("127."):
                    ips.append(ip)
        except Exception:
            pass
        
        # Also try via connection method (most reliable for primary IP)
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            primary_ip = s.getsockname()[0]
            s.close()
            if primary_ip not in ips:
                ips.insert(0, primary_ip)
        except Exception:
            pass
        
        self.local_ips = ips
        return ips

    async def handle_client(self, websocket: WebSocketServerProtocol, path: str):
        """Handle a WebSocket client connection."""
        client_ip = websocket.remote_address[0] if websocket.remote_address else "unknown"
        print(f"[LocalP2P] 🔗 Client connected from {client_ip}")
        
        self.clients.add(websocket)
        
        try:
            # Send welcome message with server info
            await websocket.send(json.dumps({
                "type": "welcome",
                "server": "jarvis_local_p2p",
                "version": "1.0",
                "local_ips": self.local_ips,
                "port": self.port,
            }))
            
            async for message in websocket:
                try:
                    if isinstance(message, str):
                        data = json.loads(message)
                        response = await self._process_message(data)
                        if response:
                            await websocket.send(json.dumps(response))
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({
                        "type": "error",
                        "error": "Invalid JSON"
                    }))
                except Exception as e:
                    print(f"[LocalP2P] Message handling error: {e}")
                    await websocket.send(json.dumps({
                        "type": "error",
                        "error": str(e)
                    }))
                    
        except websockets.exceptions.ConnectionClosed:
            print(f"[LocalP2P] Client {client_ip} disconnected")
        except Exception as e:
            print(f"[LocalP2P] Client error: {e}")
        finally:
            self.clients.discard(websocket)
    
    async def _process_message(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process incoming message and return response."""
        msg_type = data.get("type", "")
        
        if msg_type == "ping":
            return {"type": "pong", "t": data.get("t", 0), "server_time": datetime.now().isoformat()}
        
        elif msg_type == "command":
            command_type = data.get("commandType", "")
            payload = data.get("payload", {})
            
            if self.command_handler:
                try:
                    # Call the command handler (async or sync)
                    if asyncio.iscoroutinefunction(self.command_handler):
                        result = await self.command_handler(command_type, payload)
                    else:
                        result = self.command_handler(command_type, payload)
                    
                    return {
                        "type": "command_result",
                        "commandType": command_type,
                        "result": result,
                    }
                except Exception as e:
                    return {
                        "type": "command_error",
                        "commandType": command_type,
                        "error": str(e),
                    }
            else:
                return {
                    "type": "error",
                    "error": "No command handler configured"
                }
        
        elif msg_type == "get_info":
            return {
                "type": "info",
                "local_ips": self.local_ips,
                "port": self.port,
                "clients": len(self.clients),
            }
        
        return None
    
    async def _start_server(self):
        """Internal method to start the WebSocket server."""
        self.get_local_ips()
        
        # Try to bind to all interfaces
        try:
            self.server = await websockets.serve(
                self.handle_client,
                "0.0.0.0",
                self.port,
                ping_interval=20,
                ping_timeout=10,
            )
            self.running = True
            
            print(f"\n[LocalP2P] ✅ Server started on port {self.port}")
            print(f"[LocalP2P] 🌐 Available at:")
            for ip in self.local_ips:
                print(f"           ws://{ip}:{self.port}/p2p")
            print()
            
            # Keep server running
            await self.server.wait_closed()
            
        except OSError as e:
            if "Address already in use" in str(e):
                print(f"[LocalP2P] ⚠️  Port {self.port} already in use")
            else:
                print(f"[LocalP2P] ❌ Server error: {e}")
            self.running = False
    
    def start(self):
        """Start the server in a background thread."""
        if not HAS_WEBSOCKETS:
            print("[LocalP2P] Cannot start - websockets not installed")
            return False
        
        if self.running:
            return True
        
        def run_server():
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            try:
                self._loop.run_until_complete(self._start_server())
            except Exception as e:
                print(f"[LocalP2P] Server thread error: {e}")
            finally:
                self._loop.close()
        
        self._server_thread = threading.Thread(target=run_server, daemon=True)
        self._server_thread.start()
        return True
    
    def stop(self):
        """Stop the server."""
        self.running = False
        if self.server:
            self.server.close()
            self.server = None
        print("[LocalP2P] Server stopped")
    
    async def broadcast(self, message: Dict[str, Any]):
        """Broadcast a message to all connected clients."""
        if not self.clients:
            return
        
        msg = json.dumps(message)
        await asyncio.gather(
            *[client.send(msg) for client in self.clients],
            return_exceptions=True
        )


# Singleton instance
_local_p2p_server: Optional[LocalP2PServer] = None


def get_local_p2p_server() -> Optional[LocalP2PServer]:
    """Get the singleton LocalP2PServer instance."""
    return _local_p2p_server


def start_local_p2p_server(command_handler: Callable, port: int = LOCAL_P2P_PORT) -> LocalP2PServer:
    """Start the local P2P server with the given command handler."""
    global _local_p2p_server
    
    if _local_p2p_server is not None and _local_p2p_server.running:
        return _local_p2p_server
    
    _local_p2p_server = LocalP2PServer(command_handler=command_handler, port=port)
    _local_p2p_server.start()
    return _local_p2p_server


def stop_local_p2p_server():
    """Stop the local P2P server."""
    global _local_p2p_server
    
    if _local_p2p_server:
        _local_p2p_server.stop()
        _local_p2p_server = None
