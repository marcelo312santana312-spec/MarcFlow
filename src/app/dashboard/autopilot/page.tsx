"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
    Rocket,
    FolderSync,
    Plus,
    Trash2,
    Upload,
    RefreshCw,
    Play,
    Copy,
    Check,
    Clock,
    Instagram,
    Smartphone,
    Users,
    Share2,
    Sparkles,
    Link2,
    Image as ImageIcon,
    Film,
    Loader2,
    KeyRound,
    CalendarClock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface ContentItemRow {
    id: string;
    libraryId: string;
    title: string;
    caption: string | null;
    productUrl: string | null;
    priceText: string | null;
    couponCode: string | null;
    filename: string;
    mimeType: string;
    mediaType: "IMAGE" | "VIDEO";
    sizeBytes: number;
    driveFileId: string | null;
    createdAt: string;
}

interface ContentLibraryRow {
    id: string;
    userId: string;
    name: string;
    description: string | null;
    sourceType: "MANUAL" | "GOOGLE_DRIVE";
    driveFolderUrl: string | null;
    driveFolderId: string | null;
    syncEnabled: boolean;
    syncHour: number;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
    shareCode: string | null;
    isShared: boolean;
    user?: { name: string | null };
    items?: ContentItemRow[];
    _count?: { items: number; rules: number };
}

interface DispatchRow {
    id: string;
    channel: string;
    targetId: string;
    scheduledAt: string;
    status: string;
    renderedCaption: string | null;
    item?: { id: string; title: string; mediaType: string; filename: string };
}

interface AutoPostRuleRow {
    id: string;
    libraryId: string;
    name: string;
    isActive: boolean;
    whatsappSessionId: string | null;
    postWhatsappStatus: boolean;
    whatsappGroupJids: string[] | null;
    instagramAccountIds: string[] | null;
    instagramPostTypes: string[] | null;
    scheduleTimes: string[];
    daysOfWeek: number[];
    maxPostsPerDay: number;
    recycleOld: boolean;
    convertAffiliateLinks: boolean;
    resellerLink: string | null;
    resellerWhatsapp: string | null;
    resellerCoupon: string | null;
    captionTemplate: string | null;
    lastRunAt: string | null;
    library: {
        id: string;
        name: string;
        sourceType: string;
        shareCode: string | null;
        isShared: boolean;
        _count?: { items: number };
    };
    dispatches: DispatchRow[];
}

interface WaSessionOption {
    id: string;
    sessionId: string;
    name: string;
    status: string;
}

interface WaGroupOption {
    jid: string;
    subject: string | null;
}

interface IgAccountOption {
    id: string;
    username: string;
    status: string;
}

const PRESET_TIMES: Array<{ label: string; times: string[]; max: number }> = [
    { label: "3x ao dia (09:00, 12:30, 19:00)", times: ["09:00", "12:30", "19:00"], max: 3 },
    { label: "5x picos comerciais (08:30, 11:30, 14:30, 18:30, 20:30)", times: ["08:30", "11:30", "14:30", "18:30", "20:30"], max: 5 },
    { label: "2x leve (12:00, 20:00)", times: ["12:00", "20:00"], max: 2 },
];

const CHANNEL_LABEL: Record<string, string> = {
    WA_STATUS: "Status WhatsApp",
    WA_GROUP: "Grupo WhatsApp",
    IG_STORY: "Instagram Story",
    IG_FEED: "Instagram Feed",
    IG_REELS: "Instagram Reels",
};

