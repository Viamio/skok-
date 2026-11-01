@echo off
cd /d "%~dp0"
title SKOK - serwer gry
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Nie znaleziono Node.js.
  echo  Zainstaluj go ze strony https://nodejs.org  - wersja LTS,
  echo  potem uruchom ponownie komputer i kliknij START.bat jeszcze raz.
  echo.
  pause
  exit /b
)
if not exist "server\server.js" (
  echo.
  echo  START.bat musi lezec w folderze gry, obok folderow server, public i shared.
  echo  Rozpakuj caly plik ZIP i uruchom START.bat z rozpakowanego folderu.
  echo.
  pause
  exit /b
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server\launch.js
echo.
echo  Serwer zostal zatrzymany. Jesli widzisz blad powyzej, zrob zrzut ekranu.
pause
