@echo off
cd /d "%~dp0"
echo Probando conexion SQL Server del Turnero Qhali Nahui...
node -e "const {createSqlService}=require('./src/services/sqlserver'); const s=createSqlService('./config/sqlserver.json'); s.diagnose().then(r=>{console.log(JSON.stringify(r,null,2)); process.exit(r.ok?0:1)}).catch(e=>{console.error(e); process.exit(1)})"
pause
