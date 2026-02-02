@echo off
setlocal

REM JARVIS PC Agent - Windows One-Click Runner
REM - installs dependencies from requirements.txt
REM - runs the agent (background-friendly .pyw)

cd /d "%~dp0"

echo ================================================
echo   JARVIS Agent - Setup + Run
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
  echo If you're on Python 3.13+, install Python 3.10-3.12 and recreate your venv.
  pause
  exit /b 1
)

echo.
echo Starting agent...
pythonw jarvis_agent.pyw

echo.
echo Agent started in background. You can close this window.
pause
