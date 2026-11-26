import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import moment from "moment-timezone";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { StoredAffiliateSettings } from "@/modules/affiliate/config";
import { INSTAGRAM_MEDIA_DIR } from "@/modules/instagram/scheduler";
import { buildAutoPilotCaption } from "./caption";
import {
    baseMediaKey,
    downloadGoogleDriveFile,
    generateSafeMediaFilename,
    listGoogleDriveFolderFiles,
    parseMetadataText,
    ParsedDriveMetadata,
} from "./drive";

export const AUTOPILOT_MEDIA_DIR = path.join(process.cwd(), "data", "autopilot-media");

const globalForAutoPilot = globalThis as unknown as {
    __autoPilotTimer?: NodeJS.Timeout;
    __autoPilotTickRunning?: boolean;
};

export function generateShareCode(name = "LIB"): string {
    const clean = (name || "LIB")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase()
        .slice(0, 6) || "LIB";
    const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
    return `${clean}-${suffix}`;
}

export async function ensureAutoPilotMediaDir(): Promise<void> {
    await fs.mkdir(AUTOPILOT_MEDIA_DIR, { recursive: true });
}

export function normalizeScheduleTimes(raw: unknown): string[] {
    if (!Array.isArray(raw)) return ["09:00", "12:30", "18:30"];
    const valid = raw
        .map((t) => String(t || "").trim())
        .filter((t) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(t));
    const unique = Array.from(new Set(valid)).sort();
    return unique.length > 0 ? unique : ["09:00", "12:30", "18:30"];
}

export function normalizeDaysOfWeek(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [0, 1, 2, 3, 4, 5, 6];
    const valid = raw
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const unique = Array.from(new Set(valid)).sort((a, b) => a - b);
    return unique.length > 0 ? unique : [0, 1, 2, 3, 4, 5, 6];
}

/**
 * Calcula os próximos horários disponíveis (hoje e amanhã) respeitando maxPostsPerDay,
 * dias da semana e slots já agendados para evitar duplicidade.
 */
export function computeUpcomingSlots(params: {
    scheduleTimes: string[];
    daysOfWeek: number[];
    maxPostsPerDay: number;
    timezone: string;
    existingSlotTimestamps: number[];
    now?: Date;
    daysAhead?: number;
}): Date[] {
    const now = params.now || new Date();
    const daysAhead = params.daysAhead ?? 1;
    const minTimeMs = now.getTime() + 2 * 60 * 1000;
    const times = normalizeScheduleTimes(params.scheduleTimes);
    const allowedDays = new Set(normalizeDaysOfWeek(params.daysOfWeek));
    const maxPerDay = Math.max(1, Math.min(20, params.maxPostsPerDay || 3));

    const existingByDay = new Map<string, Set<string>>();
    for (const ts of params.existingSlotTimestamps) {
        const m = moment(ts).tz(params.timezone);
        const dayKey = m.format("YYYY-MM-DD");
        const hhmm = m.format("HH:mm");
        const set = existingByDay.get(dayKey) || new Set<string>();
        set.add(hhmm);
        existingByDay.set(dayKey, set);
    }

    const result: Date[] = [];

    for (let offset = 0; offset <= daysAhead; offset++) {
        const dayMoment = moment(now).tz(params.timezone).startOf("day").add(offset, "days");
        if (!allowedDays.has(dayMoment.day())) continue;

        const dayKey = dayMoment.format("YYYY-MM-DD");
        const alreadyOnDay = existingByDay.get(dayKey) || new Set<string>();
        let countOnDay = alreadyOnDay.size;

        for (const hhmm of times) {
            if (countOnDay >= maxPerDay) break;
            if (alreadyOnDay.has(hhmm)) continue;

            const [hh, mm] = hhmm.split(":").map(Number);
            const candidate = dayMoment.clone().hour(hh).minute(mm).second(0).millisecond(0);
            if (candidate.valueOf() < minTimeMs) continue;

            result.push(candidate.toDate());
            alreadyOnDay.add(hhmm);
            countOnDay += 1;
        }
    }

    return result;
}

