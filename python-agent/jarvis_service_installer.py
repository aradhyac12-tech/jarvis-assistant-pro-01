"""
JARVIS Universal Service Installer
====================================
Installs the JARVIS PC Agent as a persistent background service on:
  • Windows 7/8/10/11  → Windows Task Scheduler (boot task, no login required)
  • macOS 11+          → launchd LaunchAgent (user-session autostart)
  • Linux (systemd)    → systemd user service  (Ubuntu 16+, Fedora, Arch, etc.)
  • Linux (SysV/init)  → /etc/init.d script fallback (older distros)

Usage:
    python jarvis_service_installer.py install
    python jarvis_service_installer.py uninstall
    python jarvis_service_installer.py status
    python jarvis_service_installer.py restart

Run with admin/sudo for Windows/Linux system-level install.
macOS launchd user agent does NOT require sudo.
"""

import os
import sys
import subprocess
import platform
import textwrap
from pathlib import Path

TASK_NAME   = "JarvisAgent"
SERVICE_ID  = "com.jarvis.agent"          # macOS launchd label
SYSTEMD_SVC = "jarvis-agent"             # systemd unit name

AGENT_SCRIPT = "jarvis_agent.py"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_agent_path() -> Path:
    return Path(__file__).parent.absolute() / AGENT_SCRIPT


def get_python() -> str:
    return sys.executable


def is_admin() -> bool:
    sys_name = platform.system()
    if sys_name == "Windows":
        try:
            import ctypes
            return ctypes.windll.shell32.IsUserAnAdmin() != 0
        except Exception:
            return False
    else:
        return os.geteuid() == 0


def run(cmd: list, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


# ─────────────────────────────────────────────────────────────────────────────
# Windows — Task Scheduler
# ─────────────────────────────────────────────────────────────────────────────

def _windows_install():
    if not is_admin():
        print("❌ Run as Administrator for Windows service install.")
        print("   Right-click Command Prompt → Run as Administrator")
        return False

    agent  = get_agent_path()
    python = get_python()

    if not agent.exists():
        print(f"❌ Agent not found: {agent}")
        return False

    # Detect pythonw.exe for silent (no console window) execution
    pythonw = Path(python).parent / "pythonw.exe"
    exe = str(pythonw) if pythonw.exists() else python

    xml = textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-16"?>
        <Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
          <RegistrationInfo>
            <Description>JARVIS PC Agent — remote control daemon</Description>
          </RegistrationInfo>
          <Triggers>
            <BootTrigger><Enabled>true</Enabled></BootTrigger>
            <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
          </Triggers>
          <Principals>
            <Principal id="Author">
              <LogonType>InteractiveToken</LogonType>
              <RunLevel>HighestAvailable</RunLevel>
            </Principal>
          </Principals>
          <Settings>
            <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
            <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
            <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
            <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
            <RestartOnFailure>
              <Interval>PT1M</Interval>
              <Count>999</Count>
            </RestartOnFailure>
          </Settings>
          <Actions>
            <Exec>
              <Command>{exe}</Command>
              <Arguments>"{agent}" --headless</Arguments>
              <WorkingDirectory>{agent.parent}</WorkingDirectory>
            </Exec>
          </Actions>
        </Task>
    """)

    xml_path = agent.parent / "_jarvis_task.xml"
    xml_path.write_text(xml, encoding="utf-16")

    r = run(["schtasks", "/Create", "/TN", TASK_NAME,
              "/XML", str(xml_path), "/F"])
    xml_path.unlink(missing_ok=True)

    if r.returncode == 0:
        print(f"✅ Task '{TASK_NAME}' created. Agent will start on next boot/login.")
        # Also start it now
        run(["schtasks", "/Run", "/TN", TASK_NAME])
        print("▶  Agent started now.")
        return True
    else:
        print(f"❌ Task creation failed:\n{r.stderr}")
        return False


def _windows_uninstall():
    r = run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"])
    if r.returncode == 0:
        print(f"✅ Task '{TASK_NAME}' removed.")
    else:
        print(f"⚠️  {r.stderr.strip() or 'Task not found.'}")


def _windows_status():
    r = run(["schtasks", "/Query", "/TN", TASK_NAME, "/FO", "LIST"])
    if r.returncode == 0:
        print(r.stdout)
    else:
        print(f"Task '{TASK_NAME}' not found.")


def _windows_restart():
    run(["schtasks", "/End", "/TN", TASK_NAME])
    r = run(["schtasks", "/Run", "/TN", TASK_NAME])
    if r.returncode == 0:
        print("✅ Agent restarted.")
    else:
        print(f"❌ Restart failed: {r.stderr}")


# ─────────────────────────────────────────────────────────────────────────────
# macOS — launchd LaunchAgent (no sudo needed — user session)
# ─────────────────────────────="────────────────────────────────────────────────
LAUNCHD_PLIST_DIR = Path.home() / "Library" / "LaunchAgents"
LAUNCHD_PLIST     = LAUNCHD_PLIST_DIR / f"{SERVICE_ID}.plist"


def _macos_install():
    agent  = get_agent_path()
    python = get_python()

    if not agent.exists():
        print(f"❌ Agent not found: {agent}")
        return False

    LAUNCHD_PLIST_DIR.mkdir(parents=True, exist_ok=True)

    plist = textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
            "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>          <string>{SERVICE_ID}</string>
            <key>ProgramArguments</key>
            <array>
                <string>{python}</string>
                <string>{agent}</string>
                <string>--headless</string>
            </array>
            <key>WorkingDirectory</key> <string>{agent.parent}</string>
            <key>RunAtLoad</key>        <true/>
            <key>KeepAlive</key>        <true/>
            <key>ThrottleInterval</key> <integer>10</integer>
            <key>StandardOutPath</key>  <string>{agent.parent}/jarvis_stdout.log</string>
            <key>StandardErrorPath</key><string>{agent.parent}/jarvis_stderr.log</string>
        </dict>
        </plist>
    """)

    LAUNCHD_PLIST.write_text(plist)
    r = run(["launchctl", "load", "-w", str(LAUNCHD_PLIST)])
    if r.returncode == 0:
        print(f"✅ LaunchAgent '{SERVICE_ID}' loaded. Agent starts on login.")
        return True
    else:
        print(f"❌ launchctl load failed:\n{r.stderr}")
        return False


