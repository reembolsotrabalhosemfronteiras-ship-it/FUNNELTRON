@echo off
chcp 65001 >nul
title FUNNELTRON - Iniciando servidores

echo ========================================
echo  FUNNELTRON - Iniciando Backend + Frontend
echo ========================================
echo.

REM Iniciar Backend na porta 8000
cd /d "F:\agentes ia\funeltron\FUNNELTRON\backend"
start "FUNNELTRON Backend" cmd /k "python run_dev.py"

REM Aguardar backend subir
timeout /t 3 /nobreak >nul

REM Iniciar Frontend na porta 5173
cd /d "F:\agentes ia\funeltron\FUNNELTRON\frontend"
start "FUNNELTRON Frontend" cmd /k "npm run dev"

REM Aguardar frontend subir
timeout /t 4 /nobreak >nul

REM Abrir no navegador
start "" "http://localhost:5173"

echo.
echo ========================================
echo  Servidores rodando!
echo  Frontend: http://localhost:5173
echo  Backend:  http://localhost:8000
echo ========================================
echo.
echo Feche esta janela quando quiser parar os servidores.
pause