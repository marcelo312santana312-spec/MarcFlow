import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import moment from "moment-timezone";
import * as XLSX from "xlsx";
import { CronExpressionParser } from "cron-parser";

function normalizeKey(str: string): string {
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function findValue(row: Record<string, any>, possibleKeys: string[]): any {
    const normKeys = possibleKeys.map(normalizeKey);
    for (const [key, val] of Object.entries(row)) {
        const norm = normalizeKey(key);
        if (normKeys.some(k => norm.includes(k) || k.includes(norm))) {
            return val;
        }
    }
    return undefined;
}

function cleanPhoneNumber(raw: any): string | null {
    if (!raw) return null;
    let digits = String(raw).replace(/\D/g, "");
    if (!digits) return null;

    // Se começar com 0 (ex: 011999999999), remove o 0
    if (digits.startsWith("0")) {
        digits = digits.substring(1);
    }

    // Se tiver 10 ou 11 dígitos (DDD + número brasileiro), adiciona 55
    if (digits.length === 10 || digits.length === 11) {
        digits = "55" + digits;
    }

    // Validação mínima de tamanho (ex: 55 + DDD + 8 ou 9 dígitos = 12 ou 13 dígitos)
    if (digits.length < 10 || digits.length > 15) {
        return null;
    }

    return `${digits}@s.whatsapp.net`;
}

function parseRecurrenceFromRow(
    row: Record<string, any>,
    fallbackDate: Date,
    timezone: string,
    fallbackCron: string | null = null,
    fallbackRule: string | null = null
): { isRecurring: boolean; cronExpression: string | null; recurrenceRule: string | null; sendAt: Date } {
    const rawRec = findValue(row, ["recorrente", "recorrencia", "frequencia", "repetir", "recurring", "repeticao", "tipo"]);
    const rawTime = findValue(row, ["horario", "hora", "time"]);
    const rawDate = findValue(row, ["data", "dataenvio", "sendat", "agendamento", "date"]);

    const recStr = rawRec ? String(rawRec).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

    // Se explicitamente marcado como NÃO recorrente
    if (recStr === "nao" || recStr === "false" || recStr === "0" || recStr === "no" || recStr === "unico") {
        let sendAt = fallbackDate;
        if (rawDate) {
            const parsed = moment.tz(rawDate, timezone);
            if (parsed.isValid()) sendAt = parsed.toDate();
        } else if (rawTime) {
            const parsedTime = moment(String(rawTime).trim(), ["HH:mm", "HH:mm:ss", "H:mm"]);
            if (parsedTime.isValid()) {
                sendAt = moment(fallbackDate).tz(timezone).hour(parsedTime.hour()).minute(parsedTime.minute()).second(0).toDate();
            }
        }
        return { isRecurring: false, cronExpression: null, recurrenceRule: null, sendAt };
    }

    // Se a coluna de recorrência não veio preenchida na linha, checa se tem fallback global
    if (!recStr) {
        if (fallbackCron) {
            let sendAt = fallbackDate;
            try {
                const interval = CronExpressionParser.parse(fallbackCron, { currentDate: new Date(), tz: timezone });
                sendAt = interval.next().toDate();
            } catch {}
            return { isRecurring: true, cronExpression: fallbackCron, recurrenceRule: fallbackRule, sendAt };
        }
        let sendAt = fallbackDate;
        if (rawDate) {
            const parsed = moment.tz(rawDate, timezone);
            if (parsed.isValid()) sendAt = parsed.toDate();
        }
        return { isRecurring: false, cronExpression: null, recurrenceRule: null, sendAt };
    }

    // É recorrente pela planilha! Determina hora e minuto
    let hour = 9;
    let minute = 0;

    if (rawTime) {
        const parsedTime = moment(String(rawTime).trim(), ["HH:mm", "HH:mm:ss", "H:mm", "HH"]);
        if (parsedTime.isValid()) {
            hour = parsedTime.hour();
            minute = parsedTime.minute();
        }
    } else if (rawDate) {
        const parsedDate = moment.tz(rawDate, timezone);
        if (parsedDate.isValid()) {
            hour = parsedDate.hour();
            minute = parsedDate.minute();
        }
    } else {
        const fbMoment = moment(fallbackDate).tz(timezone);
        hour = fbMoment.hour();
        minute = fbMoment.minute();
    }

    let cron = "";
    let rule: any = {};

    const matchMins = recStr.match(/(\d+)\s*(m|min|minuto|minutos)/);
    const matchHrs = recStr.match(/(\d+)\s*(h|hora|horas)/);

    if (matchMins) {
        const mins = parseInt(matchMins[1], 10) || 15;
        cron = `*/${mins} * * * *`;
        rule = { type: "minutes", value: mins };
    } else if (matchHrs) {
        const hrs = parseInt(matchHrs[1], 10) || 1;
        cron = `0 */${hrs} * * *`;
        rule = { type: "hours", value: hrs };
    } else if (recStr.includes("diari") || recStr.includes("todo dia") || recStr.includes("todos os dias") || recStr.includes("daily")) {
        cron = `${minute} ${hour} * * *`;
        rule = { type: "days", value: [0, 1, 2, 3, 4, 5, 6] };
    } else if (recStr.includes("seg a sex") || recStr.includes("dias uteis") || recStr.includes("util") || recStr.includes("uteis") || recStr.includes("weekday")) {
        cron = `${minute} ${hour} * * 1,2,3,4,5`;
        rule = { type: "days", value: [1, 2, 3, 4, 5] };
    } else if (recStr.includes("fim de semana") || recStr.includes("finais de semana") || recStr.includes("weekend")) {
        cron = `${minute} ${hour} * * 0,6`;
        rule = { type: "days", value: [0, 6] };
    } else {
        const daysMap: Record<string, number> = {
            dom: 0, domingo: 0,
            seg: 1, segunda: 1,
            ter: 2, terca: 2,
            qua: 3, quarta: 3,
            qui: 4, quinta: 4,
            sex: 5, sexta: 5,
            sab: 6, sabado: 6
        };

        const foundDays: number[] = [];
        for (const [dayKey, dayNum] of Object.entries(daysMap)) {
            const regex = new RegExp(`\\b${dayKey}\\b`, "i");
            if (regex.test(recStr) && !foundDays.includes(dayNum)) {
                foundDays.push(dayNum);
            }
        }

        if (foundDays.length > 0) {
            foundDays.sort((a, b) => a - b);
            cron = `${minute} ${hour} * * ${foundDays.join(",")}`;
            rule = { type: "days", value: foundDays };
        } else {
            // Se disse apenas "Sim", "Recorrente" ou "Semanal", usa o dia da semana atual ou da data
            const dayOfWeek = moment(fallbackDate).tz(timezone).day();
            cron = `${minute} ${hour} * * ${dayOfWeek}`;
            rule = { type: "days", value: [dayOfWeek] };
        }
    }

    let sendAt = fallbackDate;
    try {
        const interval = CronExpressionParser.parse(cron, { currentDate: new Date(), tz: timezone });
        sendAt = interval.next().toDate();
    } catch {
        sendAt = fallbackDate;
    }

    return {
        isRecurring: true,
        cronExpression: cron,
        recurrenceRule: JSON.stringify(rule),
        sendAt
    };
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // Timezone
        // @ts-ignore
        const cfg = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        const timezone = cfg?.timezone || "America/Sao_Paulo";

        const contentType = request.headers.get("content-type") || "";

        let itemsToCreate: Array<{
            sessionId: string;
            jid: string;
            content: string | null;
            sendAt: Date;
            mediaUrl?: string | null;
            mediaType?: string | null;
            cronExpression?: string | null;
            recurrenceRule?: string | null;
            status: string;
        }> = [];

        let invalidCount = 0;
        let invalidDetails: Array<{ row: number; reason: string; data?: any }> = [];

        if (contentType.includes("application/json")) {
            // Recebe lista pré-processada do cliente
            const body = await request.json();
            const { items, defaultMessage, mediaUrl, mediaType, cronExpression, recurrenceRule } = body;

            if (!Array.isArray(items) || items.length === 0) {
                return NextResponse.json({ status: false, message: "Nenhum item fornecido para agendamento." }, { status: 400 });
            }

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const jid = cleanPhoneNumber(item.phone || item.telefone || item.jid);
                if (!jid) {
                    invalidCount++;
                    invalidDetails.push({ row: i + 1, reason: "Telefone inválido ou ausente", data: item });
                    continue;
                }

                let text = item.content || item.mensagem || item.texto || defaultMessage || "";
                if (item.name || item.nome) {
                    const fullName = String(item.name || item.nome).trim();
                    const firstName = fullName.split(/\s+/)[0] || "";
                    text = text.replace(/\{nome\}/gi, fullName).replace(/\{primeiro-nome\}/gi, firstName);
                }
                text = text.replace(/\{telefone\}/gi, jid.split("@")[0]);

                let date: Date;
                if (item.sendAt) {
                    date = moment.tz(item.sendAt, timezone).toDate();
                } else {
                    date = new Date();
                }

                itemsToCreate.push({
                    sessionId: session.id,
                    jid,
                    content: text || null,
                    sendAt: date,
                    mediaUrl: item.mediaUrl || mediaUrl || null,
                    mediaType: item.mediaType || mediaType || "image",
                    cronExpression: item.cronExpression || cronExpression || null,
                    recurrenceRule: item.recurrenceRule || recurrenceRule || null,
                    status: "PENDING"
                });
            }
        } else {
            // Recebe FormData com o arquivo
            const formData = await request.formData();
            const file = formData.get("file") as File | null;
            const defaultMessage = (formData.get("defaultMessage") as string) || "";
            const baseDateStr = (formData.get("baseDate") as string) || "";
            const delaySeconds = parseInt((formData.get("delaySeconds") as string) || "30", 10) || 0;
            const mediaUrl = (formData.get("mediaUrl") as string) || null;
            const mediaType = (formData.get("mediaType") as string) || "image";
            const cronExpression = (formData.get("cronExpression") as string) || null;
            const recurrenceRule = (formData.get("recurrenceRule") as string) || null;

            if (!file) {
                return NextResponse.json({ status: false, message: "Arquivo de planilha não enviado." }, { status: 400 });
            }

            const buffer = Buffer.from(await file.arrayBuffer());
            const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
            const firstSheetName = workbook.SheetNames[0];

            if (!firstSheetName) {
                return NextResponse.json({ status: false, message: "A planilha enviada está vazia." }, { status: 400 });
            }

            const sheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

            if (rows.length === 0) {
                return NextResponse.json({ status: false, message: "Nenhuma linha encontrada na planilha." }, { status: 400 });
            }

            const baseMoment = baseDateStr ? moment.tz(baseDateStr, timezone) : moment().tz(timezone).add(2, "minutes");

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                // Buscar telefone
                const rawPhone = findValue(row, ["telefone", "numero", "whatsapp", "destinatario", "phone", "celular", "contato"]);
                const jid = cleanPhoneNumber(rawPhone);

                if (!jid) {
                    invalidCount++;
                    invalidDetails.push({ row: i + 2, reason: "Telefone inválido ou não encontrado", data: row });
                    continue;
                }

                // Buscar nome
                const rawName = findValue(row, ["nome", "name", "cliente", "lead", "contato"]);
                const fullName = rawName ? String(rawName).trim() : "";
                const firstName = fullName.split(/\s+/)[0] || "";

                // Buscar mensagem específica na linha se houver
                const rowMessage = findValue(row, ["mensagem", "texto", "conteudo", "message"]);
                let contentText = rowMessage ? String(rowMessage).trim() : defaultMessage;

                if (!contentText && !mediaUrl) {
                    invalidCount++;
                    invalidDetails.push({ row: i + 2, reason: "Mensagem vazia e nenhuma mídia definida", data: row });
                    continue;
                }

                // Substituir variáveis
                const nowTz = moment().tz(timezone);
                const days = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

                contentText = contentText
                    .replace(/\{nome\}/gi, fullName)
                    .replace(/\{primeiro-nome\}/gi, firstName)
                    .replace(/\{telefone\}/gi, jid.split("@")[0])
                    .replace(/\{data\}/gi, nowTz.format("DD/MM/YYYY"))
                    .replace(/\{hora\}/gi, nowTz.format("HH:mm"))
                    .replace(/\{dia-semana\}/gi, days[nowTz.day()]);

                // Substituir qualquer outra coluna da planilha como variável! Ex: {cidade}, {valor}, {empresa}
                for (const [k, v] of Object.entries(row)) {
                    const normK = normalizeKey(k);
                    const regex = new RegExp(`\\{${normK}\\}`, "gi");
                    contentText = contentText.replace(regex, String(v ?? ""));
                }

                // Analisa recorrência e data diretamente da linha da planilha (ou fallback global)
                const fallbackLineDate = baseMoment.clone().add(itemsToCreate.length * delaySeconds, "seconds").toDate();
                const recData = parseRecurrenceFromRow(row, fallbackLineDate, timezone, cronExpression, recurrenceRule);

                itemsToCreate.push({
                    sessionId: session.id,
                    jid,
                    content: contentText || null,
                    sendAt: recData.sendAt,
                    mediaUrl: mediaUrl || null,
                    mediaType: mediaType || "image",
                    cronExpression: recData.cronExpression,
                    recurrenceRule: recData.recurrenceRule,
                    status: "PENDING"
                });
            }
        }

        if (itemsToCreate.length === 0) {
            return NextResponse.json({
                status: false,
                message: "Nenhum agendamento válido pôde ser criado. Verifique a planilha e os números de telefone.",
                data: { totalCreated: 0, invalidCount, invalidDetails }
            }, { status: 400 });
        }

        // Criar no banco em lotes
        await prisma.scheduledMessage.createMany({
            data: itemsToCreate
        });

        return NextResponse.json({
            status: true,
            message: `${itemsToCreate.length} mensagens agendadas com sucesso em massa!`,
            data: {
                totalCreated: itemsToCreate.length,
                invalidCount,
                invalidDetails: invalidDetails.slice(0, 10),
                firstSendAt: itemsToCreate[0]?.sendAt,
                lastSendAt: itemsToCreate[itemsToCreate.length - 1]?.sendAt
            }
        });

    } catch (error: any) {
        console.error("[Scheduler:Import] Error:", error);
        return NextResponse.json({
            status: false,
            message: "Erro ao processar a importação da planilha",
            error: error?.message || "Internal Server Error"
        }, { status: 500 });
    }
}
