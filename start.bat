@echo off
title MedBuddy - AI Medical Assistant
color 0B
echo.
echo  ============================================
echo    MedBuddy - AI Medical Assistant
echo  ============================================
echo.

if not exist "%~dp0node_modules" (
  echo  Installing dependencies (first time only)...
  echo.
  npm install
  echo.
)

echo  Checking API key...
findstr /C:"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" "%~dp0.env" >nul 2>&1
if %errorlevel%==0 (
  echo.
  echo  WARNING: Your GROQ_API_KEY is not set!
  echo  Please open the .env file and replace:
  echo    your_groq_api_key_here
  echo  with your actual key from: https://console.groq.com/keys
  echo.
  echo  Press any key to start anyway (AI features won't work without key)...
  pause >nul
)

echo.
echo  Starting MedBuddy...
echo  Open your browser at: http://localhost:3000
echo.
echo  Press Ctrl+C to stop the server.
echo.
node "%~dp0server.js"
pause
