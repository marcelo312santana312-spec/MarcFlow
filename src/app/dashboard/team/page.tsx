"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { toast } from "sonner";
import {
    Users,
    UserPlus,
    Trash2,
    Loader2,
    ShieldAlert,
    Mail,
    Smartphone,
    ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface SessionItem {
    id: string;
    name: string;
    sessionId: string;
    status: string;
}

interface TeamMember {
    id: string;
    name: string | null;
    email: string;
    role: string;
    createdAt: string;
    sessionAccesses: {
        sessionId: string;
        session: { id: string; name: string; sessionId: string };
    }[];
}

export default function TeamPage() {
    const { data: session } = useSession();
    // @ts-ignore
    const userRole = session?.user?.role;

    const [members, setMembers] = useState<TeamMember[]>([]);
    const [sessions, setSessions] = useState<SessionItem[]>([]);
    const [limits, setLimits] = useState<{ maxUsers: number }>({ maxUsers: 2 });
    const [usage, setUsage] = useState<{ users: number; staff: number }>({ users: 1, staff: 0 });
    const [planName, setPlanName] = useState<string>("Pro");
    const [loading, setLoading] = useState(true);

    const [openCreate, setOpenCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [selectedSessions, setSelectedSessions] = useState<string[]>([]);

    const loadTeam = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/team");
            const json = await res.json();
            if (res.ok && json.status) {
                setMembers(json.data.members || []);
                setSessions(json.data.sessions || []);
                setLimits(json.data.limits || { maxUsers: 2 });
                setUsage(json.data.usage || { users: 1, staff: 0 });
                setPlanName(json.data.planName || "Pro");
                setSelectedSessions((json.data.sessions || []).map((s: SessionItem) => s.id));
            }
        } catch {
            toast.error("Erro ao carregar a equipe.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (userRole && userRole !== "STAFF") {
            loadTeam();
        } else if (userRole === "STAFF") {
            setLoading(false);
        }
    }, [userRole, loadTeam]);

    const handleToggleSession = (id: string) => {
        setSelectedSessions((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
        );
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !email.trim() || password.length < 6) {
            toast.error("Preencha nome, e-mail válido e senha com no mínimo 6 caracteres.");
            return;
        }
        try {
            setCreating(true);
            const res = await fetch("/api/team", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    email: email.trim(),
                    password,
                    sessionIds: selectedSessions,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.message || "Não foi possível adicionar o atendente.");
                return;
            }
            toast.success("Atendente adicionado com sucesso!");
            setName("");
            setEmail("");
            setPassword("");
            setOpenCreate(false);
            await loadTeam();
        } catch {
            toast.error("Erro de conexão ao criar atendente.");
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            setDeletingId(id);
            const res = await fetch(`/api/team?id=${encodeURIComponent(id)}`, {
                method: "DELETE",
            });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.message || "Erro ao remover atendente.");
                return;
            }
            toast.success("Atendente removido com sucesso.");
            await loadTeam();
        } catch {
            toast.error("Erro de conexão ao remover atendente.");
        } finally {
            setDeletingId(null);
        }
    };

    if (userRole === "STAFF") {
        return (
            <Card className="max-w-lg mx-auto mt-10 border-slate-200">
                <CardContent className="py-10 text-center space-y-3">
                    <ShieldAlert className="h-10 w-10 text-amber-500 mx-auto" />
                    <h3 className="text-lg font-bold text-slate-900">Acesso Restrito</h3>
                    <p className="text-sm text-slate-500">
                        Apenas o proprietário da conta pode adicionar ou remover membros da equipe.
                    </p>
                </CardContent>
            </Card>
        );
    }

    const limitReached = usage.users >= limits.maxUsers;

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                        Equipe & Atendentes
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                        Adicione vendedores e atendentes para responder clientes no mesmo WhatsApp com controle de acesso.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Badge variant="outline" className="px-3 py-1.5 text-xs font-medium bg-white">
                        {usage.users} / {limits.maxUsers} usuários ({planName})
                    </Badge>

                    <Dialog open={openCreate} onOpenChange={setOpenCreate}>
                        <DialogTrigger asChild>
                            <Button className="gap-2" disabled={limitReached}>
                                <UserPlus className="h-4 w-4" />
                                Novo Atendente
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Adicionar Atendente (Staff)</DialogTitle>
                                <DialogDescription>
                                    O atendente terá acesso ao Chat, Funil CRM, Contatos e Agenda, sem acesso a configurações técnicas ou cobrança.
                                </DialogDescription>
                            </DialogHeader>

                            <form onSubmit={handleCreate} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="member-name">Nome completo</Label>
                                    <Input
                                        id="member-name"
                                        placeholder="Ex: Maria Oliveira"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="member-email">E-mail de acesso</Label>
                                    <Input
                                        id="member-email"
                                        type="email"
                                        placeholder="maria@suaempresa.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="member-password">Senha inicial</Label>
                                    <Input
                                        id="member-password"
                                        type="password"
                                        placeholder="Mínimo 6 caracteres"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        minLength={6}
                                        required
                                    />
                                </div>

                                {sessions.length > 0 && (
                                    <div className="space-y-2">
                                        <Label>Números WhatsApp liberados</Label>
                                        <div className="space-y-2 rounded-lg border border-slate-200 p-3 max-h-40 overflow-y-auto">
                                            {sessions.map((s) => (
                                                <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                                    <Checkbox
                                                        checked={selectedSessions.includes(s.id)}
                                                        onCheckedChange={() => handleToggleSession(s.id)}
                                                    />
                                                    <span className="font-medium text-slate-700">{s.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setOpenCreate(false)}>
                                        Cancelar
                                    </Button>
                                    <Button type="submit" disabled={creating}>
                                        {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                        Criar Atendente
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {limitReached && (
                <Card className="border-amber-200 bg-amber-50/70">
                    <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-sm text-amber-900">
                            Você atingiu o limite de <strong>{limits.maxUsers}</strong> usuários do plano{" "}
                            <strong>{planName}</strong>. Faça upgrade para adicionar mais atendentes.
                        </p>
                        <Link href="/dashboard/plans">
                            <Button size="sm" variant="outline" className="border-amber-300 bg-white gap-1">
                                Ver Planos <ArrowUpRight className="h-3.5 w-3.5" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            )}

            {/* Members List */}
            <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        Membros da Equipe ({members.length})
                    </CardTitle>
                    <CardDescription>
                        Atendentes vinculados à sua empresa.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="py-12 flex justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                    ) : members.length === 0 ? (
                        <div className="py-12 text-center space-y-3 border-2 border-dashed border-slate-200 rounded-xl">
                            <Users className="h-8 w-8 text-slate-400 mx-auto" />
                            <p className="text-sm font-medium text-slate-700">Nenhum atendente cadastrado ainda</p>
                            <p className="text-xs text-slate-500">
                                Crie logins individuais para sua equipe atender no WhatsApp de forma organizada.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {members.map((member) => (
                                <div
                                    key={member.id}
                                    className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                                >
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <p className="font-semibold text-slate-900">{member.name || "Sem nome"}</p>
                                            <Badge variant="secondary" className="text-[11px]">
                                                Atendente
                                            </Badge>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                                            <span className="flex items-center gap-1">
                                                <Mail className="h-3.5 w-3.5" />
                                                {member.email}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Smartphone className="h-3.5 w-3.5" />
                                                {member.sessionAccesses.length > 0
                                                    ? member.sessionAccesses.map((sa) => sa.session.name).join(", ")
                                                    : "Sem sessões atribuídas"}
                                            </span>
                                        </div>
                                    </div>

                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50 gap-1.5"
                                                disabled={deletingId === member.id}
                                            >
                                                {deletingId === member.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-4 w-4" />
                                                )}
                                                Remover
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Remover atendente?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    O acesso de <strong>{member.name || member.email}</strong> será revogado imediatamente.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                <AlertDialogAction
                                                    className="bg-red-600 hover:bg-red-700"
                                                    onClick={() => handleDelete(member.id)}
                                                >
                                                    Sim, remover
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
