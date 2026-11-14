"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession as useAuthSession } from "next-auth/react";
import { useSession as useWaSession } from "@/components/dashboard/session-provider";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Kanban,
    Headphones,
    QrCode,
    Plus,
    Search,
    MessageSquare,
    Clock,
    DollarSign,
    TrendingUp,
    CheckCircle2,
    Trash2,
    Edit,
    Copy,
    Loader2,
    UserCheck,
    Bot,
    AlertTriangle,
    StickyNote,
    Send,
    Calendar,
} from "lucide-react";

interface PipelineStage {
    id: string;
    pipelineId: string;
    name: string;
    color: string;
    order: number;
    isWon: boolean;
    isLost: boolean;
}

interface Pipeline {
    id: string;
    name: string;
    isDefault: boolean;
    stages: PipelineStage[];
}

interface DealNote {
    id: string;
    dealId: string;
    authorName: string | null;
    content: string;
    createdAt: string;
}

interface Deal {
    id: string;
    pipelineId: string;
    stageId: string;
    sessionId: string;
    contactJid: string;
    contactName: string | null;
    contactPhone: string | null;
    title: string;
    valueCents: number;
    status: "OPEN" | "WON" | "LOST";
    followUpAt: string | null;
    lastInteractionAt: string;
    createdAt: string;
    stage: PipelineStage;
    session: { id: string; sessionId: string; name: string };
    notes: DealNote[];
}

interface Agent {
    id: string;
    name: string | null;
    email: string;
    role: string;
}

interface Ticket {
    id: string;
    sessionId: string;
    contactJid: string;
    contactName: string | null;
    assignedUserId: string | null;
    status: "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED";
    priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    botPausedUntil: string | null;
    slaDueAt: string | null;
    lastMessageAt: string;
    assignedUser: Agent | null;
    session: { id: string; sessionId: string; name: string };
}

interface Product {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    pixKey: string | null;
    imageUrl: string | null;
    category: string | null;
    isActive: boolean;
}

function formatBRL(cents: number): string {
    return (cents / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
    });
}