async function getSystemTimezone(): Promise<string> {
    try {
        const cfg = await prisma.systemConfig.findUnique({ where: { id: "default" }, select: { timezone: true } });
        return cfg?.timezone || process.env.TZ || "America/Sao_Paulo";
    } catch {
        return "America/Sao_Paulo";
    }
}

/**
 * Sincroniza uma biblioteca conectada a uma pasta pública do Google Drive.
 */
export async function syncLibraryFromDrive(libraryId: string): Promise<{ added: number; skipped: number }> {
    const library = await prisma.contentLibrary.findUnique({ where: { id: libraryId } });
    if (!library) {
        throw new Error("Biblioteca não encontrada.");
    }
    if (library.sourceType !== "GOOGLE_DRIVE" || !library.driveFolderId) {
        throw new Error("Esta biblioteca não está vinculada a uma pasta do Google Drive.");
    }

    await ensureAutoPilotMediaDir();

    try {
        const entries = await listGoogleDriveFolderFiles(library.driveFolderId);
        const existingItems = await prisma.contentItem.findMany({
            where: { libraryId: library.id, driveFileId: { not: null } },
            select: { driveFileId: true },
        });
        const existingIds = new Set(existingItems.map((i) => i.driveFileId).filter(Boolean) as string[]);

        // Carrega arquivos .txt sidecar (ex.: perfume.mp4 + perfume.txt)
        const textEntries = entries.filter((e) => e.mediaType === "TEXT");
        const sidecarMap = new Map<string, ParsedDriveMetadata>();
        for (const txt of textEntries) {
            try {
                const { buffer } = await downloadGoogleDriveFile(txt.id);
                const parsed = parseMetadataText(buffer.toString("utf-8"));
                sidecarMap.set(baseMediaKey(txt.name), parsed);
            } catch (err) {
                logger.warn("AutoPilot", `Falha ao ler metadados ${txt.name} do Drive:`, err);
            }
        }

        const mediaEntries = entries.filter((e) => e.mediaType === "IMAGE" || e.mediaType === "VIDEO");
        let added = 0;
        let skipped = 0;

        for (const entry of mediaEntries) {
            if (existingIds.has(entry.id)) {
                skipped += 1;
                continue;
            }

            try {
                const { buffer, contentType } = await downloadGoogleDriveFile(entry.id);
                const mimeType = contentType !== "application/octet-stream" ? contentType.split(";")[0] : entry.mimeType;
                const safeFilename = generateSafeMediaFilename(entry.name, mimeType);
                const targetPath = path.join(AUTOPILOT_MEDIA_DIR, safeFilename);
                await fs.writeFile(targetPath, buffer);

                const sidecar = sidecarMap.get(baseMediaKey(entry.name)) || {};
                const descMeta = entry.description ? parseMetadataText(entry.description) : {};

                const cleanTitle = path.parse(entry.name).name.replace(/[_-]+/g, " ").trim() || entry.name;
                const caption = sidecar.caption || descMeta.caption || null;
                const productUrl = sidecar.productUrl || descMeta.productUrl || null;
                const priceText = sidecar.priceText || descMeta.priceText || null;
                const couponCode = sidecar.couponCode || descMeta.couponCode || null;

                await prisma.contentItem.create({
                    data: {
                        libraryId: library.id,
                        title: cleanTitle,
                        caption,
                        productUrl,
                        priceText,
                        couponCode,
                        filename: safeFilename,
                        mimeType,
                        mediaType: entry.mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
                        sizeBytes: buffer.byteLength,
                        driveFileId: entry.id,
                    },
                });
                added += 1;
            } catch (fileErr: any) {
                logger.warn("AutoPilot", `Arquivo ${entry.name} ignorado na sincronização:`, fileErr?.message || fileErr);
                skipped += 1;
            }
        }

        await prisma.contentLibrary.update({
            where: { id: library.id },
            data: {
                lastSyncedAt: new Date(),
                lastSyncError: null,
            },
        });

        logger.info("AutoPilot", `Biblioteca "${library.name}" sincronizada: +${added} itens, ${skipped} ignorados.`);
        return { added, skipped };
    } catch (err: any) {
        const msg = err?.message || "Erro ao sincronizar pasta do Google Drive.";
        await prisma.contentLibrary.update({
            where: { id: library.id },
            data: {
                lastSyncError: msg,
            },
        });
        throw err;
    }
}

