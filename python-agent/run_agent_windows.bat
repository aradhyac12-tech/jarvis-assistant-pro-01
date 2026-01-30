@echo off
setlocal

REM JARVIS PC Agent v3.0 - Windows One-Click Runner
REM - Installs dependencies from requirements.txt
REM - Runs the agent (GUI mode by default)

cd /d "%~dp0"

echo ================================================
echo   JARVIS Agent v3.0 - Setup + Run
echo ================================================
echo.

echo Using Python:
where python
if errorlevel 1 (
  echo.
  echo X Python not found in PATH.
  echo Install Python 3.10-3.12 from https://python.org and re-run.
  pause
  exit /b 1
)

echo.
echo Installing dependencies...
python -m pip install -r requirements.txt --quiet
if errorlevel 1 (
  echo.
  echo X Dependency install failed.
  echo If you're on Python 3.13/3.14, install Python 3.10-3.12.
  pause
  exit /b 1
)

echo.
echo Starting agent...
REM Use .pyw for silent window-less operation, or .py for console
if exist jarvis_agent.pyw (
  start "" pythonw jarvis_agent.pyw
) else (
  python jarvis_agent.py
)

echo Agent started! You can close this window.
timeout /t 3
