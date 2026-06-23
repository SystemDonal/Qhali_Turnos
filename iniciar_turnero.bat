@echo off
setlocal
title Qhali Nahui - Sistema de turnos
cd /d "%~dp0"

echo.
echo ===============================================
echo  QHALI NAHUI - SISTEMA DE TURNOS CLINICOS
echo ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en PATH.
  echo Instale Node.js LTS y vuelva a ejecutar este archivo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm no esta disponible. Reinstale Node.js LTS.
  pause
  exit /b 1
)

if not exist package.json (
  echo [ERROR] No se encontro package.json en esta carpeta.
  echo Ejecute este archivo desde la carpeta principal del sistema.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias por primera vez...
  echo Este proceso puede tardar unos minutos si es la primera ejecucion.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] No se pudieron instalar dependencias.
    pause
    exit /b 1
  )
  echo Dependencias instaladas correctamente.
)

echo Verificando dependencias instaladas...
node -e "require('express'); require('socket.io'); require('pg'); require('mssql'); console.log('Dependencias OK')" >nul 2>nul
if errorlevel 1 (
  echo [AVISO] Las dependencias estan incompletas o danadas. Reparando instalacion...
  echo Espere por favor. npm esta revisando y reparando node_modules...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] No se pudieron reparar dependencias.
    echo Cierre el servidor, revise la conexion a internet y ejecute npm install manualmente.
    pause
    exit /b 1
  )
  echo Reparacion de dependencias finalizada.
  node -e "require('express'); require('socket.io'); require('pg'); require('mssql'); console.log('Dependencias OK')" >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Las dependencias siguen danadas. Elimine node_modules y ejecute npm install.
    pause
    exit /b 1
  )
)

echo Verificando archivos principales...
call npm run check
if errorlevel 1 (
  echo [ERROR] Hay errores de sintaxis. Revise los mensajes anteriores.
  pause
  exit /b 1
)

netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo El sistema ya esta activo en http://localhost:3000
  echo Abriendo pantalla publica...
  start "" "http://localhost:3000/index.html"
  pause
  exit /b 0
)

echo.
echo Iniciando servidor en http://localhost:3000
echo La pantalla publica se abrira automaticamente.
echo Si el puerto 3000 esta ocupado, cierre otra instancia del turnero.
echo.

start "" cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:3000/index.html"
node server.js
set EXITCODE=%ERRORLEVEL%

echo.
echo El servidor se detuvo con codigo %EXITCODE%.
pause
exit /b %EXITCODE%
