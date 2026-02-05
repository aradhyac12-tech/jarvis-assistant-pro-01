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

REM Backend connection:
REM - jarvis_agent.py ships with a default backend for this project.
REM - To override, set JARVIS_SUPABASE_URL and JARVIS_SUPABASE_KEY before running this .bat.

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

echo.
echo Choose mode:
echo   [1] GUI (recommended)
echo   [2] Console
set /p JARVIS_MODE="Enter 1 or 2: "

if "%JARVIS_MODE%"=="2" (
  python jarvis_agent.py
) else (
  where pythonw >nul 2>nul
  if errorlevel 1 (
    echo.
    echo ⚠️ pythonw.exe not found - starting GUI with python.exe
    python jarvis_agent.py --gui
  ) else (
    pythonw jarvis_agent.py --gui
  )
)

pause
