@echo off
chcp 65001 >nul
title FUNNELTRON - Servidores rodando

echo ========================================
echo  FUNNELTRON - Backend + Frontend
echo ========================================
echo.
echo Iniciando Backend (porta 8000)...
cd /d "F:\agentes ia\funeltron\FUNNELTRON\backend"
start "FUNNELTRON Backend" cmd /k "python run_dev.py"

timeout /t 3 /nobreak >nul

echo Iniciando Frontend (porta 5173)...
cd /d "F:\agentes ia\funeltron\FUNNELTRON\frontend"
start "FUNNELTRON Frontend" cmd /k "npm run dev"

timeout /t 4 /nobreak >nul

echo.
echo Abrindo no navegador...
start "" "http://localhost:5173"

echo.
echo ========================================
echo  PRONTO! Acesse: http://localhost:5173
echo ========================================
echo.
echo As janelas dos servidores estao abertas acima.
echo Nao feche elas - sao os servidores rodando.
echo.
pause