def _macos_uninstall():
    if LAUNCHD_PLIST.exists():
        run(["launchctl", "unload", str(LAUNCHD_PLIST)])
        LAUNCHD_PLIST.unlink()
        print(f"✅ LaunchAgent '{SERVICE_ID}' removed.")
    else:
        print("⚠️  LaunchAgent plist not found.")


def _macos_status():
    r = run(["launchctl", "list", SERVICE_ID])
    if r.returncode == 0:
        print(r.stdout or f"'{SERVICE_ID}' is loaded.")
    else:
        print(f"'{SERVICE_ID}' is not loaded.")


def _macos_restart():
    run(["launchctl", "stop", SERVICE_ID])
    import time; time.sleep(1)
    run(["launchctl", "start", SERVICE_ID])
    print("✅ Agent restarted via launchd.")


# ─────────────────────────────────────────────────────────────────────────────
# Linux — systemd user service (preferred) or SysV init fallback
# ─────────────────────────────────────────────────────────────────────────────
SYSTEMD_USER_DIR  = Path.home() / ".config" / "systemd" / "user"
SYSTEMD_UNIT_FILE = SYSTEMD_USER_DIR / f"{SYSTEMD_SVC}.service"

SYSV_INIT_PATH    = Path(f"/etc/init.d/{SYSTEMD_SVC}")


def _has_systemd() -> bool:
    return run(["systemctl", "--version"]).returncode == 0


def _linux_install():
    agent  = get_agent_path()
    python = get_python()

    if not agent.exists():
        print(f"❌ Agent not found: {agent}")
        return False

    if _has_systemd():
        return _linux_install_systemd(agent, python)
    else:
        return _linux_install_sysv(agent, python)


def _linux_install_systemd(agent: Path, python: str) -> bool:
    SYSTEMD_USER_DIR.mkdir(parents=True, exist_ok=True)

    unit = textwrap.dedent(f"""\
        [Unit]
        Description=JARVIS PC Agent — remote control daemon
        After=network-online.target
        Wants=network-online.target

        [Service]
        Type=simple
        ExecStart={python} {agent} --headless
        WorkingDirectory={agent.parent}
        Restart=always
        RestartSec=10
        StandardOutput=journal
        StandardError=journal
        Environment=DISPLAY=:0
        Environment=XAUTHORITY={Path.home()}/.Xauthority

        [Install]
        WantedBy=default.target
    """)

    SYSTEMD_UNIT_FILE.write_text(unit)
    run(["systemctl", "--user", "daemon-reload"])
    r = run(["systemctl", "--user", "enable", "--now", SYSTEMD_SVC])
    if r.returncode == 0:
        print(f"✅ systemd user service '{SYSTEMD_SVC}' enabled and started.")
        print("   Logs: journalctl --user -u jarvis-agent -f")
        # Enable lingering so service runs even without active login session
        run(["loginctl", "enable-linger", os.environ.get("USER", "")])
        return True
    else:
        print(f"❌ systemd enable failed:\n{r.stderr}")
        return False


