"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession as useSessionProvider } from "@/components/dashboard/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  Bell,
  BellRing,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELED"
  | "NO_SHOW";

interface AppointmentItem {
  id: string;
  userId: string;
  sessionId: string;
  contactJid: string;
  contactName: string | null;
  title: string;
  notes: string | null;
  scheduledAt: string;
  durationMin: number;
  status: AppointmentStatus;
  reminder24hSent: boolean;
  reminder2hSent: boolean;
  session?: {
    id: string;
    sessionId: string;
    name: string;
  };
}

const STATUS_META: Record<
  AppointmentStatus,
  { label: string; badgeClass: string }
> = {
  SCHEDULED: {
    label: "Agendado",
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  CONFIRMED: {
    label: "Confirmado",
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  COMPLETED: {
    label: "Concluído",
    badgeClass: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
  },
  CANCELED: {
    label: "Cancelado",
    badgeClass: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  },
  NO_SHOW: {
    label: "Não compareceu",
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
};

function toLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toLocalDateTimeInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function formatPhone(jid: string): string {
  const clean = jid.replace(/@s\.whatsapp\.net|@c\.us|@lid/g, "");
  if (clean.startsWith("55") && clean.length >= 12) {
    const ddd = clean.slice(2, 4);
    const num = clean.slice(4);
    return `+55 (${ddd}) ${num}`;
  }
  return clean;
}

export default function AgendaPage() {
  const { sessions, sessionId: activeSessionSlug } = useSessionProvider();

  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [viewMode, setViewMode] = useState<"day" | "week" | "all">("week");
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    toLocalDateInput(new Date())
  );
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  // Modal de criação rápida
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formSessionId, setFormSessionId] = useState<string>("");
  const [formContactName, setFormContactName] = useState<string>("");
  const [formContactPhone, setFormContactPhone] = useState<string>("");
  const [formTitle, setFormTitle] = useState<string>("");
  const [formScheduledAt, setFormScheduledAt] = useState<string>(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return toLocalDateTimeInput(d);
  });
  const [formDurationMin, setFormDurationMin] = useState<string>("60");
  const [formNotes, setFormNotes] = useState<string>("");

  useEffect(() => {
    if (!formSessionId) {
      if (activeSessionSlug) {
        setFormSessionId(activeSessionSlug);
      } else if (sessions.length > 0) {
        setFormSessionId(sessions[0].sessionId);
      }
    }
  }, [activeSessionSlug, sessions, formSessionId]);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (sessionFilter !== "all") params.set("sessionId", sessionFilter);
      if (search.trim()) params.set("search", search.trim());

      if (viewMode === "day" && selectedDate) {
        const start = new Date(`${selectedDate}T00:00:00`);
        const end = new Date(`${selectedDate}T23:59:59.999`);
        params.set("startDate", start.toISOString());
        params.set("endDate", end.toISOString());
      } else if (viewMode === "week" && selectedDate) {
        const start = new Date(`${selectedDate}T00:00:00`);
        const end = new Date(`${selectedDate}T23:59:59.999`);
        end.setDate(end.getDate() + 6);
        params.set("startDate", start.toISOString());
        params.set("endDate", end.toISOString());
      }

      const res = await fetch(`/api/agenda?${params.toString()}`);
      const json = await res.json();
      if (res.ok && json.status) {
        setAppointments(Array.isArray(json.data) ? json.data : []);
      } else {
        toast.error(json.message || "Falha ao carregar agenda.");
      }
    } catch {
      toast.error("Erro de conexão ao carregar agenda.");
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedDate, statusFilter, sessionFilter, search]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const shiftDate = (days: number) => {
    const base = new Date(`${selectedDate}T12:00:00`);
    base.setDate(base.getDate() + days);
    setSelectedDate(toLocalDateInput(base));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSessionId) {
      toast.error("Selecione uma sessão de WhatsApp.");
      return;
    }
    if (!formContactPhone.trim() || !formTitle.trim() || !formScheduledAt) {
      toast.error("Preencha WhatsApp do cliente, título e data/hora.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: formSessionId,
          contactJid: formContactPhone.trim(),
          contactName: formContactName.trim() || undefined,
          title: formTitle.trim(),
          scheduledAt: new Date(formScheduledAt).toISOString(),
          durationMin: Number(formDurationMin) || 60,
          notes: formNotes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (res.ok && json.status) {
        toast.success("Atendimento agendado com sucesso!");
        setCreateOpen(false);
        setFormContactName("");
        setFormContactPhone("");
        setFormTitle("");
        setFormNotes("");
        fetchAppointments();
      } else {
        toast.error(json.message || "Não foi possível criar o agendamento.");
      }
    } catch {
      toast.error("Erro ao salvar agendamento.");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: AppointmentStatus) => {
    try {
      const res = await fetch(`/api/agenda/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (res.ok && json.status) {
        toast.success(`Status alterado para ${STATUS_META[status].label}.`);
        setAppointments((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status } : item))
        );
      } else {
        toast.error(json.message || "Erro ao atualizar status.");
      }
    } catch {
      toast.error("Erro de conexão ao atualizar status.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/agenda/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (res.ok && json.status) {
        toast.success("Agendamento removido.");
        setAppointments((prev) => prev.filter((item) => item.id !== id));
      } else {
        toast.error(json.message || "Erro ao remover agendamento.");
      }
    } catch {
      toast.error("Erro de conexão ao remover agendamento.");
    }
  };

  // Agrupamento por dia para leitura limpa
  const groupedByDay = appointments.reduce<Record<string, AppointmentItem[]>>(
    (acc, item) => {
      const dayKey = toLocalDateInput(new Date(item.scheduledAt));
      if (!acc[dayKey]) acc[dayKey] = [];
      acc[dayKey].push(item);
      return acc;
    },
    {}
  );

  const sortedDays = Object.keys(groupedByDay).sort();

  const counts = {
    total: appointments.length,
    scheduled: appointments.filter((a) => a.status === "SCHEDULED").length,
    confirmed: appointments.filter((a) => a.status === "CONFIRMED").length,
    completed: appointments.filter((a) => a.status === "COMPLETED").length,
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <CalendarIcon className="h-7 w-7 text-primary" />
            Agenda de Atendimentos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Organize consultas, reuniões e visitas com lembretes automáticos D-1 (24h) e 2h antes no WhatsApp.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAppointments}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Agendamento
          </Button>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total no período
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Agendados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {counts.scheduled}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Confirmados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {counts.confirmed}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Concluídos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.completed}</div>
          </CardContent>
        </Card>
      </div>

      {/* Barra de Filtros */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            {/* Seletor de Período */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border p-1 bg-muted/40">
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === "day" ? "default" : "ghost"}
                  onClick={() => setViewMode("day")}
                >
                  Dia
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === "week" ? "default" : "ghost"}
                  onClick={() => setViewMode("week")}
                >
                  Semana
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === "all" ? "default" : "ghost"}
                  onClick={() => setViewMode("all")}
                >
                  Todos
                </Button>
              </div>

              {viewMode !== "all" && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => shiftDate(viewMode === "day" ? -1 : -7)}
                    aria-label="Período anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-auto"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => shiftDate(viewMode === "day" ? 1 : 7)}
                    aria-label="Próximo período"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedDate(toLocalDateInput(new Date()))}
                  >
                    Hoje
                  </Button>
                </div>
              )}
            </div>

            {/* Busca, Status e Sessão */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente ou assunto..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 sm:w-56"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="sm:w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos os status</SelectItem>
                  <SelectItem value="SCHEDULED">Agendado</SelectItem>
                  <SelectItem value="CONFIRMED">Confirmado</SelectItem>
                  <SelectItem value="COMPLETED">Concluído</SelectItem>
                  <SelectItem value="CANCELED">Cancelado</SelectItem>
                  <SelectItem value="NO_SHOW">Não compareceu</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sessionFilter} onValueChange={setSessionFilter}>
                <SelectTrigger className="sm:w-44">
                  <SelectValue placeholder="WhatsApp" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os números</SelectItem>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.sessionId}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Agendamentos */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Carregando atendimentos...
          </CardContent>
        </Card>
      ) : sortedDays.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center space-y-3">
            <CalendarIcon className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-base font-medium">Nenhum atendimento encontrado</p>
            <p className="text-sm text-muted-foreground">
              Crie um novo agendamento ou ajuste os filtros de data e status.
            </p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Agendar Atendimento
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedDays.map((day) => {
            const dateObj = new Date(`${day}T12:00:00`);
            const formattedDay = dateObj.toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            });

            return (
              <div key={day} className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground capitalize px-1">
                  {formattedDay}
                </h2>

                <div className="grid gap-3">
                  {groupedByDay[day].map((item) => {
                    const start = new Date(item.scheduledAt);
                    const timeStr = start.toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const meta = STATUS_META[item.status] || STATUS_META.SCHEDULED;

                    return (
                      <Card key={item.id} className="hover:border-primary/40 transition-colors">
                        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-start gap-4">
                            {/* Horário */}
                            <div className="flex flex-col items-center justify-center rounded-xl bg-primary/10 text-primary px-3 py-2 min-w-[74px]">
                              <span className="text-lg font-bold leading-none">{timeStr}</span>
                              <span className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {item.durationMin}m
                              </span>
                            </div>

                            {/* Detalhes */}
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-base">{item.title}</span>
                                <Badge variant="outline" className={meta.badgeClass}>
                                  {meta.label}
                                </Badge>
                                {item.session?.name && (
                                  <Badge variant="secondary" className="text-xs">
                                    {item.session.name}
                                  </Badge>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                  <User className="h-3.5 w-3.5" />
                                  {item.contactName || formatPhone(item.contactJid)}
                                </span>
                                {item.contactName && (
                                  <span className="text-xs font-mono">
                                    {formatPhone(item.contactJid)}
                                  </span>
                                )}
                              </div>

                              {item.notes && (
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {item.notes}
                                </p>
                              )}

                              {/* Indicadores de Lembretes Automáticos D-1 e 2h */}
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <span
                                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
                                    item.reminder24hSent
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                      : "bg-muted text-muted-foreground border-border"
                                  }`}
                                >
                                  {item.reminder24hSent ? (
                                    <BellRing className="h-3 w-3" />
                                  ) : (
                                    <Bell className="h-3 w-3" />
                                  )}
                                  Lembrete D-1: {item.reminder24hSent ? "Enviado" : "Pendente"}
                                </span>

                                <span
                                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
                                    item.reminder2hSent
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                                      : "bg-muted text-muted-foreground border-border"
                                  }`}
                                >
                                  {item.reminder2hSent ? (
                                    <BellRing className="h-3 w-3" />
                                  ) : (
                                    <Bell className="h-3 w-3" />
                                  )}
                                  Lembrete 2h: {item.reminder2hSent ? "Enviado" : "Pendente"}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Ações Rápidas */}
                          <div className="flex flex-wrap items-center gap-1.5 self-end md:self-center">
                            {item.status === "SCHEDULED" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                                onClick={() => handleUpdateStatus(item.id, "CONFIRMED")}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                Confirmar
                              </Button>
                            )}
                            {(item.status === "SCHEDULED" || item.status === "CONFIRMED") && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleUpdateStatus(item.id, "COMPLETED")}
                                >
                                  Concluir
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-rose-600 hover:bg-rose-500/10"
                                  onClick={() => handleUpdateStatus(item.id, "CANCELED")}
                                >
                                  <XCircle className="h-3.5 w-3.5 mr-1" />
                                  Cancelar
                                </Button>
                              </>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-muted-foreground hover:text-rose-600"
                              onClick={() => handleDelete(item.id)}
                              aria-label="Excluir agendamento"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Criação Rápida */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo Agendamento</DialogTitle>
            <DialogDescription>
              Vincule um atendimento a uma sessão de WhatsApp. O sistema enviará lembretes automáticos D-1 e 2h antes.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="agenda-session">Número / Sessão de WhatsApp</Label>
              <Select value={formSessionId} onValueChange={setFormSessionId}>
                <SelectTrigger id="agenda-session">
                  <SelectValue placeholder="Selecione uma sessão" />
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

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="agenda-name">Nome do Cliente</Label>
                <Input
                  id="agenda-name"
                  placeholder="Ex: Maria Silva"
                  value={formContactName}
                  onChange={(e) => setFormContactName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agenda-phone">WhatsApp (com DDI e DDD) *</Label>
                <Input
                  id="agenda-phone"
                  placeholder="Ex: 5511999999999"
                  value={formContactPhone}
                  onChange={(e) => setFormContactPhone(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="agenda-title">Assunto / Serviço *</Label>
              <Input
                id="agenda-title"
                placeholder="Ex: Avaliação odontológica / Reunião de proposta"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                required
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="agenda-datetime">Data e Hora *</Label>
                <Input
                  id="agenda-datetime"
                  type="datetime-local"
                  value={formScheduledAt}
                  onChange={(e) => setFormScheduledAt(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agenda-duration">Duração (minutos)</Label>
                <Input
                  id="agenda-duration"
                  type="number"
                  min={5}
                  max={480}
                  value={formDurationMin}
                  onChange={(e) => setFormDurationMin(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="agenda-notes">Observações (opcional)</Label>
              <Textarea
                id="agenda-notes"
                rows={3}
                placeholder="Detalhes importantes para o atendimento..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar Agendamento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
