"use client";

import { useState, useEffect } from "react";
import { useSession as useSessionProvider } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    ShoppingBag,
    Save,
    RefreshCw,
    Eye,
    EyeOff,
    Play,
    CheckCircle2,
    AlertCircle,
    MessageSquareText,
    RotateCcw,
    Copy,
    Sparkles,
    Link2,
    BarChart3,
    TrendingUp,
    ExternalLink,
    XCircle,
    Clock,
    Check,
    ArrowUpRight,
    Bot,
    Calendar,
    Search,
    X,
    Filter,
} from "lucide-react";
import { toast } from "sonner";

interface ConversionRecord {
    id: string;
    sessionId: string;
    platform: string;
    originalUrl: string;
    affiliateUrl?: string | null;
    productId?: string | null;
    tag?: string | null;
    senderJid?: string | null;
    status: string;
    errorMessage?: string | null;
    createdAt: string;
}

interface AffiliateStats {
    total: number;
    shopee: number;
    mercadolivre: number;
    recent: ConversionRecord[];
    filteredTotal?: number;
}

interface AffiliateTemplatesState {
    singleSuccess: string;
    multiHeader: string;
    multiItem: string;
    nonProductUrl: string;
    invalidUrl: string;
    unavailablePlatform: string;
    replyWhenUnavailable: boolean;
}

const DEFAULT_TEMPLATES: AffiliateTemplatesState = {
    singleSuccess: "Aqui está o link do produto ({plataforma}):\n{link}",
    multiHeader: "",
    multiItem: "{indice}. {plataforma} ({id}): {link}",
    nonProductUrl:
        "O link enviado do {plataforma} aponta para um perfil, busca ou página geral. Por favor, envie a URL direta da página do produto.",
    invalidUrl:
        "Não foi possível validar o link enviado. Por favor, envie uma URL oficial direta da página do produto.",
    unavailablePlatform:
        "Não foi possível gerar o link de afiliado para {plataforma} no momento.",
    replyWhenUnavailable: true,
};

