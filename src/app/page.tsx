import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarCheck,
  Check,
  Kanban,
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "MarcFlow | CRM, Atendimento com IA e Agenda no WhatsApp",
  description:
    "Transforme seu WhatsApp em uma máquina de vendas e atendimento. Funil Kanban, IA qualificando leads, multi-atendentes, agenda com lembretes automáticos e campanhas seguras.",
  openGraph: {
    title: "MarcFlow | Plataforma Comercial para WhatsApp",
    description:
      "Centralize sua equipe, automatize o atendimento com Inteligência Artificial e feche mais vendas pelo WhatsApp.",
    type: "website",
    url: process.env.NEXT_PUBLIC_APP_URL || "https://marcflow.com.br",
  },
  twitter: {
    card: "summary_large_image",
    title: "MarcFlow | CRM, Atendimento com IA e Agenda no WhatsApp",
    description:
      "Centralize sua equipe, automatize o atendimento com Inteligência Artificial e feche mais vendas pelo WhatsApp.",
  },
};

const FEATURES = [
  {
    icon: <Kanban className="h-6 w-6 text-emerald-500" />,
    title: "CRM & Funil de Vendas Kanban",
    description:
      "Acompanhe cada oportunidade da primeira mensagem ao fechamento. Controle valores em negociação e recupere orçamentos parados automaticamente.",
  },
  {
    icon: <Sparkles className="h-6 w-6 text-violet-500" />,
    title: "Atendimento Inteligente com IA",
    description:
      "Qualifique leads 24 horas por dia, responda dúvidas frequentes com naturalidade e entregue um resumo pronto para o vendedor fechar.",
  },
  {
    icon: <Users className="h-6 w-6 text-blue-500" />,
    title: "Multi-Atendente em Um Só Número",
    description:
      "Conecte os números da sua empresa e distribua conversas entre toda a equipe comercial, com histórico completo e controle de permissões.",
  },
  {
    icon: <CalendarCheck className="h-6 w-6 text-amber-500" />,
    title: "Agenda com Lembretes Automáticos",
    description:
      "Agende consultas, reuniões ou visitas direto do atendimento e reduza faltas com confirmações automáticas D-1 e 2h antes no WhatsApp.",
  },
  {
    icon: <Send className="h-6 w-6 text-rose-500" />,
    title: "Campanhas e Disparos Seguros",
    description:
      "Reative clientes inativos e envie ofertas segmentadas por etiquetas com intervalos inteligentes que protegem a saúde do seu número.",
  },
  {
    icon: <Workflow className="h-6 w-6 text-cyan-500" />,
    title: "Fluxos Prontos por Segmento",
    description:
      "Ative jornadas prontas para clínicas, lojas, imobiliárias e serviços em poucos cliques — sem precisar escrever nenhuma linha de código.",
  },
];

