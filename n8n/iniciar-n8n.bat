@echo off
chcp 65001 >nul
title MarcFlow - Servidor n8n Local em Portugues (Docker - Porta 5678)
echo ========================================================
echo   Verificando container Docker marcflow-n8n (Porta 5678)
echo   Painel Web (PT-BR): http://localhost:5678
echo   Webhook ML: http://localhost:5678/webhook/meli-affiliate
echo ========================================================
echo.
docker start marcflow-n8n 2>nul || docker run -d --restart unless-stopped --name marcflow-n8n -p 5678:5678 --dns 8.8.8.8 --dns 1.1.1.1 -e TZ="America/Sao_Paulo" -e GENERIC_TIMEZONE="America/Sao_Paulo" -e N8N_HOST="localhost" -e N8N_PORT="5678" -e N8N_PROTOCOL="http" -e WEBHOOK_URL="http://localhost:5678/" -v marcflow_n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n

if exist "%~dp0pt-br\app-CPTfHB2X.js" (
    echo Aplicando pacote de traducao nativo Portugues Brasil (PT-BR)...
    docker cp "%~dp0pt-br\app-CPTfHB2X.js" "marcflow-n8n:/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-editor-ui@file++++home+runner+_work+n8n+n8n+packages+frontend+editor-ui/node_modules/n8n-editor-ui/dist/assets/app-CPTfHB2X.js" >nul 2>&1
    docker cp "%~dp0pt-br\index.mjs" "marcflow-n8n:/usr/local/lib/node_modules/n8n/node_modules/.pnpm/@n8n+i18n@file++++home+runner+_work+n8n+n8n+packages+frontend+@n8n+i18n/node_modules/@n8n/i18n/dist/index.mjs" >nul 2>&1
    docker cp "%~dp0pt-br\posthog.init.js" "marcflow-n8n:/usr/local/lib/node_modules/n8n/node_modules/.pnpm/n8n-editor-ui@file++++home+runner+_work+n8n+n8n+packages+frontend+editor-ui/node_modules/n8n-editor-ui/dist/static/posthog.init.js" >nul 2>&1
    rem Garante que o cache publico pertence ao usuario "node" (evita erro EACCES na inicializacao)
    docker exec -u root marcflow-n8n chown -R node:node /home/node/.cache/n8n >nul 2>&1
    docker restart marcflow-n8n >nul 2>&1
)

echo.
echo Servidor n8n (Portugues Brasil) ativo em: http://localhost:5678
start http://localhost:5678
pause
