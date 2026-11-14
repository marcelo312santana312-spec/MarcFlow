import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
    Plus,
    MessageSquare,
    ArrowRight,
    DollarSign,
    Trophy,
    Ticket,
    TrendingUp,
    CheckCircle2,
    Circle,
    Kanban,
    CalendarDays,
    CreditCard,
    Users,
    Smartphone,
    Workflow,
    Package,
    Clock,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { getAccessibleSessions } from "@/lib/api-auth";
import { getUserSubscriptionWithLimits } from "@/lib/subscription";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function formatBRL(cents: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
    }).format(cents / 100);
}

export default async function DashboardPage() {
    const session = await auth();
    if (!session?.user?.id) {
        redirect("/login");
    }

    const userId = session.user.id;
    // @ts-ignore
    const userRole = session.user.role || "OWNER";
    const isStaff = userRole === "STAFF";

    const sessions = await getAccessibleSessions(userId, userRole);
    const sessionCuidIds = sessions.map((s) => s.id);
    const sessionStringIds = sessions.map((s) => s.sessionId);

    const connectedSessions = sessions.filter((s) => s.status === "CONNECTED").length;

    let openDealsValueCents = 0;
    let wonDealsCount = 0;
    let wonDealsValueCents = 0;
    let totalDealsCount = 0;
    let openTicketsCount = 0;
    let flowsCount = 0;
    let autoReplyCount = 0;
    let productsCount = 0;

    try {
        if (sessionCuidIds.length > 0) {
            const [openAgg, wonAgg, totalDeals, ticketsCount, fCount, arCount] = await Promise.all([
                prisma.deal.aggregate({
                    where: { sessionId: { in: sessionCuidIds }, status: "OPEN" },
                    _sum: { valueCents: true },
                }),
                prisma.deal.aggregate({
                    where: { sessionId: { in: sessionCuidIds }, status: "WON" },
                    _sum: { valueCents: true },
                    _count: { id: true },
                }),
                prisma.deal.count({
                    where: { sessionId: { in: sessionCuidIds } },
                }),
                prisma.conversationTicket.count({
                    where: {
                        sessionId: { in: sessionCuidIds },
                        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] },
                    },
                }),
                prisma.flow.count({
                    where: { sessionId: { in: sessionCuidIds } },
                }),
                prisma.autoReply.count({
                    where: { sessionId: { in: sessionStringIds } },
                }),
            ]);

            openDealsValueCents = openAgg._sum.valueCents || 0;
            wonDealsValueCents = wonAgg._sum.valueCents || 0;
            wonDealsCount = wonAgg._count.id || 0;
            totalDealsCount = totalDeals;
            openTicketsCount = ticketsCount;
            flowsCount = fCount;
            autoReplyCount = arCount;
        }

        productsCount = await prisma.product.count({
            where: { userId },
        });
    } catch {
        // Fallback safely if tables are empty or migrating
    }

    const conversionRate =
        totalDealsCount > 0 ? ((wonDealsCount / totalDealsCount) * 100).toFixed(1) : "0.0";

    let subInfo: Awaited<ReturnType<typeof getUserSubscriptionWithLimits>> | null = null;
    try {
        subInfo = await getUserSubscriptionWithLimits(userId);
    } catch {
        // Ignore if subscription lookup fails
    }

    const step1Done = connectedSessions > 0;
    const step2Done = flowsCount > 0 || autoReplyCount > 0;
    const step3Done = productsCount > 0 || totalDealsCount > 0;
    const completedSteps = [step1Done, step2Done, step3Done].filter(Boolean).length;

    const kpis = [
        {
            title: "Receita em Negociação",
            value: formatBRL(openDealsValueCents),
            description: "Negócios em aberto no funil",
            icon: DollarSign,
            color: "text-blue-600",
            bg: "bg-blue-50",
        },
        {
            title: "Negócios Ganhos",
            value: `${wonDealsCount}`,
            description: wonDealsValueCents > 0 ? `${formatBRL(wonDealsValueCents)} fechados` : "Vendas concluídas",
            icon: Trophy,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
        },
        {
            title: "Tickets Abertos",
            value: `${openTicketsCount}`,
            description: "Atendimentos em andamento",
            icon: Ticket,
            color: "text-amber-600",
            bg: "bg-amber-50",
        },
        {
            title: "Taxa de Conversão",
            value: `${conversionRate}%`,
            description: `${wonDealsCount} de ${totalDealsCount} negócios`,
            icon: TrendingUp,
            color: "text-purple-600",
            bg: "bg-purple-50",
        },
    ];

    const quickLinks = [
        {
            href: "/dashboard/crm",
            label: "Funil de Vendas (CRM)",
            description: "Gerenciar leads, pipeline e catálogo PIX",
            icon: Kanban,
        },
        {
            href: "/dashboard/chat",
            label: "Central de Conversas",
            description: "Atender clientes em tempo real",
            icon: MessageSquare,
        },
        {
            href: "/dashboard/agenda",
            label: "Agenda de Atendimentos",
            description: "Consultas, retornos e lembretes",
            icon: CalendarDays,
        },
        ...(isStaff
            ? [
                  {
                      href: "/dashboard/contacts",
                      label: "Base de Contatos",
                      description: "Consultar leads e históricos",
                      icon: Users,
                  },
              ]
            : [
                  {
                      href: "/dashboard/plans",
                      label: "Planos & Assinatura",
                      description: "Consumo do plano e upgrade",
                      icon: CreditCard,
                  },
              ]),
    ];

    const onboardingSteps = [
        {
            step: 1,
            title: "Conectar WhatsApp",
            description: "Escaneie o QR Code para ativar seu número comercial.",
            done: step1Done,
            href: "/dashboard/sessions",
            cta: step1Done ? "Gerenciar conexões" : "Conectar agora",
            icon: Smartphone,
        },
        {
            step: 2,
            title: "Ativar Template de Fluxo",
            description: "Escolha um fluxo pronto por nicho para qualificar leads 24h.",
            done: step2Done,
            href: "/dashboard/flows",
            cta: step2Done ? "Ver fluxos" : "Ativar template",
            icon: Workflow,
        },
        {
            step: 3,
            title: "Criar Produto / Funil",
            description: "Cadastre seu primeiro produto com chave PIX ou crie um negócio.",
            done: step3Done,
            href: "/dashboard/crm",
            cta: step3Done ? "Abrir CRM" : "Configurar CRM",
            icon: Package,
        },
    ];

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                        Painel Executivo
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                        Acompanhe sua receita, atendimentos e performance comercial no WhatsApp.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Link href="/dashboard/crm">
                        <Button variant="outline" size="sm" className="gap-2">
                            <Kanban className="h-4 w-4" /> Abrir CRM
                        </Button>
                    </Link>
                    {!isStaff && (
                        <Link href="/dashboard/sessions">
                            <Button size="sm" className="gap-2">
                                <Plus className="h-4 w-4" /> Conectar WhatsApp
                            </Button>
                        </Link>
                    )}
                </div>
            </div>

            {/* Trial / Expiration Banner */}
            {!isStaff && subInfo && (subInfo.isTrialActive || subInfo.isExpired) && (
                <Card
                    className={
                        subInfo.isExpired
                            ? "border-red-200 bg-red-50/70"
                            : "border-amber-200 bg-amber-50/70"
                    }
                >
                    <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <Clock
                                className={`h-5 w-5 shrink-0 ${
                                    subInfo.isExpired ? "text-red-600" : "text-amber-600"
                                }`}
                            />
                            <div className="text-sm">
                                {subInfo.isExpired ? (
                                    <p className="text-red-900 font-medium">
                                        Seu período de teste ou assinatura expirou. Ative um plano para manter suas automações e conexões.
                                    </p>
                                ) : (
                                    <p className="text-amber-900">
                                        Você está no <strong>Teste Grátis do Plano {subInfo.plan.name}</strong> — restam{" "}
                                        <strong>{subInfo.trialDaysLeft}</strong>{" "}
                                        {subInfo.trialDaysLeft === 1 ? "dia" : "dias"}.
                                    </p>
                                )}
                            </div>
                        </div>
                        <Link href="/dashboard/plans">
                            <Button size="sm" variant={subInfo.isExpired ? "destructive" : "default"}>
                                Ver Planos
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            )}

            {/* Executive KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {kpis.map((kpi) => {
                    const Icon = kpi.icon;
                    return (
                        <Card
                            key={kpi.title}
                            className="glass-panel border-border/50 shadow-sm hover:shadow-md transition-all duration-300"
                        >
                            <CardContent className="p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-1 min-w-0">
                                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                                            {kpi.title}
                                        </p>
                                        <p className="text-2xl sm:text-3xl font-extrabold text-foreground truncate">
                                            {kpi.value}
                                        </p>
                                        <p className="text-xs text-muted-foreground/80 truncate">{kpi.description}</p>
                                    </div>
                                    <div className={`${kpi.bg} p-2.5 rounded-xl border border-white/20 shadow-sm shrink-0`}>
                                        <Icon className={`h-5 w-5 ${kpi.color}`} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* 3-Step Onboarding Checklist */}
            {!isStaff && (
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-lg">Primeiros Passos para Começar a Vender</CardTitle>
                                <CardDescription>
                                    Complete os 3 passos abaixo para colocar sua máquina comercial no ar.
                                </CardDescription>
                            </div>
                            <Badge variant={completedSteps === 3 ? "default" : "secondary"} className="text-xs">
                                {completedSteps}/3 concluídos
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 md:grid-cols-3">
                            {onboardingSteps.map((item) => {
                                const StepIcon = item.icon;
                                return (
                                    <div
                                        key={item.step}
                                        className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-4 ${
                                            item.done
                                                ? "bg-emerald-50/50 border-emerald-200"
                                                : "bg-slate-50/70 border-slate-200"
                                        }`}
                                    >
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                                    <StepIcon className="h-3.5 w-3.5" />
                                                    Passo {item.step}
                                                </span>
                                                {item.done ? (
                                                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                                ) : (
                                                    <Circle className="h-5 w-5 text-slate-300" />
                                                )}
                                            </div>
                                            <h4 className="font-semibold text-slate-900 text-sm">{item.title}</h4>
                                            <p className="text-xs text-slate-500">{item.description}</p>
                                        </div>
                                        <Link href={item.href}>
                                            <Button
                                                size="sm"
                                                variant={item.done ? "outline" : "default"}
                                                className="w-full justify-between"
                                            >
                                                {item.cta}
                                                <ArrowRight className="h-3.5 w-3.5" />
                                            </Button>
                                        </Link>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Quick Commercial Links */}
            <div>
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                    Atalhos Comerciais
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {quickLinks.map((action) => {
                        const Icon = action.icon;
                        return (
                            <Link key={action.href} href={action.href}>
                                <Card className="glass-panel border-border/50 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group cursor-pointer h-full">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <div className="bg-muted/50 p-2.5 rounded-xl group-hover:bg-primary transition-colors border border-border/50 shadow-sm">
                                            <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary-foreground transition-colors" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-foreground truncate">{action.label}</p>
                                            <p className="text-xs text-muted-foreground/80 truncate">{action.description}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                </div>
            </div>

            {/* Compact WhatsApp Channels Summary */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                        Canais WhatsApp ({connectedSessions}/{sessions.length} online)
                    </h3>
                    {!isStaff && (
                        <Link
                            href="/dashboard/sessions"
                            className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
                        >
                            Gerenciar canais <ArrowRight size={14} />
                        </Link>
                    )}
                </div>

                {sessions.length === 0 ? (
                    <Card className="border-dashed border-2 border-slate-200 shadow-none">
                        <CardContent className="py-10 text-center">
                            <Smartphone className="h-7 w-7 text-slate-400 mx-auto mb-2" />
                            <p className="text-sm font-medium text-slate-700">Nenhum número conectado</p>
                            <p className="text-xs text-slate-500 mb-4">
                                Conecte seu WhatsApp para iniciar os atendimentos e automações.
                            </p>
                            {!isStaff && (
                                <Link href="/dashboard/sessions">
                                    <Button size="sm" variant="outline" className="gap-2">
                                        <Plus className="h-4 w-4" /> Conectar WhatsApp
                                    </Button>
                                </Link>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {sessions.map((s) => {
                            const isConnected = s.status === "CONNECTED";
                            return (
                                <Link key={s.id} href={isStaff ? "/dashboard/chat" : `/dashboard/sessions/${s.sessionId}`}>
                                    <Card className="glass-panel border-border/50 shadow-sm hover:shadow-md transition-all cursor-pointer h-full">
                                        <CardContent className="p-4 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-foreground truncate">{s.name}</p>
                                                <p className="text-xs text-muted-foreground truncate mt-0.5">
                                                    {isConnected ? "Pronto para atender" : "Aguardando conexão"}
                                                </p>
                                            </div>
                                            <div
                                                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${
                                                    isConnected
                                                        ? "bg-emerald-50 text-emerald-700"
                                                        : "bg-red-50 text-red-600"
                                                }`}
                                            >
                                                <span
                                                    className={`h-1.5 w-1.5 rounded-full ${
                                                        isConnected ? "bg-emerald-500" : "bg-red-400"
                                                    }`}
                                                />
                                                {isConnected ? "Conectado" : "Desconectado"}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
