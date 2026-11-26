"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
    Crown,
    Users,
    DollarSign,
    Smartphone,
    Instagram,
    Search,
    RefreshCw,
    SlidersHorizontal,
    Eye,
    Plus,
    Edit,
    CheckCircle2,
    Clock,
    AlertTriangle,
    XCircle,
    ShieldAlert,
    Sparkles,
    Kanban,
    Loader2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface ClientRow {
    id: string;
    name: string | null;
    email: string;
    role: string;
    createdAt: string;
    subscription: {
        id: string;
        planId: string;
        planName: string;
        planSlug: string;
        priceCents: number;
        status: string;
        effectiveStatus: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED" | "NONE";
        trialDaysLeft: number;
        trialEndsAt: string | null;
        currentPeriodEnd: string | null;
        externalRef: string | null;
    } | null;
    limits: {
        maxSessions: number;
        maxUsers: number;
        maxBroadcastDaily: number;
        hasAiStudio: boolean;
        hasCrm: boolean;
    };
    usage: {
        sessions: number;
        connectedSessions: number;
        users: number;
        staff: number;
        broadcastDaily: number;
        deals: number;
        instagramAccounts: number;
        instagramPostsPending: number;
        instagramPostsPublished: number;
    };
    details: {
        sessions: Array<{ id: string; name: string; sessionId: string; status: string }>;
        teamMembers: Array<{ id: string; name: string | null; email: string; createdAt: string }>;
        instagramAccounts: Array<{ id: string; username: string; accountType: string | null }>;
    };
}

interface PlanSummary {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    priceCents: number;
    maxSessions: number;
    maxUsers: number;
    maxBroadcastDaily: number;
    hasAiStudio: boolean;
    hasCrm: boolean;
    isActive: boolean;
    subscribersCount: number;
    activeSubscribersCount: number;
    mrrCents: number;
}

interface Kpis {
    totalClients: number;
    totalTeamMembers: number;
    activeSubscriptions: number;
    trialSubscriptions: number;
    pastDueSubscriptions: number;
    expiredOrCanceled: number;
    withoutSubscription: number;
    mrrCents: number;
    potentialMrrCents: number;
    totalSessions: number;
    connectedSessions: number;
    totalInstagramAccounts: number;
    totalInstagramPostsPending: number;
    totalBroadcastDaily: number;
    totalDeals: number;
}

function formatBRL(cents: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
    }).format(cents / 100);
}

function formatDateBR(dateStr: string | null) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("pt-BR");
}

function toDateInputValue(dateStr: string | null) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
}

function usagePercent(used: number, max: number) {
    if (max <= 0) return used > 0 ? 100 : 0;
    return Math.min(100, Math.round((used / max) * 100));
}