function parseBRLInputToCents(val: string): number {
    const cleaned = val.replace(/[^\d.,]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    if (isNaN(num) || num < 0) return 0;
    return Math.round(num * 100);
}

function formatPhoneClean(jid: string, fallback?: string | null): string {
    const raw = (fallback || jid.split("@")[0] || "").replace(/\D/g, "");
    if (raw.startsWith("55") && (raw.length === 12 || raw.length === 13)) {
        const ddd = raw.slice(2, 4);
        const rest = raw.slice(4);
        return `+55 (${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
    }
    return raw || jid.split("@")[0];
}

const TICKET_STATUS_LABELS: Record<string, { label: string; className: string }> = {
    OPEN: { label: "Aberto", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
    IN_PROGRESS: { label: "Em Atendimento", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    WAITING_CUSTOMER: { label: "Aguardando Cliente", className: "bg-purple-500/15 text-purple-600 border-purple-500/30" },
    RESOLVED: { label: "Resolvido", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
};

const TICKET_PRIORITY_LABELS: Record<string, { label: string; className: string }> = {
    LOW: { label: "Baixa", className: "bg-slate-500/15 text-slate-600 border-slate-500/30" },
    NORMAL: { label: "Normal", className: "bg-sky-500/15 text-sky-600 border-sky-500/30" },
    HIGH: { label: "Alta", className: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
    URGENT: { label: "Urgente", className: "bg-red-500/15 text-red-600 border-red-500/30" },
};

export default function CrmPage() {
    const router = useRouter();
    const { data: authData } = useAuthSession();
    const { sessions, sessionId: activeSessionSlug } = useWaSession();
    const currentUserId = authData?.user?.id;

    const [activeTab, setActiveTab] = useState("kanban");
    const [loading, setLoading] = useState(true);

    // Pipelines & Deals
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
    const [deals, setDeals] = useState<Deal[]>([]);
    const [dealSearch, setDealSearch] = useState("");
    const [draggedDealId, setDraggedDealId] = useState<string | null>(null);

    // New Deal Modal
    const [newDealOpen, setNewDealOpen] = useState(false);
    const [newDealForm, setNewDealForm] = useState({
        title: "",
        contactName: "",
        contactPhone: "",
        valueReais: "",
        stageId: "",
        sessionId: "",
        followUpAt: "",
    });
    const [savingDeal, setSavingDeal] = useState(false);

    // Deal Details Modal
    const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
    const [editDealForm, setEditDealForm] = useState({
        title: "",
        valueReais: "",
        stageId: "",
        followUpAt: "",
    });
    const [newNoteText, setNewNoteText] = useState("");
    const [addingNote, setAddingNote] = useState(false);

    // Tickets
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [ticketStatusFilter, setTicketStatusFilter] = useState("ALL");
    const [ticketAgentFilter, setTicketAgentFilter] = useState("ALL");

    // Products
    const [products, setProducts] = useState<Product[]>([]);
    const [productSearch, setProductSearch] = useState("");
    const [productModalOpen, setProductModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [productForm, setProductForm] = useState({
        name: "",
        category: "",
        priceReais: "",
        pixKey: "",
        description: "",
        isActive: true,
    });
    const [savingProduct, setSavingProduct] = useState(false);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [pRes, dRes, tRes, prRes] = await Promise.all([
                fetch("/api/crm/pipelines"),
                fetch("/api/crm/deals"),
                fetch("/api/crm/tickets"),
                fetch("/api/crm/products"),
            ]);

            if (pRes.ok) {
                const pJson = await pRes.json();
                const list: Pipeline[] = pJson.data || [];
                setPipelines(list);
                if (list.length > 0) {
                    setSelectedPipelineId((prev) =>
                        prev && list.some((p) => p.id === prev) ? prev : list[0].id
                    );
                }
            }
            if (dRes.ok) {
                const dJson = await dRes.json();
                setDeals(dJson.data || []);
            }
            if (tRes.ok) {
                const tJson = await tRes.json();
                setTickets(tJson.data || []);
                setAgents(tJson.agents || []);
            }
            if (prRes.ok) {
                const prJson = await prRes.json();
                setProducts(prJson.data || []);
            }
        } catch (err) {
            console.error(err);
            toast.error("Erro ao carregar dados do CRM");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const currentPipeline = useMemo(
        () => pipelines.find((p) => p.id === selectedPipelineId) || pipelines[0],
        [pipelines, selectedPipelineId]
    );

    const filteredDeals = useMemo(() => {
        const q = dealSearch.trim().toLowerCase();
        return deals.filter((d) => {
            if (currentPipeline && d.pipelineId !== currentPipeline.id) return false;
            if (!q) return true;
            return (
                d.title.toLowerCase().includes(q) ||
                (d.contactName || "").toLowerCase().includes(q) ||
                (d.contactPhone || "").toLowerCase().includes(q) ||
                d.contactJid.toLowerCase().includes(q)
            );
        });
    }, [deals, currentPipeline, dealSearch]);

    const kpis = useMemo(() => {
        const openDeals = filteredDeals.filter((d) => d.status === "OPEN");
        const wonDeals = filteredDeals.filter((d) => d.status === "WON");
        const totalOpenCents = openDeals.reduce((acc, d) => acc + d.valueCents, 0);
        const totalWonCents = wonDeals.reduce((acc, d) => acc + d.valueCents, 0);
        const closedCount = wonDeals.length + filteredDeals.filter((d) => d.status === "LOST").length;
        const conversionRate = closedCount > 0 ? Math.round((wonDeals.length / closedCount) * 100) : 0;
        return {
            openCount: openDeals.length,
            totalOpenCents,
            totalWonCents,
            conversionRate,
        };
    }, [filteredDeals]);

    const handleMoveDealStage = async (dealId: string, newStageId: string) => {
        const targetStage = currentPipeline?.stages.find((s) => s.id === newStageId);
        if (!targetStage) return;

        // Optimistic update
        setDeals((prev) =>
            prev.map((d) =>
                d.id === dealId
                    ? {
                          ...d,
                          stageId: newStageId,
                          stage: targetStage,
                          status: targetStage.isWon ? "WON" : targetStage.isLost ? "LOST" : "OPEN",
                      }
                    : d
            )
        );

        try {
            const res = await fetch(`/api/crm/deals/${dealId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stageId: newStageId }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message);
            setDeals((prev) => prev.map((d) => (d.id === dealId ? json.data : d)));
            if (selectedDeal?.id === dealId) setSelectedDeal(json.data);
            toast.success(`Movido para "${targetStage.name}"`);
        } catch (err: any) {
            toast.error(err.message || "Erro ao mover negócio");
            loadAll();
        }
    };

    const handleCreateDeal = async (e: React.FormEvent) => {
        e.preventDefault();
        const sessionToUse = newDealForm.sessionId || activeSessionSlug || sessions[0]?.sessionId;
        if (!sessionToUse) {
            toast.error("Nenhuma sessão do WhatsApp disponível");
            return;
        }
        const digits = newDealForm.contactPhone.replace(/\D/g, "");
        if (!digits) {
            toast.error("Informe o telefone/WhatsApp do contato");
            return;
        }
        const jid = newDealForm.contactPhone.includes("@")
            ? newDealForm.contactPhone.trim()
            : `${digits}@s.whatsapp.net`;

        setSavingDeal(true);
        try {
            const res = await fetch("/api/crm/deals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: sessionToUse,
                    contactJid: jid,
                    contactName: newDealForm.contactName || null,
                    contactPhone: digits,
                    title: newDealForm.title.trim(),
                    valueCents: parseBRLInputToCents(newDealForm.valueReais),
                    pipelineId: currentPipeline?.id,
                    stageId: newDealForm.stageId || currentPipeline?.stages[0]?.id,
                    followUpAt: newDealForm.followUpAt
                        ? new Date(newDealForm.followUpAt).toISOString()
                        : null,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message);
            setDeals((prev) => [json.data, ...prev]);
            setNewDealOpen(false);
            setNewDealForm({
                title: "",
                contactName: "",
                contactPhone: "",
                valueReais: "",
                stageId: "",
                sessionId: "",
                followUpAt: "",
            });
            toast.success("Negócio criado!");
        } catch (err: any) {
            toast.error(err.message || "Erro ao criar negócio");
        } finally {
            setSavingDeal(false);
        }
    };

    const openDealDetails = (deal: Deal) => {
        setSelectedDeal(deal);
        setEditDealForm({
            title: deal.title,
            valueReais: (deal.valueCents / 100).toFixed(2).replace(".", ","),
            stageId: deal.stageId,
            followUpAt: deal.followUpAt ? deal.followUpAt.slice(0, 16) : "",
        });
        setNewNoteText("");
    };

    const handleSaveDealDetails = async () => {
        if (!selectedDeal) return;
        try {
            const res = await fetch(`/api/crm/deals/${selectedDeal.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: editDealForm.title.trim(),
                    valueCents: parseBRLInputToCents(editDealForm.valueReais),
                    stageId: editDealForm.stageId,
                    followUpAt: editDealForm.followUpAt
                        ? new Date(editDealForm.followUpAt).toISOString()
                        : null,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message);
            setDeals((prev) => prev.map((d) => (d.id === selectedDeal.id ? json.data : d)));
            setSelectedDeal(json.data);
            toast.success("Negócio atualizado!");
        } catch (err: any) {
            toast.error(err.message || "Erro ao atualizar");
        }
    };

    const handleDeleteDeal = async (dealId: string) => {
        try {
            const res = await fetch(`/api/crm/deals/${dealId}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Falha ao remover");
            setDeals((prev) => prev.filter((d) => d.id !== dealId));
            setSelectedDeal(null);
            toast.success("Negócio removido");
        } catch (err: any) {
            toast.error(err.message || "Erro ao remover negócio");
        }
    };

    const handleAddNote = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedDeal || !newNoteText.trim()) return;
        setAddingNote(true);
        try {
            const res = await fetch(`/api/crm/deals/${selectedDeal.id}/notes`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: newNoteText.trim() }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message);
            const updatedNotes = [json.data, ...(selectedDeal.notes || [])];
            const updatedDeal = { ...selectedDeal, notes: updatedNotes };
            setSelectedDeal(updatedDeal);
            setDeals((prev) => prev.map((d) => (d.id === selectedDeal.id ? updatedDeal : d)));
            setNewNoteText("");
            toast.success("Nota adicionada");
        } catch (err: any) {
            toast.error(err.message || "Erro ao adicionar nota");
        } finally {
            setAddingNote(false);
        }
    };

    // Tickets handlers
    const filteredTickets = useMemo(() => {
        return tickets.filter((t) => {
            if (ticketStatusFilter !== "ALL" && t.status !== ticketStatusFilter) return false;
            if (ticketAgentFilter === "MINE" && t.assignedUserId !== currentUserId) return false;
            if (ticketAgentFilter === "UNASSIGNED" && t.assignedUserId !== null) return false;
            if (
                ticketAgentFilter !== "ALL" &&
                ticketAgentFilter !== "MINE" &&
                ticketAgentFilter !== "UNASSIGNED" &&
                t.assignedUserId !== ticketAgentFilter
            ) {
                return false;
            }
            return true;
        });
    }, [tickets, ticketStatusFilter, ticketAgentFilter, currentUserId]);

    const handleUpdateTicket = async (
        ticketId: string,
        payload: Record<string, unknown>,
        successMsg?: string
    ) => {
        try {
            const res = await fetch("/api/crm/tickets", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: ticketId, ...payload }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message);
            setTickets((prev) => prev.map((t) => (t.id === ticketId ? json.data : t)));
            if (successMsg) toast.success(successMsg);
        } catch (err: any) {
            toast.error(err.message || "Erro ao atualizar ticket");
        }
    };

    // Products handlers
    const filteredProducts = useMemo(() => {
        const q = productSearch.trim().toLowerCase();
        if (!q) return products;
        return products.filter(
            (p) =>
                p.name.toLowerCase().includes(q) ||
                (p.category || "").toLowerCase().includes(q) ||
                (p.description || "").toLowerCase().includes(q)
        );
    }, [products, productSearch]);

    const openProductModal = (prod?: Product) => {
        if (prod) {
            setEditingProduct(prod);
            setProductForm({
                name: prod.name,
                category: prod.category || "",
                priceReais: (prod.priceCents / 100).toFixed(2).replace(".", ","),
                pixKey: prod.pixKey || "",
                description: prod.description || "",
                isActive: prod.isActive,
            });
        } else {
            setEditingProduct(null);
            setProductForm({
                name: "",
                category: "",
                priceReais: "",
                pixKey: "",
                description: "",
                isActive: true,
            });
        }
        setProductModalOpen(true);
    };

    const handleSaveProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!productForm.name.trim()) {
            toast.error("Nome do produto é obrigatório");
            return;
        }
        setSavingProduct(true);
        try {
            const payload = {
                name: productForm.name.trim(),
                category: productForm.category.trim() || null,
                priceCents: parseBRLInputToCents(productForm.priceReais),
                pixKey: productForm.pixKey.trim() || null,
                description: productForm.description.trim() || null,
                isActive: productForm.isActive,
            };

            const url = editingProduct
                ? `/api/crm/products/${editingProduct.id}`
                : "/api/crm/products";
            const method = editingProduct ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message);

            if (editingProduct) {
                setProducts((prev) =>
                    prev.map((p) => (p.id === editingProduct.id ? json.data : p))
                );
                toast.success("Produto atualizado!");
            } else {
                setProducts((prev) => [json.data, ...prev]);
                toast.success("Produto cadastrado!");
            }
            setProductModalOpen(false);
        } catch (err: any) {
            toast.error(err.message || "Erro ao salvar produto");
        } finally {
            setSavingProduct(false);
        }
    };

    const handleDeleteProduct = async (id: string) => {
        try {
            const res = await fetch(`/api/crm/products/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Falha ao excluir");
            setProducts((prev) => prev.filter((p) => p.id !== id));
            toast.success("Produto excluído");
        } catch (err: any) {
            toast.error(err.message || "Erro ao excluir produto");
        }
    };

    const openChat = (sessionSlug: string, jid: string) => {
        router.push(
            `/dashboard/chat?sessionId=${encodeURIComponent(sessionSlug)}&jid=${encodeURIComponent(jid)}`
        );
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">CRM & Vendas</h2>
                    <p className="text-muted-foreground">
                        Gerencie seu funil de vendas, fila de atendimento multi-atendente e catálogo PIX.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {activeTab === "kanban" && (
                        <Button
                            onClick={() => {
                                setNewDealForm((f) => ({
                                    ...f,
                                    stageId: currentPipeline?.stages[0]?.id || "",
                                    sessionId: activeSessionSlug || sessions[0]?.sessionId || "",
                                }));
                                setNewDealOpen(true);
                            }}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Novo Negócio
                        </Button>
                    )}
                    {activeTab === "catalog" && (
                        <Button onClick={() => openProductModal()}>
                            <Plus className="h-4 w-4 mr-2" />
                            Novo Produto / PIX
                        </Button>
                    )}
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList className="grid w-full max-w-2xl grid-cols-3">
                    <TabsTrigger value="kanban" className="gap-2">
                        <Kanban className="h-4 w-4" />
                        Funil Kanban
                    </TabsTrigger>
                    <TabsTrigger value="tickets" className="gap-2">
                        <Headphones className="h-4 w-4" />
                        Fila de Atendimento (Tickets)
                        {tickets.filter((t) => t.status !== "RESOLVED").length > 0 && (
                            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                                {tickets.filter((t) => t.status !== "RESOLVED").length}
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="catalog" className="gap-2">
                        <QrCode className="h-4 w-4" />
                        Catálogo & PIX
                    </TabsTrigger>
                </TabsList>

                {/* TAB 1: FUNIL KANBAN */}
                <TabsContent value="kanban" className="space-y-4">
                    {/* KPIs */}
                    <div className="grid gap-4 md:grid-cols-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Em Aberto no Funil</CardTitle>
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatBRL(kpis.totalOpenCents)}</div>
                                <p className="text-xs text-muted-foreground">{kpis.openCount} negócios ativos</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Vendas Fechadas (Ganho)</CardTitle>
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-emerald-600">{formatBRL(kpis.totalWonCents)}</div>
                                <p className="text-xs text-muted-foreground">Receita convertida</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Taxa de Conversão</CardTitle>
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{kpis.conversionRate}%</div>
                                <p className="text-xs text-muted-foreground">Ganhos vs. Perdidos</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Buscar Negócio</CardTitle>
                                <Search className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <Input
                                    placeholder="Nome, título ou telefone..."
                                    value={dealSearch}
                                    onChange={(e) => setDealSearch(e.target.value)}
                                    className="h-9"
                                />
                            </CardContent>
                        </Card>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Carregando funil...
                        </div>
                    ) : (
                        <div className="flex gap-4 overflow-x-auto pb-4">
                            {(currentPipeline?.stages || []).map((stage) => {
                                const stageDeals = filteredDeals.filter((d) => d.stageId === stage.id);
                                const stageTotal = stageDeals.reduce((sum, d) => sum + d.valueCents, 0);

                                return (
                                    <div
                                        key={stage.id}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            if (draggedDealId) {
                                                handleMoveDealStage(draggedDealId, stage.id);
                                                setDraggedDealId(null);
                                            }
                                        }}
                                        className="flex w-80 shrink-0 flex-col rounded-xl border bg-muted/30"
                                    >
                                        <div
                                            className="flex items-center justify-between rounded-t-xl border-b bg-card p-3"
                                            style={{ borderTop: `3px solid ${stage.color}` }}
                                        >
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-sm">{stage.name}</span>
                                                    <Badge variant="secondary" className="text-xs">
                                                        {stageDeals.length}
                                                    </Badge>
                                                </div>
                                                <p className="text-xs font-medium text-muted-foreground mt-0.5">
                                                    {formatBRL(stageTotal)}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex flex-1 flex-col gap-2.5 p-2.5 min-h-[320px]">
                                            {stageDeals.length === 0 ? (
                                                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                                    Arraste um negócio para cá
                                                </div>
                                            ) : (
                                                stageDeals.map((deal) => (
                                                    <div
                                                        key={deal.id}
                                                        draggable
                                                        onDragStart={() => setDraggedDealId(deal.id)}
                                                        onDragEnd={() => setDraggedDealId(null)}
                                                        className="group cursor-grab active:cursor-grabbing rounded-lg border bg-card p-3 shadow-sm transition hover:border-primary/50 hover:shadow"
                                                    >
                                                        <div
                                                            className="cursor-pointer space-y-1.5"
                                                            onClick={() => openDealDetails(deal)}
                                                        >
                                                            <div className="flex items-start justify-between gap-2">
                                                                <p className="font-semibold text-sm leading-tight">
                                                                    {deal.title}
                                                                </p>
                                                                <span className="shrink-0 text-xs font-bold text-emerald-600">
                                                                    {formatBRL(deal.valueCents)}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground truncate">
                                                                {deal.contactName || formatPhoneClean(deal.contactJid, deal.contactPhone)}
                                                            </p>
                                                            {deal.followUpAt && (
                                                                <div className="flex items-center gap-1 text-[11px] text-amber-600">
                                                                    <Calendar className="h-3 w-3" />
                                                                    Follow-up:{" "}
                                                                    {new Date(deal.followUpAt).toLocaleDateString("pt-BR")}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="mt-2.5 flex items-center justify-between gap-2 border-t pt-2">
                                                            <Select
                                                                value={deal.stageId}
                                                                onValueChange={(val) => handleMoveDealStage(deal.id, val)}
                                                            >
                                                                <SelectTrigger className="h-7 text-[11px] w-[145px]">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {(currentPipeline?.stages || []).map((s) => (
                                                                        <SelectItem key={s.id} value={s.id} className="text-xs">
                                                                            {s.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>

                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                title="Abrir no Chat"
                                                                onClick={() => openChat(deal.session.sessionId, deal.contactJid)}
                                                            >
                                                                <MessageSquare className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </TabsContent>

                {/* TAB 2: FILA DE ATENDIMENTO (TICKETS) */}
                <TabsContent value="tickets" className="space-y-4">
                    <Card>
                        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle>Fila de Atendimento Multi-Atendente</CardTitle>
                                <CardDescription>
                                    Acompanhe SLAs, prioridades, pause do robô e atribua conversas para a equipe.
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Select value={ticketStatusFilter} onValueChange={setTicketStatusFilter}>
                                    <SelectTrigger className="w-[170px]">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">Todos os status</SelectItem>
                                        <SelectItem value="OPEN">Abertos</SelectItem>
                                        <SelectItem value="IN_PROGRESS">Em Atendimento</SelectItem>
                                        <SelectItem value="WAITING_CUSTOMER">Aguardando Cliente</SelectItem>
                                        <SelectItem value="RESOLVED">Resolvidos</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={ticketAgentFilter} onValueChange={setTicketAgentFilter}>
                                    <SelectTrigger className="w-[180px]">
                                        <SelectValue placeholder="Atendente" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">Todos atendentes</SelectItem>
                                        <SelectItem value="MINE">Meus tickets</SelectItem>
                                        <SelectItem value="UNASSIGNED">Não atribuídos</SelectItem>
                                        {agents.map((a) => (
                                            <SelectItem key={a.id} value={a.id}>
                                                {a.name || a.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {filteredTickets.length === 0 ? (
                                <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                                    Nenhum ticket encontrado com os filtros selecionados.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredTickets.map((ticket) => {
                                        const st = TICKET_STATUS_LABELS[ticket.status] || TICKET_STATUS_LABELS.OPEN;
                                        const pr = TICKET_PRIORITY_LABELS[ticket.priority] || TICKET_PRIORITY_LABELS.NORMAL;
                                        const isBotPaused =
                                            ticket.botPausedUntil && new Date(ticket.botPausedUntil) > new Date();
                                        const slaExpired =
                                            ticket.slaDueAt &&
                                            ticket.status !== "RESOLVED" &&
                                            new Date(ticket.slaDueAt) < new Date();

                                        return (
                                            <div
                                                key={ticket.id}
                                                className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-lg border p-4 bg-card"
                                            >
                                                <div className="space-y-1.5 min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-semibold">
                                                            {ticket.contactName || formatPhoneClean(ticket.contactJid)}
                                                        </span>
                                                        <Badge variant="outline" className={st.className}>
                                                            {st.label}
                                                        </Badge>
                                                        <Badge variant="outline" className={pr.className}>
                                                            {pr.label}
                                                        </Badge>
                                                        {isBotPaused && (
                                                            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 gap-1">
                                                                <Bot className="h-3 w-3" />
                                                                Robô pausado
                                                            </Badge>
                                                        )}
                                                        {slaExpired && (
                                                            <Badge variant="destructive" className="gap-1">
                                                                <AlertTriangle className="h-3 w-3" />
                                                                SLA vencido
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                                        <span>Sessão: {ticket.session.name}</span>
                                                        <span>Tel: {formatPhoneClean(ticket.contactJid)}</span>
                                                        {ticket.slaDueAt && (
                                                            <span className="flex items-center gap-1">
                                                                <Clock className="h-3 w-3" />
                                                                SLA:{" "}
                                                                {new Date(ticket.slaDueAt).toLocaleString("pt-BR", {
                                                                    day: "2-digit",
                                                                    month: "2-digit",
                                                                    hour: "2-digit",
                                                                    minute: "2-digit",
                                                                })}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Select
                                                        value={ticket.assignedUserId || "UNASSIGNED"}
                                                        onValueChange={(val) =>
                                                            handleUpdateTicket(
                                                                ticket.id,
                                                                { assignedUserId: val === "UNASSIGNED" ? null : val },
                                                                "Atendente atualizado"
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger className="h-8 w-[160px] text-xs">
                                                            <SelectValue placeholder="Atribuir..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="UNASSIGNED">Sem atendente</SelectItem>
                                                            {agents.map((a) => (
                                                                <SelectItem key={a.id} value={a.id}>
                                                                    {a.name || a.email}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>

                                                    {currentUserId && ticket.assignedUserId !== currentUserId && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() =>
                                                                handleUpdateTicket(
                                                                    ticket.id,
                                                                    {
                                                                        assignedUserId: currentUserId,
                                                                        status: "IN_PROGRESS",
                                                                    },
                                                                    "Ticket assumido por você!"
                                                                )
                                                            }
                                                        >
                                                            <UserCheck className="h-3.5 w-3.5 mr-1.5" />
                                                            Assumir
                                                        </Button>
                                                    )}

                                                    {ticket.status !== "RESOLVED" && (
                                                        <Button
                                                            size="sm"
                                                            variant="default"
                                                            onClick={() =>
                                                                handleUpdateTicket(
                                                                    ticket.id,
                                                                    { status: "RESOLVED", botPausedUntil: null },
                                                                    "Ticket resolvido!"
                                                                )
                                                            }
                                                        >
                                                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                                            Resolver
                                                        </Button>
                                                    )}

                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        onClick={() => openChat(ticket.session.sessionId, ticket.contactJid)}
                                                    >
                                                        <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                                        Abrir Chat
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* TAB 3: CATÁLOGO & PIX */}
                <TabsContent value="catalog" className="space-y-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="relative w-full sm:w-80">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar produto, serviço ou categoria..."
                                className="pl-8"
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                            />
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {filteredProducts.length} item(ns) cadastrado(s)
                        </p>
                    </div>

                    {filteredProducts.length === 0 ? (
                        <Card>
                            <CardContent className="py-12 text-center text-muted-foreground">
                                Nenhum produto cadastrado. Clique em &quot;Novo Produto / PIX&quot; para começar.
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {filteredProducts.map((product) => (
                                <Card key={product.id} className={!product.isActive ? "opacity-60" : ""}>
                                    <CardHeader className="pb-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <CardTitle className="text-base">{product.name}</CardTitle>
                                                {product.category && (
                                                    <CardDescription className="text-xs mt-0.5">
                                                        {product.category}
                                                    </CardDescription>
                                                )}
                                            </div>
                                            <Badge variant={product.isActive ? "default" : "secondary"}>
                                                {product.isActive ? "Ativo" : "Inativo"}
                                            </Badge>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="text-2xl font-bold text-emerald-600">
                                            {formatBRL(product.priceCents)}
                                        </div>
                                        {product.description && (
                                            <p className="text-xs text-muted-foreground line-clamp-2">
                                                {product.description}
                                            </p>
                                        )}
                                        {product.pixKey && (
                                            <div className="flex items-center justify-between rounded-md bg-muted px-2.5 py-1.5 text-xs">
                                                <span className="truncate font-mono">PIX: {product.pixKey}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 shrink-0"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(product.pixKey || "");
                                                        toast.success("Chave PIX copiada!");
                                                    }}
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-end gap-2 pt-2 border-t">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => openProductModal(product)}
                                            >
                                                <Edit className="h-3.5 w-3.5 mr-1" />
                                                Editar
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:text-destructive"
                                                onClick={() => handleDeleteProduct(product.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* MODAL: NOVO NEGÓCIO */}
            <Dialog open={newDealOpen} onOpenChange={setNewDealOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Novo Negócio</DialogTitle>
                        <DialogDescription>
                            Adicione uma oportunidade ao seu funil de vendas.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateDeal} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>Título do Negócio *</Label>
                            <Input
                                required
                                placeholder="Ex: Plano Mensal - Clínica Sorriso"
                                value={newDealForm.title}
                                onChange={(e) => setNewDealForm({ ...newDealForm, title: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Nome do Contato</Label>
                                <Input
                                    placeholder="Ex: Maria Silva"
                                    value={newDealForm.contactName}
                                    onChange={(e) => setNewDealForm({ ...newDealForm, contactName: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>WhatsApp (com DDD) *</Label>
                                <Input
                                    required
                                    placeholder="5511999998888"
                                    value={newDealForm.contactPhone}
                                    onChange={(e) => setNewDealForm({ ...newDealForm, contactPhone: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Valor (R$)</Label>
                                <Input
                                    placeholder="0,00"
                                    value={newDealForm.valueReais}
                                    onChange={(e) => setNewDealForm({ ...newDealForm, valueReais: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Etapa Inicial</Label>
                                <Select
                                    value={newDealForm.stageId}
                                    onValueChange={(val) => setNewDealForm({ ...newDealForm, stageId: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(currentPipeline?.stages || []).map((s) => (
                                            <SelectItem key={s.id} value={s.id}>
                                                {s.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Sessão WhatsApp</Label>
                                <Select
                                    value={newDealForm.sessionId}
                                    onValueChange={(val) => setNewDealForm({ ...newDealForm, sessionId: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {sessions.map((s) => (
                                            <SelectItem key={s.id} value={s.sessionId}>
                                                {s.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Lembrete / Follow-up</Label>
                                <Input
                                    type="datetime-local"
                                    value={newDealForm.followUpAt}
                                    onChange={(e) => setNewDealForm({ ...newDealForm, followUpAt: e.target.value })}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setNewDealOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={savingDeal}>
                                {savingDeal && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Criar Negócio
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* MODAL: DETALHES DO NEGÓCIO & NOTAS */}
            <Dialog open={!!selectedDeal} onOpenChange={(open) => !open && setSelectedDeal(null)}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    {selectedDeal && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center justify-between gap-2 pr-6">
                                    <span>{selectedDeal.title}</span>
                                    <Badge variant="outline">
                                        {selectedDeal.contactName || formatPhoneClean(selectedDeal.contactJid, selectedDeal.contactPhone)}
                                    </Badge>
                                </DialogTitle>
                                <DialogDescription>
                                    Sessão: {selectedDeal.session.name} • Criado em{" "}
                                    {new Date(selectedDeal.createdAt).toLocaleDateString("pt-BR")}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Título</Label>
                                        <Input
                                            value={editDealForm.title}
                                            onChange={(e) => setEditDealForm({ ...editDealForm, title: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Valor (R$)</Label>
                                        <Input
                                            value={editDealForm.valueReais}
                                            onChange={(e) => setEditDealForm({ ...editDealForm, valueReais: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Etapa do Funil</Label>
                                        <Select
                                            value={editDealForm.stageId}
                                            onValueChange={(val) => setEditDealForm({ ...editDealForm, stageId: val })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(currentPipeline?.stages || []).map((s) => (
                                                    <SelectItem key={s.id} value={s.id}>
                                                        {s.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Follow-up Automático</Label>
                                        <Input
                                            type="datetime-local"
                                            value={editDealForm.followUpAt}
                                            onChange={(e) => setEditDealForm({ ...editDealForm, followUpAt: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-1">
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => openChat(selectedDeal.session.sessionId, selectedDeal.contactJid)}
                                        >
                                            <MessageSquare className="h-4 w-4 mr-1.5" />
                                            Abrir no Chat
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => handleDeleteDeal(selectedDeal.id)}
                                        >
                                            <Trash2 className="h-4 w-4 mr-1.5" />
                                            Excluir
                                        </Button>
                                    </div>
                                    <Button type="button" size="sm" onClick={handleSaveDealDetails}>
                                        Salvar Alterações
                                    </Button>
                                </div>

                                <div className="border-t pt-4 space-y-3">
                                    <div className="flex items-center gap-2 font-semibold text-sm">
                                        <StickyNote className="h-4 w-4 text-primary" />
                                        Notas e Histórico ({selectedDeal.notes?.length || 0})
                                    </div>
                                    <form onSubmit={handleAddNote} className="flex gap-2">
                                        <Input
                                            placeholder="Adicionar observação sobre este cliente..."
                                            value={newNoteText}
                                            onChange={(e) => setNewNoteText(e.target.value)}
                                        />
                                        <Button type="submit" size="sm" disabled={addingNote || !newNoteText.trim()}>
                                            {addingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                        </Button>
                                    </form>
                                    <div className="space-y-2 max-h-52 overflow-y-auto">
                                        {(selectedDeal.notes || []).length === 0 ? (
                                            <p className="text-xs text-muted-foreground">Nenhuma nota registrada ainda.</p>
                                        ) : (
                                            selectedDeal.notes.map((n) => (
                                                <div key={n.id} className="rounded-lg bg-muted/50 p-2.5 text-xs space-y-1">
                                                    <div className="flex items-center justify-between text-muted-foreground">
                                                        <span className="font-medium text-foreground">
                                                            {n.authorName || "Equipe"}
                                                        </span>
                                                        <span>
                                                            {new Date(n.createdAt).toLocaleString("pt-BR")}
                                                        </span>
                                                    </div>
                                                    <p className="whitespace-pre-wrap">{n.content}</p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* MODAL: PRODUTO / PIX */}
            <Dialog open={productModalOpen} onOpenChange={setProductModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {editingProduct ? "Editar Produto / PIX" : "Novo Produto / PIX"}
                        </DialogTitle>
                        <DialogDescription>
                            Cadastre itens para enviar cobranças rápidas com chave PIX direto no WhatsApp.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSaveProduct} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>Nome do Produto ou Serviço *</Label>
                            <Input
                                required
                                placeholder="Ex: Consulta de Avaliação / Combo Premium"
                                value={productForm.name}
                                onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Preço (R$) *</Label>
                                <Input
                                    required
                                    placeholder="197,00"
                                    value={productForm.priceReais}
                                    onChange={(e) => setProductForm({ ...productForm, priceReais: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Categoria</Label>
                                <Input
                                    placeholder="Ex: Serviços, Planos"
                                    value={productForm.category}
                                    onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Chave PIX (CPF, CNPJ, E-mail, Telefone ou Aleatória)</Label>
                            <Input
                                placeholder="pix@suaempresa.com.br"
                                value={productForm.pixKey}
                                onChange={(e) => setProductForm({ ...productForm, pixKey: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Descrição (enviada na mensagem)</Label>
                            <Textarea
                                rows={3}
                                placeholder="Detalhes do produto/serviço..."
                                value={productForm.description}
                                onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="prod-active">Produto ativo no catálogo</Label>
                            <Switch
                                id="prod-active"
                                checked={productForm.isActive}
                                onCheckedChange={(checked) => setProductForm({ ...productForm, isActive: checked })}
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setProductModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={savingProduct}>
                                {savingProduct && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Salvar Produto
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
