@echo off
title iCloud Album Downloader Server
echo ============================================================
echo   Memulai iCloud Album Downloader Web Server...
echo   Server sedang berjalan di http://localhost:5000
echo   (JANGAN TUTUP JENDELA INI SELAMA ANDA MENDOWNLOAD)
echo ============================================================
echo.

:: Pindah ke folder project
cd /d "%~dp0"

:: Buka browser secara otomatis
start http://localhost:5000

:: Jalankan server Python
python app.py

pause