export default function AutoPilotPage() {
    const [loading, setLoading] = useState(true);
    const [libraries, setLibraries] = useState<ContentLibraryRow[]>([]);
    const [subscribedLibraries, setSubscribedLibraries] = useState<ContentLibraryRow[]>([]);
    const [rules, setRules] = useState<AutoPostRuleRow[]>([]);
    const [waSessions, setWaSessions] = useState<WaSessionOption[]>([]);
    const [igAccounts, setIgAccounts] = useState<IgAccountOption[]>([]);
    const [groupsBySession, setGroupsBySession] = useState<Record<string, WaGroupOption[]>>({});

    const [copiedCode, setCopiedCode] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    // Modal: Nova Biblioteca
    const [libModalOpen, setLibModalOpen] = useState(false);
    const [libForm, setLibForm] = useState({
        name: "",
        description: "",
        sourceType: "GOOGLE_DRIVE" as "MANUAL" | "GOOGLE_DRIVE",
        driveFolderUrl: "",
        syncHour: "6",
        isShared: true,
    });
    const [savingLib, setSavingLib] = useState(false);

    // Modal: Assinar Repositório de Gerente por Código
    const [joinCodeInput, setJoinCodeInput] = useState("");
    const [joinedPreview, setJoinedPreview] = useState<ContentLibraryRow | null>(null);
    const [lookingUpCode, setLookingUpCode] = useState(false);

    // Modal: Upload Direto de Mídia
    const [uploadLib, setUploadLib] = useState<ContentLibraryRow | null>(null);
    const [uploadForm, setUploadForm] = useState({
        title: "",
        caption: "",
        productUrl: "",
        priceText: "",
        couponCode: "",
    });
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadingItem, setUploadingItem] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    // Modal: Nova Regra Automática
    const [ruleModalOpen, setRuleModalOpen] = useState(false);
    const [ruleForm, setRuleForm] = useState({
        libraryId: "",
        name: "",
        whatsappSessionId: "",
        postWhatsappStatus: true,
        whatsappGroupJids: [] as string[],
        instagramAccountIds: [] as string[],
        instagramPostTypes: ["STORY", "FEED", "REELS"] as Array<"STORY" | "FEED" | "REELS">,
        scheduleTimesText: "09:00, 12:30, 19:00",
        maxPostsPerDay: "3",
        recycleOld: true,
        convertAffiliateLinks: true,
        resellerLink: "",
        resellerWhatsapp: "",
        resellerCoupon: "",
        captionTemplate: "",
        runNow: true,
    });
    const [savingRule, setSavingRule] = useState(false);

    const loadAll = useCallback(async () => {
        try {
            const [libRes, ruleRes, sessRes, igRes] = await Promise.all([
                fetch("/api/autopilot/libraries", { cache: "no-store" }),
                fetch("/api/autopilot/rules", { cache: "no-store" }),
                fetch("/api/sessions", { cache: "no-store" }),
                fetch("/api/instagram/accounts", { cache: "no-store" }),
            ]);

            const [libJson, ruleJson, sessJson, igJson] = await Promise.all([
                libRes.json().catch(() => null),
                ruleRes.json().catch(() => null),
                sessRes.json().catch(() => null),
                igRes.json().catch(() => null),
            ]);

            if (libJson?.status && libJson.data) {
                setLibraries(libJson.data.libraries || []);
                setSubscribedLibraries(libJson.data.subscribedLibraries || []);
            }
            if (ruleJson?.status && Array.isArray(ruleJson.data)) {
                setRules(ruleJson.data);
            }
            if (sessJson?.status && Array.isArray(sessJson.data)) {
                setWaSessions(sessJson.data);
            }
            if (igJson?.status && igJson.data?.accounts) {
                setIgAccounts(igJson.data.accounts);
            }
        } catch {
            toast.error("Erro ao carregar dados da Máquina de Vendas.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadAll();
    }, [loadAll]);

    const loadGroupsForSession = useCallback(
        async (sessionIdKey: string) => {
            if (!sessionIdKey || groupsBySession[sessionIdKey]) return;
            try {
                const res = await fetch(`/api/groups/${encodeURIComponent(sessionIdKey)}`);
                const json = await res.json();
                if (json?.status && Array.isArray(json.data)) {
                    setGroupsBySession((prev) => ({ ...prev, [sessionIdKey]: json.data }));
                }
            } catch {}
        },
        [groupsBySession]
    );

    useEffect(() => {
        if (ruleForm.whatsappSessionId) {
            void loadGroupsForSession(ruleForm.whatsappSessionId);
        }
    }, [ruleForm.whatsappSessionId, loadGroupsForSession]);

    const availableLibraries = [
        ...libraries,
        ...subscribedLibraries.filter((s) => !libraries.some((l) => l.id === s.id)),
        ...(joinedPreview && !libraries.some((l) => l.id === joinedPreview.id) && !subscribedLibraries.some((l) => l.id === joinedPreview.id)
            ? [joinedPreview]
            : []),
    ];

    async function handleCreateLibrary(e: React.FormEvent) {
        e.preventDefault();
        setSavingLib(true);
        try {
            const res = await fetch("/api/autopilot/libraries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: libForm.name,
                    description: libForm.description || null,
                    sourceType: libForm.sourceType,
                    driveFolderUrl: libForm.sourceType === "GOOGLE_DRIVE" ? libForm.driveFolderUrl : null,
                    syncHour: Number(libForm.syncHour) || 6,
                    isShared: libForm.isShared,
                    syncNow: libForm.sourceType === "GOOGLE_DRIVE",
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.error || "Falha ao criar repositório.");
                return;
            }
            if (json.data?.syncWarning) {
                toast.warning(json.message);
            } else {
                toast.success(json.message || "Repositório criado!");
            }
            setLibModalOpen(false);
            setLibForm({
                name: "",
                description: "",
                sourceType: "GOOGLE_DRIVE",
                driveFolderUrl: "",
                syncHour: "6",
                isShared: true,
            });
            await loadAll();
        } catch {
            toast.error("Erro ao criar repositório.");
        } finally {
            setSavingLib(false);
        }
    }

    async function handleSyncDrive(libId: string) {
        setBusyId(libId);
        try {
            const res = await fetch(`/api/autopilot/libraries/${libId}/sync`, { method: "POST" });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.error || "Não foi possível sincronizar a pasta do Drive.");
            } else {
                toast.success(json.message || "Sincronizado!");
            }
            await loadAll();
        } catch {
            toast.error("Erro ao sincronizar pasta.");
        } finally {
            setBusyId(null);
        }
    }

    async function handleToggleShare(lib: ContentLibraryRow) {
        setBusyId(lib.id);
        try {
            const res = await fetch(`/api/autopilot/libraries/${lib.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isShared: !lib.isShared }),
            });
            const json = await res.json();
            if (json.status) {
                toast.success(
                    !lib.isShared
                        ? "Repositório compartilhado! Envie o código aos revendedores."
                        : "Compartilhamento desativado."
                );
                await loadAll();
            }
        } catch {
            toast.error("Erro ao atualizar compartilhamento.");
        } finally {
            setBusyId(null);
        }
    }

    async function handleDeleteLibrary(libId: string) {
        setBusyId(libId);
        try {
            const res = await fetch(`/api/autopilot/libraries/${libId}`, { method: "DELETE" });
            const json = await res.json();
            if (json.status) {
                toast.success("Repositório removido.");
                await loadAll();
            } else {
                toast.error(json.error || "Erro ao remover repositório.");
            }
        } catch {
            toast.error("Erro ao remover repositório.");
        } finally {
            setBusyId(null);
        }
    }

    async function handleUploadItem(e: React.FormEvent) {
        e.preventDefault();
        if (!uploadLib || !uploadFile) {
            toast.error("Selecione uma foto ou vídeo.");
            return;
        }
        setUploadingItem(true);
        try {
            const fd = new FormData();
            fd.append("file", uploadFile);
            fd.append("title", uploadForm.title);
            fd.append("caption", uploadForm.caption);
            fd.append("productUrl", uploadForm.productUrl);
            fd.append("priceText", uploadForm.priceText);
            fd.append("couponCode", uploadForm.couponCode);

            const res = await fetch(`/api/autopilot/libraries/${uploadLib.id}/items`, {
                method: "POST",
                body: fd,
            });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.error || "Falha ao enviar mídia.");
                return;
            }
            toast.success(json.message || "Mídia adicionada!");
            setUploadLib(null);
            setUploadFile(null);
            setUploadForm({ title: "", caption: "", productUrl: "", priceText: "", couponCode: "" });
            if (fileRef.current) fileRef.current.value = "";
            await loadAll();
        } catch {
            toast.error("Erro ao enviar arquivo.");
        } finally {
            setUploadingItem(false);
        }
    }

    async function handleDeleteItem(itemId: string) {
        setBusyId(itemId);
        try {
            const res = await fetch(`/api/autopilot/items/${itemId}`, { method: "DELETE" });
            const json = await res.json();
            if (json.status) {
                toast.success("Mídia removida.");
                await loadAll();
            }
        } catch {
            toast.error("Erro ao remover mídia.");
        } finally {
            setBusyId(null);
        }
    }

    async function handleLookupShareCode() {
        const code = joinCodeInput.trim().toUpperCase();
        if (!code) return;
        setLookingUpCode(true);
        try {
            const res = await fetch(`/api/autopilot/libraries?shareCode=${encodeURIComponent(code)}`);
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.error || "Código não encontrado.");
                setJoinedPreview(null);
                return;
            }
            setJoinedPreview(json.data);
            setRuleForm((prev) => ({
                ...prev,
                libraryId: json.data.id,
                name: prev.name || `Auto-Post ${json.data.name}`,
            }));
            setRuleModalOpen(true);
            toast.success(`Repositório "${json.data.name}" encontrado! Configure onde postar.`);
        } catch {
            toast.error("Erro ao buscar código do repositório.");
        } finally {
            setLookingUpCode(false);
        }
    }

    function openNewRuleModal(defaultLibraryId?: string) {
        const libId = defaultLibraryId || availableLibraries[0]?.id || "";
        const selectedLib = availableLibraries.find((l) => l.id === libId);
        setRuleForm({
            libraryId: libId,
            name: selectedLib ? `Auto-Post ${selectedLib.name}` : "Minha Máquina de Vendas",
            whatsappSessionId: waSessions[0]?.sessionId || "",
            postWhatsappStatus: waSessions.length > 0,
            whatsappGroupJids: [],
            instagramAccountIds: igAccounts.length > 0 ? [igAccounts[0].id] : [],
            instagramPostTypes: ["STORY", "FEED", "REELS"],
            scheduleTimesText: "09:00, 12:30, 19:00",
            maxPostsPerDay: "3",
            recycleOld: true,
            convertAffiliateLinks: true,
            resellerLink: "",
            resellerWhatsapp: "",
            resellerCoupon: "",
            captionTemplate: "",
            runNow: true,
        });
        setRuleModalOpen(true);
    }

    async function handleCreateRule(e: React.FormEvent) {
        e.preventDefault();
        const times = ruleForm.scheduleTimesText
            .split(/[,;\s]+/)
            .map((t) => t.trim())
            .filter((t) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(t));

        if (times.length === 0) {
            toast.error("Informe pelo menos um horário válido no formato HH:MM (ex: 09:00, 12:30).");
            return;
        }

        setSavingRule(true);
        try {
            const res = await fetch("/api/autopilot/rules", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    libraryId: ruleForm.libraryId,
                    name: ruleForm.name,
                    whatsappSessionId: ruleForm.whatsappSessionId || null,
                    postWhatsappStatus: ruleForm.postWhatsappStatus,
                    whatsappGroupJids: ruleForm.whatsappGroupJids,
                    instagramAccountIds: ruleForm.instagramAccountIds,
                    instagramPostTypes: ruleForm.instagramPostTypes,
                    scheduleTimes: times,
                    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    maxPostsPerDay: Math.max(1, Number(ruleForm.maxPostsPerDay) || 3),
                    recycleOld: ruleForm.recycleOld,
                    convertAffiliateLinks: ruleForm.convertAffiliateLinks,
                    resellerLink: ruleForm.resellerLink || null,
                    resellerWhatsapp: ruleForm.resellerWhatsapp || null,
                    resellerCoupon: ruleForm.resellerCoupon || null,
                    captionTemplate: ruleForm.captionTemplate || null,
                    runNow: ruleForm.runNow,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.error || "Não foi possível salvar a automação.");
                return;
            }
            toast.success(json.message || "Automação criada!");
            setRuleModalOpen(false);
            await loadAll();
        } catch {
            toast.error("Erro ao criar automação.");
        } finally {
            setSavingRule(false);
        }
    }

    async function handleRunRuleNow(ruleId: string) {
        setBusyId(ruleId);
        try {
            const res = await fetch(`/api/autopilot/rules/${ruleId}/run`, { method: "POST" });
            const json = await res.json();
            if (json.status) {
                toast.success(json.message || "Fila preenchida!");
                await loadAll();
            } else {
                toast.error(json.error || "Erro ao executar regra.");
            }
        } catch {
            toast.error("Erro ao executar regra.");
        } finally {
            setBusyId(null);
        }
    }

    async function handleToggleRule(rule: AutoPostRuleRow) {
        setBusyId(rule.id);
        try {
            const res = await fetch(`/api/autopilot/rules/${rule.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: !rule.isActive }),
            });
            const json = await res.json();
            if (json.status) {
                toast.success(!rule.isActive ? "Automação ativada!" : "Automação pausada.");
                await loadAll();
            }
        } catch {
            toast.error("Erro ao atualizar automação.");
        } finally {
            setBusyId(null);
        }
    }

    async function handleDeleteRule(ruleId: string) {
        setBusyId(ruleId);
        try {
            const res = await fetch(`/api/autopilot/rules/${ruleId}`, { method: "DELETE" });
            const json = await res.json();
            if (json.status) {
                toast.success("Automação removida.");
                await loadAll();
            }
        } catch {
            toast.error("Erro ao remover automação.");
        } finally {
            setBusyId(null);
        }
    }

    async function copyCode(code: string) {
        try {
            await navigator.clipboard.writeText(code);
            setCopiedCode(code);
            toast.success(`Código "${code}" copiado! Envie para os revendedores.`);
            setTimeout(() => setCopiedCode((cur) => (cur === code ? null : cur)), 2500);
        } catch {
            toast.error("Não foi possível copiar.");
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[380px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const activeGroups = ruleForm.whatsappSessionId ? groupsBySession[ruleForm.whatsappSessionId] || [] : [];

    return (
        <div className="space-y-6 pb-10">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                            <Rocket className="h-5 w-5" />
                        </span>
                        Máquina de Vendas — Auto-Post (Drive & Repositório)
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Sincronize pastas do Google Drive ou suba vídeos/artes no repositório do gerente e publique automaticamente nos melhores horários no WhatsApp e Instagram com seu link de afiliado ou revenda.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setLibModalOpen(true)}>
                        <FolderSync className="h-4 w-4 mr-2" />
                        Novo Repositório / Drive
                    </Button>
                    <Button onClick={() => openNewRuleModal()} disabled={availableLibraries.length === 0}>
                        <Plus className="h-4 w-4 mr-2" />
                        Nova Máquina de Postagem
                    </Button>
                </div>
            </div>

            {/* Banner para revendedores assinarem repositório do gerente */}
            <Card className="border-primary/20 bg-primary/5">
                <CardContent className="pt-4 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="space-y-0.5 text-sm">
                        <p className="font-semibold flex items-center gap-2">
                            <KeyRound className="h-4 w-4 text-primary" />
                            Você é revendedor ou afiliado e recebeu o código de um gerente?
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Cole o código do repositório compartilhado abaixo para usar automaticamente todas as artes e vídeos com o seu link, cupom ou WhatsApp.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Input
                            placeholder="Ex.: PERFUM-4A1F"
                            value={joinCodeInput}
                            onChange={(e) => setJoinCodeInput(e.target.value)}
                            className="w-44 font-mono uppercase bg-background"
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void handleLookupShareCode()}
                            disabled={lookingUpCode || !joinCodeInput.trim()}
                        >
                            {lookingUpCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "Conectar código"}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Tabs defaultValue="rules" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="rules">
                        Máquinas de Postagem ({rules.length})
                    </TabsTrigger>
                    <TabsTrigger value="libraries">
                        Repositórios & Google Drive ({libraries.length + subscribedLibraries.length})
                    </TabsTrigger>
                </TabsList>

                {/* Aba 1: Máquinas de Postagem (Regras) */}
                <TabsContent value="rules" className="space-y-4">
                    {rules.length === 0 ? (
                        <Card>
                            <CardContent className="py-12 text-center space-y-3">
                                <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground" />
                                <div className="space-y-1">
                                    <p className="font-semibold">Nenhuma máquina automática configurada ainda</p>
                                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                                        {availableLibraries.length === 0
                                            ? "Comece criando um repositório (vinculado a uma pasta pública do Google Drive ou com upload direto) na aba ao lado — ou cole o código de um gerente acima."
                                            : "Você já tem um repositório pronto! Clique abaixo para escolher os canais (WhatsApp Status/Grupos e Instagram) e os melhores horários."}
                                    </p>
                                </div>
                                {availableLibraries.length === 0 ? (
                                    <Button onClick={() => setLibModalOpen(true)}>
                                        <FolderSync className="h-4 w-4 mr-2" />
                                        Criar primeiro repositório
                                    </Button>
                                ) : (
                                    <Button onClick={() => openNewRuleModal()}>
                                        <Plus className="h-4 w-4 mr-2" />
                                        Configurar Máquina de Postagem
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-4">
                            {rules.map((rule) => {
                                const busy = busyId === rule.id;
                                const igIds = Array.isArray(rule.instagramAccountIds) ? rule.instagramAccountIds : [];
                                const igTypes = Array.isArray(rule.instagramPostTypes) ? rule.instagramPostTypes : [];
                                const waGroups = Array.isArray(rule.whatsappGroupJids) ? rule.whatsappGroupJids : [];
                                const times = Array.isArray(rule.scheduleTimes) ? rule.scheduleTimes : [];

                                return (
                                    <Card key={rule.id} className={!rule.isActive ? "opacity-75" : ""}>
                                        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <CardTitle className="text-lg">{rule.name}</CardTitle>
                                                    <Badge variant={rule.isActive ? "default" : "secondary"} className={rule.isActive ? "bg-emerald-600" : ""}>
                                                        {rule.isActive ? "Ativa" : "Pausada"}
                                                    </Badge>
                                                    {rule.convertAffiliateLinks && (
                                                        <Badge variant="outline" className="gap-1 text-xs">
                                                            <Link2 className="h-3 w-3" /> Conversão Afiliado
                                                        </Badge>
                                                    )}
                                                </div>
                                                <CardDescription className="mt-1">
                                                    Repositório: <strong>{rule.library.name}</strong> ({rule.library._count?.items ?? 0} mídias) • Horários:{" "}
                                                    <span className="font-mono">{times.join(", ")}</span> (até {rule.maxPostsPerDay}/dia)
                                                </CardDescription>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={busy}
                                                    onClick={() => void handleRunRuleNow(rule.id)}
                                                >
                                                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                                                    Agendar próximos horários
                                                </Button>
                                                <Switch
                                                    checked={rule.isActive}
                                                    disabled={busy}
                                                    onCheckedChange={() => void handleToggleRule(rule)}
                                                />
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="text-rose-500 hover:text-rose-600"
                                                    disabled={busy}
                                                    onClick={() => void handleDeleteRule(rule.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="flex flex-wrap gap-2 text-xs">
                                                {rule.postWhatsappStatus && (
                                                    <Badge variant="outline" className="gap-1">
                                                        <Smartphone className="h-3 w-3 text-emerald-600" /> Status WhatsApp
                                                    </Badge>
                                                )}
                                                {waGroups.length > 0 && (
                                                    <Badge variant="outline" className="gap-1">
                                                        <Users className="h-3 w-3 text-emerald-600" /> {waGroups.length} Grupo(s) WA
                                                    </Badge>
                                                )}
                                                {igIds.length > 0 && (
                                                    <Badge variant="outline" className="gap-1">
                                                        <Instagram className="h-3 w-3 text-pink-600" /> {igIds.length} Conta(s) IG ({igTypes.join("/")})
                                                    </Badge>
                                                )}
                                                {rule.resellerCoupon && (
                                                    <Badge variant="secondary">Cupom: {rule.resellerCoupon}</Badge>
                                                )}
                                                {rule.resellerWhatsapp && (
                                                    <Badge variant="secondary">WA Vendas: {rule.resellerWhatsapp}</Badge>
                                                )}
                                            </div>

                                            {/* Últimas postagens geradas */}
                                            <div>
                                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                                    Últimas postagens programadas ({rule.dispatches.length})
                                                </p>
                                                {rule.dispatches.length === 0 ? (
                                                    <p className="text-xs text-muted-foreground">
                                                        Clique em <strong>Agendar próximos horários</strong> ou adicione mídias no repositório para preencher a fila.
                                                    </p>
                                                ) : (
                                                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                        {rule.dispatches.slice(0, 6).map((d) => (
                                                            <div key={d.id} className="rounded-lg border p-2.5 text-xs space-y-1 bg-muted/20">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="font-semibold truncate">{d.item?.title || "Mídia"}</span>
                                                                    <Badge variant="outline" className="text-[10px]">
                                                                        {CHANNEL_LABEL[d.channel] || d.channel}
                                                                    </Badge>
                                                                </div>
                                                                <div className="flex items-center gap-1 text-muted-foreground">
                                                                    <Clock className="h-3 w-3" />
                                                                    {new Date(d.scheduledAt).toLocaleString("pt-BR", {
                                                                        dateStyle: "short",
                                                                        timeStyle: "short",
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </TabsContent>

                {/* Aba 2: Repositórios & Google Drive */}
                <TabsContent value="libraries" className="space-y-4">
                    {libraries.length === 0 && subscribedLibraries.length === 0 ? (
                        <Card>
                            <CardContent className="py-12 text-center space-y-3">
                                <FolderSync className="h-10 w-10 mx-auto text-muted-foreground" />
                                <p className="font-semibold">Nenhum repositório criado ainda</p>
                                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                                    Você pode conectar uma pasta pública do Google Drive (sincronizada diariamente) ou criar um repositório interno para o seu gerente subir fotos e vídeos dos produtos.
                                </p>
                                <Button onClick={() => setLibModalOpen(true)}>
                                    <Plus className="h-4 w-4 mr-2" /> Criar Repositório / Conectar Drive
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {libraries.map((lib) => {
                                const busy = busyId === lib.id;
                                const items = lib.items || [];
                                return (
                                    <Card key={lib.id}>
                                        <CardHeader className="pb-3 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <CardTitle className="text-lg">{lib.name}</CardTitle>
                                                    <Badge variant="outline">
                                                        {lib.sourceType === "GOOGLE_DRIVE" ? "Google Drive (Sync diário)" : "Upload Direto"}
                                                    </Badge>
                                                    {lib.isShared && lib.shareCode && (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            className="h-6 px-2 text-xs font-mono gap-1"
                                                            onClick={() => void copyCode(lib.shareCode!)}
                                                        >
                                                            {copiedCode === lib.shareCode ? (
                                                                <Check className="h-3 w-3 text-emerald-600" />
                                                            ) : (
                                                                <Copy className="h-3 w-3" />
                                                            )}
                                                            Código: {lib.shareCode}
                                                        </Button>
                                                    )}
                                                </div>
                                                {lib.description && <CardDescription>{lib.description}</CardDescription>}
                                                {lib.sourceType === "GOOGLE_DRIVE" && (
                                                    <p className="text-xs text-muted-foreground">
                                                        Sync automático todo dia às {String(lib.syncHour).padStart(2, "0")}:00 • Último sync:{" "}
                                                        {lib.lastSyncedAt ? new Date(lib.lastSyncedAt).toLocaleString("pt-BR") : "Ainda não sincronizado"}
                                                    </p>
                                                )}
                                                {lib.lastSyncError && (
                                                    <p className="text-xs text-rose-600 bg-rose-500/10 rounded px-2 py-1 mt-1">
                                                        {lib.lastSyncError}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2">
                                                {lib.sourceType === "GOOGLE_DRIVE" && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={busy}
                                                        onClick={() => void handleSyncDrive(lib.id)}
                                                    >
                                                        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${busy ? "animate-spin" : ""}`} />
                                                        Sincronizar Drive agora
                                                    </Button>
                                                )}
                                                <Button size="sm" variant="outline" onClick={() => setUploadLib(lib)}>
                                                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                                                    Enviar Foto/Vídeo
                                                </Button>
                                                <Button size="sm" onClick={() => openNewRuleModal(lib.id)}>
                                                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                                                    Automatizar postagens
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={busy}
                                                    onClick={() => void handleToggleShare(lib)}
                                                    title="Compartilhar com rede de revendedores"
                                                >
                                                    <Share2 className={`h-4 w-4 ${lib.isShared ? "text-emerald-600" : "text-muted-foreground"}`} />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="text-rose-500 hover:text-rose-600"
                                                    disabled={busy}
                                                    onClick={() => void handleDeleteLibrary(lib.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            {items.length === 0 ? (
                                                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                                                    Nenhuma mídia importada ainda neste repositório. Clique em <strong>Enviar Foto/Vídeo</strong> ou <strong>Sincronizar Drive agora</strong>.
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                                    {items.map((item) => (
                                                        <div key={item.id} className="group relative rounded-lg border overflow-hidden bg-muted/20">
                                                            <div className="aspect-square bg-black/5 flex items-center justify-center overflow-hidden">
                                                                {item.mediaType === "VIDEO" ? (
                                                                    <video
                                                                        src={`/api/autopilot/media/${encodeURIComponent(item.filename)}`}
                                                                        className="h-full w-full object-cover"
                                                                        muted
                                                                        playsInline
                                                                    />
                                                                ) : (
                                                                    // eslint-disable-next-line @next/next/no-img-element
                                                                    <img
                                                                        src={`/api/autopilot/media/${encodeURIComponent(item.filename)}`}
                                                                        alt={item.title}
                                                                        className="h-full w-full object-cover"
                                                                    />
                                                                )}
                                                            </div>
                                                            <div className="p-2 space-y-0.5">
                                                                <div className="flex items-center justify-between gap-1">
                                                                    <span className="text-xs font-medium truncate" title={item.title}>
                                                                        {item.title}
                                                                    </span>
                                                                    {item.mediaType === "VIDEO" ? (
                                                                        <Film className="h-3 w-3 text-muted-foreground shrink-0" />
                                                                    ) : (
                                                                        <ImageIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                                                                    )}
                                                                </div>
                                                                {item.priceText && (
                                                                    <p className="text-[11px] font-semibold text-emerald-700">{item.priceText}</p>
                                                                )}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleDeleteItem(item.id)}
                                                                className="absolute top-1.5 right-1.5 rounded-full bg-black/70 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                                                title="Remover mídia"
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                );
                            })}

                            {subscribedLibraries.length > 0 && (
                                <div className="space-y-2 pt-2">
                                    <h3 className="text-sm font-semibold text-muted-foreground">Repositórios de Gerentes Assinados</h3>
                                    {subscribedLibraries.map((lib) => (
                                        <Card key={lib.id}>
                                            <CardHeader className="pb-2 flex flex-row items-center justify-between">
                                                <div>
                                                    <CardTitle className="text-base">{lib.name}</CardTitle>
                                                    <CardDescription>
                                                        Gerente: {lib.user?.name || "Compartilhado"} • {lib._count?.items ?? 0} mídias disponíveis
                                                    </CardDescription>
                                                </div>
                                                <Button size="sm" onClick={() => openNewRuleModal(lib.id)}>
                                                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Nova regra com este repositório
                                                </Button>
                                            </CardHeader>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* Modal: Novo Repositório / Google Drive */}
            <Dialog open={libModalOpen} onOpenChange={setLibModalOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Criar Repositório de Conteúdo</DialogTitle>
                        <DialogDescription>
                            Conecte uma pasta pública do Google Drive ou crie uma biblioteca para o gerente enviar artes e vídeos manualmente.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateLibrary} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>Nome do repositório</Label>
                            <Input
                                placeholder="Ex.: Catálogo Perfumes Masculinos / Ofertas Shopee"
                                value={libForm.name}
                                onChange={(e) => setLibForm((p) => ({ ...p, name: e.target.value }))}
                                required
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>Origem das mídias</Label>
                            <Select
                                value={libForm.sourceType}
                                onValueChange={(v) => setLibForm((p) => ({ ...p, sourceType: v as "MANUAL" | "GOOGLE_DRIVE" }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="GOOGLE_DRIVE">Pasta do Google Drive (Sincronização diária)</SelectItem>
                                    <SelectItem value="MANUAL">Repositório Interno (Upload pelo gerente no painel)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {libForm.sourceType === "GOOGLE_DRIVE" && (
                            <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
                                <div className="space-y-1.5">
                                    <Label>Link da pasta do Google Drive</Label>
                                    <Input
                                        placeholder="https://drive.google.com/drive/folders/..."
                                        value={libForm.driveFolderUrl}
                                        onChange={(e) => setLibForm((p) => ({ ...p, driveFolderUrl: e.target.value }))}
                                        required
                                    />
                                    <p className="text-[11px] text-muted-foreground">
                                        No Google Drive, clique com o botão direito na pasta → <strong>Compartilhar</strong> → deixe como{" "}
                                        <strong>&quot;Qualquer pessoa com o link (Leitor)&quot;</strong>. Dica: coloque um arquivo <code>nome_video.txt</code> ao lado do vídeo com legenda, preço e link!
                                    </p>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Horário da sincronização automática diária</Label>
                                    <Select
                                        value={libForm.syncHour}
                                        onValueChange={(v) => setLibForm((p) => ({ ...p, syncHour: v }))}
                                    >
                                        <SelectTrigger className="w-40">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {[5, 6, 7, 8, 9, 12, 18, 22].map((h) => (
                                                <SelectItem key={h} value={String(h)}>
                                                    {String(h).padStart(2, "0")}:00 diariamente
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                                <p className="text-sm font-medium">Compartilhar com revendedores (gerar código)</p>
                                <p className="text-xs text-muted-foreground">
                                    Permite que seus vendedores conectem suas contas e postem essas artes com o próprio link/cupom.
                                </p>
                            </div>
                            <Switch
                                checked={libForm.isShared}
                                onCheckedChange={(v) => setLibForm((p) => ({ ...p, isShared: v }))}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setLibModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={savingLib}>
                                {savingLib ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Criar e sincronizar
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Modal: Upload Direto de Mídia */}
            <Dialog open={Boolean(uploadLib)} onOpenChange={(o) => !o && setUploadLib(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Enviar mídia para {uploadLib?.name}</DialogTitle>
                        <DialogDescription>
                            Suba uma foto ou vídeo (até 100 MB). Todas as automações conectadas receberão o item na fila.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleUploadItem} className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Arquivo (JPG, PNG, WEBP, MP4 ou MOV)</Label>
                            <Input
                                ref={fileRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Nome do produto / título</Label>
                            <Input
                                placeholder="Ex.: Perfume Árabe Lattafa Asad 100ml"
                                value={uploadForm.title}
                                onChange={(e) => setUploadForm((p) => ({ ...p, title: e.target.value }))}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Preço (opcional)</Label>
                                <Input
                                    placeholder="R$ 189,90"
                                    value={uploadForm.priceText}
                                    onChange={(e) => setUploadForm((p) => ({ ...p, priceText: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Cupom padrão (opcional)</Label>
                                <Input
                                    placeholder="PERFUME10"
                                    value={uploadForm.couponCode}
                                    onChange={(e) => setUploadForm((p) => ({ ...p, couponCode: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Link do produto (Shopee, Mercado Livre ou catálogo)</Label>
                            <Input
                                placeholder="https://shopee.com.br/..."
                                value={uploadForm.productUrl}
                                onChange={(e) => setUploadForm((p) => ({ ...p, productUrl: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Legenda modelo</Label>
                            <Textarea
                                rows={3}
                                placeholder="Descrição persuasiva do produto..."
                                value={uploadForm.caption}
                                onChange={(e) => setUploadForm((p) => ({ ...p, caption: e.target.value }))}
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setUploadLib(null)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={uploadingItem}>
                                {uploadingItem ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Enviar mídia
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Modal: Nova Máquina de Postagem (Regra) */}
            <Dialog open={ruleModalOpen} onOpenChange={setRuleModalOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Configurar Máquina de Postagem Automática</DialogTitle>
                        <DialogDescription>
                            Escolha o repositório, onde postar (WhatsApp e/ou Instagram), os melhores horários e seus dados de afiliado/revendedor.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateRule} className="space-y-5">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Repositório de origem</Label>
                                <Select
                                    value={ruleForm.libraryId}
                                    onValueChange={(v) => setRuleForm((p) => ({ ...p, libraryId: v }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione um repositório" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableLibraries.map((l) => (
                                            <SelectItem key={l.id} value={l.id}>
                                                {l.name} ({l._count?.items ?? 0} mídias)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Nome desta automação</Label>
                                <Input
                                    value={ruleForm.name}
                                    onChange={(e) => setRuleForm((p) => ({ ...p, name: e.target.value }))}
                                    required
                                />
                            </div>
                        </div>

                        {/* Destinos WhatsApp */}
                        <div className="rounded-lg border p-3.5 space-y-3">
                            <p className="text-sm font-semibold flex items-center gap-2">
                                <Smartphone className="h-4 w-4 text-emerald-600" />
                                Onde postar no WhatsApp
                            </p>
                            {waSessions.length === 0 ? (
                                <p className="text-xs text-muted-foreground">Nenhuma sessão WhatsApp conectada ainda.</p>
                            ) : (
                                <>
                                    <Select
                                        value={ruleForm.whatsappSessionId || "__none__"}
                                        onValueChange={(v) =>
                                            setRuleForm((p) => ({
                                                ...p,
                                                whatsappSessionId: v === "__none__" ? "" : v,
                                                whatsappGroupJids: [],
                                            }))
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione a conexão WhatsApp" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none__">Não postar no WhatsApp</SelectItem>
                                            {waSessions.map((s) => (
                                                <SelectItem key={s.id} value={s.sessionId}>
                                                    {s.name} ({s.status})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>

                                    {ruleForm.whatsappSessionId && (
                                        <div className="space-y-2.5 pt-1">
                                            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                                                <Checkbox
                                                    checked={ruleForm.postWhatsappStatus}
                                                    onCheckedChange={(c) =>
                                                        setRuleForm((p) => ({ ...p, postWhatsappStatus: Boolean(c) }))
                                                    }
                                                />
                                                Postar automaticamente no <strong>Status do WhatsApp</strong>
                                            </label>

                                            {activeGroups.length > 0 && (
                                                <div className="space-y-1.5">
                                                    <Label className="text-xs text-muted-foreground">
                                                        Grupos de ofertas / clientes ({ruleForm.whatsappGroupJids.length} selecionado(s))
                                                    </Label>
                                                    <div className="max-h-32 overflow-y-auto rounded border p-2 space-y-1.5 bg-background">
                                                        {activeGroups.map((g) => {
                                                            const checked = ruleForm.whatsappGroupJids.includes(g.jid);
                                                            return (
                                                                <label key={g.jid} className="flex items-center gap-2 text-xs cursor-pointer">
                                                                    <Checkbox
                                                                        checked={checked}
                                                                        onCheckedChange={(c) =>
                                                                            setRuleForm((p) => ({
                                                                                ...p,
                                                                                whatsappGroupJids: c
                                                                                    ? [...p.whatsappGroupJids, g.jid]
                                                                                    : p.whatsappGroupJids.filter((x) => x !== g.jid),
                                                                            }))
                                                                        }
                                                                    />
                                                                    <span className="truncate">{g.subject || g.jid}</span>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Destinos Instagram */}
                        <div className="rounded-lg border p-3.5 space-y-3">
                            <p className="text-sm font-semibold flex items-center gap-2">
                                <Instagram className="h-4 w-4 text-pink-600" />
                                Onde postar no Instagram
                            </p>
                            {igAccounts.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    Nenhuma conta do Instagram conectada ainda (conecte na aba Instagram se quiser postar lá também).
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-3">
                                        {igAccounts.map((acc) => {
                                            const checked = ruleForm.instagramAccountIds.includes(acc.id);
                                            return (
                                                <label key={acc.id} className="flex items-center gap-2 text-xs font-medium cursor-pointer border rounded-md px-2.5 py-1.5">
                                                    <Checkbox
                                                        checked={checked}
                                                        onCheckedChange={(c) =>
                                                            setRuleForm((p) => ({
                                                                ...p,
                                                                instagramAccountIds: c
                                                                    ? [...p.instagramAccountIds, acc.id]
                                                                    : p.instagramAccountIds.filter((x) => x !== acc.id),
                                                            }))
                                                        }
                                                    />
                                                    @{acc.username}
                                                </label>
                                            );
                                        })}
                                    </div>

                                    {ruleForm.instagramAccountIds.length > 0 && (
                                        <div className="flex flex-wrap gap-4 text-xs">
                                            {(["STORY", "FEED", "REELS"] as const).map((tp) => {
                                                const checked = ruleForm.instagramPostTypes.includes(tp);
                                                return (
                                                    <label key={tp} className="flex items-center gap-1.5 cursor-pointer">
                                                        <Checkbox
                                                            checked={checked}
                                                            onCheckedChange={(c) =>
                                                                setRuleForm((p) => ({
                                                                    ...p,
                                                                    instagramPostTypes: c
                                                                        ? [...p.instagramPostTypes, tp]
                                                                        : p.instagramPostTypes.filter((x) => x !== tp),
                                                                }))
                                                            }
                                                        />
                                                        {tp === "STORY" ? "Stories" : tp === "FEED" ? "Feed (Fotos)" : "Reels (Vídeos)"}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Melhores Horários */}
                        <div className="rounded-lg border p-3.5 space-y-3">
                            <p className="text-sm font-semibold flex items-center gap-2">
                                <Clock className="h-4 w-4 text-primary" />
                                Melhores Horários Automáticos
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {PRESET_TIMES.map((preset) => (
                                    <Button
                                        key={preset.label}
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        onClick={() =>
                                            setRuleForm((p) => ({
                                                ...p,
                                                scheduleTimesText: preset.times.join(", "),
                                                maxPostsPerDay: String(preset.max),
                                            }))
                                        }
                                    >
                                        {preset.label}
                                    </Button>
                                ))}
                            </div>
                            <div className="grid sm:grid-cols-3 gap-3">
                                <div className="sm:col-span-2 space-y-1">
                                    <Label className="text-xs">Horários (HH:MM separados por vírgula)</Label>
                                    <Input
                                        value={ruleForm.scheduleTimesText}
                                        onChange={(e) => setRuleForm((p) => ({ ...p, scheduleTimesText: e.target.value }))}
                                        placeholder="09:00, 12:30, 18:30"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Máx. por dia</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        max="20"
                                        value={ruleForm.maxPostsPerDay}
                                        onChange={(e) => setRuleForm((p) => ({ ...p, maxPostsPerDay: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <Checkbox
                                    checked={ruleForm.recycleOld}
                                    onCheckedChange={(c) => setRuleForm((p) => ({ ...p, recycleOld: Boolean(c) }))}
                                />
                                Reciclar mídias antigas quando não houver arquivos novos no dia (mantém o perfil ativo)
                            </label>
                        </div>

                        {/* Afiliados e Revenda */}
                        <div className="rounded-lg border p-3.5 space-y-3 bg-muted/20">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-sm font-semibold flex items-center gap-2">
                                        <Link2 className="h-4 w-4 text-primary" />
                                        Afiliados & Personalização do Revendedor
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Converte links Shopee/Mercado Livre automaticamente e injeta o contato/cupom do vendedor.
                                    </p>
                                </div>
                                <Switch
                                    checked={ruleForm.convertAffiliateLinks}
                                    onCheckedChange={(v) => setRuleForm((p) => ({ ...p, convertAffiliateLinks: v }))}
                                />
                            </div>
                            <div className="grid sm:grid-cols-3 gap-2.5">
                                <div className="space-y-1">
                                    <Label className="text-xs">Seu Link / Catálogo (opcional)</Label>
                                    <Input
                                        placeholder="https://sualoja.com/?ref=..."
                                        value={ruleForm.resellerLink}
                                        onChange={(e) => setRuleForm((p) => ({ ...p, resellerLink: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">WhatsApp de Vendas</Label>
                                    <Input
                                        placeholder="(11) 99999-9999"
                                        value={ruleForm.resellerWhatsapp}
                                        onChange={(e) => setRuleForm((p) => ({ ...p, resellerWhatsapp: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Cupom do Vendedor</Label>
                                    <Input
                                        placeholder="MARCELO10"
                                        value={ruleForm.resellerCoupon}
                                        onChange={(e) => setRuleForm((p) => ({ ...p, resellerCoupon: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">
                                    Modelo de legenda (opcional — variáveis: <code>{"{produto}"}</code>, <code>{"{preco}"}</code>, <code>{"{link}"}</code>, <code>{"{cupom}"}</code>, <code>{"{whatsapp}"}</code>, <code>{"{legenda}"}</code>)
                                </Label>
                                <Textarea
                                    rows={2}
                                    placeholder="Deixe vazio para usar a legenda automática completa de cada mídia..."
                                    value={ruleForm.captionTemplate}
                                    onChange={(e) => setRuleForm((p) => ({ ...p, captionTemplate: e.target.value }))}
                                />
                            </div>
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setRuleModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={savingRule}>
                                {savingRule ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Rocket className="h-4 w-4 mr-2" />}
                                Salvar e Agendar
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
