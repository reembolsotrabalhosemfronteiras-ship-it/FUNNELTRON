@echo off
chcp 65001 >nul
title FUNNELTRON - Servidor Local

echo ========================================
echo   FUNNELTRON - Iniciando ambiente local
echo ========================================
echo.

:: Verifica se o venv existe
if not exist "backend\.venv\Scripts\python.exe" (
    echo [ERRO] Virtualenv do backend nao encontrada em backend\.venv
    echo Execute: python -m venv backend\.venv && backend\.venv\Scripts\pip install -r backend\requirements.txt
    pause
    exit /b 1
)

:: Inicia o backend em uma nova janela
echo [1/3] Iniciando backend (porta 8000)...
start "FUNNELTRON Backend" cmd /k "cd /d "%~dp0backend" && .\.venv\Scripts\python.exe run_dev.py"

:: Aguarda o backend ficar disponivel
echo [2/3] Aguardando backend responder...
:wait_backend
timeout /t 2 /nobreak >nul
powershell -Command "try { $null = Invoke-WebRequest -Uri 'http://localhost:8000/docs' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo       Ainda aguardando...
    goto wait_backend
)
echo       Backend pronto!

:: Inicia o frontend em uma nova janela (forca porta 5173)
echo [3/3] Iniciando frontend (porta 5173)...
start "FUNNELTRON Frontend" cmd /k "cd /d "%~dp0frontend" && set PORT= && npx vite --port 5173 --strictPort"

:: Aguarda o frontend ficar disponivel
echo.
echo       Aguardando frontend responder...
:wait_frontend
timeout /t 2 /nobreak >nul
powershell -Command "try { $null = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo       Ainda aguardando...
    goto wait_frontend
)
echo       Frontend pronto!

:: Abre o navegador
echo.
echo ========================================
echo   Sistema pronto! Abrindo navegador...
echo   http://localhost:5173
echo ========================================
echo.
start http://localhost:5173

echo As janelas do backend e frontend foram mantidas abertas para debug.
echo Pressione qualquer tecla para encerrar este script (os servidores continuarao rodando).
pause >nul