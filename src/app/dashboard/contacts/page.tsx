"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
} from "@/components/ui/pagination";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { toast } from "sonner";
import { Search, Loader2, User, MessageSquare, Plus, Briefcase } from "lucide-react";

interface Contact {
    id: string;
    jid: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
    profilePic?: string;
    remoteJidAlt?: string;
    updatedAt?: string;
}

interface PipelineStage {
    id: string;
    name: string;
    color: string;
}

interface DealSummary {
    id: string;
    contactJid: string;
    title: string;
    valueCents: number;
    status: string;
    stageId: string;
    lastInteractionAt: string;
    stage: PipelineStage;
}

function formatCleanPhone(jid: string, alt?: string): string {
    const candidate = alt && !alt.endsWith("@lid") ? alt : jid;
    const raw = (candidate.split("@")[0] || "").replace(/\D/g, "");
    if (!raw) return jid.split("@")[0] || jid;
    if (raw.startsWith("55") && (raw.length === 12 || raw.length === 13)) {
        const ddd = raw.slice(2, 4);
        const rest = raw.slice(4);
        return `+55 (${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
    }
    return `+${raw}`;
}

function formatBRL(cents: number): string {
    return (cents / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
    });
}

export default function ContactListPage() {
    const router = useRouter();
    const { sessionId } = useSession();
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(false);

    // CRM data
    const [stages, setStages] = useState<PipelineStage[]>([]);
    const [deals, setDeals] = useState<DealSummary[]>([]);
    const [stageFilter, setStageFilter] = useState<string>("ALL");

    // Filters
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState("10");
    const [meta, setMeta] = useState({ total: 0, totalPages: 1 });

    // Create Deal Modal
    const [dealModalContact, setDealModalContact] = useState<Contact | null>(null);
    const [dealTitle, setDealTitle] = useState("");
    const [dealValueReais, setDealValueReais] = useState("");
    const [dealStageId, setDealStageId] = useState("");
    const [creatingDeal, setCreatingDeal] = useState(false);

    const fetchCrmData = useCallback(async () => {
        if (!sessionId) return;
        try {
            const [pRes, dRes] = await Promise.all([
                fetch("/api/crm/pipelines"),
                fetch(`/api/crm/deals?sessionId=${encodeURIComponent(sessionId)}`),
            ]);
            if (pRes.ok) {
                const pj = await pRes.json();
                const st: PipelineStage[] = pj.data?.[0]?.stages || [];
                setStages(st);
                if (st.length > 0 && !dealStageId) setDealStageId(st[0].id);
            }
            if (dRes.ok) {
                const dj = await dRes.json();
                setDeals(dj.data || []);
            }
        } catch (e) {
            console.error(e);
        }
    }, [sessionId, dealStageId]);

    const fetchContacts = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: stageFilter !== "ALL" ? "all" : limit,
                search: search
            });

            const res = await fetch(`/api/contacts/${sessionId}?${params}`);
            const data = await res.json();

            if (res.ok) {
                setContacts(data.data);
                setMeta(data.meta);
            } else {
                setContacts([]);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [sessionId, page, limit, search, stageFilter]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(1);
            fetchContacts();
        }, 400);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        fetchContacts();
    }, [page, sessionId, limit, stageFilter]);

    useEffect(() => {
        fetchCrmData();
    }, [fetchCrmData]);

    const dealsByJid = useMemo(() => {
        const map = new Map<string, DealSummary[]>();
        for (const d of deals) {
            const list = map.get(d.contactJid) || [];
            list.push(d);
            map.set(d.contactJid, list);
        }
        return map;
    }, [deals]);

    const displayedContacts = useMemo(() => {
        if (stageFilter === "ALL") return contacts;
        if (stageFilter === "NO_DEAL") {
            return contacts.filter((c) => !(dealsByJid.get(c.jid)?.length));
        }
        return contacts.filter((c) =>
            (dealsByJid.get(c.jid) || []).some((d) => d.stageId === stageFilter)
        );
    }, [contacts, stageFilter, dealsByJid]);

    const openCreateDealModal = (contact: Contact) => {
        const displayName = contact.name || contact.notify || formatCleanPhone(contact.jid, contact.remoteJidAlt);
        setDealModalContact(contact);
        setDealTitle(`Negócio - ${displayName}`);
        setDealValueReais("");
        if (stages.length > 0) setDealStageId(stages[0].id);
    };

    const handleCreateDeal = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!dealModalContact || !sessionId) return;
        const num = parseFloat(dealValueReais.replace(/[^\d.,]/g, "").replace(",", "."));
        const valueCents = isNaN(num) || num < 0 ? 0 : Math.round(num * 100);

        setCreatingDeal(true);
        try {
            const res = await fetch("/api/crm/deals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    contactJid: dealModalContact.jid,
                    contactName: dealModalContact.name || dealModalContact.notify || null,
                    contactPhone: formatCleanPhone(dealModalContact.jid, dealModalContact.remoteJidAlt),
                    title: dealTitle.trim() || "Novo Negócio",
                    valueCents,
                    stageId: dealStageId || undefined,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message);
            setDeals((prev) => [json.data, ...prev]);
            setDealModalContact(null);
            toast.success("Negócio criado no funil!");
        } catch (err: any) {
            toast.error(err.message || "Erro ao criar negócio");
        } finally {
            setCreatingDeal(false);
        }
    };

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Contatos & Leads (CRM)</h2>
                        <p className="text-muted-foreground">
                            Visualize contatos, etapas do funil, valores em negociação e inicie atendimentos.
                        </p>
                    </div>
                    <Button variant="outline" onClick={() => router.push("/dashboard/crm")}>
                        <Briefcase className="h-4 w-4 mr-2" />
                        Ir para o Funil Kanban
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                            <div className="space-y-1">
                                <CardTitle>Lista de contatos</CardTitle>
                                <CardDescription>
                                    Total: {stageFilter === "ALL" ? meta.total : displayedContacts.length} contato(s)
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                                <Select value={stageFilter} onValueChange={(val) => { setStageFilter(val); setPage(1); }}>
                                    <SelectTrigger className="w-[180px]">
                                        <SelectValue placeholder="Etapa do funil" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">Todas as etapas</SelectItem>
                                        <SelectItem value="NO_DEAL">Sem negócio ainda</SelectItem>
                                        {stages.map((s) => (
                                            <SelectItem key={s.id} value={s.id}>
                                                {s.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={limit} onValueChange={(val) => { setLimit(val); setPage(1); }}>
                                    <SelectTrigger className="w-[130px]">
                                        <SelectValue placeholder="Por página" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[10, 25, 50, 100].map((l) => (
                                            <SelectItem key={l} value={l.toString()}>
                                                {l} / página
                                            </SelectItem>
                                        ))}
                                        <SelectItem value="all">Mostrar todos</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="relative w-full sm:w-64">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Buscar nome ou telefone..."
                                        className="pl-8"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[64px]">Foto</TableHead>
                                        <TableHead>Contato / Telefone</TableHead>
                                        <TableHead>Etapa do Funil</TableHead>
                                        <TableHead className="hidden md:table-cell">Valor Total</TableHead>
                                        <TableHead className="hidden lg:table-cell">Última Interação</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-24 text-center">
                                                <div className="flex justify-center items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Carregando...
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : displayedContacts.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-24 text-center">
                                                Nenhum contato encontrado.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        displayedContacts.map((contact) => {
                                            const contactDeals = dealsByJid.get(contact.jid) || [];
                                            const primaryDeal = contactDeals[0];
                                            const totalValueCents = contactDeals.reduce((s, d) => s + d.valueCents, 0);
                                            const lastDate = primaryDeal?.lastInteractionAt || contact.updatedAt;

                                            return (
                                                <TableRow key={contact.id}>
                                                    <TableCell>
                                                        <Avatar>
                                                            <AvatarImage src={`/api/chat/${sessionId}/${encodeURIComponent(contact.jid)}/avatar`} alt="" />
                                                            <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                                                        </Avatar>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">
                                                                {contact.name || contact.notify || "Sem nome"}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground font-mono">
                                                                {formatCleanPhone(contact.jid, contact.remoteJidAlt)}
                                                            </span>
                                                            {contact.verifiedName && (
                                                                <span className="text-xs text-green-600">
                                                                    ✓ {contact.verifiedName}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        {primaryDeal ? (
                                                            <Badge
                                                                variant="outline"
                                                                style={{
                                                                    borderColor: primaryDeal.stage.color,
                                                                    color: primaryDeal.stage.color,
                                                                }}
                                                            >
                                                                {primaryDeal.stage.name}
                                                            </Badge>
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">—</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="hidden md:table-cell font-medium">
                                                        {contactDeals.length > 0 ? (
                                                            <span className="text-emerald-600">{formatBRL(totalValueCents)}</span>
                                                        ) : (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                                                        {lastDate ? new Date(lastDate).toLocaleDateString("pt-BR") : "—"}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 text-xs"
                                                                onClick={() => openCreateDealModal(contact)}
                                                            >
                                                                <Plus className="h-3.5 w-3.5 mr-1" />
                                                                Criar Negócio
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                className="h-8 text-xs"
                                                                onClick={() =>
                                                                    router.push(
                                                                        `/dashboard/chat?sessionId=${encodeURIComponent(sessionId)}&jid=${encodeURIComponent(contact.jid)}`
                                                                    )
                                                                }
                                                            >
                                                                <MessageSquare className="h-3.5 w-3.5 mr-1" />
                                                                Abrir Chat
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

                        {stageFilter === "ALL" && meta.totalPages > 1 && (
                            <div className="mt-4">
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem>
                                            <Button
                                                variant="ghost"
                                                disabled={page <= 1}
                                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                            >
                                                Anterior
                                            </Button>
                                        </PaginationItem>

                                        <PaginationItem>
                                            <span className="text-sm text-muted-foreground mx-4">
                                                Página {page} de {meta.totalPages}
                                            </span>
                                        </PaginationItem>

                                        <PaginationItem>
                                            <Button
                                                variant="ghost"
                                                disabled={page >= meta.totalPages}
                                                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                                            >
                                                Próxima
                                            </Button>
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Modal: Criar Negócio */}
                <Dialog open={!!dealModalContact} onOpenChange={(open) => !open && setDealModalContact(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Criar Negócio para Contato</DialogTitle>
                            <DialogDescription>
                                {dealModalContact?.name || dealModalContact?.notify || (dealModalContact && formatCleanPhone(dealModalContact.jid, dealModalContact.remoteJidAlt))}
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleCreateDeal} className="space-y-4">
                            <div className="space-y-1.5">
                                <Label>Título do Negócio *</Label>
                                <Input
                                    required
                                    value={dealTitle}
                                    onChange={(e) => setDealTitle(e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Valor (R$)</Label>
                                    <Input
                                        placeholder="0,00"
                                        value={dealValueReais}
                                        onChange={(e) => setDealValueReais(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Etapa Inicial</Label>
                                    <Select value={dealStageId} onValueChange={setDealStageId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {stages.map((s) => (
                                                <SelectItem key={s.id} value={s.id}>
                                                    {s.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setDealModalContact(null)}>
                                    Cancelar
                                </Button>
                                <Button type="submit" disabled={creatingDeal}>
                                    {creatingDeal && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Criar Negócio
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
