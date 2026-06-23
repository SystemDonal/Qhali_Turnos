@echo off
setlocal
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
del "%STARTUP%\QhaliNahui Turnero.lnk" >nul 2>&1
echo.
echo Inicio automatico retirado.
pause