export default function AffiliatesPage() {
    const { sessionId } = useSessionProvider();

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Estado principal
    const [enabled, setEnabled] = useState(true);

    // Shopee
    const [shopeeEnabled, setShopeeEnabled] = useState(true);
    const [shopeeAppId, setShopeeAppId] = useState("");
    const [shopeeSecret, setShopeeSecret] = useState("");
    const [shopeeHasSecret, setShopeeHasSecret] = useState(false);
    const [shopeeSecretPreview, setShopeeSecretPreview] = useState("");
    const [shopeeApiUrl, setShopeeApiUrl] = useState("https://open-api.affiliate.shopee.com.br/graphql");
    const [shopeeConfigured, setShopeeConfigured] = useState(false);
    const [showShopeeSecret, setShowShopeeSecret] = useState(false);

    // Mercado Livre (configuração opcional por empresa)
    const [mlEnabled, setMlEnabled] = useState(false);
    const [mlApiUrl, setMlApiUrl] = useState("");
    const [mlTag, setMlTag] = useState("");
    const [mlToken, setMlToken] = useState("");
    const [mlHasToken, setMlHasToken] = useState(false);
    const [mlTokenPreview, setMlTokenPreview] = useState("");
    const [mlConfigured, setMlConfigured] = useState(false);
    const [showMlToken, setShowMlToken] = useState(false);

    // Templates de mensagem
    const [templates, setTemplates] = useState<AffiliateTemplatesState>(DEFAULT_TEMPLATES);
    const [activeTemplateField, setActiveTemplateField] = useState<keyof Omit<AffiliateTemplatesState, "replyWhenUnavailable">>("singleSuccess");

    // Simulador / Testador ao vivo
    const [testInput, setTestInput] = useState("");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<any | null>(null);

    // Dashboard / Estatísticas de Conversão
    const [stats, setStats] = useState<AffiliateStats>({
        total: 0,
        shopee: 0,
        mercadolivre: 0,
        recent: [],
    });
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Filtros de busca no histórico de links
    const [filterStartDate, setFilterStartDate] = useState("");
    const [filterEndDate, setFilterEndDate] = useState("");
    const [filterPlatform, setFilterPlatform] = useState("all");
    const [filterStatus, setFilterStatus] = useState("all");
    const [filterSearch, setFilterSearch] = useState("");
    const [dateQuickRange, setDateQuickRange] = useState("all");

    const handleQuickDate = (range: string) => {
        setDateQuickRange(range);
        const today = new Date();
        const formatDate = (d: Date) => d.toISOString().split("T")[0];

        if (range === "today") {
            const t = formatDate(today);
            setFilterStartDate(t);
            setFilterEndDate(t);
        } else if (range === "yesterday") {
            const y = new Date();
            y.setDate(y.getDate() - 1);
            const str = formatDate(y);
            setFilterStartDate(str);
            setFilterEndDate(str);
        } else if (range === "7days") {
            const past = new Date();
            past.setDate(past.getDate() - 7);
            setFilterStartDate(formatDate(past));
            setFilterEndDate(formatDate(today));
        } else if (range === "30days") {
            const past = new Date();
            past.setDate(past.getDate() - 30);
            setFilterStartDate(formatDate(past));
            setFilterEndDate(formatDate(today));
        } else if (range === "all") {
            setFilterStartDate("");
            setFilterEndDate("");
        }
    };

    const handleClearFilters = () => {
        setFilterStartDate("");
        setFilterEndDate("");
        setFilterPlatform("all");
        setFilterStatus("all");
        setFilterSearch("");
        setDateQuickRange("all");
    };

    const isFilterActive = Boolean(
        filterStartDate || filterEndDate || filterPlatform !== "all" || filterStatus !== "all" || filterSearch.trim()
    );

    // Bot de IA Gemini (Status e controle rápido)
    const [aiEnabled, setAiEnabled] = useState(false);
    const [togglingAi, setTogglingAi] = useState(false);

    const handleToggleAi = async (checked: boolean) => {
        setTogglingAi(true);
        setAiEnabled(checked);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/bot-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ aiEnabled: checked })
            });
            if (res.ok) {
                toast.success(checked ? "Atendimento com IA (Gemini) ativado!" : "Atendimento com IA (Gemini) desativado com sucesso!");
            } else {
                setAiEnabled(!checked);
                toast.error("Falha ao salvar status da IA.");
            }
        } catch {
            setAiEnabled(!checked);
            toast.error("Erro de conexão ao alterar status da IA.");
        } finally {
            setTogglingAi(false);
        }
    };

    const handleCopyLink = (id: string, url: string) => {
        navigator.clipboard.writeText(url);
        setCopiedId(id);
        toast.success("Link de afiliado copiado!");
        setTimeout(() => setCopiedId(null), 2000);
    };

    const formatSender = (jid?: string | null) => {
        if (!jid) return "Simulação/Sistema";
        const cleaned = jid.replace("@s.whatsapp.net", "").replace("@c.us", "").replace("@lid", "");
        if (cleaned.startsWith("55") && cleaned.length >= 12) {
            const ddd = cleaned.slice(2, 4);
            const num = cleaned.slice(4);
            return `+55 (${ddd}) ${num}`;
        }
        return cleaned;
    };

    const loadSettings = async (overrideFilters?: {
        startDate?: string;
        endDate?: string;
        platform?: string;
        status?: string;
        search?: string;
    }) => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const sDate = overrideFilters?.startDate !== undefined ? overrideFilters.startDate : filterStartDate;
            const eDate = overrideFilters?.endDate !== undefined ? overrideFilters.endDate : filterEndDate;
            const plat = overrideFilters?.platform !== undefined ? overrideFilters.platform : filterPlatform;
            const stat = overrideFilters?.status !== undefined ? overrideFilters.status : filterStatus;
            const q = overrideFilters?.search !== undefined ? overrideFilters.search : filterSearch;

            const params = new URLSearchParams();
            if (sDate) params.set("startDate", sDate);
            if (eDate) params.set("endDate", eDate);
            if (plat && plat !== "all") params.set("platform", plat);
            if (stat && stat !== "all") params.set("status", stat);
            if (q && q.trim()) params.set("search", q.trim());

            const qs = params.toString() ? `?${params.toString()}` : "";
            const res = await fetch(`/api/affiliates/${sessionId}${qs}`);
            const json = await res.json();
            if (res.ok && json.status && json.data) {
                const d = json.data;
                setEnabled(Boolean(d.enabled));

                setShopeeEnabled(Boolean(d.shopee?.enabled));
                setShopeeAppId(d.shopee?.appId || "");
                setShopeeSecret("");
                setShopeeHasSecret(Boolean(d.shopee?.hasSecret));
                setShopeeSecretPreview(d.shopee?.secretPreview || "");
                setShopeeApiUrl(d.shopee?.apiUrl || "https://open-api.affiliate.shopee.com.br/graphql");
                setShopeeConfigured(Boolean(d.shopee?.configured));

                setMlEnabled(Boolean(d.mercadolivre?.enabled));
                setMlApiUrl(d.mercadolivre?.apiUrl || "");
                setMlTag(d.mercadolivre?.tag || "");
                setMlToken("");
                setMlHasToken(Boolean(d.mercadolivre?.hasToken));
                setMlTokenPreview(d.mercadolivre?.tokenPreview || "");
                setMlConfigured(Boolean(d.mercadolivre?.configured));

                if (d.stats) {
                    setStats({
                        total: Number(d.stats.total) || 0,
                        shopee: Number(d.stats.shopee) || 0,
                        mercadolivre: Number(d.stats.mercadolivre) || 0,
                        recent: Array.isArray(d.stats.recent) ? d.stats.recent : [],
                        filteredTotal: d.stats.filteredTotal !== undefined ? Number(d.stats.filteredTotal) : undefined,
                    });
                }

                if (d.templates) {
                    setTemplates({
                        ...DEFAULT_TEMPLATES,
                        ...d.templates,
                    });
                }
            }

            // Carrega status da IA Gemini
            try {
                const botRes = await fetch(`/api/sessions/${sessionId}/bot-config`);
                const botJson = await botRes.json();
                if (botRes.ok && botJson.status && botJson.data) {
                    setAiEnabled(Boolean(botJson.data.aiEnabled));
                }
            } catch {}
        } catch {
            toast.error("Não foi possível carregar as configurações de afiliados.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!sessionId) return;
        const timer = setTimeout(() => {
            loadSettings();
        }, 250);
        return () => clearTimeout(timer);
    }, [sessionId, filterStartDate, filterEndDate, filterPlatform, filterStatus, filterSearch]);

    const handleSave = async () => {
        if (!sessionId) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/affiliates/${sessionId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    enabled,
                    shopee: {
                        enabled: shopeeEnabled,
                        appId: shopeeAppId,
                        secret: shopeeSecret, // Se vazio, o backend preserva o segredo atual
                        apiUrl: shopeeApiUrl,
                    },
                    mercadolivre: {
                        enabled: mlEnabled,
                        apiUrl: mlApiUrl,
                        tag: mlTag,
                        token: mlToken, // Se vazio, o backend preserva o token atual
                    },
                    templates,
                }),
            });

            const json = await res.json();
            if (res.ok && json.status) {
                toast.success("Configurações e mensagens de afiliados salvas com sucesso!");
                await loadSettings();
            } else {
                toast.error(json.message || "Falha ao salvar configurações.");
            }
        } catch {
            toast.error("Erro ao salvar configurações de afiliados.");
        } finally {
            setSaving(false);
        }
    };

    const handleInsertVariable = (variable: string) => {
        setTemplates((prev) => ({
            ...prev,
            [activeTemplateField]: `${prev[activeTemplateField] || ""}${variable}`,
        }));
        toast.info(`Variável ${variable} inserida no campo selecionado.`);
    };

    const handleRestoreDefaultTemplates = () => {
        setTemplates(DEFAULT_TEMPLATES);
        toast.info("Textos padrão restaurados. Clique em Salvar para aplicar.");
    };

    const handleRunTest = async () => {
        if (!sessionId) return;
        if (!testInput.trim()) {
            toast.warning("Cole um link ou mensagem com link para testar.");
            return;
        }
        setTesting(true);
        setTestResult(null);
        try {
            const res = await fetch(`/api/affiliates/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ testText: testInput }),
            });
            const json = await res.json();
            if (res.ok && json.status) {
                setTestResult(json.data);
                if (json.data?.replied) {
                    toast.success("Simulação concluída com sucesso!");
                } else {
                    toast.info(`Simulação concluída (${json.data?.skippedReason || "sem resposta"}).`);
                }
                await loadSettings();
            } else {
                toast.error(json.message || "Falha ao testar link.");
            }
        } catch {
            toast.error("Erro ao executar teste de conversão.");
        } finally {
            setTesting(false);
        }
    };

    return (
        <SessionGuard>
            <div className="space-y-6">
                {/* Cabeçalho */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-xl sm:text-3xl font-bold tracking-tight flex items-center gap-2.5">
                            <ShoppingBag className="h-7 w-7 text-primary" />
                            Links de Afiliados (Shopee & Mercado Livre)
                        </h2>
                        <p className="text-muted-foreground text-sm mt-1">
                            Gerencie suas credenciais (App ID, Secret / Token) e personalize as mensagens automáticas enviadas no WhatsApp.
                        </p>
                    </div>
                    <Button onClick={handleSave} disabled={saving || loading || !sessionId} className="w-full sm:w-auto">
                        {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Salvar todas as configurações
                    </Button>
                </div>

                {/* Dashboard de Métricas */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card className="border-border/60 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-xs sm:text-sm font-medium">Total de Conversões</CardTitle>
                            <BarChart3 className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold tracking-tight">{stats.total}</div>
                            <p className="text-xs text-muted-foreground mt-1">Links processados</p>
                        </CardContent>
                    </Card>

                    <Card className="border-orange-500/30 bg-orange-500/5 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-xs sm:text-sm font-medium text-orange-600 dark:text-orange-400">
                                Shopee Afiliados
                            </CardTitle>
                            <ShoppingBag className="h-4 w-4 text-orange-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold tracking-tight text-orange-600 dark:text-orange-400">
                                {stats.shopee}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Gerados com sucesso</p>
                        </CardContent>
                    </Card>

                    <Card className="border-yellow-500/30 bg-yellow-500/5 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-xs sm:text-sm font-medium text-yellow-600 dark:text-yellow-400">
                                Mercado Livre
                            </CardTitle>
                            <Sparkles className="h-4 w-4 text-yellow-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold tracking-tight text-yellow-600 dark:text-yellow-400">
                                {stats.mercadolivre}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                {mlTag ? `Etiqueta: ${mlTag}` : "Integração opcional por empresa"}
                            </p>
                        </CardContent>
                    </Card>

                    <Card className="border-emerald-500/30 bg-emerald-500/5 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-xs sm:text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                Taxa de Sucesso
                            </CardTitle>
                            <TrendingUp className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                                {stats.total > 0
                                    ? `${Math.round(((stats.shopee + stats.mercadolivre) / stats.total) * 100)}%`
                                    : "100%"}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Links convertidos válidos</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Histórico Recente de Conversões */}
                <Card>
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Clock className="h-5 w-5 text-primary" />
                                    Histórico de Links Gerados
                                </CardTitle>
                                {stats.filteredTotal !== undefined && stats.filteredTotal !== stats.total ? (
                                    <Badge variant="secondary" className="text-xs">
                                        {stats.recent.length} de {stats.filteredTotal} {stats.filteredTotal === 1 ? "filtrado" : "filtrados"} (total: {stats.total})
                                    </Badge>
                                ) : stats.recent.length > 0 ? (
                                    <Badge variant="secondary" className="text-xs">
                                        {stats.recent.length} {stats.recent.length === 1 ? "registro" : "registros"}
                                    </Badge>
                                ) : null}
                            </div>
                            <CardDescription className="mt-1">
                                Acompanhe os links recebidos no WhatsApp e convertidos para seus links comissionados (use o filtro de data e busca abaixo).
                            </CardDescription>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => loadSettings()}
                            disabled={loading || !sessionId}
                            className="self-start sm:self-auto h-8 text-xs"
                        >
                            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                            Atualizar
                        </Button>
                    </CardHeader>
                    <CardContent className="p-0 sm:p-6 sm:pt-0 space-y-4">
                        {/* Barra de Filtros de Data e Busca */}
                        <div className="p-3.5 sm:p-4 rounded-lg border bg-muted/20 mx-4 sm:mx-0 space-y-3">
                            {/* Linha 1: Campo de Busca e Botões Rápidos de Data */}
                            <div className="flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-center justify-between">
                                <div className="relative flex-1 min-w-[220px]">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Buscar por link, produto (MLB/Shopee) ou número..."
                                        value={filterSearch}
                                        onChange={(e) => setFilterSearch(e.target.value)}
                                        className="pl-9 pr-8 h-9 text-xs bg-background"
                                    />
                                    {filterSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setFilterSearch("")}
                                            className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                                            title="Limpar busca"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>

                                {/* Botões rápidos de intervalo de data */}
                                <div className="flex flex-wrap items-center gap-1">
                                    <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1 font-medium">
                                        <Calendar className="h-3.5 w-3.5" /> Período:
                                    </span>
                                    <Button
                                        type="button"
                                        variant={dateQuickRange === "all" ? "default" : "outline"}
                                        size="sm"
                                        className="h-7 text-xs px-2.5"
                                        onClick={() => handleQuickDate("all")}
                                    >
                                        Todos
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={dateQuickRange === "today" ? "default" : "outline"}
                                        size="sm"
                                        className="h-7 text-xs px-2.5"
                                        onClick={() => handleQuickDate("today")}
                                    >
                                        Hoje
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={dateQuickRange === "yesterday" ? "default" : "outline"}
                                        size="sm"
                                        className="h-7 text-xs px-2.5"
                                        onClick={() => handleQuickDate("yesterday")}
                                    >
                                        Ontem
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={dateQuickRange === "7days" ? "default" : "outline"}
                                        size="sm"
                                        className="h-7 text-xs px-2.5"
                                        onClick={() => handleQuickDate("7days")}
                                    >
                                        7 dias
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={dateQuickRange === "30days" ? "default" : "outline"}
                                        size="sm"
                                        className="h-7 text-xs px-2.5"
                                        onClick={() => handleQuickDate("30days")}
                                    >
                                        30 dias
                                    </Button>
                                </div>
                            </div>

                            {/* Linha 2: Filtro por data específica (De/Até), Plataforma, Status e Limpar */}
                            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
                                <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-muted-foreground font-medium">De:</span>
                                    <Input
                                        type="date"
                                        value={filterStartDate}
                                        onChange={(e) => {
                                            setFilterStartDate(e.target.value);
                                            setDateQuickRange("custom");
                                        }}
                                        className="h-7 w-[130px] text-xs px-2 py-0 bg-background"
                                    />
                                </div>
                                <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-muted-foreground font-medium">Até:</span>
                                    <Input
                                        type="date"
                                        value={filterEndDate}
                                        onChange={(e) => {
                                            setFilterEndDate(e.target.value);
                                            setDateQuickRange("custom");
                                        }}
                                        className="h-7 w-[130px] text-xs px-2 py-0 bg-background"
                                    />
                                </div>

                                {/* Filtro por Plataforma */}
                                <div className="flex items-center gap-1 ml-0 sm:ml-2">
                                    <Button
                                        type="button"
                                        variant={filterPlatform === "all" ? "secondary" : "ghost"}
                                        size="sm"
                                        className="h-7 text-xs px-2"
                                        onClick={() => setFilterPlatform("all")}
                                    >
                                        Todas
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={filterPlatform === "shopee" ? "secondary" : "ghost"}
                                        size="sm"
                                        className="h-7 text-xs px-2 text-orange-600 dark:text-orange-400"
                                        onClick={() => setFilterPlatform("shopee")}
                                    >
                                        🛍️ Shopee
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={filterPlatform === "mercadolivre" ? "secondary" : "ghost"}
                                        size="sm"
                                        className="h-7 text-xs px-2 text-yellow-700 dark:text-yellow-400"
                                        onClick={() => setFilterPlatform("mercadolivre")}
                                    >
                                        🟡 Meli
                                    </Button>
                                </div>

                                {/* Filtro por Status */}
                                <div className="flex items-center gap-1">
                                    <Button
                                        type="button"
                                        variant={filterStatus === "all" ? "secondary" : "ghost"}
                                        size="sm"
                                        className="h-7 text-xs px-2"
                                        onClick={() => setFilterStatus("all")}
                                    >
                                        Todos
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={filterStatus === "success" ? "secondary" : "ghost"}
                                        size="sm"
                                        className="h-7 text-xs px-2 text-emerald-600 dark:text-emerald-400"
                                        onClick={() => setFilterStatus("success")}
                                    >
                                        ✅ OK
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={filterStatus === "error" ? "secondary" : "ghost"}
                                        size="sm"
                                        className="h-7 text-xs px-2 text-destructive"
                                        onClick={() => setFilterStatus("error")}
                                    >
                                        ❌ Erros
                                    </Button>
                                </div>

                                {/* Botão Limpar Filtros */}
                                {isFilterActive && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleClearFilters}
                                        className="h-7 text-xs text-muted-foreground hover:text-foreground ml-auto"
                                    >
                                        <X className="h-3 w-3 mr-1" /> Limpar filtros
                                    </Button>
                                )}
                            </div>
                        </div>

                        {stats.recent.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 px-4 text-center border-t sm:border rounded-lg bg-muted/10 mx-4 sm:mx-0 my-4 sm:my-0">
                                {isFilterActive ? (
                                    <>
                                        <Filter className="h-10 w-10 text-muted-foreground/50 mb-3" />
                                        <p className="font-medium text-sm text-foreground">Nenhum link encontrado para os filtros selecionados</p>
                                        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                                            Tente alterar as datas selecionadas, limpar o termo de busca ou selecionar outra plataforma.
                                        </p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleClearFilters}
                                            className="mt-3 h-8 text-xs"
                                        >
                                            <X className="h-3.5 w-3.5 mr-1" /> Limpar Filtros
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <ShoppingBag className="h-10 w-10 text-muted-foreground/50 mb-3" />
                                        <p className="font-medium text-sm text-foreground">Nenhuma conversão registrada ainda</p>
                                        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                                            Envie um link de produto no WhatsApp da sua sessão ou utilize o simulador abaixo para testar a geração automática.
                                        </p>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="border rounded-md overflow-x-auto overflow-y-auto max-h-[420px] relative sidebar-scrollbar shadow-inner">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 border-b shadow-sm">
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className="w-[120px] bg-background font-semibold">Plataforma</TableHead>
                                            <TableHead className="w-[140px] bg-background font-semibold">Data / Hora</TableHead>
                                            <TableHead className="w-[140px] bg-background font-semibold">Remetente</TableHead>
                                            <TableHead className="min-w-[200px] bg-background font-semibold">Link Original</TableHead>
                                            <TableHead className="min-w-[220px] bg-background font-semibold">Link de Afiliado</TableHead>
                                            <TableHead className="w-[100px] text-right bg-background font-semibold">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {stats.recent.map((item) => (
                                            <TableRow key={item.id}>
                                                <TableCell>
                                                    {item.platform === "shopee" ? (
                                                        <Badge variant="outline" className="border-orange-500/40 text-orange-600 dark:text-orange-400 bg-orange-500/10 text-xs font-medium">
                                                            🛍️ Shopee
                                                        </Badge>
                                                    ) : item.platform === "mercadolivre" ? (
                                                        <Badge variant="outline" className="border-yellow-500/40 text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 text-xs font-medium">
                                                            🟡 Meli
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary" className="text-xs">
                                                            {item.platform}
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                                    {new Date(item.createdAt).toLocaleString("pt-BR", {
                                                        day: "2-digit",
                                                        month: "2-digit",
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                        second: "2-digit",
                                                    })}
                                                </TableCell>
                                                <TableCell className="text-xs font-mono">
                                                    {formatSender(item.senderJid)}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-1.5 max-w-[240px]">
                                                        <span className="text-xs truncate text-muted-foreground" title={item.originalUrl}>
                                                            {item.originalUrl}
                                                        </span>
                                                        <a
                                                            href={item.originalUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-muted-foreground hover:text-foreground shrink-0"
                                                            title="Abrir link original"
                                                        >
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </a>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {item.status === "success" && item.affiliateUrl ? (
                                                        <div className="flex items-center gap-2 max-w-[260px]">
                                                            <span className="text-xs truncate font-medium text-emerald-600 dark:text-emerald-400" title={item.affiliateUrl}>
                                                                {item.affiliateUrl}
                                                            </span>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 shrink-0"
                                                                onClick={() => handleCopyLink(item.id, item.affiliateUrl!)}
                                                                title="Copiar link gerado"
                                                            >
                                                                {copiedId === item.id ? (
                                                                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                                                                ) : (
                                                                    <Copy className="h-3.5 w-3.5" />
                                                                )}
                                                            </Button>
                                                            <a
                                                                href={item.affiliateUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-muted-foreground hover:text-foreground shrink-0"
                                                                title="Testar link gerado"
                                                            >
                                                                <ArrowUpRight className="h-3.5 w-3.5" />
                                                            </a>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-destructive italic" title={item.errorMessage || "Erro na geração"}>
                                                            {item.errorMessage || "Falha na geração"}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {item.status === "success" ? (
                                                        <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-xs">
                                                            <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="destructive" className="text-xs">
                                                            <XCircle className="h-3 w-3 mr-1" /> Erro
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Chave Geral */}
                <Card className="border-primary/30">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between space-x-4">
                            <div className="space-y-1">
                                <Label htmlFor="affiliate-global-enabled" className="text-base font-semibold cursor-pointer">
                                    Responder automaticamente com link de afiliado no privado
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    Quando ativado, sempre que alguém enviar um link de produto da Shopee ou do Mercado Livre em conversa privada, o bot valida o produto e responde com o seu link de afiliado. Mensagens em grupos ou da própria conta são ignoradas.
                                </p>
                            </div>
                            <Switch
                                id="affiliate-global-enabled"
                                checked={enabled}
                                onCheckedChange={setEnabled}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Assistente de IA (Gemini) e Controle Direto */}
                <Card className={`border transition-colors ${aiEnabled ? "border-amber-500/30 bg-amber-500/5" : "border-muted/50 bg-muted/10"}`}>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between space-x-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Bot className="h-5 w-5 text-primary" />
                                    <Label htmlFor="ai-assistant-toggle" className="text-base font-semibold cursor-pointer">
                                        Assistente de IA Geral (Google Gemini)
                                    </Label>
                                    {aiEnabled ? (
                                        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                                            Ativo no WhatsApp
                                        </Badge>
                                    ) : (
                                        <Badge variant="secondary" className="text-xs">
                                            Desativado
                                        </Badge>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {aiEnabled
                                        ? "O atendimento por IA está ativo para dúvidas normais. Links de afiliados têm prioridade total e a IA nunca interfere quando alguém envia produtos."
                                        : "O atendimento automático por IA está desativado. O WhatsApp responderá exclusivamente com links de afiliados e respostas automáticas cadastradas."}
                                </p>
                            </div>
                            <Switch
                                id="ai-assistant-toggle"
                                checked={aiEnabled}
                                disabled={togglingAi || loading || !sessionId}
                                onCheckedChange={handleToggleAi}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Credenciais das Plataformas */}
                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Card Shopee */}
                    <Card>
                        <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        <span>🛍️ Shopee Afiliados</span>
                                        {shopeeConfigured ? (
                                            <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-xs">
                                                <CheckCircle2 className="h-3 w-3 mr-1" /> Configurado
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary" className="text-xs">
                                                <AlertCircle className="h-3 w-3 mr-1" /> Pendente
                                            </Badge>
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        API Oficial GraphQL da Shopee Open Platform (`generateShortLink`).
                                    </CardDescription>
                                </div>
                                <Switch
                                    checked={shopeeEnabled}
                                    onCheckedChange={setShopeeEnabled}
                                    aria-label="Ativar Shopee"
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label htmlFor="shopee-app-id">App ID da Shopee</Label>
                                <Input
                                    id="shopee-app-id"
                                    placeholder="Ex.: 18351070841"
                                    value={shopeeAppId}
                                    onChange={(e) => setShopeeAppId(e.target.value)}
                                />
                            </div>

                            <div className="grid gap-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="shopee-secret">Secret (Chave Secreta)</Label>
                                    {shopeeHasSecret && (
                                        <span className="text-[11px] text-emerald-600 font-mono">
                                            Salvo: {shopeeSecretPreview}
                                        </span>
                                    )}
                                </div>
                                <div className="relative">
                                    <Input
                                        id="shopee-secret"
                                        type={showShopeeSecret ? "text" : "password"}
                                        placeholder={
                                            shopeeHasSecret
                                                ? "Deixe em branco para manter o Secret atual ou digite um novo..."
                                                : "Cole seu Secret da Shopee API..."
                                        }
                                        value={shopeeSecret}
                                        onChange={(e) => setShopeeSecret(e.target.value)}
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowShopeeSecret((v) => !v)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        {showShopeeSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    Assinatura SHA-256 gerada automaticamente a cada requisição.
                                </p>
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="shopee-api-url">Endpoint da API (GraphQL)</Label>
                                <Input
                                    id="shopee-api-url"
                                    placeholder="https://open-api.affiliate.shopee.com.br/graphql"
                                    value={shopeeApiUrl}
                                    onChange={(e) => setShopeeApiUrl(e.target.value)}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Card Mercado Livre */}
                    <Card>
                        <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        <span>🤝 Mercado Livre Afiliados</span>
                                        {mlConfigured ? (
                                            <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-xs">
                                                <CheckCircle2 className="h-3 w-3 mr-1" /> Configurado
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary" className="text-xs">
                                                <AlertCircle className="h-3 w-3 mr-1" /> Pendente
                                            </Badge>
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        Endpoint / Builder autorizado para geração de link do Mercado Livre.
                                    </CardDescription>
                                </div>
                                <Switch
                                    checked={mlEnabled}
                                    onCheckedChange={setMlEnabled}
                                    aria-label="Ativar Mercado Livre"
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div className="grid gap-2">
                                    <Label htmlFor="ml-tag">Etiqueta de Afiliado (Tag opcional)</Label>
                                    <Input
                                        id="ml-tag"
                                        placeholder="Ex: sua-tag-afiliado"
                                        value={mlTag}
                                        onChange={(e) => setMlTag(e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="ml-api-url">URL do Webhook de Conversão (opcional)</Label>
                                    <Input
                                        id="ml-api-url"
                                        placeholder="https://seu-webhook.empresa.com/afiliados"
                                        value={mlApiUrl}
                                        onChange={(e) => setMlApiUrl(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="grid gap-2">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="ml-token">Token / Bearer Secret</Label>
                                    {mlHasToken && (
                                        <span className="text-[11px] text-emerald-600 font-mono">
                                            Salvo: {mlTokenPreview}
                                        </span>
                                    )}
                                </div>
                                <div className="relative">
                                    <Input
                                        id="ml-token"
                                        type={showMlToken ? "text" : "password"}
                                        placeholder={
                                            mlHasToken
                                                ? "Deixe em branco para manter o Token atual ou digite um novo..."
                                                : "Cole seu Token de autenticação..."
                                        }
                                        value={mlToken}
                                        onChange={(e) => setMlToken(e.target.value)}
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowMlToken((v) => !v)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        {showMlToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    Caso você não utilize Mercado Livre por enquanto, deixe desativado acima para ignorar links do ML silenciosamente.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Personalização das Mensagens de Resposta */}
                <Card>
                    <CardHeader>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <MessageSquareText className="h-5 w-5 text-primary" />
                                    Personalizar Mensagens de Resposta
                                </CardTitle>
                                <CardDescription>
                                    Personalize exatamente o texto que o bot responde no WhatsApp quando converte um produto.
                                </CardDescription>
                            </div>
                            <Button variant="outline" size="sm" onClick={handleRestoreDefaultTemplates}>
                                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                                Restaurar textos padrão
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Barra de Variáveis */}
                        <div className="rounded-lg border bg-muted/40 p-3 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground mr-1">
                                Variáveis disponíveis (clique para inserir no campo selecionado):
                            </span>
                            {[
                                { tag: "{link}", desc: "Link de afiliado gerado" },
                                { tag: "{plataforma}", desc: "Shopee ou Mercado Livre" },
                                { tag: "{id}", desc: "ID do produto" },
                                { tag: "{indice}", desc: "Número do item (1, 2...)" },
                            ].map((v) => (
                                <button
                                    key={v.tag}
                                    type="button"
                                    onClick={() => handleInsertVariable(v.tag)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-background border hover:border-primary hover:text-primary transition-colors shadow-xs"
                                    title={v.desc}
                                >
                                    <Sparkles className="h-3 w-3 text-primary" />
                                    {v.tag}
                                    <span className="font-sans text-[10px] text-muted-foreground">({v.desc})</span>
                                </button>
                            ))}
                        </div>

                        <div className="grid md:grid-cols-2 gap-6">
                            {/* Mensagem principal (1 produto) */}
                            <div className="space-y-2">
                                <Label htmlFor="tpl-single" className="font-semibold">
                                    ✅ Resposta quando 1 link é convertido com sucesso
                                </Label>
                                <Textarea
                                    id="tpl-single"
                                    rows={4}
                                    value={templates.singleSuccess}
                                    onFocus={() => setActiveTemplateField("singleSuccess")}
                                    onChange={(e) =>
                                        setTemplates((prev) => ({ ...prev, singleSuccess: e.target.value }))
                                    }
                                    placeholder="Aqui está o link do produto ({plataforma}):&#10;{link}"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Dica: Use <code>{"{link}"}</code> onde deseja que o link convertido apareça.
                                </p>
                            </div>

                            {/* Múltiplos links na mesma mensagem */}
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="tpl-multi-header" className="font-semibold">
                                        📦 Cabeçalho para múltiplos links (opcional)
                                    </Label>
                                    <Input
                                        id="tpl-multi-header"
                                        value={templates.multiHeader}
                                        onFocus={() => setActiveTemplateField("multiHeader")}
                                        onChange={(e) =>
                                            setTemplates((prev) => ({ ...prev, multiHeader: e.target.value }))
                                        }
                                        placeholder="Ex.: Confira os links convertidos abaixo:"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="tpl-multi-item" className="font-semibold">
                                        📋 Formato de cada item (quando enviam vários links juntos)
                                    </Label>
                                    <Input
                                        id="tpl-multi-item"
                                        value={templates.multiItem}
                                        onFocus={() => setActiveTemplateField("multiItem")}
                                        onChange={(e) =>
                                            setTemplates((prev) => ({ ...prev, multiItem: e.target.value }))
                                        }
                                        placeholder="{indice}. {plataforma}: {link}"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-6 pt-4 border-t">
                            {/* Link não é produto (perfil/busca/loja) */}
                            <div className="space-y-2">
                                <Label htmlFor="tpl-non-product">
                                    ⚠️ Resposta quando enviam link de perfil, loja ou busca (não é produto)
                                </Label>
                                <Textarea
                                    id="tpl-non-product"
                                    rows={3}
                                    value={templates.nonProductUrl}
                                    onFocus={() => setActiveTemplateField("nonProductUrl")}
                                    onChange={(e) =>
                                        setTemplates((prev) => ({ ...prev, nonProductUrl: e.target.value }))
                                    }
                                />
                            </div>

                            {/* Link inválido ou quebrado */}
                            <div className="space-y-2">
                                <Label htmlFor="tpl-invalid">
                                    ❌ Resposta quando o link está quebrado ou não pôde ser validado
                                </Label>
                                <Textarea
                                    id="tpl-invalid"
                                    rows={3}
                                    value={templates.invalidUrl}
                                    onFocus={() => setActiveTemplateField("invalidUrl")}
                                    onChange={(e) =>
                                        setTemplates((prev) => ({ ...prev, invalidUrl: e.target.value }))
                                    }
                                />
                            </div>
                        </div>

                        {/* Plataforma indisponível / desativada */}
                        <div className="pt-4 border-t space-y-4">
                            <div className="flex items-center justify-between border p-3 rounded-lg bg-muted/20">
                                <div className="space-y-0.5">
                                    <Label htmlFor="reply-when-unavailable" className="cursor-pointer font-medium">
                                        Avisar o remetente quando uma plataforma estiver desativada ou sem credenciais
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Se desmarcado, o bot ficará em silêncio caso receba um link de uma plataforma que você ainda não configurou (ex.: Mercado Livre).
                                    </p>
                                </div>
                                <Switch
                                    id="reply-when-unavailable"
                                    checked={templates.replyWhenUnavailable}
                                    onCheckedChange={(c) =>
                                        setTemplates((prev) => ({ ...prev, replyWhenUnavailable: c }))
                                    }
                                />
                            </div>

                            {templates.replyWhenUnavailable && (
                                <div className="space-y-2">
                                    <Label htmlFor="tpl-unavailable">
                                        Mensagem quando a plataforma estiver desativada/indisponível
                                    </Label>
                                    <Input
                                        id="tpl-unavailable"
                                        value={templates.unavailablePlatform}
                                        onFocus={() => setActiveTemplateField("unavailablePlatform")}
                                        onChange={(e) =>
                                            setTemplates((prev) => ({
                                                ...prev,
                                                unavailablePlatform: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            )}
                        </div>

                        <div className="pt-2">
                            <Button onClick={handleSave} disabled={saving || !sessionId}>
                                {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Salvar credenciais e mensagens
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Simulador / Testador ao Vivo */}
                <Card className="border-primary/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Link2 className="h-5 w-5 text-primary" />
                            Testar Conversão de Link Agora
                        </CardTitle>
                        <CardDescription>
                            Cole abaixo qualquer link da Shopee (curto `s.shopee.com.br` ou direto) ou do Mercado Livre para testar suas credenciais e ver como ficará a mensagem final.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex flex-col sm:flex-row gap-3">
                            <Input
                                placeholder="Ex.: Olha esse produto https://s.shopee.com.br/3B3RVbF6pM"
                                value={testInput}
                                onChange={(e) => setTestInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleRunTest()}
                                className="flex-1"
                            />
                            <Button onClick={handleRunTest} disabled={testing || !sessionId}>
                                {testing ? (
                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Play className="mr-2 h-4 w-4" />
                                )}
                                Testar Conversão
                            </Button>
                        </div>

                        {testResult && (
                            <div className="rounded-lg border bg-muted/30 p-4 space-y-3 animate-in fade-in duration-200">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Prévia da Resposta no WhatsApp
                                    </span>
                                    {testResult.replyText && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => {
                                                navigator.clipboard.writeText(testResult.replyText);
                                                toast.success("Resposta copiada para a área de transferência!");
                                            }}
                                        >
                                            <Copy className="h-3.5 w-3.5 mr-1" /> Copiar resposta
                                        </Button>
                                    )}
                                </div>

                                {testResult.replyText ? (
                                    <pre className="whitespace-pre-wrap text-sm bg-background border rounded-md p-3 font-sans">
                                        {testResult.replyText}
                                    </pre>
                                ) : (
                                    <p className="text-sm text-muted-foreground italic">
                                        Nenhuma mensagem seria enviada (motivo: <code>{testResult.skippedReason || "silenciado"}</code>).
                                    </p>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </SessionGuard>
    );
}