export default function SuperAdminDashboardPage() {
    const { data: authSession, status: sessionStatus } = useSession();
    const isSuperAdmin = (authSession?.user as any)?.role === "SUPERADMIN";

    const [loading, setLoading] = useState(true);
    const [kpis, setKpis] = useState<Kpis | null>(null);
    const [clients, setClients] = useState<ClientRow[]>([]);
    const [plans, setPlans] = useState<PlanSummary[]>([]);

    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("ALL");
    const [planFilter, setPlanFilter] = useState<string>("ALL");

    // Modal Gerenciar Assinatura do Cliente
    const [editingClient, setEditingClient] = useState<ClientRow | null>(null);
    const [subForm, setSubForm] = useState({
        planId: "",
        status: "ACTIVE" as "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED",
        expirationDate: "",
        extendDays: "",
        externalRef: "",
    });
    const [savingSub, setSavingSub] = useState(false);

    // Modal Detalhes do Cliente
    const [detailsClient, setDetailsClient] = useState<ClientRow | null>(null);

    // Modal Criar / Editar Plano
    const [planModalOpen, setPlanModalOpen] = useState(false);
    const [editingPlan, setEditingPlan] = useState<PlanSummary | null>(null);
    const [planForm, setPlanForm] = useState({
        slug: "",
        name: "",
        description: "",
        priceReais: "97",
        maxSessions: "1",
        maxUsers: "2",
        maxBroadcastDaily: "200",
        hasAiStudio: false,
        hasCrm: true,
        isActive: true,
    });
    const [savingPlan, setSavingPlan] = useState(false);

    const loadOverview = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/overview", { cache: "no-store" });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.message || "Erro ao carregar painel de gestão.");
                return;
            }
            setKpis(json.data.kpis);
            setClients(json.data.clients || []);
            setPlans(json.data.plans || []);
        } catch {
            toast.error("Falha de conexão ao carregar dados do SuperAdmin.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (sessionStatus === "authenticated" && isSuperAdmin) {
            loadOverview();
        } else if (sessionStatus === "authenticated") {
            setLoading(false);
        }
    }, [sessionStatus, isSuperAdmin, loadOverview]);

    const filteredClients = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        return clients.filter((client) => {
            if (term) {
                const haystack = [
                    client.name || "",
                    client.email,
                    client.subscription?.planName || "",
                    client.subscription?.externalRef || "",
                ]
                    .join(" ")
                    .toLowerCase();
                if (!haystack.includes(term)) return false;
            }

            const effStatus = client.subscription?.effectiveStatus || "NONE";
            if (statusFilter !== "ALL" && effStatus !== statusFilter) {
                return false;
            }

            if (planFilter !== "ALL" && client.subscription?.planId !== planFilter) {
                return false;
            }

            return true;
        });
    }, [clients, searchTerm, statusFilter, planFilter]);

    const openManageSubscription = (client: ClientRow) => {
        const defaultPlanId = client.subscription?.planId || plans[0]?.id || "";
        const rawStatus = client.subscription?.effectiveStatus;
        const normalizedStatus: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED" =
            rawStatus && rawStatus !== "NONE" ? rawStatus : "ACTIVE";

        const expDate =
            normalizedStatus === "TRIAL"
                ? toDateInputValue(client.subscription?.trialEndsAt || client.subscription?.currentPeriodEnd || null)
                : toDateInputValue(client.subscription?.currentPeriodEnd || null);

        setEditingClient(client);
        setSubForm({
            planId: defaultPlanId,
            status: normalizedStatus,
            expirationDate: expDate,
            extendDays: "",
            externalRef: client.subscription?.externalRef || "",
        });
    };

    const handleSaveSubscription = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingClient || !subForm.planId) {
            toast.error("Selecione um plano para o cliente.");
            return;
        }

        setSavingSub(true);
        try {
            const payload: Record<string, unknown> = {
                planId: subForm.planId,
                status: subForm.status,
                externalRef: subForm.externalRef.trim() || null,
            };

            if (subForm.extendDays) {
                payload.extendDays = Number(subForm.extendDays);
            } else if (subForm.expirationDate) {
                const iso = new Date(`${subForm.expirationDate}T23:59:59`).toISOString();
                if (subForm.status === "TRIAL") {
                    payload.trialEndsAt = iso;
                    payload.currentPeriodEnd = iso;
                } else {
                    payload.currentPeriodEnd = iso;
                    payload.trialEndsAt = null;
                }
            }

            const res = await fetch(`/api/admin/subscriptions/${editingClient.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.message || "Falha ao atualizar assinatura.");
                return;
            }

            toast.success(json.message || "Assinatura atualizada com sucesso!");
            setEditingClient(null);
            await loadOverview();
        } catch {
            toast.error("Erro de rede ao salvar assinatura.");
        } finally {
            setSavingSub(false);
        }
    };

    const openPlanModal = (plan: PlanSummary | null) => {
        setEditingPlan(plan);
        if (plan) {
            setPlanForm({
                slug: plan.slug,
                name: plan.name,
                description: plan.description || "",
                priceReais: String(plan.priceCents / 100),
                maxSessions: String(plan.maxSessions),
                maxUsers: String(plan.maxUsers),
                maxBroadcastDaily: String(plan.maxBroadcastDaily),
                hasAiStudio: plan.hasAiStudio,
                hasCrm: plan.hasCrm,
                isActive: plan.isActive,
            });
        } else {
            setPlanForm({
                slug: "",
                name: "",
                description: "",
                priceReais: "97",
                maxSessions: "1",
                maxUsers: "2",
                maxBroadcastDaily: "300",
                hasAiStudio: false,
                hasCrm: true,
                isActive: true,
            });
        }
        setPlanModalOpen(true);
    };

    const handleSavePlan = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingPlan(true);
        try {
            const priceCents = Math.round(Number(planForm.priceReais.replace(",", ".")) * 100);
            const res = await fetch("/api/plans", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    slug: planForm.slug.trim().toLowerCase(),
                    name: planForm.name.trim(),
                    description: planForm.description.trim() || null,
                    priceCents: Number.isFinite(priceCents) ? priceCents : 0,
                    maxSessions: Math.max(1, Number(planForm.maxSessions) || 1),
                    maxUsers: Math.max(1, Number(planForm.maxUsers) || 1),
                    maxBroadcastDaily: Math.max(0, Number(planForm.maxBroadcastDaily) || 0),
                    hasAiStudio: planForm.hasAiStudio,
                    hasCrm: planForm.hasCrm,
                    isActive: planForm.isActive,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.message || "Erro ao salvar plano.");
                return;
            }
            toast.success(json.message || "Plano salvo com sucesso!");
            setPlanModalOpen(false);
            await loadOverview();
        } catch {
            toast.error("Erro de comunicação ao salvar plano.");
        } finally {
            setSavingPlan(false);
        }
    };

    const renderStatusBadge = (sub: ClientRow["subscription"]) => {
        if (!sub) {
            return (
                <Badge variant="outline" className="text-slate-500">
                    Sem plano
                </Badge>
            );
        }

        switch (sub.effectiveStatus) {
            case "ACTIVE":
                return (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Ativo
                    </Badge>
                );
            case "TRIAL":
                return (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200 gap-1">
                        <Clock className="h-3 w-3" />
                        Trial ({sub.trialDaysLeft}d)
                    </Badge>
                );
            case "PAST_DUE":
                return (
                    <Badge className="bg-orange-100 text-orange-800 border-orange-200 gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Vencido
                    </Badge>
                );
            case "CANCELED":
                return (
                    <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        Cancelado
                    </Badge>
                );
            case "EXPIRED":
            default:
                return (
                    <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Expirado
                    </Badge>
                );
        }
    };

    if (sessionStatus === "loading" || loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (!isSuperAdmin) {
        return (
            <Card className="border-red-200 bg-red-50 max-w-xl mx-auto mt-10">
                <CardContent className="pt-6 flex items-start gap-3">
                    <ShieldAlert className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
                    <div>
                        <h3 className="font-semibold text-red-900">Acesso restrito ao SuperAdmin</h3>
                        <p className="text-sm text-red-700 mt-1">
                            Este painel exibe dados consolidados de clientes e assinaturas de toda a plataforma e só pode ser acessado por um SuperAdmin.
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Crown className="h-6 w-6 text-amber-500" />
                        Gestão SaaS (SuperAdmin)
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Visão completa dos clientes ativos, planos contratados, vencimentos e consumo da plataforma.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={loadOverview} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                    Atualizar dados
                </Button>
            </div>

            {/* KPI Cards */}
            {kpis && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Clientes (Contas)</CardTitle>
                            <Users className="h-4 w-4 text-blue-600" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{kpis.totalClients}</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                + {kpis.totalTeamMembers} atendente(s) de equipe
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-sm font-medium text-muted-foreground">MRR (Receita Ativa)</CardTitle>
                            <DollarSign className="h-4 w-4 text-emerald-600" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-emerald-700">{formatBRL(kpis.mrrCents)}</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Potencial (c/ trials): {formatBRL(kpis.potentialMrrCents)}
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Assinaturas</CardTitle>
                            <Crown className="h-4 w-4 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{kpis.activeSubscriptions} ativas</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                {kpis.trialSubscriptions} trial • {kpis.pastDueSubscriptions + kpis.expiredOrCanceled} vencidas/expiradas
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Canais na Plataforma</CardTitle>
                            <Smartphone className="h-4 w-4 text-primary" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {kpis.connectedSessions}/{kpis.totalSessions} WA
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                {kpis.totalInstagramAccounts} Instagram • {kpis.totalDeals} negócios CRM
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )}

            <Tabs defaultValue="clients" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="clients">
                        Clientes & Assinaturas ({clients.length})
                    </TabsTrigger>
                    <TabsTrigger value="plans">
                        Planos & Preços ({plans.length})
                    </TabsTrigger>
                </TabsList>

                {/* Tab: Clientes */}
                <TabsContent value="clients" className="space-y-4">
                    <Card>
                        <CardHeader className="pb-3">
                            <div className="flex flex-col md:flex-row gap-3 justify-between">
                                <div className="relative flex-1 max-w-md">
                                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        placeholder="Buscar por nome, e-mail, plano ou referência..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="pl-9"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                                        <SelectTrigger className="w-[170px]">
                                            <SelectValue placeholder="Status" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">Todos os status</SelectItem>
                                            <SelectItem value="ACTIVE">Ativo</SelectItem>
                                            <SelectItem value="TRIAL">Em Trial</SelectItem>
                                            <SelectItem value="PAST_DUE">Vencido</SelectItem>
                                            <SelectItem value="EXPIRED">Expirado</SelectItem>
                                            <SelectItem value="CANCELED">Cancelado</SelectItem>
                                            <SelectItem value="NONE">Sem plano</SelectItem>
                                        </SelectContent>
                                    </Select>

                                    <Select value={planFilter} onValueChange={setPlanFilter}>
                                        <SelectTrigger className="w-[170px]">
                                            <SelectValue placeholder="Plano" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">Todos os planos</SelectItem>
                                            {plans.map((p) => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    {p.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Cliente</TableHead>
                                            <TableHead>Plano</TableHead>
                                            <TableHead>Status & Validade</TableHead>
                                            <TableHead className="min-w-[210px]">Consumo do Plano</TableHead>
                                            <TableHead>Canais Extras</TableHead>
                                            <TableHead className="text-right">Ações</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredClients.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                                                    Nenhum cliente encontrado com os filtros aplicados.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            filteredClients.map((client) => {
                                                const expDate =
                                                    client.subscription?.effectiveStatus === "TRIAL"
                                                        ? client.subscription.trialEndsAt
                                                        : client.subscription?.currentPeriodEnd;

                                                return (
                                                    <TableRow key={client.id}>
                                                        <TableCell>
                                                            <div className="font-medium">{client.name || "Sem nome"}</div>
                                                            <div className="text-xs text-muted-foreground">{client.email}</div>
                                                            <div className="text-[11px] text-muted-foreground mt-0.5">
                                                                Desde {formatDateBR(client.createdAt)}
                                                            </div>
                                                        </TableCell>

                                                        <TableCell>
                                                            {client.subscription ? (
                                                                <div>
                                                                    <div className="font-semibold">{client.subscription.planName}</div>
                                                                    <div className="text-xs text-muted-foreground">
                                                                        {formatBRL(client.subscription.priceCents)}/mês
                                                                    </div>
                                                                    {client.subscription.externalRef && (
                                                                        <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                                                                            Ref: {client.subscription.externalRef}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground">Não atribuído</span>
                                                            )}
                                                        </TableCell>

                                                        <TableCell>
                                                            <div className="space-y-1">
                                                                {renderStatusBadge(client.subscription)}
                                                                <div className="text-xs text-muted-foreground">
                                                                    Até {formatDateBR(expDate || null)}
                                                                </div>
                                                            </div>
                                                        </TableCell>

                                                        <TableCell>
                                                            <div className="space-y-2 text-xs">
                                                                <div>
                                                                    <div className="flex justify-between mb-0.5">
                                                                        <span>WhatsApp ({client.usage.connectedSessions} online)</span>
                                                                        <span className="font-medium">
                                                                            {client.usage.sessions}/{client.limits.maxSessions || "-"}
                                                                        </span>
                                                                    </div>
                                                                    <Progress
                                                                        value={usagePercent(client.usage.sessions, client.limits.maxSessions)}
                                                                        className="h-1.5"
                                                                    />
                                                                </div>
                                                                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                                                    <span>
                                                                        Equipe: {client.usage.users}/{client.limits.maxUsers || "-"}
                                                                    </span>
                                                                    <span>
                                                                        Disparos hoje: {client.usage.broadcastDaily}/{client.limits.maxBroadcastDaily || "-"}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </TableCell>

                                                        <TableCell>
                                                            <div className="space-y-1 text-xs">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Instagram className="h-3.5 w-3.5 text-pink-600" />
                                                                    <span>
                                                                        {client.usage.instagramAccounts} conta(s) • {client.usage.instagramPostsPending} agend.
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                                                    <Kanban className="h-3.5 w-3.5" />
                                                                    <span>{client.usage.deals} negócio(s) CRM</span>
                                                                </div>
                                                            </div>
                                                        </TableCell>

                                                        <TableCell className="text-right">
                                                            <div className="flex justify-end gap-1.5">
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    onClick={() => setDetailsClient(client)}
                                                                    title="Ver sessões e equipe"
                                                                >
                                                                    <Eye className="h-3.5 w-3.5 mr-1" />
                                                                    Detalhes
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => openManageSubscription(client)}
                                                                    title="Alterar plano ou validade"
                                                                >
                                                                    <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
                                                                    Gerenciar
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Tab: Planos */}
                <TabsContent value="plans" className="space-y-4">
                    <div className="flex justify-between items-center">
                        <p className="text-sm text-muted-foreground">
                            Configure preços, limites operacionais e acompanhe o faturamento por plano.
                        </p>
                        <Button size="sm" onClick={() => openPlanModal(null)}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            Novo plano
                        </Button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                        {plans.map((plan) => (
                            <Card key={plan.id} className={!plan.isActive ? "opacity-70" : ""}>
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <CardTitle className="flex items-center gap-2">
                                                {plan.name}
                                                {!plan.isActive && <Badge variant="secondary">Inativo</Badge>}
                                            </CardTitle>
                                            <CardDescription className="font-mono text-xs mt-0.5">
                                                slug: {plan.slug}
                                            </CardDescription>
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={() => openPlanModal(plan)}>
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <div className="pt-2">
                                        <span className="text-2xl font-bold">{formatBRL(plan.priceCents)}</span>
                                        <span className="text-xs text-muted-foreground">/mês</span>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    {plan.description && (
                                        <p className="text-xs text-muted-foreground">{plan.description}</p>
                                    )}

                                    <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Assinantes totais:</span>
                                            <span className="font-semibold">{plan.subscribersCount}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Ativos pagantes:</span>
                                            <span className="font-semibold text-emerald-700">{plan.activeSubscribersCount}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">MRR do plano:</span>
                                            <span className="font-semibold">{formatBRL(plan.mrrCents)}</span>
                                        </div>
                                    </div>

                                    <div className="space-y-1 text-xs pt-1">
                                        <div>• Até {plan.maxSessions} conexão(ões) WhatsApp</div>
                                        <div>• Até {plan.maxUsers} usuário(s) na equipe</div>
                                        <div>• Até {plan.maxBroadcastDaily} disparos/dia</div>
                                        <div className="flex items-center gap-2 pt-1">
                                            {plan.hasAiStudio && (
                                                <Badge variant="outline" className="text-[10px] gap-1">
                                                    <Sparkles className="h-2.5 w-2.5" /> Estúdio IA
                                                </Badge>
                                            )}
                                            {plan.hasCrm && (
                                                <Badge variant="outline" className="text-[10px] gap-1">
                                                    <Kanban className="h-2.5 w-2.5" /> CRM
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>
            </Tabs>

            {/* Dialog: Gerenciar Assinatura */}
            <Dialog open={Boolean(editingClient)} onOpenChange={(open) => !open && setEditingClient(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Gerenciar assinatura do cliente</DialogTitle>
                        <DialogDescription>
                            {editingClient?.name || editingClient?.email} ({editingClient?.email})
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSaveSubscription} className="space-y-4">
                        <div className="space-y-2">
                            <Label>Plano contratado</Label>
                            <Select
                                value={subForm.planId}
                                onValueChange={(v) => setSubForm((prev) => ({ ...prev, planId: v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione um plano" />
                                </SelectTrigger>
                                <SelectContent>
                                    {plans.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name} ({formatBRL(p.priceCents)}/mês)
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Status da assinatura</Label>
                            <Select
                                value={subForm.status}
                                onValueChange={(v) =>
                                    setSubForm((prev) => ({
                                        ...prev,
                                        status: v as typeof prev.status,
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ACTIVE">Ativo (ACTIVE)</SelectItem>
                                    <SelectItem value="TRIAL">Em Teste (TRIAL)</SelectItem>
                                    <SelectItem value="PAST_DUE">Vencido (PAST_DUE)</SelectItem>
                                    <SelectItem value="EXPIRED">Expirado (EXPIRED)</SelectItem>
                                    <SelectItem value="CANCELED">Cancelado (CANCELED)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Estender prazo rapidamente</Label>
                            <div className="flex flex-wrap gap-2">
                                {[7, 30, 90, 365].map((days) => (
                                    <Button
                                        key={days}
                                        type="button"
                                        size="sm"
                                        variant={subForm.extendDays === String(days) ? "default" : "outline"}
                                        onClick={() =>
                                            setSubForm((prev) => ({
                                                ...prev,
                                                extendDays: prev.extendDays === String(days) ? "" : String(days),
                                            }))
                                        }
                                    >
                                        +{days} dias
                                    </Button>
                                ))}
                            </div>
                        </div>

                        {!subForm.extendDays && (
                            <div className="space-y-2">
                                <Label>Data de vencimento / fim do trial</Label>
                                <Input
                                    type="date"
                                    value={subForm.expirationDate}
                                    onChange={(e) =>
                                        setSubForm((prev) => ({ ...prev, expirationDate: e.target.value }))
                                    }
                                />
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Referência externa / Comprovante (opcional)</Label>
                            <Input
                                placeholder="Ex: PIX-2026-11, Stripe ID, etc."
                                value={subForm.externalRef}
                                onChange={(e) => setSubForm((prev) => ({ ...prev, externalRef: e.target.value }))}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setEditingClient(null)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={savingSub}>
                                {savingSub ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Salvar assinatura
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Dialog: Detalhes do Cliente */}
            <Dialog open={Boolean(detailsClient)} onOpenChange={(open) => !open && setDetailsClient(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{detailsClient?.name || detailsClient?.email}</DialogTitle>
                        <DialogDescription>
                            Detalhes operacionais de conexões, equipe e Instagram.
                        </DialogDescription>
                    </DialogHeader>
                    {detailsClient && (
                        <div className="space-y-4 text-sm max-h-[65vh] overflow-y-auto pr-1">
                            <div>
                                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">
                                    Conexões WhatsApp ({detailsClient.details.sessions.length})
                                </h4>
                                {detailsClient.details.sessions.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">Nenhuma sessão criada.</p>
                                ) : (
                                    <div className="space-y-1.5">
                                        {detailsClient.details.sessions.map((s) => (
                                            <div
                                                key={s.id}
                                                className="flex items-center justify-between rounded border px-3 py-1.5 text-xs"
                                            >
                                                <div>
                                                    <span className="font-medium">{s.name}</span>
                                                    <span className="text-muted-foreground ml-2 font-mono">{s.sessionId}</span>
                                                </div>
                                                <Badge
                                                    variant={s.status === "CONNECTED" ? "default" : "secondary"}
                                                    className={s.status === "CONNECTED" ? "bg-emerald-600" : ""}
                                                >
                                                    {s.status}
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">
                                    Contas Instagram ({detailsClient.details.instagramAccounts.length})
                                </h4>
                                {detailsClient.details.instagramAccounts.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">Nenhuma conta conectada.</p>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {detailsClient.details.instagramAccounts.map((ig) => (
                                            <Badge key={ig.id} variant="outline" className="gap-1">
                                                <Instagram className="h-3 w-3 text-pink-600" />@{ig.username}
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">
                                    Equipe / Atendentes ({detailsClient.details.teamMembers.length})
                                </h4>
                                {detailsClient.details.teamMembers.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">Nenhum atendente vinculado.</p>
                                ) : (
                                    <div className="space-y-1">
                                        {detailsClient.details.teamMembers.map((m) => (
                                            <div key={m.id} className="flex justify-between rounded border px-3 py-1.5 text-xs">
                                                <span>{m.name || "Sem nome"}</span>
                                                <span className="text-muted-foreground">{m.email}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Dialog: Criar / Editar Plano */}
            <Dialog open={planModalOpen} onOpenChange={setPlanModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingPlan ? `Editar plano ${editingPlan.name}` : "Criar novo plano"}</DialogTitle>
                        <DialogDescription>
                            Defina preço mensal e limites de uso aplicados às assinaturas deste plano.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSavePlan} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Slug (identificador)</Label>
                                <Input
                                    value={planForm.slug}
                                    onChange={(e) => setPlanForm((p) => ({ ...p, slug: e.target.value }))}
                                    disabled={Boolean(editingPlan)}
                                    placeholder="starter"
                                    required
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Nome do plano</Label>
                                <Input
                                    value={planForm.name}
                                    onChange={(e) => setPlanForm((p) => ({ ...p, name: e.target.value }))}
                                    placeholder="Starter"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Descrição</Label>
                            <Input
                                value={planForm.description}
                                onChange={(e) => setPlanForm((p) => ({ ...p, description: e.target.value }))}
                                placeholder="Descrição comercial do plano"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Preço mensal (R$)</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={planForm.priceReais}
                                    onChange={(e) => setPlanForm((p) => ({ ...p, priceReais: e.target.value }))}
                                    required
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Máx. sessões WhatsApp</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={planForm.maxSessions}
                                    onChange={(e) => setPlanForm((p) => ({ ...p, maxSessions: e.target.value }))}
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Máx. usuários equipe</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={planForm.maxUsers}
                                    onChange={(e) => setPlanForm((p) => ({ ...p, maxUsers: e.target.value }))}
                                    required
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Máx. disparos/dia</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={planForm.maxBroadcastDaily}
                                    onChange={(e) => setPlanForm((p) => ({ ...p, maxBroadcastDaily: e.target.value }))}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2 pt-1">
                            <div className="flex items-center justify-between">
                                <Label>Inclui Estúdio IA</Label>
                                <Switch
                                    checked={planForm.hasAiStudio}
                                    onCheckedChange={(v) => setPlanForm((p) => ({ ...p, hasAiStudio: v }))}
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label>Inclui CRM & Funil</Label>
                                <Switch
                                    checked={planForm.hasCrm}
                                    onCheckedChange={(v) => setPlanForm((p) => ({ ...p, hasCrm: v }))}
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label>Plano ativo para venda</Label>
                                <Switch
                                    checked={planForm.isActive}
                                    onCheckedChange={(v) => setPlanForm((p) => ({ ...p, isActive: v }))}
                                />
                            </div>
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setPlanModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={savingPlan}>
                                {savingPlan ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Salvar plano
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
