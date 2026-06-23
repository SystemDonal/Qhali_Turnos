@echo off
cd /d "%~dp0"
node server.js >> servidor.out.log 2>> servidor.err.log
