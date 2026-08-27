@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
if not exist ".venv\Scripts\python.exe" (
  echo Ambiente nao instalado. Execute scripts\instalar.bat.
  exit /b 1
)
".venv\Scripts\python.exe" -m uvicorn server.app:app --host 127.0.0.1 --port 8765
