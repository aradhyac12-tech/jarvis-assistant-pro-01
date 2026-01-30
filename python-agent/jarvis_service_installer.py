"""
JARVIS Windows Service Installer
=================================
Installs a Windows service that starts the JARVIS agent on boot.
The service runs in the background even before user login.

Usage:
  python jarvis_service_installer.py install   - Install the service
  python jarvis_service_installer.py uninstall - Remove the service
  python jarvis_service_installer.py start     - Start the service
  python jarvis_service_installer.py stop      - Stop the service
  python jarvis_service_installer.py status    - Check service status

Requires Administrator privileges!
"""

import os
import sys
import subprocess
import ctypes
import shutil

SERVICE_NAME = "JarvisAgent"
SERVICE_DISPLAY_NAME = "JARVIS PC Agent"
SERVICE_DESCRIPTION = "Runs JARVIS PC Agent for remote control from mobile devices"

def is_admin():
    """Check if running with admin privileges."""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

def get_python_path():
    """Get the path to pythonw.exe for silent execution."""
    python_dir = os.path.dirname(sys.executable)
    pythonw = os.path.join(python_dir, "pythonw.exe")
    if os.path.exists(pythonw):
        return pythonw
    return sys.executable

def get_agent_path():
    """Get the path to the agent script."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # Prefer .pyw for silent execution
    pyw_path = os.path.join(script_dir, "jarvis_agent.pyw")
    if os.path.exists(pyw_path):
        return pyw_path
    return os.path.join(script_dir, "jarvis_agent.py")

def create_startup_batch():
    """Create a batch file for Task Scheduler startup."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    batch_path = os.path.join(script_dir, "jarvis_autostart.bat")
    
    python_path = get_python_path()
    agent_path = get_agent_path()
    
    content = f'''@echo off
cd /d "{script_dir}"
start "" "{python_path}" "{agent_path}" --headless
'''
    
    with open(batch_path, "w") as f:
        f.write(content)
    
    print(f"✅ Created autostart batch: {batch_path}")
    return batch_path

def install_task_scheduler():
    """Install using Task Scheduler (more reliable than services for GUI apps)."""
    print("\n📦 Installing JARVIS autostart via Task Scheduler...")
    
    batch_path = create_startup_batch()
    python_path = get_python_path()
    agent_path = get_agent_path()
    
    # Delete existing task if any
    subprocess.run(
        ["schtasks", "/delete", "/tn", SERVICE_NAME, "/f"],
        capture_output=True
    )
    
    # Create task to run at logon
    result = subprocess.run([
        "schtasks", "/create",
        "/tn", SERVICE_NAME,
        "/tr", f'"{python_path}" "{agent_path}" --headless',
        "/sc", "onlogon",
        "/rl", "highest",
        "/f"
    ], capture_output=True, text=True)
    
    if result.returncode == 0:
        print("✅ Task Scheduler entry created!")
        print(f"   Task Name: {SERVICE_NAME}")
        print("   Trigger: At logon")
        print("\n💡 The agent will start automatically when you log in.")
        print("   To start now, run: python jarvis_service_installer.py start")
        return True
    else:
        print(f"❌ Failed to create task: {result.stderr}")
        return False

def uninstall_task_scheduler():
    """Remove the Task Scheduler entry."""
    print("\n🗑️  Removing JARVIS autostart...")
    
    result = subprocess.run(
        ["schtasks", "/delete", "/tn", SERVICE_NAME, "/f"],
        capture_output=True, text=True
    )
    
    if result.returncode == 0:
        print("✅ Task removed!")
    else:
        print(f"⚠️  Task may not exist: {result.stderr}")
    
    # Also remove batch file
    script_dir = os.path.dirname(os.path.abspath(__file__))
    batch_path = os.path.join(script_dir, "jarvis_autostart.bat")
    if os.path.exists(batch_path):
        os.remove(batch_path)
        print("✅ Autostart batch removed!")

def start_agent():
    """Start the agent process."""
    print("\n🚀 Starting JARVIS agent...")
    
    python_path = get_python_path()
    agent_path = get_agent_path()
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Start detached process
    if sys.platform == "win32":
        subprocess.Popen(
            [python_path, agent_path],
            cwd=script_dir,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        print("✅ Agent started in background!")
    else:
        subprocess.Popen(
            [python_path, agent_path],
            cwd=script_dir,
            start_new_session=True
        )
        print("✅ Agent started!")

def stop_agent():
    """Stop running agent processes."""
    print("\n🛑 Stopping JARVIS agent...")
    
    if sys.platform == "win32":
        # Kill pythonw processes running our script
        result = subprocess.run(
            ["taskkill", "/f", "/im", "pythonw.exe"],
            capture_output=True
        )
        # Also try python.exe
        subprocess.run(
            ["taskkill", "/f", "/im", "python.exe", "/fi", "WINDOWTITLE eq JARVIS*"],
            capture_output=True
        )
    else:
        subprocess.run(["pkill", "-f", "jarvis_agent"], capture_output=True)
    
    print("✅ Agent stopped!")

def check_status():
    """Check if the agent is running."""
    print("\n📊 JARVIS Agent Status:")
    
    # Check Task Scheduler
    result = subprocess.run(
        ["schtasks", "/query", "/tn", SERVICE_NAME],
        capture_output=True, text=True
    )
    
    if result.returncode == 0:
        print("   ✅ Autostart: Enabled (Task Scheduler)")
    else:
        print("   ❌ Autostart: Not configured")
    
    # Check if process is running
    if sys.platform == "win32":
        result = subprocess.run(
            ["tasklist", "/fi", "imagename eq pythonw.exe"],
            capture_output=True, text=True
        )
        if "pythonw.exe" in result.stdout:
            print("   ✅ Agent: Running")
        else:
            print("   ❌ Agent: Not running")
    else:
        result = subprocess.run(["pgrep", "-f", "jarvis_agent"], capture_output=True)
        if result.returncode == 0:
            print("   ✅ Agent: Running")
        else:
            print("   ❌ Agent: Not running")

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    
    command = sys.argv[1].lower()
    
    if command == "install":
        if not is_admin():
            print("⚠️  Some features require Administrator privileges.")
            print("   Run as admin for full functionality.")
        install_task_scheduler()
        
    elif command == "uninstall":
        uninstall_task_scheduler()
        
    elif command == "start":
        start_agent()
        
    elif command == "stop":
        stop_agent()
        
    elif command == "status":
        check_status()
        
    else:
        print(f"Unknown command: {command}")
        print(__doc__)

if __name__ == "__main__":
    main()
