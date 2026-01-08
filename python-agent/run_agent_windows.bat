@echo off
setlocal

REM JARVIS PC Agent - Windows One-Click Runner
REM - installs dependencies from requirements.txt
REM - sets backend URL/key for this agent session
REM - runs the agent

cd /d "%~dp0"

echo ================================================
echo   JARVIS Agent - Setup + Run
echo ================================================
echo.

REM Configure backend connection (edit if needed)
set "JARVIS_SUPABASE_URL=https://wxemscrgximbsrynoxzp.supabase.co"
set "JARVIS_SUPABASE_KEY=sb_publishable_oM9g3ms-V7Wm9N3Xziv3wQ_udPmV304"

echo Using Python:
where python
if errorlevel 1 (
  echo.
  echo ❌ Python not found in PATH.
  echo Install Python 3.10-3.12 from https://python.org and re-run.
  pause
  exit /b 1
)

echo.
echo Installing dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo ❌ Dependency install failed.
  echo If you're on Python 3.13/3.14, install Python 3.10-3.12 and recreate your venv.
  pause
  exit /b 1
)

echo.
echo Starting agent...
python jarvis_agent.py

pause
