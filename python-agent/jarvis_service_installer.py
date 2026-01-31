"""
JARVIS Windows Service Installer
================================
Creates a Windows Scheduled Task that starts the JARVIS agent
on system boot (before user login).

Run as Administrator:
    python jarvis_service_installer.py install
    python jarvis_service_installer.py uninstall
    python jarvis_service_installer.py status
"""

import os
import sys
import subprocess
import platform
from pathlib import Path

TASK_NAME = "JarvisAgent"
AGENT_SCRIPT = "jarvis_agent.pyw"


def get_agent_path() -> Path:
    """Get the full path to the agent script."""
    script_dir = Path(__file__).parent.absolute()
    return script_dir / AGENT_SCRIPT


def get_python_path() -> str:
    """Get the Python executable path."""
    return sys.executable


def is_admin() -> bool:
    """Check if running as administrator."""
    if platform.system() != "Windows":
        return os.geteuid() == 0
    
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except:
        return False


def install_service():
    """Install the Windows Scheduled Task."""
    if platform.system() != "Windows":
        print("❌ This installer is for Windows only.")
        print("   On Linux/macOS, use systemd or launchd.")
        return False
    
    if not is_admin():
        print("❌ Please run as Administrator!")
        print("   Right-click Command Prompt → Run as Administrator")
        return False
    
    agent_path = get_agent_path()
    python_path = get_python_path()
    
    if not agent_path.exists():
        print(f"❌ Agent script not found: {agent_path}")
        return False
    
    print(f"📦 Installing JARVIS service...")
    print(f"   Python: {python_path}")
    print(f"   Script: {agent_path}")
    
    # Create XML for the scheduled task
    xml_content = f'''<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>JARVIS PC Agent - Runs on boot for remote PC control</Description>
    <Author>JARVIS</Author>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </BootTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT5S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>pythonw.exe</Command>
      <Arguments>"{agent_path}"</Arguments>
      <WorkingDirectory>{agent_path.parent}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>'''
    
    # Save XML to temp file
    xml_path = Path(os.environ.get("TEMP", "/tmp")) / "jarvis_task.xml"
    with open(xml_path, "w", encoding="utf-16") as f:
        f.write(xml_content)
    
    # Delete existing task if present
    subprocess.run(
        ["schtasks", "/Delete", "/TN", TASK_NAME, "/F"],
        capture_output=True
    )
    
    # Create the task
    result = subprocess.run(
        ["schtasks", "/Create", "/TN", TASK_NAME, "/XML", str(xml_path), "/F"],
        capture_output=True,
        text=True
    )
    
    # Cleanup
    try:
        xml_path.unlink()
    except:
        pass
    
    if result.returncode == 0:
        print("✅ JARVIS service installed successfully!")
        print()
        print("   The agent will start automatically on:")
        print("   • System boot (before login)")
        print("   • User login")
        print()
        print("   To start now: schtasks /Run /TN JarvisAgent")
        print("   To stop:      schtasks /End /TN JarvisAgent")
        print("   To uninstall: python jarvis_service_installer.py uninstall")
        return True
    else:
        print(f"❌ Installation failed: {result.stderr}")
        return False


def uninstall_service():
    """Uninstall the Windows Scheduled Task."""
    if platform.system() != "Windows":
        print("❌ This installer is for Windows only.")
        return False
    
    if not is_admin():
        print("❌ Please run as Administrator!")
        return False
    
    print(f"🗑️  Uninstalling JARVIS service...")
    
    # Stop the task first
    subprocess.run(
        ["schtasks", "/End", "/TN", TASK_NAME],
        capture_output=True
    )
    
    # Delete the task
    result = subprocess.run(
        ["schtasks", "/Delete", "/TN", TASK_NAME, "/F"],
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print("✅ JARVIS service uninstalled successfully!")
        return True
    else:
        print(f"❌ Uninstall failed: {result.stderr}")
        return False


def check_status():
    """Check if the service is installed and running."""
    if platform.system() != "Windows":
        print("❌ This installer is for Windows only.")
        return
    
    result = subprocess.run(
        ["schtasks", "/Query", "/TN", TASK_NAME, "/V", "/FO", "LIST"],
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print("✅ JARVIS service is installed")
        print()
        
        # Parse status
        for line in result.stdout.split("\n"):
            if "Status:" in line:
                status = line.split(":")[-1].strip()
                if status == "Running":
                    print(f"   Status: 🟢 {status}")
                else:
                    print(f"   Status: 🔴 {status}")
            elif "Next Run Time:" in line:
                print(f"   {line.strip()}")
            elif "Last Run Time:" in line:
                print(f"   {line.strip()}")
    else:
        print("🔴 JARVIS service is NOT installed")
        print("   Run: python jarvis_service_installer.py install")


def start_service():
    """Start the service now."""
    if platform.system() != "Windows":
        print("❌ This is for Windows only.")
        return
    
    result = subprocess.run(
        ["schtasks", "/Run", "/TN", TASK_NAME],
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print("✅ JARVIS service started!")
    else:
        print(f"❌ Failed to start: {result.stderr}")


def stop_service():
    """Stop the service."""
    if platform.system() != "Windows":
        print("❌ This is for Windows only.")
        return
    
    result = subprocess.run(
        ["schtasks", "/End", "/TN", TASK_NAME],
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print("✅ JARVIS service stopped!")
    else:
        print(f"❌ Failed to stop: {result.stderr}")


def print_usage():
    print("""
JARVIS Windows Service Installer
=================================

Usage:
    python jarvis_service_installer.py <command>

Commands:
    install     Install the JARVIS service (requires Admin)
    uninstall   Uninstall the JARVIS service (requires Admin)
    status      Check if service is installed and running
    start       Start the service now
    stop        Stop the service

Examples:
    python jarvis_service_installer.py install
    python jarvis_service_installer.py status
""")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(0)
    
    command = sys.argv[1].lower()
    
    if command == "install":
        install_service()
    elif command == "uninstall":
        uninstall_service()
    elif command == "status":
        check_status()
    elif command == "start":
        start_service()
    elif command == "stop":
        stop_service()
    else:
        print(f"Unknown command: {command}")
        print_usage()
        sys.exit(1)
