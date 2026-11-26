"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
    RefreshCw,
    Save,
    AlertCircle,
    Download,
    CheckCircle2,
    Clock,
    AlertTriangle,
    ExternalLink,
    Terminal,
} from "lucide-react";
import { toast } from "sonner";

interface UpdateCheckData {
    enabled: boolean;
    repo?: string;
    branch?: string;
    currentSha: string | null;
    currentShortSha: string | null;
    versionUnknown?: boolean;
    hasUpdate: boolean;
    imageStatus?: "ready" | "building" | "failed" | "unknown";
    canSelfUpdate?: boolean;
    latestCommit?: {
        sha: string;
        shortSha: string;
        message: string;
        author: string;
        date: string;
        htmlUrl: string;
    };
    workflowRun?: {
        id: number;
        status: string;
        conclusion: string | null;
        htmlUrl: string;
    } | null;
}

interface UpdaterState {
    state: "idle" | "running" | "succeeded" | "failed";
    step: string;
    progress: number;
    logs: string[];
    targetSha?: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    error?: string | null;
}

export default function SettingsPage() {
    const { data: authSession, status: sessionStatus } = useSession();
    const isSuperAdmin = (authSession?.user as any)?.role === "SUPERADMIN";

    const [systemConfig, setSystemConfig] = useState({
        appName: "MarcFlow",
        logoUrl: "",
        timezone: "America/Sao_Paulo",
        enableRegistration: true,
    });
    const [systemLoading, setSystemLoading] = useState(false);
    const [timezones, setTimezones] = useState<string[]>(["UTC", "America/Sao_Paulo", "America/Fortaleza", "America/Manaus"]);

    const [checkingUpdates, setCheckingUpdates] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateCheckData | null>(null);
    const [updaterConfigured, setUpdaterConfigured] = useState(false);
    const [updaterReachable, setUpdaterReachable] = useState(false);
    const [updaterState, setUpdaterState] = useState<UpdaterState | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [restartingServer, setRestartingServer] = useState(false);

    const logsEndRef = useRef<HTMLDivElement | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearPollTimer = () => {
        if (pollTimerRef.current) {
            clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    };

    useEffect(() => {
        return () => clearPollTimer();
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [updaterState?.logs?.length, restartingServer]);

    useEffect(() => {
        try {
            if (typeof Intl !== "undefined" && Intl.supportedValuesOf) {
                const list = Intl.supportedValuesOf("timeZone");
                if (!list.includes("UTC")) {
                    list.push("UTC");
                }
                list.sort();
                setTimezones(list);
            }
        } catch (e) {
            console.error("Failed to load timezones dynamically", e);
        }
    }, []);

    useEffect(() => {
        fetch("/api/settings/system")
            .then((r) => {
                if (!r.ok) throw new Error();
                return r.json();
            })
            .then((responseData) => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setSystemConfig({
                        appName: data.appName || "MarcFlow",
                        logoUrl: data.logoUrl || "",
                        // @ts-ignore
                        faviconUrl: data.faviconUrl || "/favicon.ico",
                        timezone: data.timezone || "America/Sao_Paulo",
                        enableRegistration: data.enableRegistration !== undefined ? data.enableRegistration : true,
                    });
                }
            })
            .catch(() => {});
    }, []);

    const fetchUpdateCheck = useCallback(async (method: "GET" | "POST" = "GET") => {
        setCheckingUpdates(true);
        try {
            const res = await fetch("/api/system/check-updates", { method });
            const json = await res.json();
            if (json.status && json.data) {
                setUpdateInfo(json.data);
                if (method === "POST") {
                    toast.success(json.message || "Verificação concluída!");
                }
            } else if (method === "POST") {
                toast.error(json.message || "Falha ao verificar atualizações");
            }
        } catch {
            if (method === "POST") {
                toast.error("Erro ao verificar atualizações");
            }
        } finally {
            setCheckingUpdates(false);
        }
    }, []);

    const pollUpdaterProgress = useCallback(async (sawRunning = false, previousSha: string | null = null) => {
        clearPollTimer();
        try {
            const res = await fetch("/api/system/update", { cache: "no-store" });
            if (!res.ok) {
                if (res.status === 502 || res.status === 503 || res.status === 504) {
                    setRestartingServer(true);
                    pollTimerRef.current = setTimeout(() => pollUpdaterProgress(true, previousSha), 2000);
                    return;
                }
                throw new Error(`HTTP ${res.status}`);
            }

            const json = await res.json();
            const st: UpdaterState | null = json.updater || null;
            setUpdaterConfigured(Boolean(json.configured));
            setUpdaterReachable(Boolean(json.reachable));

            if (st) {
                setUpdaterState(st);
            }

            if (st?.state === "running") {
                setIsUpdating(true);
                setRestartingServer(false);
                pollTimerRef.current = setTimeout(() => pollUpdaterProgress(true, previousSha), 1500);
                return;
            }

            if (st?.state === "succeeded") {
                // Verifica se o container já reiniciou com o SHA novo ou se acabou de reiniciar
                const healthRes = await fetch("/api/health", { cache: "no-store" }).catch(() => null);
                const healthJson = healthRes && healthRes.ok ? await healthRes.json().catch(() => null) : null;
                const newSha: string | null = healthJson?.gitSha || json.currentSha || null;

                if (sawRunning && previousSha && newSha && newSha === previousSha && st.targetSha && st.targetSha !== previousSha) {
                    setRestartingServer(true);
                    pollTimerRef.current = setTimeout(() => pollUpdaterProgress(true, previousSha), 2000);
                    return;
                }

                setRestartingServer(false);
                setIsUpdating(false);
                await fetchUpdateCheck("GET");
                if (sawRunning) {
                    toast.success("Sistema atualizado e reiniciado com sucesso!");
                }
                return;
            }

            if (st?.state === "failed") {
                setRestartingServer(false);
                setIsUpdating(false);
                if (sawRunning) {
                    toast.error(st.error || "Falha ao atualizar o sistema.");
                }
            }
        } catch {
            // Durante a recriação do container marcflow-app, fetch pode falhar por alguns segundos
            if (sawRunning) {
                setRestartingServer(true);
                pollTimerRef.current = setTimeout(() => pollUpdaterProgress(true, previousSha), 2000);
            }
        }
    }, [fetchUpdateCheck]);

    useEffect(() => {
        if (!isSuperAdmin) return;
        fetchUpdateCheck("GET");
    }, [isSuperAdmin, fetchUpdateCheck]);

    useEffect(() => {
        if (!isSuperAdmin) return;
        fetch("/api/system/update", { cache: "no-store" })
            .then((r) => r.json())
            .then((json) => {
                setUpdaterConfigured(Boolean(json.configured));
                setUpdaterReachable(Boolean(json.reachable));
                if (json.updater) {
                    setUpdaterState(json.updater);
                    if (json.updater.state === "running") {
                        setIsUpdating(true);
                        pollUpdaterProgress(true, json.currentSha || null);
                    }
                }
            })
            .catch(() => {});
    }, [isSuperAdmin, pollUpdaterProgress]);

    const handleStartUpdate = async (force = false) => {
        setIsUpdating(true);
        setRestartingServer(false);
        const previousSha = updateInfo?.currentSha || null;

        try {
            const res = await fetch("/api/system/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ force }),
            });
            const json = await res.json();

            if (!res.ok) {
                setIsUpdating(false);
                toast.error(json.message || "Não foi possível iniciar a atualização.");
                return;
            }

            if (json.data) {
                setUpdaterState(json.data);
            }
            toast.info("Atualização iniciada. Acompanhe o progresso abaixo.");
            pollTimerRef.current = setTimeout(() => pollUpdaterProgress(true, previousSha), 1200);
        } catch {
            setIsUpdating(false);
            toast.error("Erro de comunicação ao iniciar atualização.");
        }
    };

    const handleSaveSystem = async () => {
        setSystemLoading(true);
        try {
            const res = await fetch("/api/settings/system", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(systemConfig),
            });

            if (res.ok) {
                toast.success("Configurações do sistema atualizadas. Atualize a página para ver as mudanças.");
            } else {
                toast.error("Falha ao atualizar as configurações do sistema");
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao salvar as configurações do sistema");
        } finally {
            setSystemLoading(false);
        }
    };

    const inputClass =
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

    const renderBuildBadge = () => {
        if (!updateInfo?.enabled) return null;
        if (updateInfo.imageStatus === "building") {
            return (
                <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 border-amber-200">
                    <Clock className="h-3 w-3 animate-pulse" />
                    Compilando no GitHub Actions
                </Badge>
            );
        }
        if (updateInfo.imageStatus === "failed") {
            return (
                <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Build falhou no GitHub
                </Badge>
            );
        }
        if (updateInfo.hasUpdate) {
            return (
                <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white">
                    <Download className="h-3 w-3" />
                    Nova atualização pronta
                </Badge>
            );
        }
        if (updateInfo.currentShortSha) {
            return (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 bg-emerald-50">
                    <CheckCircle2 className="h-3 w-3" />
                    Sistema atualizado
                </Badge>
            );
        }
        return (
            <Badge variant="outline" className="gap-1">
                Imagem pronta no GHCR
            </Badge>
        );
    };

    const showUpdaterPanel =
        isUpdating ||
        restartingServer ||
        (updaterState && updaterState.state !== "idle" && (updaterState.logs?.length > 0 || updaterState.error));

    if (sessionStatus === "loading") {
        return <div className="p-8 text-center text-sm text-muted-foreground">Carregando...</div>;
    }

    if (!isSuperAdmin) {
        return (
            <Card className="border-red-200 bg-red-50 max-w-xl mx-auto mt-10">
                <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-red-900">Acesso restrito ao SuperAdmin</p>
                            <p className="text-xs text-red-700 mt-1">
                                Somente SuperAdmins podem visualizar e gerenciar as configurações globais e atualizações do sistema.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Configurações</h2>
                <p className="text-muted-foreground text-sm mt-1">Configuração global do sistema. Somente SuperAdmins podem fazer alterações.</p>
            </div>

            {/* System Configuration (Global) */}
            <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                    <CardTitle className="text-xl">Configuração do aplicativo</CardTitle>
                    <CardDescription>Configurações globais de identidade visual e controle de acesso do aplicativo.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label>Nome do aplicativo</Label>
                            <input
                                className={inputClass}
                                placeholder="MarcFlow"
                                value={systemConfig.appName}
                                onChange={(e) => setSystemConfig((prev) => ({ ...prev, appName: e.target.value }))}
                                disabled={!isSuperAdmin}
                            />
                            <p className="text-xs text-muted-foreground">Altera o nome na barra lateral e no título do navegador.</p>
                        </div>

                        <div className="grid gap-2">
                            <Label>Fuso horário</Label>
                            <select
                                className={inputClass}
                                value={systemConfig.timezone}
                                onChange={(e) => setSystemConfig((prev) => ({ ...prev, timezone: e.target.value }))}
                                disabled={!isSuperAdmin}
                            >
                                {timezones.map((tz) => (
                                    <option key={tz} value={tz}>
                                        {tz}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-muted-foreground">O Agendador usará este fuso horário.</p>
                        </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label>URL do logo</Label>
                            <input
                                className={inputClass}
                                placeholder="https://example.com/logo.png"
                                value={systemConfig.logoUrl}
                                onChange={(e) => setSystemConfig((prev) => ({ ...prev, logoUrl: e.target.value }))}
                                disabled={!isSuperAdmin}
                            />
                            <p className="text-xs text-muted-foreground">URL do logo principal do painel.</p>
                        </div>
                        <div className="grid gap-2">
                            <Label>URL do favicon</Label>
                            <input
                                className={inputClass}
                                placeholder="/favicon.ico"
                                value={(systemConfig as any).faviconUrl || ""}
                                onChange={(e) => setSystemConfig((prev) => ({ ...prev, faviconUrl: e.target.value }))}
                                disabled={!isSuperAdmin}
                            />
                            <p className="text-xs text-muted-foreground">URL do ícone da aba do navegador.</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between space-x-2 pt-2 border-t border-border/50">
                        <Label htmlFor="enable-registration" className="flex flex-col space-y-1">
                            <span>Habilitar cadastro de usuários</span>
                            <span className="font-normal text-xs text-muted-foreground">Permite que novos usuários criem contas. Desative para manter a plataforma privada.</span>
                        </Label>
                        <Switch
                            id="enable-registration"
                            checked={systemConfig.enableRegistration}
                            onCheckedChange={(c) => setSystemConfig((prev) => ({ ...prev, enableRegistration: c }))}
                            disabled={!isSuperAdmin}
                        />
                    </div>

                    <div className="pt-2">
                        <Button onClick={handleSaveSystem} disabled={systemLoading || !isSuperAdmin}>
                            {systemLoading ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                            Salvar configuração
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* System Updates (GitHub + Live VM Updater) */}
            <Card>
                <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                        <CardTitle>Atualizações do sistema (GitHub)</CardTitle>
                        <CardDescription>
                            Acompanhe os commits da branch principal, o build no GitHub Actions e aplique atualizações com um clique.
                        </CardDescription>
                    </div>
                    {renderBuildBadge()}
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                        <div>
                            <p className="text-xs text-muted-foreground">Versão instalada na VM</p>
                            <p className="font-mono font-medium mt-0.5">
                                {updateInfo?.currentShortSha ? `commit ${updateInfo.currentShortSha}` : "Não identificada (local / build antigo)"}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">
                                Última versão no GitHub ({updateInfo?.branch || "main"})
                            </p>
                            {updateInfo?.latestCommit ? (
                                <div className="mt-0.5">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-medium">commit {updateInfo.latestCommit.shortSha}</span>
                                        <a
                                            href={updateInfo.latestCommit.htmlUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                        >
                                            Ver commit <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate mt-0.5" title={updateInfo.latestCommit.message}>
                                        {updateInfo.latestCommit.message}
                                    </p>
                                </div>
                            ) : (
                                <p className="text-muted-foreground mt-0.5">Clique em verificar para consultar.</p>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            className="sm:flex-1"
                            onClick={() => fetchUpdateCheck("POST")}
                            disabled={checkingUpdates || isUpdating}
                        >
                            <RefreshCw className={`mr-2 h-4 w-4 ${checkingUpdates ? "animate-spin" : ""}`} />
                            {checkingUpdates ? "Verificando GitHub..." : "Verificar atualizações"}
                        </Button>

                        {isSuperAdmin && (
                            <Button
                                className="sm:flex-1"
                                variant={updateInfo?.hasUpdate ? "default" : "secondary"}
                                onClick={() => handleStartUpdate(false)}
                                disabled={
                                    isUpdating ||
                                    restartingServer ||
                                    !updaterConfigured ||
                                    !updaterReachable ||
                                    updateInfo?.imageStatus === "building"
                                }
                            >
                                {isUpdating || restartingServer ? (
                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Download className="mr-2 h-4 w-4" />
                                )}
                                {restartingServer
                                    ? "Reiniciando servidor..."
                                    : isUpdating
                                    ? "Atualizando sistema..."
                                    : updateInfo?.imageStatus === "building"
                                    ? "Aguardando build no GitHub Actions..."
                                    : updateInfo?.hasUpdate
                                    ? "Atualizar sistema agora"
                                    : "Reaplicar atualização / Puxar imagem"}
                            </Button>
                        )}
                    </div>

                    {isSuperAdmin && updaterConfigured && !updaterReachable && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                            O agente de atualização na VM não respondeu no momento. Verifique o serviço `marcflow-updater` no servidor.
                        </p>
                    )}

                    {updateInfo?.workflowRun?.htmlUrl && updateInfo.imageStatus === "building" && (
                        <div className="flex items-center justify-between text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                            <span>O GitHub Actions está gerando a nova imagem Docker para este commit.</span>
                            <a
                                href={updateInfo.workflowRun.htmlUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-medium underline"
                            >
                                Acompanhar build <ExternalLink className="h-3 w-3" />
                            </a>
                        </div>
                    )}

                    {showUpdaterPanel && (
                        <div className="rounded-lg border bg-zinc-950 text-zinc-100 p-4 space-y-3">
                            <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="flex items-center gap-2 font-medium">
                                    <Terminal className="h-4 w-4 text-emerald-400" />
                                    {restartingServer
                                        ? "Reiniciando container marcflow-app e sincronizando banco de dados..."
                                        : updaterState?.step || "Processando atualização..."}
                                </span>
                                <span className="font-mono text-zinc-400">
                                    {restartingServer ? 98 : updaterState?.progress ?? 0}%
                                </span>
                            </div>

                            <Progress value={restartingServer ? 98 : updaterState?.progress ?? 0} className="h-2 bg-zinc-800" />

                            <div className="max-h-56 overflow-y-auto rounded bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-zinc-300 space-y-0.5">
                                {(updaterState?.logs || []).map((line, idx) => (
                                    <div key={idx} className="whitespace-pre-wrap break-all">
                                        {line}
                                    </div>
                                ))}
                                {restartingServer && (
                                    <div className="text-amber-300">
                                        [...] Container recriado. Aguardando o servidor Next.js responder novamente...
                                    </div>
                                )}
                                <div ref={logsEndRef} />
                            </div>

                            {updaterState?.state === "succeeded" && !restartingServer && !isUpdating && (
                                <div className="flex items-center justify-between gap-2 text-xs text-emerald-300">
                                    <span>Atualização finalizada! Recarregue a página se quiser atualizar a interface visual.</span>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 border-emerald-500/40 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900"
                                        onClick={() => window.location.reload()}
                                    >
                                        Recarregar página
                                    </Button>
                                </div>
                            )}

                            {updaterState?.state === "failed" && updaterState.error && (
                                <p className="text-xs text-red-400">Erro: {updaterState.error}</p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
