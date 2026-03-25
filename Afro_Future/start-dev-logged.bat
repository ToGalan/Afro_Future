@echo off
setlocal enabledelayedexpansion

cd /d "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future"

echo Server startup log > server-startup.txt
echo Starting at %date% %time% >> server-startup.txt

npm run dev 1>> server-startup.txt 2>&1

echo Server exited with code %errorlevel% >> server-startup.txt



