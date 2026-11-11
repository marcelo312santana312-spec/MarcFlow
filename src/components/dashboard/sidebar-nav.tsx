"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Workflow, ChevronDown } from "lucide-react";
import {
    LayoutDashboard,
    MessageSquare,
    Users,
    Settings,
    QrCode,
    ImageIcon,
    Webhook,
    CalendarClock,
    Bot,
    Bell,
    FileText,
    Code,
    Send,
    UserCheck,
    Megaphone,
    HardDrive,
    Activity,
    UserCircle,
    Tag,
    MessageCircleReply,
    Contact,
    UserPlus,
    DatabaseBackup,
    ShoppingBag,
    Sparkles
} from "lucide-react";
import { useSidebar } from "./sidebar-context";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavGroup {
    label: string;
    items: NavItem[];
}

interface NavItem {
    href: string;
    label: string;
    icon: React.ElementType;
    external?: boolean;
    superadminOnly?: boolean;
    allowedRoles?: string[];
}

export const navGroups: NavGroup[] = [
    {
        label: "Principal",
        items: [
            { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
            { href: "/dashboard/sessions", label: "Sessões / QR", icon: QrCode },
        ],
    },
    {
        label: "Mensagens",
        items: [
            { href: "/dashboard/chat", label: "Conversas", icon: MessageSquare },
            { href: "/dashboard/broadcast", label: "Transmissão", icon: Megaphone },
            { href: "/dashboard/sticker", label: "Criador de figurinhas", icon: ImageIcon },
            { href: "/dashboard/archive", label: "Exportar conversas", icon: DatabaseBackup },
        ],
    },
    {
        label: "Contatos",
        items: [
            { href: "/dashboard/contacts", label: "Contatos", icon: UserCheck },
            { href: "/dashboard/groups", label: "Grupos", icon: Users },
            { href: "/dashboard/labels", label: "Etiquetas", icon: Tag },
        ],
    },
    {
        label: "Automação",
        items: [
            { href: "/dashboard/ai-studio", label: "Estúdio IA (Flow)", icon: Sparkles },
            { href: "/dashboard/flows", label: "Fluxos de conversa", icon: Workflow },
            { href: "/dashboard/bot-settings", label: "Configurações do bot", icon: Bot },
            { href: "/dashboard/autoreply", label: "Resposta automática", icon: MessageCircleReply },
            { href: "/dashboard/affiliates", label: "Links de afiliados", icon: ShoppingBag },
            { href: "/dashboard/profile", label: "Perfil do bot", icon: UserCircle },
            { href: "/dashboard/scheduler", label: "Agendador", icon: CalendarClock },
            { href: "/dashboard/webhooks", label: "Webhooks & API", icon: Webhook },
        ],
    },
    {
        label: "Desenvolvedor",
        items: [
            { href: "/docs", label: "Documentação da API", icon: FileText },
            { href: "/swagger", label: "Swagger UI", icon: Code, external: true },
        ],
    },
    {
        label: "Administração",
        items: [
            { href: "/dashboard/media", label: "Gerenciador de mídia", icon: HardDrive },
            { href: "/dashboard/sessions/access", label: "Acesso às sessões", icon: UserPlus },
            { href: "/dashboard/users", label: "Usuários", icon: Users, superadminOnly: true },
            { href: "/dashboard/settings", label: "Configurações", icon: Settings },
            { href: "/dashboard/system-monitor", label: "Monitor do sistema", icon: Activity, superadminOnly: true },
            { href: "/dashboard/notifications", label: "Notificações", icon: Bell, superadminOnly: true },
        ],
    },
];

export function SidebarNav() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const { isCollapsed } = useSidebar();
    // @ts-ignore
    const userRole = session?.user?.role;

    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        try {
            const saved = localStorage.getItem("marcflow_collapsed_groups");
            if (saved) {
                setCollapsedGroups(JSON.parse(saved));
            }
        } catch {}
    }, []);

    const toggleGroup = (label: string) => {
        setCollapsedGroups((prev) => {
            const next = { ...prev, [label]: !prev[label] };
            try {
                localStorage.setItem("marcflow_collapsed_groups", JSON.stringify(next));
            } catch {}
            return next;
        });
    };

    const nonPrincipalGroups = navGroups.filter((g) => g.label !== "Principal");
    const allCollapsed =
        nonPrincipalGroups.length > 0 &&
        nonPrincipalGroups.every((g) => Boolean(collapsedGroups[g.label]));

    const toggleAll = () => {
        const shouldCollapse = !allCollapsed;
        const next: Record<string, boolean> = {};
        nonPrincipalGroups.forEach((g) => {
            next[g.label] = shouldCollapse;
        });
        setCollapsedGroups(next);
        try {
            localStorage.setItem("marcflow_collapsed_groups", JSON.stringify(next));
        } catch {}
    };

    const isActive = (href: string) => {
        if (href === "/dashboard") return pathname === "/dashboard";
        return pathname.startsWith(href);
    };

    return (
        <TooltipProvider delayDuration={0}>
            <nav className="flex-1 px-4 pb-4 overflow-y-auto overflow-x-hidden space-y-0.5 sidebar-scrollbar">
                {/* Botão de Recolher/Expandir Tudo (visível apenas quando o menu não estiver colapsado em ícones) */}
                {!isCollapsed && (
                    <div className="flex items-center justify-between px-2 pt-1 pb-2 mb-1 border-b border-white/[0.05] text-[10px] text-[#7C8783] uppercase tracking-wider">
                        <span>Opções</span>
                        <button
                            type="button"
                            onClick={toggleAll}
                            className="text-[10px] text-[#8E9894] hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-white/[0.06] flex items-center gap-1 cursor-pointer"
                            title={allCollapsed ? "Expandir todos os grupos" : "Recolher todos os grupos"}
                        >
                            {allCollapsed ? "Expandir tudo" : "Recolher tudo"}
                        </button>
                    </div>
                )}

                {navGroups.map((group) => {
                    const visibleItems = group.items.filter((item) => {
                        if (item.superadminOnly && userRole !== "SUPERADMIN") return false;
                        if (item.allowedRoles && (!userRole || !item.allowedRoles.includes(userRole))) return false;
                        return true;
                    });
                    if (visibleItems.length === 0) return null;

                    // Grupo "Principal" doesn't show a collapsible header
                    if (group.label === "Principal") {
                        return (
                            <div key={group.label} className="mb-1">
                                {visibleItems.map((item) => (
                                    <NavLink
                                        key={item.href}
                                        item={item}
                                        active={isActive(item.href)}
                                        isCollapsed={isCollapsed}
                                    />
                                ))}
                            </div>
                        );
                    }

                    const isGroupActive = visibleItems.some((item) => isActive(item.href));
                    // Permite recolher se o usuário escolheu fechar. Se a página atual está no grupo e o usuário ainda não colapsou manualmente, mantemos aberto.
                    const isGroupCollapsed = mounted && Boolean(collapsedGroups[group.label]);

                    return (
                        <div key={group.label} className="mb-1">
                            {/* Group header — clicável para recolher/expandir */}
                            {!isCollapsed && (
                                <button
                                    type="button"
                                    onClick={() => toggleGroup(group.label)}
                                    className="w-full flex items-center justify-between px-3 py-2 mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8A9591] hover:text-white hover:bg-white/[0.04] rounded-md transition-all group cursor-pointer"
                                    title={isGroupCollapsed ? `Expandir ${group.label}` : `Recolher ${group.label}`}
                                >
                                    <span className="flex items-center gap-1.5 truncate">
                                        {group.label}
                                        {isGroupActive && (
                                            <span className="h-1.5 w-1.5 rounded-full bg-[#3BE38C]" title="Página ativa neste grupo" />
                                        )}
                                    </span>
                                    <ChevronDown
                                        size={14}
                                        className={`transition-transform duration-200 text-[#7C8783] group-hover:text-white ${
                                            isGroupCollapsed ? "-rotate-90" : "rotate-0"
                                        }`}
                                    />
                                </button>
                            )}

                            {/* Collapsed sidebar: show a thin divider between groups */}
                            {isCollapsed && (
                                <div className="mx-3 my-3 border-t border-white/[0.07]" />
                            )}

                            {/* Se não estiver recolhido (ou se a sidebar inteira estiver colapsada em ícones) */}
                            {(!isGroupCollapsed || isCollapsed) && (
                                <div className="space-y-0.5 mt-0.5 animate-in fade-in duration-150">
                                    {visibleItems.map((item) => (
                                        <NavLink
                                            key={item.href}
                                            item={item}
                                            active={isActive(item.href)}
                                            isCollapsed={isCollapsed}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>
        </TooltipProvider>
    );
}

function NavLink({ item, active, isCollapsed }: { item: NavItem; active: boolean; isCollapsed: boolean }) {
    const Icon = item.icon;

    const linkContent = (
        <Link
            href={item.href}
            target={item.external ? "_blank" : undefined}
            className={`
                flex items-center rounded-lg text-[15px]
                transition-all duration-200 group relative
                ${isCollapsed ? "justify-center px-2 py-2.5" : "gap-4 px-4 py-2.5"}
                ${active
                    ? "bg-[#14452E] text-white font-medium"
                    : "text-[#C9D1CE] hover:bg-white/[0.06] hover:text-white"
                }
            `}
        >
            <Icon
                size={isCollapsed ? 21 : 20}
                strokeWidth={1.6}
                className={`flex-shrink-0 transition-colors duration-200 ${active ? "text-[#3BE38C]" : "text-[#AEB8B4] group-hover:text-white"}`}
            />
            {!isCollapsed && <span className="truncate">{item.label}</span>}
        </Link>
    );

    if (isCollapsed) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    {linkContent}
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                    <p className="text-xs font-medium">{item.label}</p>
                </TooltipContent>
            </Tooltip>
        );
    }

    return linkContent;
}
