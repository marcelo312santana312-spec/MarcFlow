@echo off
chcp 65001 >nul
echo ==========================================
echo   Iniciando Banco de Dados e MarcFlow...
echo ==========================================
cd /d "C:\Users\marce\.gemini\antigravity\scratch\MarcFlow"
docker compose up -d db
npm run dev
pause
