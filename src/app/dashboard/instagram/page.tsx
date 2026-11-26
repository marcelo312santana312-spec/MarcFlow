"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Instagram,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PostType = "FEED" | "CAROUSEL" | "REELS" | "STORY";
type PostStatus = "PENDING" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELED";

interface InstagramAccountItem {
  id: string;
  igUserId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  accountType: string | null;
  tokenExpiresAt: string;
  status: string;
  lastError: string | null;
  _count?: { posts: number };
}

interface InstagramConfigInfo {
  configured: boolean;
  redirectUri: string;
  publicBaseUrl: string;
  isHttpsPublicUrl: boolean;
  graphVersion: string;
}

interface InstagramAccessRequestItem {
  id: string;
  igUsername: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
  adminNote: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MediaItem {
  filename?: string;
  url?: string;
  mediaType: "IMAGE" | "VIDEO";
  mimeType?: string;
  previewUrl?: string;
}

interface InstagramPostItem {
  id: string;
  accountId: string;
  type: PostType;
  caption: string | null;
  mediaItems: MediaItem[];
  shareToFeed: boolean;
  scheduledAt: string;
  status: PostStatus;
  igMediaId: string | null;
  permalink: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  createdAt: string;
  account: {
    id: string;
    username: string;
    name: string | null;
    profilePictureUrl: string | null;
    status: string;
  };
}

const TYPE_META: Record<PostType, { label: string; description: string; icon: React.ElementType }> = {
  FEED: { label: "Feed", description: "1 foto ou vídeo no perfil", icon: ImageIcon },
  CAROUSEL: { label: "Carrossel", description: "2 a 10 fotos/vídeos", icon: Layers },
  REELS: { label: "Reels", description: "Vídeo vertical (MP4/MOV)", icon: Film },
  STORY: { label: "Story", description: "1 foto ou vídeo (24h)", icon: Sparkles },
};

const STATUS_META: Record<PostStatus, { label: string; badgeClass: string }> = {
  PENDING: {
    label: "Agendado",
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  PUBLISHING: {
    label: "Publicando...",
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  PUBLISHED: {
    label: "Publicado",
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  FAILED: {
    label: "Com erro",
    badgeClass: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  },
  CANCELED: {
    label: "Cancelado",
    badgeClass: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
  },
};

function defaultDateTimeLocal(): string {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTimePtBr(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function InstagramPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: authSession } = useSession();
  const isSuperAdmin = (authSession?.user as any)?.role === "SUPERADMIN";
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [accounts, setAccounts] = useState<InstagramAccountItem[]>([]);
  const [configInfo, setConfigInfo] = useState<InstagramConfigInfo | null>(null);
  const [posts, setPosts] = useState<InstagramPostItem[]>([]);
  const [accessRequests, setAccessRequests] = useState<InstagramAccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);

  // Guided connection modal state
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [requestHandleInput, setRequestHandleInput] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [forceNewRequestForm, setForceNewRequestForm] = useState(false);
  const [acceptedInviteCheck, setAcceptedInviteCheck] = useState(false);

  // Composer state
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [postType, setPostType] = useState<PostType>("FEED");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [caption, setCaption] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [scheduledAt, setScheduledAt] = useState<string>(defaultDateTimeLocal);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Queue filter & item action states
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const loadData = useCallback(async () => {
    try {
      const [accRes, postRes, reqRes] = await Promise.all([
        fetch("/api/instagram/accounts"),
        fetch("/api/instagram/posts"),
        fetch("/api/instagram/access-requests"),
      ]);
      const accJson = await accRes.json();
      const postJson = await postRes.json();
      const reqJson = await reqRes.json().catch(() => null);

      if (accJson?.status && accJson?.data) {
        const list: InstagramAccountItem[] = accJson.data.accounts || [];
        setAccounts(list);
        setConfigInfo(accJson.data.config || null);
        setSelectedAccountId((prev) => (prev && list.some((a) => a.id === prev) ? prev : list[0]?.id || ""));
      }
      if (postJson?.status && Array.isArray(postJson?.data)) {
        setPosts(postJson.data);
      }
      if (reqJson?.status && Array.isArray(reqJson?.data)) {
        setAccessRequests(reqJson.data);
      }
    } catch {
      toast.error("Erro ao carregar dados do Instagram.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Handle OAuth callback feedback
  useEffect(() => {
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");
    if (connected) {
      toast.success(`Conta ${connected} conectada com sucesso!`);
      router.replace("/dashboard/instagram");
      void loadData();
    } else if (err) {
      toast.error(err);
      router.replace("/dashboard/instagram");
    }
  }, [searchParams, router, loadData]);

  // Keep previewIndex within range
  useEffect(() => {
    if (previewIndex >= mediaItems.length) {
      setPreviewIndex(Math.max(0, mediaItems.length - 1));
    }
  }, [mediaItems.length, previewIndex]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || accounts[0] || null,
    [accounts, selectedAccountId]
  );

  const filteredPosts = useMemo(() => {
    if (statusFilter === "ALL") return posts;
    return posts.filter((p) => p.status === statusFilter);
  }, [posts, statusFilter]);

  const activeAccessRequest = useMemo(() => {
    const approved = accessRequests.find((r) => r.status === "APPROVED");
    if (approved) return approved;
    const pending = accessRequests.find((r) => r.status === "PENDING");
    if (pending) return pending;
    const latest = accessRequests[0];
    if (latest && latest.status === "REJECTED") return latest;
    return null;
  }, [accessRequests]);

  // Atualiza automaticamente enquanto houver solicitação pendente aguardando o SuperAdmin
  useEffect(() => {
    if (activeAccessRequest?.status !== "PENDING") return;
    const timer = setInterval(() => {
      void loadData();
    }, 6000);
    return () => clearInterval(timer);
  }, [activeAccessRequest?.status, loadData]);

  function handleConnectInstagram() {
    if (configInfo && !configInfo.configured) {
      toast.error("Configure INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET no .env primeiro.");
      setGuideOpen(true);
      return;
    }
    setForceNewRequestForm(false);
    setAcceptedInviteCheck(false);
    setConnectModalOpen(true);
  }

  function startOAuthFlow() {
    window.location.href = "/api/instagram/auth?redirect=1";
  }

  async function handleSubmitAccessRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!requestHandleInput.trim()) {
      toast.error("Informe o @usuário da sua conta do Instagram.");
      return;
    }
    setSubmittingRequest(true);
    try {
      const res = await fetch("/api/instagram/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ igUsername: requestHandleInput }),
      });
      const json = await res.json();
      if (!res.ok || !json.status) {
        toast.error(json.error || "Não foi possível enviar a solicitação.");
        return;
      }
      toast.success(json.message || "Solicitação enviada para o administrador!");
      setRequestHandleInput("");
      setForceNewRequestForm(false);
      await loadData();
    } catch {
      toast.error("Erro ao enviar solicitação.");
    } finally {
      setSubmittingRequest(false);
    }
  }

  async function handleCancelAccessRequest(id: string) {
    setSubmittingRequest(true);
    try {
      const res = await fetch(`/api/instagram/access-requests/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.status) {
        toast.error(json.error || "Não foi possível remover a solicitação.");
        return;
      }
      toast.info("Solicitação cancelada. Informe outro @ se desejar.");
      setForceNewRequestForm(true);
      await loadData();
    } catch {
      toast.error("Erro ao cancelar solicitação.");
    } finally {
      setSubmittingRequest(false);
    }
  }

  async function handleRefreshAccount(id: string) {
    setBusyAccountId(id);
    try {
      const res = await fetch(`/api/instagram/accounts/${id}/refresh`, { method: "POST" });
      const json = await res.json();
      if (!json.status) {
        toast.error(json.error || "Não foi possível renovar o token.");
      } else {
        toast.success(`Token da conta @${json.data.username} renovado por mais 60 dias!`);
        await loadData();
      }
    } catch {
      toast.error("Erro ao renovar token.");
    } finally {
      setBusyAccountId(null);
    }
  }

  async function handleDisconnectAccount(id: string, username: string) {
    setBusyAccountId(id);
    try {
      const res = await fetch(`/api/instagram/accounts/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.status) {
        toast.error(json.error || "Erro ao desconectar conta.");
      } else {
        toast.success(`Conta @${username} desconectada.`);
        await loadData();
      }
    } catch {
      toast.error("Erro ao desconectar conta.");
    } finally {
      setBusyAccountId(null);
    }
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    const maxAllowed = postType === "CAROUSEL" ? 10 - mediaItems.length : 1;
    if (maxAllowed <= 0) {
      toast.error("O carrossel suporta no máximo 10 itens.");
      return;
    }

    const toUpload = postType === "CAROUSEL" ? files.slice(0, maxAllowed) : [files[0]];
    setUploading(true);
    try {
      const uploaded: MediaItem[] = [];
      for (const file of toUpload) {
        if (postType === "REELS" && !file.type.startsWith("video/") && !/\.(mp4|mov)$/i.test(file.name)) {
          toast.error("Reels aceita apenas arquivos de vídeo (MP4 ou MOV).");
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/instagram/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (!json.status) {
          toast.error(json.error || `Falha ao enviar ${file.name}`);
          continue;
        }
        uploaded.push(json.data);
      }

      if (uploaded.length > 0) {
        if (postType === "CAROUSEL") {
          setMediaItems((prev) => [...prev, ...uploaded].slice(0, 10));
        } else {
          setMediaItems([uploaded[0]]);
        }
        toast.success(`${uploaded.length} mídia(s) carregada(s)!`);
      }
    } catch {
      toast.error("Erro no upload de mídia.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function moveMedia(idx: number, dir: -1 | 1) {
    setMediaItems((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }

  function removeMedia(idx: number) {
    setMediaItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmitPost(publishNow: boolean) {
    if (!selectedAccountId) {
      toast.error("Conecte e selecione uma conta do Instagram primeiro.");
      return;
    }
    if (mediaItems.length === 0) {
      toast.error("Envie pelo menos uma foto ou vídeo.");
      return;
    }
    if (postType === "CAROUSEL" && mediaItems.length < 2) {
      toast.error("Carrossel precisa de pelo menos 2 mídias.");
      return;
    }
    if (postType === "REELS" && mediaItems[0]?.mediaType !== "VIDEO") {
      toast.error("Reels exige um arquivo de vídeo (MP4 ou MOV).");
      return;
    }
    if (publishNow && configInfo && !configInfo.isHttpsPublicUrl) {
      toast.error("Para publicar na Meta é necessário configurar BASE_URL com um domínio HTTPS público.");
      return;
    }

    setSubmitting(true);
    try {
      const isoDate = scheduledAt ? new Date(scheduledAt).toISOString() : new Date().toISOString();
      const res = await fetch("/api/instagram/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccountId,
          type: postType,
          caption: postType === "STORY" ? "" : caption,
          mediaItems,
          shareToFeed,
          scheduledAt: isoDate,
          publishNow,
        }),
      });
      const json = await res.json();

      if (!json.status) {
        toast.error(json.error || "Erro ao processar publicação.");
      } else {
        toast.success(
          publishNow
            ? "Publicação enviada para o Instagram com sucesso!"
            : "Publicação agendada com sucesso!"
        );
        setMediaItems([]);
        setCaption("");
        setScheduledAt(defaultDateTimeLocal());
      }
      await loadData();
    } catch {
      toast.error("Erro de comunicação ao salvar publicação.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublishNow(postId: string) {
    setBusyPostId(postId);
    try {
      const res = await fetch(`/api/instagram/posts/${postId}/publish`, { method: "POST" });
      const json = await res.json();
      if (!json.status) {
        toast.error(json.error || "Falha ao publicar no Instagram.");
      } else {
        toast.success("Publicado no Instagram!");
      }
      await loadData();
    } catch {
      toast.error("Erro ao publicar.");
    } finally {
      setBusyPostId(null);
    }
  }

  async function handleDeletePost(postId: string) {
    setBusyPostId(postId);
    try {
      const res = await fetch(`/api/instagram/posts/${postId}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.status) {
        toast.error(json.error || "Erro ao excluir.");
      } else {
        toast.success("Agendamento removido.");
        await loadData();
      }
    } catch {
      toast.error("Erro ao excluir agendamento.");
    } finally {
      setBusyPostId(null);
    }
  }

  async function copyRedirectUri() {
    if (!configInfo?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(configInfo.redirectUri);
      toast.success("Redirect URI copiada!");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  const activePreviewMedia = mediaItems[previewIndex] || mediaItems[0] || null;
  const isVerticalPreview = postType === "STORY" || postType === "REELS";

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600 text-white shadow-sm">
              <Instagram className="h-5 w-5" />
            </span>
            Instagram — Posts, Reels & Stories
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte contas profissionais via login oficial da Meta e agende publicações no Feed, Carrossel, Reels e Stories.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setGuideOpen(true)} className="gap-2">
            <BookOpen className="h-4 w-4" />
            Guia de Configuração Meta
          </Button>
          <Button
            onClick={handleConnectInstagram}
            className="gap-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white"
          >
            <Plus className="h-4 w-4" />
            Conectar Instagram
          </Button>
        </div>
      </div>

      {/* Environment Alerts */}
      {configInfo && (!configInfo.configured || !configInfo.isHttpsPublicUrl) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 text-sm">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                {!configInfo.configured && (
                  <p>
                    <strong>App Meta ainda não configurado:</strong> defina{" "}
                    <code className="px-1 py-0.5 rounded bg-muted">INSTAGRAM_APP_ID</code> e{" "}
                    <code className="px-1 py-0.5 rounded bg-muted">INSTAGRAM_APP_SECRET</code> no arquivo{" "}
                    <code className="px-1 py-0.5 rounded bg-muted">.env</code> para habilitar o botão de conexão dos clientes.
                  </p>
                )}
                {!configInfo.isHttpsPublicUrl && (
                  <p>
                    <strong>Domínio HTTPS público necessário para publicação:</strong> o endereço atual (
                    <code className="px-1 py-0.5 rounded bg-muted">{configInfo.publicBaseUrl}</code>) é local. A Meta exige{" "}
                    <code className="px-1 py-0.5 rounded bg-muted">BASE_URL=&quot;https://...&quot;</code> público para baixar imagens e vídeos.
                  </p>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setGuideOpen(true)} className="shrink-0">
              Ver Passo a Passo
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Status da solicitação de liberação do Instagram */}
      {activeAccessRequest && activeAccessRequest.status !== "COMPLETED" && (
        <Card
          className={
            activeAccessRequest.status === "APPROVED"
              ? "border-emerald-500/40 bg-emerald-500/5"
              : activeAccessRequest.status === "PENDING"
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-rose-500/40 bg-rose-500/5"
          }
        >
          <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 text-sm">
              {activeAccessRequest.status === "APPROVED" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : activeAccessRequest.status === "PENDING" ? (
                <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div>
                {activeAccessRequest.status === "APPROVED" ? (
                  <>
                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                      Instagram @{activeAccessRequest.igUsername} liberado pelo administrador!
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Siga os passos finais para aceitar o convite no navegador e concluir a conexão no sistema.
                    </p>
                  </>
                ) : activeAccessRequest.status === "PENDING" ? (
                  <>
                    <p className="font-semibold text-amber-700 dark:text-amber-400">
                      Liberação pendente para @{activeAccessRequest.igUsername}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      O SuperAdmin já foi avisado para adicionar seu @ na Meta. Assim que for liberado, os próximos passos serão destravados aqui automaticamente.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-rose-700 dark:text-rose-400">
                      Solicitação para @{activeAccessRequest.igUsername} não aprovada
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activeAccessRequest.adminNote || "Verifique seu @usuário e solicite novamente."}
                    </p>
                  </>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant={activeAccessRequest.status === "APPROVED" ? "default" : "outline"}
              onClick={handleConnectInstagram}
              className="shrink-0"
            >
              {activeAccessRequest.status === "APPROVED"
                ? "Continuar conexão →"
                : activeAccessRequest.status === "PENDING"
                ? "Ver status"
                : "Tentar novamente"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connected Accounts */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Contas Conectadas ({accounts.length})</CardTitle>
            <CardDescription>
              Cada cliente pode conectar uma ou mais contas Instagram Profissionais (Comercial ou Criador).
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void loadData()} title="Atualizar lista">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando contas...
            </div>
          ) : accounts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhuma conta do Instagram conectada ainda. Clique em <strong>Conectar Instagram</strong> para autenticar.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {accounts.map((acc) => {
                const isConnected = acc.status === "CONNECTED";
                const busy = busyAccountId === acc.id;
                return (
                  <div
                    key={acc.id}
                    className={`rounded-xl border p-3.5 flex flex-col justify-between gap-3 transition-colors ${
                      selectedAccountId === acc.id ? "border-primary/60 bg-primary/5" : "bg-card"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {acc.profilePictureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={acc.profilePictureUrl}
                          alt={acc.username}
                          className="h-11 w-11 rounded-full object-cover border"
                        />
                      ) : (
                        <div className="h-11 w-11 rounded-full bg-gradient-to-tr from-amber-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                          {acc.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm truncate">@{acc.username}</span>
                          <Badge
                            variant="outline"
                            className={
                              isConnected
                                ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px]"
                                : "bg-rose-500/15 text-rose-600 border-rose-500/30 text-[10px]"
                            }
                          >
                            {isConnected ? "Conectado" : acc.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {acc.name || acc.accountType || "Conta Profissional"}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Token válido até {formatDateTimePtBr(acc.tokenExpiresAt)}
                        </p>
                      </div>
                    </div>

                    {acc.lastError && (
                      <p className="text-xs text-rose-500 bg-rose-500/10 rounded p-2 line-clamp-2">{acc.lastError}</p>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1 border-t">
                      <Button
                        size="sm"
                        variant={selectedAccountId === acc.id ? "default" : "secondary"}
                        onClick={() => setSelectedAccountId(acc.id)}
                        className="h-7 text-xs"
                      >
                        {selectedAccountId === acc.id ? "Selecionada" : "Selecionar"}
                      </Button>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void handleRefreshAccount(acc.id)}
                          className="h-7 px-2 text-xs"
                          title="Renovar token OAuth por mais 60 dias"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${busy ? "animate-spin" : ""}`} />
                          Renovar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void handleDisconnectAccount(acc.id, acc.username)}
                          className="h-7 px-2 text-xs text-rose-500 hover:text-rose-600"
                          title="Desconectar conta"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Post Creator + Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Form */}
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle className="text-lg">Criar / Agendar Publicação</CardTitle>
            <CardDescription>
              Escolha o formato, envie suas mídias (JPG, PNG, MP4 ou MOV) e defina data e hora.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Account & Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Conta do Instagram</Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma conta..." />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        @{acc.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Data e Hora do Agendamento</Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
            </div>

            {/* Format selector */}
            <div className="space-y-2">
              <Label>Formato da Publicação</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(Object.keys(TYPE_META) as PostType[]).map((t) => {
                  const meta = TYPE_META[t];
                  const Icon = meta.icon;
                  const active = postType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setPostType(t);
                        if (t !== "CAROUSEL" && mediaItems.length > 1) {
                          setMediaItems([mediaItems[0]]);
                        }
                      }}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                        active
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-medium text-sm">
                        <Icon className="h-4 w-4 text-primary" />
                        {meta.label}
                      </div>
                      <span className="text-[11px] text-muted-foreground leading-tight">
                        {meta.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Media upload */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  Mídia ({postType === "CAROUSEL" ? `${mediaItems.length}/10 itens` : `${mediaItems.length}/1`})
                </Label>
                <span className="text-xs text-muted-foreground">
                  {postType === "REELS" ? "MP4 ou MOV até 100 MB" : "JPG, PNG, MP4 ou MOV até 100 MB"}
                </span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={postType === "REELS" ? "video/mp4,video/quicktime,.mp4,.mov" : "image/jpeg,image/png,video/mp4,video/quicktime,.jpg,.jpeg,.png,.mp4,.mov"}
                multiple={postType === "CAROUSEL"}
                className="hidden"
                onChange={(e) => void handleFilesSelected(e.target.files)}
              />

              <div className="flex flex-wrap gap-3">
                {mediaItems.map((item, idx) => (
                  <div
                    key={`${item.filename || item.url}-${idx}`}
                    className="relative w-24 h-24 rounded-lg border overflow-hidden bg-muted group"
                  >
                    {item.mediaType === "VIDEO" ? (
                      <video
                        src={item.previewUrl || item.url}
                        className="w-full h-full object-cover"
                        muted
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.previewUrl || item.url}
                        alt={`Mídia ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeMedia(idx)}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-90 hover:bg-rose-600"
                      title="Remover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {postType === "CAROUSEL" && (
                      <div className="absolute bottom-1 inset-x-1 flex justify-between px-1">
                        <button
                          type="button"
                          onClick={() => moveMedia(idx, -1)}
                          disabled={idx === 0}
                          className="h-5 w-5 rounded bg-black/70 text-white flex items-center justify-center disabled:opacity-30"
                          title="Mover antes"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMedia(idx, 1)}
                          disabled={idx === mediaItems.length - 1}
                          className="h-5 w-5 rounded bg-black/70 text-white flex items-center justify-center disabled:opacity-30"
                          title="Mover depois"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {(postType === "CAROUSEL" ? mediaItems.length < 10 : mediaItems.length === 0) && (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-24 h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer"
                  >
                    {uploading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Upload className="h-5 w-5" />
                    )}
                    <span>{uploading ? "Enviando..." : "Enviar"}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Caption (not applicable for Story) */}
            {postType !== "STORY" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Legenda</Label>
                  <span className={`text-xs ${caption.length > 2200 ? "text-rose-500 font-semibold" : "text-muted-foreground"}`}>
                    {caption.length} / 2200
                  </span>
                </div>
                <Textarea
                  rows={4}
                  maxLength={2200}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Escreva a legenda do seu post, hashtags e chamada para ação..."
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
                Stories publicados pela API oficial da Meta não possuem campo de legenda externa (qualquer texto visual deve estar na própria imagem ou vídeo 9:16).
              </p>
            )}

            {/* Reels shareToFeed option */}
            {postType === "REELS" && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Compartilhar também no Feed</Label>
                  <p className="text-xs text-muted-foreground">
                    Exibe o Reels na grade principal do perfil além da aba Reels.
                  </p>
                </div>
                <Switch checked={shareToFeed} onCheckedChange={setShareToFeed} />
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="button"
                onClick={() => void handleSubmitPost(false)}
                disabled={submitting || uploading || !selectedAccountId}
                className="gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                Agendar Publicação
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleSubmitPost(true)}
                disabled={submitting || uploading || !selectedAccountId}
                className="gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publicar Agora
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Right: Preview */}
        <Card className="lg:col-span-5 flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">Pré-visualização</CardTitle>
            <CardDescription>
              Simulação em tempo real ({isVerticalPreview ? "9:16 Vertical" : "1:1 Feed"})
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col items-center justify-center">
            <div
              className={`w-full rounded-2xl border bg-background shadow-sm overflow-hidden ${
                isVerticalPreview ? "max-w-[270px]" : "max-w-[360px]"
              }`}
            >
              {/* Mock IG header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-amber-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {selectedAccount?.username?.charAt(0)?.toUpperCase() || "M"}
                  </div>
                  <span className="text-xs font-semibold truncate">
                    @{selectedAccount?.username || "sua_conta"}
                  </span>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {TYPE_META[postType].label}
                </Badge>
              </div>

              {/* Media frame */}
              <div
                className={`relative bg-black/90 flex items-center justify-center ${
                  isVerticalPreview ? "aspect-[9/16]" : "aspect-square"
                }`}
              >
                {activePreviewMedia ? (
                  activePreviewMedia.mediaType === "VIDEO" ? (
                    <video
                      src={activePreviewMedia.previewUrl || activePreviewMedia.url}
                      controls
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activePreviewMedia.previewUrl || activePreviewMedia.url}
                      alt="Pré-visualização"
                      className="w-full h-full object-cover"
                    />
                  )
                ) : (
                  <div className="text-center text-xs text-muted-foreground px-4">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    Envie uma imagem ou vídeo para visualizar aqui
                  </div>
                )}

                {postType === "CAROUSEL" && mediaItems.length > 1 && (
                  <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5">
                    {mediaItems.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPreviewIndex(idx)}
                        className={`h-2 w-2 rounded-full transition-all ${
                          idx === previewIndex ? "bg-white scale-110" : "bg-white/40"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Caption preview */}
              {postType !== "STORY" && (
                <div className="p-3 text-xs space-y-1 border-t">
                  <p className="line-clamp-4 whitespace-pre-wrap">
                    <span className="font-semibold mr-1.5">@{selectedAccount?.username || "sua_conta"}</span>
                    {caption || (
                      <span className="text-muted-foreground italic">Sua legenda aparecerá aqui...</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Queue & History */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Fila e Histórico de Publicações</CardTitle>
            <CardDescription>
              O agendador verifica a fila automaticamente a cada 30 segundos.
            </CardDescription>
          </div>
          <Tabs value={statusFilter} onValueChange={setStatusFilter}>
            <TabsList>
              <TabsTrigger value="ALL">Todos ({posts.length})</TabsTrigger>
              <TabsTrigger value="PENDING">
                Agendados ({posts.filter((p) => p.status === "PENDING").length})
              </TabsTrigger>
              <TabsTrigger value="PUBLISHED">
                Publicados ({posts.filter((p) => p.status === "PUBLISHED").length})
              </TabsTrigger>
              <TabsTrigger value="FAILED">
                Com Erro ({posts.filter((p) => p.status === "FAILED").length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {filteredPosts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhuma publicação encontrada neste filtro.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPosts.map((post) => {
                const firstMedia = post.mediaItems?.[0];
                const statusMeta = STATUS_META[post.status] || STATUS_META.PENDING;
                const typeMeta = TYPE_META[post.type] || TYPE_META.FEED;
                const busy = busyPostId === post.id;

                return (
                  <div
                    key={post.id}
                    className="rounded-xl border p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                      <div className="h-16 w-16 rounded-lg border bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                        {firstMedia?.previewUrl || firstMedia?.url ? (
                          firstMedia.mediaType === "VIDEO" ? (
                            <video
                              src={firstMedia.previewUrl || firstMedia.url}
                              className="w-full h-full object-cover"
                              muted
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={firstMedia.previewUrl || firstMedia.url}
                              alt="Thumb"
                              className="w-full h-full object-cover"
                            />
                          )
                        ) : (
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm">@{post.account?.username}</span>
                          <Badge variant="outline" className="text-[11px]">
                            {typeMeta.label}
                            {post.type === "CAROUSEL" ? ` (${post.mediaItems?.length || 0})` : ""}
                          </Badge>
                          <Badge variant="outline" className={`${statusMeta.badgeClass} text-[11px]`}>
                            {post.status === "PUBLISHED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                            {post.status === "FAILED" && <XCircle className="h-3 w-3 mr-1" />}
                            {post.status === "PENDING" && <Clock className="h-3 w-3 mr-1" />}
                            {statusMeta.label}
                          </Badge>
                        </div>

                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {post.caption || (post.type === "STORY" ? "Story sem legenda" : "Sem legenda")}
                        </p>

                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                          <span>Agendado: {formatDateTimePtBr(post.scheduledAt)}</span>
                          {post.publishedAt && <span>Publicado em: {formatDateTimePtBr(post.publishedAt)}</span>}
                        </div>

                        {post.errorMessage && (
                          <p className="text-xs text-rose-500 bg-rose-500/10 rounded px-2 py-1 mt-1">
                            {post.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {post.permalink && (
                        <Button size="sm" variant="outline" asChild className="gap-1.5 h-8 text-xs">
                          <a href={post.permalink} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                            Ver no Instagram
                          </a>
                        </Button>
                      )}
                      {(post.status === "PENDING" || post.status === "FAILED") && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void handlePublishNow(post.id)}
                          className="gap-1.5 h-8 text-xs"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          {post.status === "FAILED" ? "Tentar novamente" : "Publicar agora"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void handleDeletePost(post.id)}
                        className="h-8 px-2.5 text-rose-500 hover:text-rose-600"
                        title="Excluir agendamento"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Meta Setup Guide Modal */}
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              Como configurar o App da Meta (Instagram Login)
            </DialogTitle>
            <DialogDescription>
              Configure uma única vez no painel da Meta para que todos os seus clientes conectem suas contas profissionais.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Sua Redirect URI OAuth
              </Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={configInfo?.redirectUri || ""} className="font-mono text-xs" />
                <Button type="button" size="sm" variant="outline" onClick={() => void copyRedirectUri()}>
                  <Copy className="h-4 w-4 mr-1" /> Copiar
                </Button>
              </div>
            </div>

            <ol className="list-decimal list-inside space-y-2.5 text-muted-foreground">
              <li>
                Acesse <strong className="text-foreground">developers.facebook.com</strong> e crie um app do tipo{" "}
                <strong className="text-foreground">Business</strong>.
              </li>
              <li>
                Adicione o produto <strong className="text-foreground">Instagram</strong> e abra{" "}
                <strong className="text-foreground">API setup with Instagram login</strong>.
              </li>
              <li>
                Cole a <strong className="text-foreground">Redirect URI</strong> acima em{" "}
                <strong className="text-foreground">Valid OAuth Redirect URIs</strong> e habilite as permissões{" "}
                <code className="px-1 rounded bg-muted">instagram_business_basic</code> e{" "}
                <code className="px-1 rounded bg-muted">instagram_business_content_publish</code>.
              </li>
              <li>
                Copie o <strong className="text-foreground">Instagram App ID</strong> e{" "}
                <strong className="text-foreground">Instagram App Secret</strong> para o arquivo{" "}
                <code className="px-1 rounded bg-muted">.env</code> do MarcFlow e garanta que{" "}
                <code className="px-1 rounded bg-muted">BASE_URL</code> esteja em HTTPS público.
              </li>
              <li>
                Rode <code className="px-1 rounded bg-muted">npm run db:push</code> caso ainda não tenha aplicado as tabelas novas no MySQL e reinicie o servidor.
              </li>
              <li>
                Em modo de desenvolvimento, adicione seus clientes em{" "}
                <strong className="text-foreground">App Roles → Instagram Testers</strong>; para acesso público irrestrito, conclua o App Review da Meta.
              </li>
            </ol>
          </div>

          <DialogFooter>
            <Button onClick={() => setGuideOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Janela guiada de conexão com o Instagram */}
      <Dialog open={connectModalOpen} onOpenChange={setConnectModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600 text-white">
                <Instagram className="h-4 w-4" />
              </span>
              Conectar conta do Instagram
            </DialogTitle>
            <DialogDescription>
              Para conectar uma conta Instagram Profissional, informe seu @ para liberação e siga as etapas abaixo.
            </DialogDescription>
          </DialogHeader>

          {/* Caso 1: Solicitação Pendente */}
          {!forceNewRequestForm && activeAccessRequest?.status === "PENDING" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge className="bg-amber-500 text-white gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Pendente — aguardando SuperAdmin
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => void loadData()}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
                  </Button>
                </div>
                <p className="text-sm font-medium pt-1">
                  Conta solicitada: <span className="font-mono font-bold">@{activeAccessRequest.igUsername}</span>
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  O administrador já recebeu a notificação com o seu @ para adicioná-lo como testador autorizado na Meta.
                  Assim que ele confirmar no painel, esta janela liberará automaticamente os próximos passos para você conectar.
                </p>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submittingRequest}
                  onClick={() => void handleCancelAccessRequest(activeAccessRequest.id)}
                >
                  Informar outro @
                </Button>
                <Button type="button" onClick={() => setConnectModalOpen(false)}>
                  Fechar
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Caso 2: Liberado pelo SuperAdmin -> Próximos passos */}
          {!forceNewRequestForm && activeAccessRequest?.status === "APPROVED" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Conta @{activeAccessRequest.igUsername} liberada!
                </div>
                <p className="text-xs text-muted-foreground">
                  Agora siga os 2 passos abaixo para concluir a integração:
                </p>
              </div>

              <div className="space-y-3 text-sm">
                <div className="rounded-lg border p-3.5 space-y-2 bg-muted/20">
                  <p className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Passo 1 — Aceite o convite no navegador
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Logado na conta <strong className="text-foreground">@{activeAccessRequest.igUsername}</strong> pelo{" "}
                    <strong className="text-foreground">navegador</strong> (no app do celular essa aba não aparece), abra o link abaixo, entre na aba{" "}
                    <strong className="text-foreground">Convites de testador</strong> e clique em <strong className="text-foreground">Aceitar</strong>:
                  </p>
                  <a
                    href="https://www.instagram.com/accounts/manage_access/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-pink-600 hover:underline"
                  >
                    Abrir Convites de testador (instagram.com/accounts/manage_access)
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>

                <div className="rounded-lg border p-3.5 space-y-3 bg-muted/20">
                  <p className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Passo 2 — Autorizar e conectar no MarcFlow
                  </p>
                  <label className="flex items-start gap-2.5 text-xs cursor-pointer select-none">
                    <Checkbox
                      checked={acceptedInviteCheck}
                      onCheckedChange={(checked) => setAcceptedInviteCheck(Boolean(checked))}
                      className="mt-0.5"
                    />
                    <span>
                      Já aceitei o convite em <strong>Convites de testador</strong> pelo navegador usando a conta{" "}
                      <strong>@{activeAccessRequest.igUsername}</strong>.
                    </span>
                  </label>
                </div>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setForceNewRequestForm(true)}
                >
                  Usar outro @
                </Button>
                <Button
                  type="button"
                  disabled={!acceptedInviteCheck}
                  onClick={startOAuthFlow}
                  className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white"
                >
                  Conectar conta do Instagram agora
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Caso 3: Nenhuma solicitação ativa (ou Recusada / Novo @) */}
          {(forceNewRequestForm || !activeAccessRequest || activeAccessRequest.status === "REJECTED") && (
            <form onSubmit={handleSubmitAccessRequest} className="space-y-4">
              {activeAccessRequest?.status === "REJECTED" && !forceNewRequestForm && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
                  <strong>Solicitação anterior (@{activeAccessRequest.igUsername}) recusada:</strong>{" "}
                  {activeAccessRequest.adminNote || "Confirme o @usuário e envie novamente."}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="ig-handle-input">Seu @usuário do Instagram Profissional</Label>
                <Input
                  id="ig-handle-input"
                  placeholder="Ex.: @sualoja"
                  value={requestHandleInput}
                  onChange={(e) => setRequestHandleInput(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  A conta precisa estar configurada como <strong>Profissional (Comercial ou Criador de Conteúdo)</strong>.
                  Ao enviar, o administrador será notificado para liberar seu perfil.
                </p>
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
                {isSuperAdmin ? (
                  <Button type="button" variant="outline" size="sm" onClick={startOAuthFlow}>
                    Conectar direto (SuperAdmin)
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setConnectModalOpen(false)}>
                    Cancelar
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={submittingRequest}
                  className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white"
                >
                  {submittingRequest ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Enviar @ e solicitar liberação
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function InstagramDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[300px] text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando módulo do Instagram...
        </div>
      }
    >
      <InstagramPageContent />
    </Suspense>
  );
}
