@echo off
setlocal
cd /d "%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%TEMP%\qhali_inicio_auto.vbs"
(
  echo Set oWS = CreateObject^("WScript.Shell"^)
  echo sLinkFile = "%STARTUP%\QhaliNahui Turnero.lnk"
  echo Set oLink = oWS.CreateShortcut^(sLinkFile^)
  echo oLink.TargetPath = "%~dp0iniciar_turnero.bat"
  echo oLink.WorkingDirectory = "%~dp0"
  echo oLink.IconLocation = "%SystemRoot%\System32\shell32.dll,220"
  echo oLink.Description = "Inicio automático Qhali Ñahui"
  echo oLink.Save
) > "%VBS%"
cscript //nologo "%VBS%"
del "%VBS%" >nul 2>&1
echo.
echo Inicio automatico instalado.
echo El sistema se ejecutara al iniciar sesion en Windows.
pause