def _linux_install_sysv(agent: Path, python: str) -> bool:
    """Fallback for distros without systemd (e.g., Debian 7, older Ubuntu)."""
    if not is_admin():
        print("❌ sudo required for SysV init install.")
        return False

    script = textwrap.dedent(f"""\
        #!/bin/sh
        ### BEGIN INIT INFO
        # Provides:          jarvis-agent
        # Required-Start:    $network $remote_fs
        # Required-Stop:     $network $remote_fs
        # Default-Start:     2 3 4 5
        # Default-Stop:      0 1 6
        # Short-Description: JARVIS PC Agent
        ### END INIT INFO

        DAEMON="{python}"
        DAEMON_ARGS="{agent} --headless"
        PIDFILE=/var/run/jarvis-agent.pid
        NAME=jarvis-agent

        case "$1" in
          start)
            start-stop-daemon --start --background --make-pidfile --pidfile $PIDFILE \\
              --exec $DAEMON -- $DAEMON_ARGS
            echo "$NAME started."
            ;;
          stop)
            start-stop-daemon --stop --pidfile $PIDFILE
            echo "$NAME stopped."
            ;;
          restart)
            $0 stop; sleep 2; $0 start
            ;;
          status)
            start-stop-daemon --status --pidfile $PIDFILE && echo "$NAME running" || echo "$NAME stopped"
            ;;
          *)
            echo "Usage: $0 {{start|stop|restart|status}}"
            exit 1
            ;;
        esac
    """)

    SYSV_INIT_PATH.write_text(script)
    SYSV_INIT_PATH.chmod(0o755)
    run(["update-rc.d", str(SYSV_INIT_PATH.name), "defaults"])
    r = run(["service", str(SYSV_INIT_PATH.name), "start"])
    if r.returncode == 0:
        print(f"✅ SysV init script installed and started.")
        return True
    else:
        print(f"❌ SysV start failed:\n{r.stderr}")
        return False


def _linux_uninstall():
    if _has_systemd() and SYSTEMD_UNIT_FILE.exists():
        run(["systemctl", "--user", "disable", "--now", SYSTEMD_SVC])
        SYSTEMD_UNIT_FILE.unlink()
        run(["systemctl", "--user", "daemon-reload"])
        print(f"✅ systemd service '{SYSTEMD_SVC}' removed.")
    elif SYSV_INIT_PATH.exists():
        run(["service", SYSTEMD_SVC, "stop"])
        run(["update-rc.d", "-f", SYSTEMD_SVC, "remove"])
        SYSV_INIT_PATH.unlink()
        print(f"✅ SysV init script removed.")
    else:
        print("⚠️  No service found to remove.")


def _linux_status():
    if _has_systemd():
        r = run(["systemctl", "--user", "status", SYSTEMD_SVC])
        print(r.stdout or r.stderr)
    else:
        run(["service", SYSTEMD_SVC, "status"])


def _linux_restart():
    if _has_systemd():
        r = run(["systemctl", "--user", "restart", SYSTEMD_SVC])
        print("✅ Restarted." if r.returncode == 0 else f"❌ {r.stderr}")
    else:
        run(["service", SYSTEMD_SVC, "restart"])
        print("✅ Restarted via SysV init.")


# ─────────────────────────────────────────────────────────────────────────────
# Dispatcher
# ─────────────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("install", "uninstall", "status", "restart"):
        print(__doc__)
        print(f"\nUsage: python {Path(__file__).name} <install|uninstall|status|restart>")
        sys.exit(1)

    action = sys.argv[1]
    sys_name = platform.system()

    print(f"JARVIS Service Installer — {sys_name} — action: {action}")
    print(f"Python: {get_python()}")
    print(f"Agent:  {get_agent_path()}")
    print()

    if sys_name == "Windows":
        {"install": _windows_install, "uninstall": _windows_uninstall,
         "status": _windows_status, "restart": _windows_restart}[action]()
    elif sys_name == "Darwin":
        {"install": _macos_install, "uninstall": _macos_uninstall,
         "status": _macos_status, "restart": _macos_restart}[action]()
    elif sys_name == "Linux":
        {"install": _linux_install, "uninstall": _linux_uninstall,
         "status": _linux_status, "restart": _linux_restart}[action]()
    else:
        print(f"❌ Unsupported platform: {sys_name}")
        sys.exit(1)


if __name__ == "__main__":
    main()