const PLANS = [
  {
    name: "Starter",
    price: "R$ 97",
    period: "/mês",
    description: "Ideal para autônomos e pequenas empresas organizarem o WhatsApp.",
    highlight: false,
    features: [
      "1 número de WhatsApp conectado",
      "Até 2 atendentes na equipe",
      "CRM com Funil Kanban de vendas",
      "Agenda de atendimentos e lembretes",
      "Respostas rápidas e etiquetas",
    ],
    cta: "Começar 7 dias grátis",
  },
  {
    name: "Pro",
    price: "R$ 197",
    period: "/mês",
    description: "O favorito para equipes comerciais que querem vender com IA e escala.",
    highlight: true,
    badge: "Mais Popular",
    features: [
      "Até 3 números de WhatsApp conectados",
      "Até 5 atendentes na equipe",
      "Atendimento com IA e resumo de leads",
      "Recuperação automática de orçamentos",
      "Campanhas segmentadas e fluxos prontos",
      "Lembretes D-1 e 2h no WhatsApp",
    ],
    cta: "Testar Pro por 7 dias",
  },
  {
    name: "Enterprise",
    price: "R$ 397",
    period: "/mês",
    description: "Para operações consolidadas com alto volume e múltiplos times.",
    highlight: false,
    features: [
      "Até 10 números de WhatsApp conectados",
      "Até 20 atendentes na equipe",
      "Todos os recursos de IA e automação",
      "Disparos em larga escala com proteção",
      "Relatórios executivos de conversão",
      "Suporte prioritário na implantação",
    ],
    cta: "Testar Enterprise grátis",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden selection:bg-primary/30 selection:text-primary-foreground">
      {/* Navbar - Floating Glass */}
      <header className="fixed top-4 inset-x-4 md:inset-x-auto md:top-6 md:left-1/2 md:-translate-x-1/2 z-50 md:w-full md:max-w-5xl transition-all duration-300">
        <div className="glass rounded-full px-4 md:px-8 h-14 md:h-16 flex items-center justify-between mx-auto shadow-lg shadow-black/5 dark:shadow-black/20 border border-white/40 dark:border-white/10">
          <Link href="/" className="flex items-center gap-3 font-bold text-xl">
            <div className="relative flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-primary text-white shadow-inner">
              <Bot className="h-5 w-5 md:h-6 md:w-6" />
              <div className="absolute inset-0 rounded-full bg-primary blur-md -z-10 opacity-50 animate-pulse-glow" />
            </div>
            <span className="text-foreground tracking-tight">MarcFlow</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <Link
              href="#recursos"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Recursos
            </Link>
            <Link
              href="#como-funciona"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Como funciona
            </Link>
            <Link
              href="#planos"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Planos
            </Link>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm" className="rounded-full px-4 text-sm font-medium">
                Entrar
              </Button>
            </Link>
            <Link href="/auth/register">
              <Button
                size="sm"
                className="rounded-full px-4 sm:px-6 bg-foreground text-background hover:bg-foreground/90 shadow-xl shadow-foreground/10"
              >
                Teste grátis
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-32 pb-24 lg:pt-44 lg:pb-36 overflow-hidden flex items-center justify-center">
          <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-emerald-400/20 dark:bg-emerald-500/10 rounded-full blur-[100px] animate-float" />
          <div
            className="absolute bottom-1/4 right-1/4 translate-x-1/3 translate-y-1/3 w-[30rem] h-[30rem] bg-blue-500/20 dark:bg-blue-600/10 rounded-full blur-[100px] animate-float"
            style={{ animationDelay: "2s" }}
          />

          <div className="container px-4 md:px-6 relative z-10">
            <div className="flex flex-col items-center text-center space-y-8 max-w-4xl mx-auto">
              <div className="inline-flex items-center rounded-full glass-panel px-4 py-1.5 text-sm font-medium text-foreground/80">
                <span className="relative flex h-2 w-2 mr-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                7 dias de teste grátis no plano Pro • Sem cartão de crédito
              </div>

              <div className="space-y-6">
                <h1 className="text-4xl font-extrabold tracking-tighter sm:text-6xl md:text-7xl w-full">
                  <span className="block text-foreground pb-1">Transforme seu WhatsApp</span>
                  <span className="text-gradient block pb-2">em uma máquina de vendas.</span>
                </h1>
                <p className="mx-auto max-w-[42rem] text-muted-foreground text-lg sm:text-xl leading-relaxed">
                  Centralize seus atendentes, qualifique leads com Inteligência Artificial, organize negociações no Funil Kanban e reduza faltas com agenda automática.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-2 w-full sm:w-auto px-4">
                <Link href="/auth/register" className="w-full sm:w-auto">
                  <Button
                    size="lg"
                    className="w-full h-14 px-8 rounded-full text-base sm:text-lg shadow-2xl shadow-primary/30 hover:shadow-primary/40 group"
                  >
                    Começar teste grátis de 7 dias
                    <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </Button>
                </Link>
                <Link href="/auth/login" className="w-full sm:w-auto">
                  <Button
                    size="lg"
                    variant="glass"
                    className="w-full h-14 px-8 rounded-full text-base sm:text-lg transition-all hover:bg-white/40 dark:hover:bg-white/10"
                  >
                    Já tenho conta • Entrar
                  </Button>
                </Link>
              </div>

              {/* Prova de valor rápida */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 w-full max-w-3xl text-left">
                <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <MessageSquareText className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Resposta imediata 24/7</p>
                    <p className="text-xs text-muted-foreground">Nenhum cliente fica sem retorno</p>
                  </div>
                </div>
                <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <Kanban className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Previsibilidade de caixa</p>
                    <p className="text-xs text-muted-foreground">Veja quanto há em negociação</p>
                  </div>
                </div>
                <div className="glass-panel rounded-2xl p-4 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Implantação em minutos</p>
                    <p className="text-xs text-muted-foreground">Conecte lendo um QR Code</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section id="recursos" className="py-24 relative">
          <div className="absolute inset-0 bg-slate-50/50 dark:bg-slate-900/30 border-y border-border" />
          <div className="container px-4 md:px-6 relative z-10">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-5xl mb-4 text-foreground">
                Tudo o que sua empresa precisa para vender mais
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Do primeiro “oi” no WhatsApp até o pós-venda, sua operação inteira organizada em um painel simples e visual.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
              {FEATURES.map((feat) => (
                <FeatureCard
                  key={feat.title}
                  icon={feat.icon}
                  title={feat.title}
                  description={feat.description}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="py-24 relative">
          <div className="container px-4 md:px-6 max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4 text-foreground">
                Comece a operar em 3 passos simples
              </h2>
              <p className="text-muted-foreground text-lg">
                Sem burocracia e sem depender de equipe técnica.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="glass-panel rounded-3xl p-8 space-y-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary font-bold">
                  1
                </span>
                <h3 className="text-xl font-bold text-foreground">Conecte seu WhatsApp</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Escaneie o QR Code no painel e centralize um ou mais números da sua empresa em segundos.
                </p>
              </div>
              <div className="glass-panel rounded-3xl p-8 space-y-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary font-bold">
                  2
                </span>
                <h3 className="text-xl font-bold text-foreground">Ative um fluxo ou IA</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Escolha um modelo pronto para o seu segmento e deixe a IA atender, qualificar e agendar clientes.
                </p>
              </div>
              <div className="glass-panel rounded-3xl p-8 space-y-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary font-bold">
                  3
                </span>
                <h3 className="text-xl font-bold text-foreground">Acompanhe as vendas</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Sua equipe atende no chat multi-usuário enquanto você acompanha metas, funil e agenda em tempo real.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Planos */}
        <section id="planos" className="py-24 relative">
          <div className="absolute inset-0 bg-slate-50/50 dark:bg-slate-900/30 border-y border-border" />
          <div className="container px-4 md:px-6 relative z-10 max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-5xl mb-4 text-foreground">
                Planos transparentes para o seu momento
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Comece agora com 7 dias de teste grátis. Cancele ou mude de plano quando quiser.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3 items-stretch">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={`relative flex flex-col justify-between rounded-3xl p-8 glass-panel transition-all ${
                    plan.highlight
                      ? "border-2 border-primary shadow-2xl shadow-primary/15 scale-[1.02]"
                      : "border border-border"
                  }`}
                >
                  {plan.badge && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground shadow">
                      {plan.badge}
                    </span>
                  )}

                  <div>
                    <h3 className="text-2xl font-bold text-foreground">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground mt-2 min-h-[40px]">
                      {plan.description}
                    </p>
                    <div className="mt-6 flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold text-foreground">{plan.price}</span>
                      <span className="text-sm text-muted-foreground">{plan.period}</span>
                    </div>

                    <ul className="mt-8 space-y-3">
                      {plan.features.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/90">
                          <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Link href="/auth/register" className="mt-8 block">
                    <Button
                      size="lg"
                      variant={plan.highlight ? "default" : "outline"}
                      className="w-full rounded-full"
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/50 bg-background/50 backdrop-blur-xl py-12 relative z-10">
        <div className="container px-4 md:px-6 max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <span className="text-xl font-bold text-foreground">MarcFlow</span>
            </div>
            <div className="flex gap-8 text-sm font-medium">
              <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
                Privacidade
              </Link>
              <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
                Termos de Uso
              </Link>
              <Link href="/auth/login" className="text-muted-foreground hover:text-foreground transition-colors">
                Acessar Painel
              </Link>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} MarcFlow. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group relative p-8 glass-panel rounded-[2rem] hover-lift overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-white/0 dark:from-white/5 dark:to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative z-10">
        <div className="mb-6 inline-flex p-4 rounded-2xl bg-background/50 backdrop-blur-md shadow-sm border border-border group-hover:scale-110 transition-transform duration-500 ease-out">
          {icon}
        </div>
        <h3 className="text-xl font-bold mb-3 text-foreground tracking-tight">{title}</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
