@echo off
setlocal
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo Error: Bun is not installed or is not available on PATH.
  exit /b 1
)

set "HELP_EXIT=0"
set "ACTION=%~1"

if "%ACTION%"=="" goto help
if /I "%ACTION%"=="bootstrap" goto bootstrap
if /I "%ACTION%"=="bootstrap-db" goto bootstrap-db
if /I "%ACTION%"=="dev" goto dev
if /I "%ACTION%"=="dev-api" goto dev-api
if /I "%ACTION%"=="dev-web" goto dev-web

echo Error: Unknown command "%ACTION%".
set "HELP_EXIT=1"
goto help

:bootstrap
call bun run bootstrap
exit /b %errorlevel%

:bootstrap-db
call bun run bootstrap --with-db
exit /b %errorlevel%

:dev
call bun run dev
exit /b %errorlevel%

:dev-api
call bun run dev:api
exit /b %errorlevel%

:dev-web
call bun run dev:web
exit /b %errorlevel%

:help
echo Usage: herms.bat COMMAND
echo.
echo Commands:
echo   bootstrap      Install dependencies and prepare the local environment
echo   bootstrap-db   Bootstrap, migrate, and seed the configured database
echo   dev            Start the frontend and backend together
echo   dev-api        Start only the backend
echo   dev-web        Start only the frontend
echo.
echo Example: .\herms.bat bootstrap
exit /b %HELP_EXIT%
