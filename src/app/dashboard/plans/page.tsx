"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
    Check,
    Crown,
    Sparkles,
    Users,
    Smartphone,
    Megaphone,
    Clock,
    AlertTriangle,
    CheckCircle2,
    Loader2,
    Zap,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface Plan {
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
}

interface SubscriptionData {
    plan: Plan;
    status: string;
    isTrialActive: boolean;
    isExpired: boolean;
    trialDaysLeft: number;
    subscription: {
        id: string;
        status: string;
        trialEndsAt: string | null;
        currentPeriodEnd: string | null;
    };
    usage: {
        sessions: number;
        users: number;
        staff: number;
        broadcastDaily: number;
    };
    limits: {
        maxSessions: number;
        maxUsers: number;
        maxBroadcastDaily: number;
        hasAiStudio: boolean;
        hasCrm: boolean;
    };
}

function formatBRL(cents: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(cents / 100);
}

function formatDateBR(dateStr: string | null) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("pt-BR");
}

export default function PlansPage() {
    const { data: session } = useSession();
    // @ts-ignore
    const userRole = session?.user?.role;

    const [plans, setPlans] = useState<Plan[]>([]);
    const [subData, setSubData] = useState<SubscriptionData | null>(null);
    const [loading, setLoading] = useState(true);
    const [updatingPlanId, setUpdatingPlanId] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [plansRes, subRes] = await Promise.all([
                fetch("/api/plans"),
                fetch("/api/subscription"),
            ]);
            const plansJson = await plansRes.json();
            const subJson = await subRes.json();

            if (plansJson.status) {
                setPlans(plansJson.data || []);
            }
            if (subJson.status) {
                setSubData(subJson.data);
            }
        } catch (err) {
            toast.error("Erro ao carregar planos e assinatura.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSelectPlan = async (plan: Plan) => {
        if (userRole === "STAFF") {
            toast.error("Apenas o proprietário da conta pode alterar o plano.");
            return;
        }
        try {
            setUpdatingPlanId(plan.id);
            const res = await fetch("/api/subscription", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId: plan.id, action: "activate" }),
            });
            const json = await res.json();
            if (!res.ok || !json.status) {
                toast.error(json.message || "Não foi possível atualizar o plano.");
                return;
            }
            toast.success(json.message || `Plano ${plan.name} ativado com sucesso!`);
            setSubData(json.data);
        } catch {
            toast.error("Erro de conexão ao atualizar o plano.");
        } finally {
            setUpdatingPlanId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const usagePct = (used: number, max: number) => {
        if (max <= 0) return 100;
        return Math.min(100, Math.round((used / max) * 100));
    };

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                        Planos & Assinatura
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                        Acompanhe o consumo da sua conta e escolha o plano ideal para o seu crescimento.
                    </p>
                </div>
                {subData && (
                    <div className="flex items-center gap-2">
                        {subData.isTrialActive ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 px-3 py-1.5 text-xs font-semibold gap-1.5">
                                <Clock className="h-3.5 w-3.5" />
                                Teste Grátis: {subData.trialDaysLeft} {subData.trialDaysLeft === 1 ? "dia restante" : "dias restantes"}
                            </Badge>
                        ) : subData.isExpired ? (
                            <Badge variant="destructive" className="px-3 py-1.5 text-xs font-semibold gap-1.5">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Assinatura Expirada
                            </Badge>
                        ) : (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 px-3 py-1.5 text-xs font-semibold gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Assinatura Ativa ({subData.plan.name})
                            </Badge>
                        )}
                    </div>
                )}
            </div>

            {/* Current Usage & Trial Status */}
            {subData && (
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="pb-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Crown className="h-5 w-5 text-primary" />
                                    Plano Atual: {subData.plan.name}
                                </CardTitle>
                                <CardDescription className="mt-1">
                                    {subData.isTrialActive
                                        ? `Você está no período de teste gratuito de 7 dias do plano ${subData.plan.name} (expira em ${formatDateBR(subData.subscription.trialEndsAt)}).`
                                        : subData.isExpired
                                        ? "Seu período de teste ou assinatura expirou. Ative um plano abaixo para desbloquear novos recursos."
                                        : `Ciclo atual válido até ${formatDateBR(subData.subscription.currentPeriodEnd)}.`}
                                </CardDescription>
                            </div>
                            <div className="text-left sm:text-right">
                                <span className="text-2xl font-bold text-slate-900">
                                    {formatBRL(subData.plan.priceCents)}
                                </span>
                                <span className="text-xs text-slate-500">/mês</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-6 md:grid-cols-3">
                            {/* Sessions */}
                            <div className="space-y-2 p-4 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="flex items-center justify-between text-sm font-medium">
                                    <span className="flex items-center gap-2 text-slate-700">
                                        <Smartphone className="h-4 w-4 text-blue-600" />
                                        Conexões WhatsApp
                                    </span>
                                    <span className="font-bold text-slate-900">
                                        {subData.usage.sessions} / {subData.limits.maxSessions}
                                    </span>
                                </div>
                                <Progress value={usagePct(subData.usage.sessions, subData.limits.maxSessions)} className="h-2" />
                                <p className="text-xs text-slate-500">Números conectados simultaneamente</p>
                            </div>

                            {/* Team Users */}
                            <div className="space-y-2 p-4 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="flex items-center justify-between text-sm font-medium">
                                    <span className="flex items-center gap-2 text-slate-700">
                                        <Users className="h-4 w-4 text-emerald-600" />
                                        Usuários da Equipe
                                    </span>
                                    <span className="font-bold text-slate-900">
                                        {subData.usage.users} / {subData.limits.maxUsers}
                                    </span>
                                </div>
                                <Progress value={usagePct(subData.usage.users, subData.limits.maxUsers)} className="h-2" />
                                <p className="text-xs text-slate-500">Proprietário + {subData.usage.staff} atendente(s)</p>
                            </div>

                            {/* Daily Broadcasts */}
                            <div className="space-y-2 p-4 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="flex items-center justify-between text-sm font-medium">
                                    <span className="flex items-center gap-2 text-slate-700">
                                        <Megaphone className="h-4 w-4 text-purple-600" />
                                        Disparos Hoje
                                    </span>
                                    <span className="font-bold text-slate-900">
                                        {subData.usage.broadcastDaily} / {subData.limits.maxBroadcastDaily}
                                    </span>
                                </div>
                                <Progress
                                    value={usagePct(subData.usage.broadcastDaily, subData.limits.maxBroadcastDaily)}
                                    className="h-2"
                                />
                                <p className="text-xs text-slate-500">Campanhas e agendamentos diários</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Plans Comparison */}
            <div className="grid gap-6 md:grid-cols-3">
                {plans.map((plan) => {
                    const isCurrent = subData?.plan?.id === plan.id;
                    const isPro = plan.slug === "pro";
                    const isBusy = updatingPlanId === plan.id;

                    return (
                        <Card
                            key={plan.id}
                            className={`relative flex flex-col justify-between transition-all ${
                                isPro
                                    ? "border-primary shadow-lg ring-1 ring-primary/20"
                                    : "border-slate-200 shadow-sm hover:shadow-md"
                            }`}
                        >
                            {isPro && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                    <Badge className="bg-primary text-primary-foreground px-3 py-0.5 text-xs font-semibold shadow-sm gap-1">
                                        <Sparkles className="h-3 w-3" /> Mais Popular
                                    </Badge>
                                </div>
                            )}

                            <div>
                                <CardHeader className="pb-4 pt-6">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-xl font-bold text-slate-900">{plan.name}</CardTitle>
                                        {isCurrent && (
                                            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 text-xs">
                                                Seu Plano
                                            </Badge>
                                        )}
                                    </div>
                                    <CardDescription className="min-h-[40px] text-xs mt-1">
                                        {plan.description}
                                    </CardDescription>
                                    <div className="mt-4 flex items-baseline gap-1">
                                        <span className="text-3xl font-extrabold text-slate-900">
                                            {formatBRL(plan.priceCents)}
                                        </span>
                                        <span className="text-sm text-slate-500">/mês</span>
                                    </div>
                                </CardHeader>

                                <CardContent className="space-y-3 text-sm">
                                    <div className="flex items-center gap-2.5 text-slate-700">
                                        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                                        <span>
                                            Até <strong>{plan.maxSessions}</strong>{" "}
                                            {plan.maxSessions === 1 ? "conexão WhatsApp" : "conexões WhatsApp"}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2.5 text-slate-700">
                                        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                                        <span>
                                            Até <strong>{plan.maxUsers}</strong> usuários na equipe
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2.5 text-slate-700">
                                        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                                        <span>
                                            <strong>{plan.maxBroadcastDaily.toLocaleString("pt-BR")}</strong> disparos/dia
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2.5 text-slate-700">
                                        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                                        <span>Funil Kanban CRM, Agenda & Catálogo PIX</span>
                                    </div>
                                    <div
                                        className={`flex items-center gap-2.5 ${
                                            plan.hasAiStudio ? "text-slate-700" : "text-slate-400 line-through"
                                        }`}
                                    >
                                        {plan.hasAiStudio ? (
                                            <Zap className="h-4 w-4 text-amber-500 shrink-0" />
                                        ) : (
                                            <Check className="h-4 w-4 text-slate-300 shrink-0" />
                                        )}
                                        <span>Estúdio IA & Qualificação Automática</span>
                                    </div>
                                </CardContent>
                            </div>

                            <CardFooter className="pt-4">
                                <Button
                                    className="w-full"
                                    variant={isCurrent && !subData?.isTrialActive && !subData?.isExpired ? "outline" : isPro ? "default" : "secondary"}
                                    disabled={isBusy || userRole === "STAFF"}
                                    onClick={() => handleSelectPlan(plan)}
                                >
                                    {isBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    {isCurrent && subData?.isTrialActive
                                        ? `Ativar Plano ${plan.name}`
                                        : isCurrent && !subData?.isExpired
                                        ? "Renovar por 30 dias"
                                        : `Escolher ${plan.name}`}
                                </Button>
                            </CardFooter>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