/**
 * Executa uma regra de Auto-Postagem: escolhe próximos itens da biblioteca,
 * personaliza legendas/links de afiliado e agenda no WhatsApp e/ou Instagram.
 */
export async function runAutoPostRule(ruleId: string): Promise<{ scheduledDispatches: number; slotsFilled: number }> {
    const rule = await prisma.autoPostRule.findUnique({
        where: { id: ruleId },
        include: { library: true },
    });

    if (!rule || !rule.isActive) {
        return { scheduledDispatches: 0, slotsFilled: 0 };
    }

    const items = await prisma.contentItem.findMany({
        where: { libraryId: rule.libraryId, isActive: true },
        orderBy: { createdAt: "asc" },
    });

    if (items.length === 0) {
        return { scheduledDispatches: 0, slotsFilled: 0 };
    }

    const tz = await getSystemTimezone();
    const now = new Date();
    const windowStart = moment(now).tz(tz).startOf("day").toDate();

    const recentDispatches = await prisma.autoPostDispatch.findMany({
        where: {
            ruleId: rule.id,
            scheduledAt: { gte: windowStart },
        },
        select: { scheduledAt: true },
    });

    const slots = computeUpcomingSlots({
        scheduleTimes: normalizeScheduleTimes(rule.scheduleTimes),
        daysOfWeek: normalizeDaysOfWeek(rule.daysOfWeek),
        maxPostsPerDay: rule.maxPostsPerDay,
        timezone: tz,
        existingSlotTimestamps: recentDispatches.map((d) => d.scheduledAt.getTime()),
        now,
        daysAhead: 1,
    });

    if (slots.length === 0) {
        return { scheduledDispatches: 0, slotsFilled: 0 };
    }

    const allRuleDispatches = await prisma.autoPostDispatch.findMany({
        where: { ruleId: rule.id },
        select: { itemId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });

    const lastSentByItem = new Map<string, number>();
    for (const d of allRuleDispatches) {
        if (!lastSentByItem.has(d.itemId)) {
            lastSentByItem.set(d.itemId, d.createdAt.getTime());
        }
    }

    const unpostedItems = items.filter((it) => !lastSentByItem.has(it.id));
    const orderedPool = [...unpostedItems];
    if (rule.recycleOld) {
        const alreadyPostedSorted = items
            .filter((it) => lastSentByItem.has(it.id))
            .sort((a, b) => (lastSentByItem.get(a.id) || 0) - (lastSentByItem.get(b.id) || 0));
        orderedPool.push(...alreadyPostedSorted);
    }

    if (orderedPool.length === 0) {
        return { scheduledDispatches: 0, slotsFilled: 0 };
    }

    // Carrega sessão WhatsApp + config de afiliado (se configurada)
    let waSessionRecord: { id: string; sessionId: string; config: unknown } | null = null;
    if (rule.whatsappSessionId) {
        waSessionRecord = await prisma.session.findFirst({
            where: {
                userId: rule.userId,
                OR: [{ id: rule.whatsappSessionId }, { sessionId: rule.whatsappSessionId }],
            },
            select: { id: true, sessionId: true, config: true },
        });
    }

    const sessionAffiliateSettings =
        ((waSessionRecord?.config as any)?.affiliate as StoredAffiliateSettings | undefined) || null;

    const waGroupJids = Array.isArray(rule.whatsappGroupJids)
        ? rule.whatsappGroupJids.map((g) => String(g).trim()).filter(Boolean)
        : [];
    const igAccountIds = Array.isArray(rule.instagramAccountIds)
        ? rule.instagramAccountIds.map((id) => String(id).trim()).filter(Boolean)
        : [];
    const igTypes = Array.isArray(rule.instagramPostTypes)
        ? rule.instagramPostTypes.map((t) => String(t).toUpperCase())
        : ["STORY", "FEED", "REELS"];

    const validIgAccounts =
        igAccountIds.length > 0
            ? await prisma.instagramAccount.findMany({
                  where: { id: { in: igAccountIds }, userId: rule.userId },
                  select: { id: true, username: true },
              })
            : [];

    let scheduledDispatches = 0;
    let slotsFilled = 0;

    for (let i = 0; i < slots.length; i++) {
        if (i >= orderedPool.length && !rule.recycleOld) break;
        const item = orderedPool[i % orderedPool.length];
        const slotDate = slots[i];

        const renderedCaption = await buildAutoPilotCaption({
            itemTitle: item.title,
            itemCaption: item.caption,
            itemProductUrl: item.productUrl,
            itemPriceText: item.priceText,
            itemCouponCode: item.couponCode,
            captionTemplate: rule.captionTemplate,
            resellerLink: rule.resellerLink,
            resellerWhatsapp: rule.resellerWhatsapp,
            resellerCoupon: rule.resellerCoupon,
            convertAffiliateLinks: rule.convertAffiliateLinks,
            affiliateSettings: sessionAffiliateSettings,
        });

        let slotCreatedAnything = false;
        const waMediaRelPath = `data/autopilot-media/${item.filename}`;
        const waMediaType = item.mediaType === "VIDEO" ? "video" : "image";

        // 1. WhatsApp Status
        if (waSessionRecord && rule.postWhatsappStatus) {
            const sched = await prisma.scheduledMessage.create({
                data: {
                    sessionId: waSessionRecord.id,
                    jid: "status@broadcast",
                    content: renderedCaption,
                    mediaUrl: waMediaRelPath,
                    mediaType: waMediaType,
                    sendAt: slotDate,
                    status: "PENDING",
                },
            });
            await prisma.autoPostDispatch.create({
                data: {
                    ruleId: rule.id,
                    itemId: item.id,
                    channel: "WA_STATUS",
                    targetId: waSessionRecord.sessionId,
                    scheduledAt: slotDate,
                    externalPostId: sched.id,
                    status: "SCHEDULED",
                    renderedCaption,
                },
            });
            scheduledDispatches += 1;
            slotCreatedAnything = true;
        }

        // 2. WhatsApp Grupos / Canais
        if (waSessionRecord && waGroupJids.length > 0) {
            for (const jid of waGroupJids) {
                const sched = await prisma.scheduledMessage.create({
                    data: {
                        sessionId: waSessionRecord.id,
                        jid,
                        content: renderedCaption,
                        mediaUrl: waMediaRelPath,
                        mediaType: waMediaType,
                        sendAt: slotDate,
                        status: "PENDING",
                    },
                });
                await prisma.autoPostDispatch.create({
                    data: {
                        ruleId: rule.id,
                        itemId: item.id,
                        channel: "WA_GROUP",
                        targetId: jid,
                        scheduledAt: slotDate,
                        externalPostId: sched.id,
                        status: "SCHEDULED",
                        renderedCaption,
                    },
                });
                scheduledDispatches += 1;
                slotCreatedAnything = true;
            }
        }

        // 3. Instagram (Feed / Reels / Story)
        if (validIgAccounts.length > 0 && igTypes.length > 0) {
            const targetIgPostTypes: Array<"FEED" | "REELS" | "STORY"> = [];
            if (item.mediaType === "VIDEO") {
                if (igTypes.includes("REELS") || igTypes.includes("FEED")) targetIgPostTypes.push("REELS");
                if (igTypes.includes("STORY")) targetIgPostTypes.push("STORY");
            } else {
                if (igTypes.includes("FEED")) targetIgPostTypes.push("FEED");
                if (igTypes.includes("STORY")) targetIgPostTypes.push("STORY");
            }

            if (targetIgPostTypes.length > 0) {
                await fs.mkdir(INSTAGRAM_MEDIA_DIR, { recursive: true });
                const ext = path.extname(item.filename) || (item.mediaType === "VIDEO" ? ".mp4" : ".jpg");
                const igFilename = `ig_ap_${item.id}_${Date.now()}${ext}`;
                await fs.copyFile(
                    path.join(AUTOPILOT_MEDIA_DIR, item.filename),
                    path.join(INSTAGRAM_MEDIA_DIR, igFilename)
                );

                for (const acc of validIgAccounts) {
                    for (const igType of targetIgPostTypes) {
                        const igPost = await prisma.instagramPost.create({
                            data: {
                                userId: rule.userId,
                                accountId: acc.id,
                                type: igType,
                                caption: igType === "STORY" ? null : renderedCaption,
                                mediaItems: [
                                    {
                                        filename: igFilename,
                                        mediaType: item.mediaType,
                                        mimeType: item.mimeType,
                                    },
                                ],
                                shareToFeed: true,
                                scheduledAt: slotDate,
                                status: "PENDING",
                            },
                        });
                        await prisma.autoPostDispatch.create({
                            data: {
                                ruleId: rule.id,
                                itemId: item.id,
                                channel: `IG_${igType}`,
                                targetId: acc.username,
                                scheduledAt: slotDate,
                                externalPostId: igPost.id,
                                status: "SCHEDULED",
                                renderedCaption: igType === "STORY" ? "(Story)" : renderedCaption,
                            },
                        });
                        scheduledDispatches += 1;
                        slotCreatedAnything = true;
                    }
                }
            }
        }

        if (slotCreatedAnything) {
            slotsFilled += 1;
        }
    }

    await prisma.autoPostRule.update({
        where: { id: rule.id },
        data: { lastRunAt: new Date() },
    });

    return { scheduledDispatches, slotsFilled };
}

/**
 * Tick periódico (60s): executa sync diário das pastas do Drive e preenche filas das regras ativas.
 */
export async function runAutoPilotTick() {
    if (globalForAutoPilot.__autoPilotTickRunning) return;
    globalForAutoPilot.__autoPilotTickRunning = true;

    try {
        const tz = await getSystemTimezone();
        const now = moment().tz(tz);

        // 1. Sincronização diária de bibliotecas Google Drive após o horário configurado (padrão 06:00)
        const driveLibs = await prisma.contentLibrary.findMany({
            where: {
                sourceType: "GOOGLE_DRIVE",
                syncEnabled: true,
                driveFolderId: { not: null },
            },
        });

        for (const lib of driveLibs) {
            if (now.hour() < lib.syncHour) continue;
            const syncedToday =
                lib.lastSyncedAt &&
                moment(lib.lastSyncedAt).tz(tz).format("YYYY-MM-DD") === now.format("YYYY-MM-DD");
            if (syncedToday) continue;

            try {
                await syncLibraryFromDrive(lib.id);
            } catch (err) {
                logger.error("AutoPilot", `Erro no sync diário da biblioteca ${lib.id}:`, err);
            }
        }

        // 2. Verifica regras ativas cuja última execução foi há mais de 30 minutos
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const activeRules = await prisma.autoPostRule.findMany({
            where: {
                isActive: true,
                OR: [{ lastRunAt: null }, { lastRunAt: { lt: thirtyMinutesAgo } }],
            },
            select: { id: true },
        });

        for (const rule of activeRules) {
            try {
                await runAutoPostRule(rule.id);
            } catch (err) {
                logger.error("AutoPilot", `Erro ao processar regra ${rule.id}:`, err);
            }
        }
    } catch (err) {
        logger.error("AutoPilot", "Erro no tick do Auto-Pilot:", err);
    } finally {
        globalForAutoPilot.__autoPilotTickRunning = false;
    }
}

export function startAutoPilotScheduler() {
    if (globalForAutoPilot.__autoPilotTimer) return;
    logger.info("AutoPilot", "Starting Sales Machine Auto-Pilot Scheduler (60s interval)...");
    globalForAutoPilot.__autoPilotTimer = setInterval(() => {
        void runAutoPilotTick();
    }, 60 * 1000);
    setTimeout(() => {
        void runAutoPilotTick();
    }, 10000);
}
