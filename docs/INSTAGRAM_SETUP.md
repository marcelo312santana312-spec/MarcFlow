# Guia de Configuração do Módulo de Instagram (MarcFlow)

Este guia explica como configurar o app oficial da Meta (**Instagram API with Instagram Login**) para que você e seus clientes possam conectar contas profissionais e agendar **Posts (Feed), Carrosséis, Reels e Stories** diretamente no MarcFlow.

---

## Pré-requisitos

1. **Conta Instagram Profissional** (Comercial ou Criador de Conteúdo) para cada cliente que for conectar.
2. **URL pública HTTPS** apontando para o servidor MarcFlow (ex.: via Cloudflare Tunnel, Nginx ou domínio próprio `https://seu-dominio.com`).
   - A Meta baixa as imagens e vídeos através de URL pública HTTPS assinada (`/api/instagram/media/[filename]`). Em `http://localhost`, o upload e a pré-visualização funcionam normalmente, mas a publicação na Meta exige `BASE_URL="https://..."`.
3. **1 App gratuito no Meta for Developers** (configurado uma única vez por você, dono do sistema).

---

## Passo 1: Criar o App na Meta

1. Acesse [Meta for Developers](https://developers.facebook.com/apps/) e clique em **Create App** (*Criar aplicativo*).
2. Em caso de uso (*Use case*), selecione **Other** (*Outro*) ou **Manage messaging & content on Instagram** → Tipo **Business**.
3. Dê um nome ao app (ex.: `MarcFlow Agendador`) e finalize a criação.
4. No menu lateral do app, adicione o produto **Instagram** e abra **API setup with Instagram login** (*Configuração da API com login do Instagram*).

---

## Passo 2: Configurar Redirect URI e Permissões

1. Na seção **Business Login settings** (*Configurações de login empresarial*), adicione em **Valid OAuth Redirect URIs**:
   ```text
   https://SEU-DOMINIO-PUBLICO/api/instagram/callback
   ```
   *(Substitua `SEU-DOMINIO-PUBLICO` pelo mesmo endereço configurado em `BASE_URL` no `.env`.)*
2. Copie o **Instagram App ID** e o **Instagram App Secret** exibidos nessa mesma página.
3. Certifique-se de incluir as permissões:
   - `instagram_business_basic`
   - `instagram_business_content_publish`

---

## Passo 3: Configurar o `.env` e Atualizar o Banco

Edite o arquivo `.env` na raiz do MarcFlow:

```env
BASE_URL="https://SEU-DOMINIO-PUBLICO"
NEXT_PUBLIC_APP_URL="${BASE_URL}"

INSTAGRAM_APP_ID="SEU_INSTAGRAM_APP_ID"
INSTAGRAM_APP_SECRET="SEU_INSTAGRAM_APP_SECRET"
INSTAGRAM_REDIRECT_URI="${BASE_URL}/api/instagram/callback"
INSTAGRAM_GRAPH_VERSION="v22.0"
```

Depois, aplique as novas tabelas (`InstagramAccount` e `InstagramPost`) no MySQL e reinicie o servidor:

```bash
npm run db:push
npm run dev
```

---

## Passo 4: Como liberar para Clientes Externos (App Review)

- Enquanto o app da Meta estiver em **Modo de Desenvolvimento**, apenas contas cadastradas como **Instagram Testers** (em *App Roles → Roles → Add Instagram Testers*, aceitando o convite no app/site do Instagram em *Apps and Websites → Tester Invites*) conseguem conectar e publicar.
- Para liberar qualquer cliente automaticamente sem precisar convidá-lo como tester:
  1. Preencha os dados básicos do app em **Settings → Basic** (Ícone, Política de Privacidade `/privacy`, Termos `/terms`).
  2. Solicite o **App Review** para `instagram_business_basic` e `instagram_business_content_publish` enviando um vídeo curto demonstrando o fluxo no MarcFlow (`/dashboard/instagram`).
  3. Alterne o app de **Development** para **Live**.

---

## Formatos de Mídia Suportados pela Meta

- **Feed (Foto):** JPG ou PNG (até 8 MB recomendado).
- **Carrossel:** 2 a 10 itens (JPG, PNG ou MP4/MOV).
- **Stories:** JPG, PNG ou MP4/MOV (proporção recomendada `9:16`).
- **Reels:** Vídeo MP4 ou MOV (até 100 MB no upload do MarcFlow, proporção recomendada `9:16`).
- **Renovação de Token:** Os tokens OAuth duram 60 dias e o agendador do MarcFlow os renova automaticamente quando faltam menos de 7 dias para vencer.
