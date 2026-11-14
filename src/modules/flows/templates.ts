import type { FlowGraph } from "./types";

export interface FlowTemplate {
    id: string;
    name: string;
    niche: string;
    description: string;
    badge: string;
    trigger: {
        type: "FIRST_MESSAGE" | "KEYWORD" | "ANY_MESSAGE";
        keyword?: string;
        matchType?: "EXACT" | "CONTAINS";
    };
    graph: FlowGraph;
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
    {
        id: "clinica-estetica",
        name: "Clínica & Estética — Triagem e Agendamento",
        niche: "Clínica & Estética",
        badge: "Alta conversão",
        description: "Recepciona o paciente, identifica o procedimento desejado, coleta horário preferido, qualifica com IA e avisa a recepção.",
        trigger: { type: "FIRST_MESSAGE" },
        graph: {
            nodes: [
                { id: "start", type: "start", position: { x: 60, y: 180 }, data: {} },
                {
                    id: "boas_vindas",
                    type: "content",
                    position: { x: 320, y: 140 },
                    data: {
                        name: "Boas-vindas",
                        items: [
                            {
                                id: "c1",
                                kind: "text",
                                text: "Olá, {primeiro-nome}! Seja bem-vindo(a) à nossa clínica ✨\nSerá um prazer cuidar de você.",
                            },
                            { id: "c2", kind: "delay", seconds: 2, typing: true },
                        ],
                    },
                },
                {
                    id: "menu_proc",
                    type: "menu",
                    position: { x: 660, y: 100 },
                    data: {
                        name: "Procedimento",
                        mode: "number",
                        question: "Qual procedimento você gostaria de saber mais ou agendar?",
                        invalidText: "Por favor, responda apenas com o número da opção desejada (1 a 4).",
                        maxErrors: 3,
                        expireValue: 1,
                        expireUnit: "days",
                        options: [
                            { id: "opt_limpeza", text: "Limpeza de Pele & Facial" },
                            { id: "opt_harm", text: "Harmonização / Botox" },
                            { id: "opt_depil", text: "Depilação a Laser" },
                            { id: "opt_aval", text: "Avaliação Personalizada" },
                        ],
                    },
                },
                {
                    id: "coleta_horario",
                    type: "content",
                    position: { x: 1040, y: 120 },
                    data: {
                        name: "Coleta de preferência",
                        items: [
                            {
                                id: "in_turno",
                                kind: "input",
                                question: "Perfeito! Para agilizar seu agendamento, qual dia da semana e período (manhã ou tarde) você prefere?",
                                answerType: "text",
                                fieldKey: "preferencia-agendamento",
                                fieldScope: "CONTACT",
                                expireValue: 1,
                                expireUnit: "days",
                                errorMessage: "Por favor, me diga o dia e período de sua preferência.",
                                maxAttempts: 2,
                            },
                        ],
                    },
                },
                {
                    id: "ia_qualifica",
                    type: "action",
                    position: { x: 1400, y: 120 },
                    data: {
                        name: "Qualificação IA & Aviso",
                        actions: [
                            {
                                id: "a_ia",
                                type: "ai_qualifier",
                                provider: "auto",
                                systemPrompt:
                                    "Você é a consultora virtual de uma clínica de estética. Analise a conversa com {nome-completo} ({telefone}) e a preferência informada ({preferencia-agendamento}). Gere um resumo objetivo em 2 linhas com: procedimento de interesse, urgência (Alta/Média/Baixa) e melhor horário sugerido.",
                                saveFieldKey: "resumo-qualificacao-ia",
                                saveFieldScope: "CONTACT",
                                replyToContact: false,
                            },
                            {
                                id: "a_pause",
                                type: "pauseAutomation",
                                forever: false,
                                value: 30,
                                unit: "minutes",
                            },
                        ],
                    },
                },
                {
                    id: "confirmacao",
                    type: "content",
                    position: { x: 1740, y: 120 },
                    data: {
                        name: "Confirmação",
                        items: [
                            {
                                id: "c_fim",
                                kind: "text",
                                text: "Anotado, {primeiro-nome}! 💚 Nossa equipe de atendimento já recebeu sua preferência ({preferencia-agendamento}) e vai confirmar os horários disponíveis com você em instantes.",
                            },
                        ],
                    },
                },
            ],
            edges: [
                { id: "e1", source: "start", sourceHandle: "next", target: "boas_vindas" },
                { id: "e2", source: "boas_vindas", sourceHandle: "next", target: "menu_proc" },
                { id: "e3", source: "menu_proc", sourceHandle: "option:opt_limpeza", target: "coleta_horario" },
                { id: "e4", source: "menu_proc", sourceHandle: "option:opt_harm", target: "coleta_horario" },
                { id: "e5", source: "menu_proc", sourceHandle: "option:opt_depil", target: "coleta_horario" },
                { id: "e6", source: "menu_proc", sourceHandle: "option:opt_aval", target: "coleta_horario" },
                { id: "e7", source: "coleta_horario", sourceHandle: "input:in_turno:valid", target: "ia_qualifica" },
                { id: "e8", source: "coleta_horario", sourceHandle: "next", target: "ia_qualifica" },
                { id: "e9", source: "ia_qualifica", sourceHandle: "next", target: "confirmacao" },
            ],
        },
    },
    {
        id: "loja-delivery",
        name: "Loja & Delivery — Pedido Rápido + ERP",
        niche: "Loja & Delivery",
        badge: "Venda direta",
        description: "Apresenta o menu de atendimento, coleta o pedido e endereço, envia para webhook/ERP via HTTP e confirma o pagamento.",
        trigger: { type: "KEYWORD", keyword: "pedido", matchType: "CONTAINS" },
        graph: {
            nodes: [
                { id: "start", type: "start", position: { x: 60, y: 180 }, data: {} },
                {
                    id: "menu_loja",
                    type: "menu",
                    position: { x: 340, y: 120 },
                    data: {
                        name: "Menu Principal",
                        mode: "number",
                        question: "Olá, {primeiro-nome}! 🛍️ Bem-vindo à nossa loja! Como posso te ajudar hoje?",
                        invalidText: "Responda com o número da opção (1, 2 ou 3).",
                        maxErrors: 3,
                        expireValue: 1,
                        expireUnit: "days",
                        options: [
                            { id: "opt_pedir", text: "Fazer um pedido agora" },
                            { id: "opt_rastrear", text: "Status do meu pedido" },
                            { id: "opt_atendente", text: "Falar com atendente" },
                        ],
                    },
                },
                {
                    id: "coleta_pedido",
                    type: "content",
                    position: { x: 720, y: 40 },
                    data: {
                        name: "Dados do Pedido",
                        items: [
                            {
                                id: "in_itens",
                                kind: "input",
                                question: "Ótimo! Escreva os itens que deseja pedir (ex: 2x Combo X, 1x Refrigerante):",
                                answerType: "text",
                                fieldKey: "itens-pedido",
                                fieldScope: "CONTACT",
                                expireValue: 1,
                                expireUnit: "days",
                                errorMessage: "Envie os itens em texto para continuarmos.",
                                maxAttempts: 2,
                            },
                            {
                                id: "in_end",
                                kind: "input",
                                question: "Agora informe seu endereço completo para entrega (ou escreva RETIRADA):",
                                answerType: "text",
                                fieldKey: "endereco-entrega",
                                fieldScope: "CONTACT",
                                expireValue: 1,
                                expireUnit: "days",
                                errorMessage: "Informe o endereço completo.",
                                maxAttempts: 2,
                            },
                        ],
                    },
                },
                {
                    id: "webhook_erp",
                    type: "action",
                    position: { x: 1100, y: 40 },
                    data: {
                        name: "Enviar Pedido ERP",
                        actions: [
                            {
                                id: "a_http",
                                type: "http_request",
                                method: "POST",
                                url: "https://api.seuerp.com.br/webhooks/pedidos",
                                headersJson: '{"Content-Type": "application/json"}',
                                bodyJson: '{"cliente": "{nome-completo}", "telefone": "{telefone}", "itens": "{itens-pedido}", "endereco": "{endereco-entrega}"}',
                                saveFieldKey: "retorno-erp",
                                saveFieldScope: "CONTACT",
                            },
                            {
                                id: "a_pause_loja",
                                type: "pauseAutomation",
                                forever: false,
                                value: 20,
                                unit: "minutes",
                            },
                        ],
                    },
                },
                {
                    id: "msg_final_pedido",
                    type: "content",
                    position: { x: 1440, y: 40 },
                    data: {
                        name: "Confirmação do Pedido",
                        items: [
                            {
                                id: "c_ok",
                                kind: "text",
                                text: "Pedido recebido, {primeiro-nome}! 🚀\n\n📦 Itens: {itens-pedido}\n📍 Entrega: {endereco-entrega}\n\nEm breve enviamos o link/chave PIX e o prazo estimado!",
                            },
                        ],
                    },
                },
                {
                    id: "msg_humano",
                    type: "content",
                    position: { x: 720, y: 320 },
                    data: {
                        name: "Transferência Atendente",
                        items: [
                            {
                                id: "c_hum",
                                kind: "text",
                                text: "Sem problemas, {primeiro-nome}! Já chamei um atendente para te ajudar por aqui.",
                            },
                        ],
                    },
                },
            ],
            edges: [
                { id: "e1", source: "start", sourceHandle: "next", target: "menu_loja" },
                { id: "e2", source: "menu_loja", sourceHandle: "option:opt_pedir", target: "coleta_pedido" },
                { id: "e3", source: "menu_loja", sourceHandle: "option:opt_rastrear", target: "msg_humano" },
                { id: "e4", source: "menu_loja", sourceHandle: "option:opt_atendente", target: "msg_humano" },
                { id: "e5", source: "coleta_pedido", sourceHandle: "input:in_end:valid", target: "webhook_erp" },
                { id: "e6", source: "coleta_pedido", sourceHandle: "next", target: "webhook_erp" },
                { id: "e7", source: "webhook_erp", sourceHandle: "next", target: "msg_final_pedido" },
            ],
        },
    },
    {
        id: "imobiliaria",
        name: "Imobiliária — Qualificação de Lead com IA",
        niche: "Imobiliária",
        badge: "Qualificação IA",
        description: "Segmenta compra ou locação, captura bairro/orçamento e usa IA para gerar o perfil do comprador para o corretor.",
        trigger: { type: "FIRST_MESSAGE" },
        graph: {
            nodes: [
                { id: "start", type: "start", position: { x: 60, y: 180 }, data: {} },
                {
                    id: "menu_imob",
                    type: "menu",
                    position: { x: 340, y: 120 },
                    data: {
                        name: "Interesse",
                        mode: "number",
                        question: "Olá, {primeiro-nome}! 🏡 Que tipo de negócio você procura hoje?",
                        invalidText: "Por favor, escolha 1 para Comprar ou 2 para Alugar.",
                        maxErrors: 3,
                        expireValue: 1,
                        expireUnit: "days",
                        options: [
                            { id: "opt_comprar", text: "Comprar imóvel" },
                            { id: "opt_alugar", text: "Alugar imóvel" },
                        ],
                    },
                },
                {
                    id: "coleta_imob",
                    type: "content",
                    position: { x: 700, y: 120 },
                    data: {
                        name: "Perfil do Imóvel",
                        items: [
                            {
                                id: "in_regiao",
                                kind: "input",
                                question: "Qual bairro ou região você tem preferência e quantos quartos precisa?",
                                answerType: "text",
                                fieldKey: "imovel-regiao",
                                fieldScope: "CONTACT",
                                expireValue: 1,
                                expireUnit: "days",
                                errorMessage: "Me conte a região ou quantidade de quartos.",
                                maxAttempts: 2,
                            },
                            {
                                id: "in_faixa",
                                kind: "input",
                                question: "Qual a faixa de valor aproximada que você está buscando?",
                                answerType: "text",
                                fieldKey: "imovel-orcamento",
                                fieldScope: "CONTACT",
                                expireValue: 1,
                                expireUnit: "days",
                                errorMessage: "Informe um valor aproximado.",
                                maxAttempts: 2,
                            },
                        ],
                    },
                },
                {
                    id: "ia_corretor",
                    type: "action",
                    position: { x: 1080, y: 120 },
                    data: {
                        name: "Resumo IA + Corretor",
                        actions: [
                            {
                                id: "a_ia_imob",
                                type: "ai_qualifier",
                                provider: "auto",
                                systemPrompt:
                                    "Você é um assistente de pré-atendimento imobiliário. Gere um briefing curto para o corretor com base nos dados de {nome-completo} ({telefone}): Região/Quartos = {imovel-regiao}, Orçamento = {imovel-orcamento}. Classifique o lead (Quente/Morno/Frio) e sugira 1 pergunta de fechamento.",
                                saveFieldKey: "resumo-qualificacao-ia",
                                saveFieldScope: "CONTACT",
                                replyToContact: true,
                            },
                            {
                                id: "a_pause_imob",
                                type: "pauseAutomation",
                                forever: false,
                                value: 30,
                                unit: "minutes",
                            },
                        ],
                    },
                },
            ],
            edges: [
                { id: "e1", source: "start", sourceHandle: "next", target: "menu_imob" },
                { id: "e2", source: "menu_imob", sourceHandle: "option:opt_comprar", target: "coleta_imob" },
                { id: "e3", source: "menu_imob", sourceHandle: "option:opt_alugar", target: "coleta_imob" },
                { id: "e4", source: "coleta_imob", sourceHandle: "input:in_faixa:valid", target: "ia_corretor" },
                { id: "e5", source: "coleta_imob", sourceHandle: "next", target: "ia_corretor" },
            ],
        },
    },
    {
        id: "pos-venda-pix",
        name: "Pós-Venda & Cobrança PIX",
        niche: "Pós-Venda & Financeiro",
        badge: "Recuperação",
        description: "Confirma recebimento ou envia segunda via / chave PIX copia e cola, com registro automático em webhook.",
        trigger: { type: "KEYWORD", keyword: "pix", matchType: "CONTAINS" },
        graph: {
            nodes: [
                { id: "start", type: "start", position: { x: 60, y: 180 }, data: {} },
                {
                    id: "menu_pix",
                    type: "menu",
                    position: { x: 340, y: 120 },
                    data: {
                        name: "Atendimento Financeiro",
                        mode: "number",
                        question: "Olá, {primeiro-nome}! Como posso te ajudar com seu pedido ou pagamento?",
                        invalidText: "Responda com 1, 2 ou 3.",
                        maxErrors: 3,
                        expireValue: 1,
                        expireUnit: "days",
                        options: [
                            { id: "opt_pagar", text: "Receber Chave PIX para pagamento" },
                            { id: "opt_comprovante", text: "Já paguei / Enviar comprovante" },
                            { id: "opt_suporte", text: "Dúvida ou suporte pós-venda" },
                        ],
                    },
                },
                {
                    id: "envia_pix",
                    type: "content",
                    position: { x: 720, y: 20 },
                    data: {
                        name: "Chave PIX",
                        items: [
                            {
                                id: "c_pix1",
                                kind: "text",
                                text: "Perfeito, {primeiro-nome}! Segue nossa chave PIX oficial:\n\n🔑 *Chave PIX (CNPJ/E-mail):* financeiro@suaempresa.com.br\n\nAssim que realizar o pagamento, responda aqui com o comprovante para liberarmos seu pedido imediatamente!",
                            },
                        ],
                    },
                },
                {
                    id: "recebe_comp",
                    type: "content",
                    position: { x: 720, y: 200 },
                    data: {
                        name: "Receber Comprovante",
                        items: [
                            {
                                id: "in_comp",
                                kind: "input",
                                question: "Pode enviar a imagem ou PDF do comprovante aqui mesmo, ou digitar o código da transação:",
                                answerType: "text",
                                fieldKey: "comprovante-pix",
                                fieldScope: "CONTACT",
                                expireValue: 1,
                                expireUnit: "days",
                                errorMessage: "Envie o texto ou comprovante.",
                                maxAttempts: 2,
                            },
                        ],
                    },
                },
                {
                    id: "http_baixa",
                    type: "action",
                    position: { x: 1080, y: 200 },
                    data: {
                        name: "Registrar Baixa ERP",
                        actions: [
                            {
                                id: "a_http_pix",
                                type: "http_request",
                                method: "POST",
                                url: "https://api.seuerp.com.br/webhooks/pix-comprovante",
                                headersJson: '{"Content-Type": "application/json"}',
                                bodyJson: '{"cliente": "{nome-completo}", "telefone": "{telefone}", "comprovante": "{comprovante-pix}"}',
                            },
                        ],
                    },
                },
                {
                    id: "suporte_pos",
                    type: "content",
                    position: { x: 720, y: 380 },
                    data: {
                        name: "Pós-Venda",
                        items: [
                            {
                                id: "c_sup",
                                kind: "text",
                                text: "Certo, {primeiro-nome}! Me conte qual foi o problema ou dúvida com o seu pedido que nossa equipe já vai assumir o atendimento.",
                            },
                        ],
                    },
                },
            ],
            edges: [
                { id: "e1", source: "start", sourceHandle: "next", target: "menu_pix" },
                { id: "e2", source: "menu_pix", sourceHandle: "option:opt_pagar", target: "envia_pix" },
                { id: "e3", source: "menu_pix", sourceHandle: "option:opt_comprovante", target: "recebe_comp" },
                { id: "e4", source: "menu_pix", sourceHandle: "option:opt_suporte", target: "suporte_pos" },
                { id: "e5", source: "recebe_comp", sourceHandle: "input:in_comp:valid", target: "http_baixa" },
                { id: "e6", source: "recebe_comp", sourceHandle: "next", target: "http_baixa" },
            ],
        },
    },
];
