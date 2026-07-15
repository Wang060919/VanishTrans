@echo off
echo ========================================
echo   VanishTrans - Starting Dev Server...
echo ========================================
cd /d "%~dp0"
pnpm tauri dev
pause
