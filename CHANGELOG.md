# Changelog

## [Não lançado]

- **Módulo de Instagram (Posts, Carrossel, Reels e Stories)**: integração oficial via *Instagram API with Instagram Login* com fluxo OAuth multiusuário (`/api/instagram/auth` e `/callback`), criptografia AES-256-GCM para tokens com renovação automática, upload e entrega via URL assinada por HMAC (`/api/instagram/media/[filename]`), worker agendador em segundo plano (`src/modules/instagram/scheduler.ts`) e painel completo em `/dashboard/instagram` com pré-visualização, suporte a Feed, Carrossel, Reels e Stories.
- **Login com Google (OAuth)**: integração do Google OAuth via NextAuth v5. O botão "Entrar com Google" aparece na tela de login quando `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. Suporte a criação automática de conta para novos usuários Google (controlado por `GOOGLE_ALLOW_NEW_USERS`).
- **Suporte Multiplataforma**: inclusão de `cross-env` nos scripts do `package.json` (`dev`, `build`, `start`) para execução universal e correção do `iniciar.bat` para caminho dinâmico (`%~dp0`).
- **Aprimoramento do Docker**: migração do `Dockerfile` para Node.js 22 LTS e instalação do pacote `ffmpeg`, garantindo compatibilidade no envio de notas de voz em contêineres.
- **Localização Brasileira**: padronização de fuso horário (`America/Sao_Paulo`), localidade (`pt-BR`) e DDI padrão no `.env.example`, `docker-compose.yml` e `jid-utils`.
- **Testes Automatizados**: inclusão de script `npm test` usando o runner nativo do Node/TSX e testes unitários em `src/lib/__tests__/jid-utils.test.ts`.
- Nova aba **Exportar conversas**: seleção de várias conversas (ou todas), sincronização do histórico e download de um ZIP com TXT por conversa, áudios originais, mídias opcionais, índice e relatório do que ficou indisponível.

## [1.0.0] - 2026-10-18

Primeira versão do **MarcFlow**, criado por Marcos Maia ([@marcolamaia](https://instagram.com/marcolamaia)).

- Construtor visual de fluxos de conversa, com simulador e configurações do robô
- Transmissões com variáveis, mídia, agendamento, controle de envio e lista de saída
- Grupos com categorias, ações em lote, sair e apagar de verdade e criação de grupos
- Respostas rápidas na conversa
- Notas de voz compatíveis com iPhone
- API REST, webhooks e documentação interativa em `/docs`
