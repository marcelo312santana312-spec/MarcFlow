"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
    Sparkles,
    Image as ImageIcon,
    Video,
    Wand2,
    Send,
    CalendarClock,
    Download,
    Trash2,
    KeyRound,
    Loader2,
    Upload,
    X,
    CheckCircle2,
    Smartphone,
    Square,
    Monitor,
    Play,
    Film,
    Users,
    Radio,
    UserCheck,
    ShoppingBag,
} from "lucide-react";

interface AiStudioMediaItem {
    id: string;
    type: "image" | "video";
    prompt: string;
    enhancedPrompt?: string;
    caption?: string;
    model: string;
    aspectRatio: string;
    filename: string;
    url: string;
    localPath: string;
    createdAt: string;
}

interface GroupItem {
    id: string;
    subject: string;
}

interface ContactItem {
    jid: string;
    name?: string | null;
    notify?: string | null;
}

interface AffiliateQuickItem {
    id: string;
    shortUrl: string | null;
    productTitle: string | null;
    platform: string;
}

const STYLE_PRESETS = [
    {
        id: "produto-estudio",
        label: "📦 Produto em Estúdio",
        value: "Fotografia comercial de produto em estúdio profissional, iluminação suave de três pontos, fundo elegante com profundidade de campo rasa, altíssima nitidez 8k, estilo anúncio premium e-commerce",
    },
    {
        id: "oferta-story",
        label: "🔥 Achadinho / Oferta",
        value: "Visual comercial vibrante e atraente para redes sociais, iluminação dinâmica moderna, cores vivas e contrastantes que chamam atenção imediata no feed e stories, estética de produto desejável",
    },
    {
        id: "lifestyle",
        label: "🏡 Uso Real (Lifestyle)",
        value: "Fotografia lifestyle natural e autêntica em ambiente moderno aconchegante, luz solar dourada entrando pela janela, aparência hiper-realista espontânea",
    },
    {
        id: "cinematic-flow",
        label: "🎬 Cinematográfico (Flow)",
        value: "Cena cinematográfica estilo Google Flow, câmera em movimento suave (slow motion pan/dolly), iluminação volumétrica dramática, gradação de cores de cinema, 4k ultrarrealista",
    },
    {
        id: "luxo",
        label: "✨ Minimalista Premium",
        value: "Estética minimalista de luxo, superfícies em mármore ou madeira nobre, reflexos elegantes, iluminação de vitrine sofisticada",
    },
];

export default function AiStudioPage() {
    const { sessionId: selectedSession } = useSession();

    // Gallery & API Key state
    const [loadingGallery, setLoadingGallery] = useState(true);
    const [hasApiKey, setHasApiKey] = useState(false);
    const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
    const [showKeyModal, setShowKeyModal] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [savingKey, setSavingKey] = useState(false);
    const [colabUrl, setColabUrl] = useState("");
    const [colabUrlInput, setColabUrlInput] = useState("");
    const [showColabModal, setShowColabModal] = useState(false);
    const [savingColab, setSavingColab] = useState(false);

    const [items, setItems] = useState<AiStudioMediaItem[]>([]);
    const [galleryFilter, setGalleryFilter] = useState<"ALL" | "image" | "video">("ALL");
    const [activePreview, setActivePreview] = useState<AiStudioMediaItem | null>(null);

    // Generator Form state
    const [mode, setMode] = useState<"image" | "video">("image");
    const [prompt, setPrompt] = useState("");
    const [caption, setCaption] = useState("");
    const [speechText, setSpeechText] = useState("");
    const [voiceId, setVoiceId] = useState("br_001");
    const [stylePreset, setStylePreset] = useState(STYLE_PRESETS[0].value);
    const [aspectRatio, setAspectRatio] = useState<"9:16" | "1:1" | "16:9">("9:16");
    const [imageModel, setImageModel] = useState("flux-1-ultra-hd");
    const [videoModel, setVideoModel] = useState("minimax-h3-turbo");

    // Reference image (upload or gallery selection for Image-to-Video / Product Scene)
    const [referenceImageBase64, setReferenceImageBase64] = useState<string | null>(null);
    const [referenceImageMime, setReferenceImageMime] = useState<string>("image/png");
    const [referenceImagePreview, setReferenceImagePreview] = useState<string | null>(null);
    const [sourceGalleryFilename, setSourceGalleryFilename] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Processing state
    const [enhancing, setEnhancing] = useState(false);
    const [generating, setGenerating] = useState(false);

    // WhatsApp Publish / Schedule Modal state
    const [sendModalOpen, setSendModalOpen] = useState(false);
    const [sendTargetItem, setSendTargetItem] = useState<AiStudioMediaItem | null>(null);
    const [targetType, setTargetType] = useState<"status" | "groups" | "contacts">("status");
    const [selectedJids, setSelectedJids] = useState<string[]>([]);
    const [manualJid, setManualJid] = useState("");
    const [sendCaption, setSendCaption] = useState("");
    const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
    const [sendAt, setSendAt] = useState("");
    const [sendingWhatsapp, setSendingWhatsapp] = useState(false);

    // Auxiliary lists for modal (groups, contacts, recent affiliate links)
    const [groups, setGroups] = useState<GroupItem[]>([]);
    const [contacts, setContacts] = useState<ContactItem[]>([]);
    const [recentAffiliates, setRecentAffiliates] = useState<AffiliateQuickItem[]>([]);

    // Live AI Servers Status Pill
    const [providers, setProviders] = useState<
        { id: string; name: string; category: string; status: "online" | "limited" | "exhausted" | "offline"; detail: string }[]
    >([]);
    const [loadingProviders, setLoadingProviders] = useState(false);
    const [providersOpen, setProvidersOpen] = useState(false);

    useEffect(() => {
        if (!selectedSession) {
            setLoadingGallery(false);
            return;
        }
        fetchStudioData(selectedSession);
        fetchTargetsAndAffiliates(selectedSession);
        fetchProviderStatus(selectedSession);
    }, [selectedSession]);

    const fetchProviderStatus = async (sessionId: string) => {
        setLoadingProviders(true);
        try {
            const res = await fetch(`/api/ai-studio/${sessionId}?status=providers`);
            const json = await res.json();
            if (json.status && json.data?.providers) {
                setProviders(json.data.providers);
            }
        } catch {
        } finally {
            setLoadingProviders(false);
        }
    };

    const fetchStudioData = async (sessionId: string) => {
        setLoadingGallery(true);
        try {
            const res = await fetch(`/api/ai-studio/${sessionId}`);
            const json = await res.json();
            if (json.status && json.data) {
                setHasApiKey(Boolean(json.data.hasApiKey));
                setMaskedApiKey(json.data.maskedApiKey || null);
                const cUrl = json.data.colabUrl || "";
                setColabUrl(cUrl);
                setColabUrlInput(cUrl);
                const list: AiStudioMediaItem[] = json.data.items || [];
                setItems(list);
                if (list.length > 0 && !activePreview) {
                    setActivePreview(list[0]);
                }
            }
        } catch {
            toast.error("Erro ao carregar o Estúdio IA.");
        } finally {
            setLoadingGallery(false);
        }
    };

    const fetchTargetsAndAffiliates = async (sessionId: string) => {
        try {
            const [grpRes, cntRes, affRes] = await Promise.all([
                fetch(`/api/groups/${sessionId}`).catch(() => null),
                fetch(`/api/contacts/${sessionId}?limit=100`).catch(() => null),
                fetch(`/api/affiliates/${sessionId}?status=CONVERTED&limit=15`).catch(() => null),
            ]);

            if (grpRes && grpRes.ok) {
                const gJson = await grpRes.json();
                if (Array.isArray(gJson.data)) setGroups(gJson.data);
            }
            if (cntRes && cntRes.ok) {
                const cJson = await cntRes.json();
                if (Array.isArray(cJson.data)) setContacts(cJson.data);
            }
            if (affRes && affRes.ok) {
                const aJson = await affRes.json();
                if (Array.isArray(aJson.data?.links)) setRecentAffiliates(aJson.data.links);
            }
        } catch {}
    };

    const handleSaveApiKey = async () => {
        if (!selectedSession) return;
        if (!apiKeyInput.trim()) {
            toast.error("Cole sua chave da API do Google Gemini.");
            return;
        }
        setSavingKey(true);
        try {
            const res = await fetch(`/api/ai-studio/${selectedSession}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "save-api-key",
                    apiKey: apiKeyInput.trim(),
                }),
            });
            const json = await res.json();
            if (json.status) {
                toast.success(json.message || "Chave salva com sucesso!");
                setApiKeyInput("");
                setShowKeyModal(false);
                fetchStudioData(selectedSession);
            } else {
                toast.error(json.message || "Falha ao salvar chave");
            }
        } catch {
            toast.error("Erro ao salvar chave de API.");
        } finally {
            setSavingKey(false);
        }
    };

    const handleSaveColabUrl = async () => {
        if (!selectedSession) return;
        setSavingColab(true);
        try {
            const res = await fetch(`/api/ai-studio/${selectedSession}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "save-colab-url",
                    colabUrl: colabUrlInput.trim(),
                }),
            });
            const json = await res.json();
            if (json.status) {
                const clean = colabUrlInput.trim().replace(/\/+$/, "");
                setColabUrl(clean);
                toast.success(json.message || "Colab GPU atualizado!");
                setShowColabModal(false);
                fetchProviderStatus(selectedSession);
            } else {
                toast.error(json.message || "Erro ao salvar URL do Colab");
            }
        } catch {
            toast.error("Erro ao salvar URL do Colab.");
        } finally {
            setSavingColab(false);
        }
    };

    const colabCellScript = `# === MARCFLOW COLAB GPU VIDEO SERVER (A100 / L4 / T4) ===
import os
os.environ["HF_HOME"] = "/content/hf_cache"
os.makedirs(os.environ["HF_HOME"], exist_ok=True)

!pip install -q -U diffusers transformers accelerate sentencepiece ftfy imageio[ffmpeg] fastapi uvicorn
!wget -q -O /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared

import io, re, time, base64, tempfile, threading, subprocess, torch
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
from PIL import Image
from diffusers import AutoencoderKLWan, WanPipeline, WanImageToVideoPipeline, LTXImageToVideoPipeline
from diffusers.utils import export_to_video
import uvicorn

gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
vram_gb = (torch.cuda.get_device_properties(0).total_memory / 1e9) if torch.cuda.is_available() else 0
print(f"GPU detectada: {gpu_name} ({vram_gb:.1f} GB VRAM) | Cache: {os.environ['HF_HOME']}")

MODEL_T2V = "Wan-AI/Wan2.1-T2V-14B-Diffusers" if vram_gb >= 38 else "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
print(f"Carregando modelo: {MODEL_T2V} ...")

vae = AutoencoderKLWan.from_pretrained(MODEL_T2V, subfolder="vae", torch_dtype=torch.float32)
pipe_t2v = WanPipeline.from_pretrained(MODEL_T2V, vae=vae, torch_dtype=torch.bfloat16)
pipe_t2v.enable_model_cpu_offload()
pipe_i2v = None

app = FastAPI()

class GenReq(BaseModel):
    prompt: str
    aspect_ratio: str = "9:16"
    duration_sec: int = 8
    image_base64: str | None = None

@app.get("/health")
def health():
    return {"ok": True, "gpu": gpu_name, "vram_gb": round(vram_gb, 1), "model": MODEL_T2V}

@app.post("/generate")
def generate(req: GenReq):
    global pipe_i2v
    w, h = (480, 832) if req.aspect_ratio == "9:16" else (832, 480)
    num_frames = 81  # ~5s fluído em 16fps (sincronizado com FFmpeg no MarcFlow)
    neg = "blurry, distorted, low quality, static, watermark, text, deformed face"

    if req.image_base64 and vram_gb >= 38:
        if pipe_i2v is None:
            i2v_id = "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers"
            vae_i2v = AutoencoderKLWan.from_pretrained(i2v_id, subfolder="vae", torch_dtype=torch.float32)
            pipe_i2v = WanImageToVideoPipeline.from_pretrained(i2v_id, vae=vae_i2v, torch_dtype=torch.bfloat16)
            pipe_i2v.enable_model_cpu_offload()
        img_bytes = base64.b64decode(req.image_base64.split(",")[-1])
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB").resize((w, h))
        frames = pipe_i2v(image=img, prompt=req.prompt, negative_prompt=neg, height=h, width=w, num_frames=num_frames, guidance_scale=5.0, num_inference_steps=28).frames[0]
    elif req.image_base64 and vram_gb >= 14:
        if pipe_i2v is None:
            pipe_i2v = LTXImageToVideoPipeline.from_pretrained("Lightricks/LTX-Video", torch_dtype=torch.bfloat16)
            pipe_i2v.enable_model_cpu_offload()
        lw, lh = (512, 768) if req.aspect_ratio == "9:16" else (768, 512)
        img_bytes = base64.b64decode(req.image_base64.split(",")[-1])
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB").resize((lw, lh))
        frames = pipe_i2v(image=img, prompt=req.prompt, negative_prompt=neg, width=lw, height=lh, num_frames=97, num_inference_steps=30).frames[0]
    else:
        frames = pipe_t2v(prompt=req.prompt, negative_prompt=neg, height=h, width=w, num_frames=num_frames, guidance_scale=5.0, num_inference_steps=28).frames[0]

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        out_path = tmp.name
    export_to_video(frames, out_path, fps=16)
    with open(out_path, "rb") as f:
        data = f.read()
    os.remove(out_path)
    return Response(content=data, media_type="video/mp4")

def start_tunnel():
    proc = subprocess.Popen(["cloudflared", "tunnel", "--no-autoupdate", "--url", "http://localhost:8000"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in proc.stdout:
        m = re.search(r"https://[-a-z0-9]+\\.trycloudflare\\.com", line)
        if m:
            print("\\n" + "="*60)
            print("COLE ESTE LINK NO MARCFLOW -> CONECTAR COLAB GPU:")
            print(m.group(0))
            print("="*60 + "\\n")

threading.Thread(target=start_tunnel, daemon=True).start()
config = uvicorn.Config(app, host="0.0.0.0", port=8000)
server = uvicorn.Server(config)
await server.serve()`;

    const handleEnhancePrompt = async () => {
        if (!selectedSession) return;
        if (!prompt.trim()) {
            toast.error("Digite uma breve descrição do produto ou cena primeiro!");
            return;
        }
        setEnhancing(true);
        try {
            const res = await fetch(`/api/ai-studio/${selectedSession}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "enhance-prompt",
                    prompt: prompt.trim(),
                    mediaType: mode,
                    stylePreset,
                }),
            });
            const json = await res.json();
            if (json.status && json.data) {
                if (json.data.enhancedPrompt) setPrompt(json.data.enhancedPrompt);
                if (json.data.caption) setCaption(json.data.caption);
                if (json.data.speechText) setSpeechText(json.data.speechText);
                toast.success("Prompt otimizado, fala narrada e legenda criadas com IA!");
            } else {
                toast.error(json.message || "Não foi possível otimizar o prompt.");
            }
        } catch {
            toast.error("Erro ao comunicar com o Gemini.");
        } finally {
            setEnhancing(false);
        }
    };

    const handleUploadReferenceImage = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || "");
            setReferenceImageBase64(result);
            setReferenceImageMime(file.type || "image/png");
            setReferenceImagePreview(result);
            setSourceGalleryFilename(null);
        };
        reader.readAsDataURL(file);
    };

    const clearReferenceImage = () => {
        setReferenceImageBase64(null);
        setReferenceImagePreview(null);
        setSourceGalleryFilename(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleAnimateFromGallery = (item: AiStudioMediaItem) => {
        setMode("video");
        setSourceGalleryFilename(item.filename);
        setReferenceImagePreview(item.url);
        setReferenceImageBase64(null);
        setAspectRatio(item.aspectRatio === "16:9" ? "16:9" : "9:16");
        setPrompt(`Movimento cinematográfico suave dando vida ao produto: ${item.prompt}`);
        if (item.caption) setCaption(item.caption);
        window.scrollTo({ top: 0, behavior: "smooth" });
        toast.info("Imagem selecionada! Clique em 'Gerar Vídeo (Veo / Flow)' para animá-la.");
    };

    const handleGenerate = async () => {
        if (!selectedSession) {
            toast.error("Selecione uma sessão do WhatsApp no topo da página.");
            return;
        }
        if (!prompt.trim()) {
            toast.error("Descreva o que você deseja gerar no campo de Prompt.");
            return;
        }
        if (!hasApiKey) {
            setShowKeyModal(true);
            toast.error("Configure sua chave GEMINI_API_KEY antes de gerar.");
            return;
        }

        setGenerating(true);
        try {
            const payload =
                mode === "image"
                    ? {
                          action: "generate-image",
                          prompt: prompt.trim(),
                          aspectRatio,
                          stylePreset,
                          model: imageModel,
                          caption: caption.trim(),
                          referenceImageBase64,
                          referenceImageMimeType: referenceImageMime,
                      }
                    : {
                          action: "generate-video",
                          prompt: prompt.trim(),
                          aspectRatio: aspectRatio === "16:9" ? "16:9" : "9:16",
                          stylePreset,
                          model: videoModel,
                          caption: caption.trim(),
                          speechText: speechText.trim(),
                          voiceId,
                          sourceImageFilename: sourceGalleryFilename,
                          referenceImageBase64,
                          referenceImageMimeType: referenceImageMime,
                      };

            const res = await fetch(`/api/ai-studio/${selectedSession}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const json = await res.json();

            if (json.status && json.data) {
                toast.success(json.message || "Mídia gerada com sucesso!");
                setItems((prev) => [json.data, ...prev]);
                setActivePreview(json.data);
            } else {
                toast.error(json.message || "Falha na geração.");
            }
        } catch (err: any) {
            toast.error(err?.message || "Erro ao gerar mídia.");
        } finally {
            setGenerating(false);
            if (selectedSession) fetchProviderStatus(selectedSession);
        }
    };

    const handleDeleteItem = async (id: string) => {
        if (!selectedSession) return;
        try {
            const res = await fetch(`/api/ai-studio/${selectedSession}?id=${encodeURIComponent(id)}`, {
                method: "DELETE",
            });
            const json = await res.json();
            if (json.status) {
                toast.success("Item removido da galeria.");
                const remaining = items.filter((i) => i.id !== id);
                setItems(remaining);
                if (activePreview?.id === id) {
                    setActivePreview(remaining[0] || null);
                }
            } else {
                toast.error(json.message || "Erro ao excluir.");
            }
        } catch {
            toast.error("Erro ao excluir mídia.");
        }
    };

    const openSendModal = (item: AiStudioMediaItem) => {
        setSendTargetItem(item);
        setSendCaption(item.caption || caption || "");
        setTargetType("status");
        setSelectedJids([]);
        setSendMode("now");
        setSendModalOpen(true);
    };

    const toggleJidSelection = (jid: string) => {
        setSelectedJids((prev) =>
            prev.includes(jid) ? prev.filter((item) => item !== jid) : [...prev, jid]
        );
    };

    const handleSendToWhatsapp = async () => {
        if (!selectedSession || !sendTargetItem) return;

        let jidsToUse = [...selectedJids];
        if (targetType !== "status" && manualJid.trim()) {
            jidsToUse.push(manualJid.trim());
        }

        if (targetType !== "status" && jidsToUse.length === 0) {
            toast.error("Selecione pelo menos um Grupo ou Contato (ou digite o número).");
            return;
        }

        if (sendMode === "schedule" && !sendAt) {
            toast.error("Selecione a data e horário para o agendamento.");
            return;
        }

        setSendingWhatsapp(true);
        try {
            const res = await fetch(`/api/ai-studio/${selectedSession}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "send-whatsapp",
                    itemId: sendTargetItem.id,
                    targetType,
                    jids: jidsToUse,
                    caption: sendCaption.trim(),
                    sendMode,
                    sendAt: sendMode === "schedule" ? sendAt : undefined,
                }),
            });
            const json = await res.json();
            if (json.status) {
                toast.success(json.message || "Enviado com sucesso!");
                setSendModalOpen(false);
            } else {
                toast.error(json.message || "Falha ao enviar para o WhatsApp.");
            }
        } catch {
            toast.error("Erro ao disparar mídia no WhatsApp.");
        } finally {
            setSendingWhatsapp(false);
        }
    };

    const filteredItems = items.filter((i) =>
        galleryFilter === "ALL" ? true : i.type === galleryFilter
    );

    return (
        <div className="space-y-6 pb-10">
            {/* Top Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-sm">
                            <Sparkles className="h-5 w-5" />
                        </div>
                        Estúdio Criativo IA (Gemini & Google Flow / Veo)
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Crie imagens de produtos, artes de ofertas e vídeos cinematográficos e publique direto no Status ou Grupos do WhatsApp.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Badge
                        variant={hasApiKey ? "default" : "destructive"}
                        className={
                            hasApiKey
                                ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 px-3 py-1"
                                : "px-3 py-1"
                        }
                    >
                        <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                        {hasApiKey ? `API Gemini Ativa (${maskedApiKey})` : "API Key Pendente"}
                    </Badge>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowColabModal(true)}
                        className="gap-1.5"
                    >
                        <span className={`h-2 w-2 rounded-full ${colabUrl ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {colabUrl ? "Colab GPU Conectado" : "Conectar Colab GPU"}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowKeyModal(true)}
                        className="gap-1.5"
                    >
                        <KeyRound className="h-4 w-4" />
                        {hasApiKey ? "Trocar Chave API" : "Configurar GEMINI_API_KEY"}
                    </Button>
                </div>
            </div>

            {/* Main Grid: Left Studio Controls + Right Live Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Creation Controls */}
                <Card className="lg:col-span-7 border-slate-200/80 shadow-sm">
                    <CardHeader className="pb-4 border-b bg-slate-50/50 dark:bg-slate-900/30">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                                <CardTitle className="text-base">Gerador Multimodal</CardTitle>
                                <CardDescription>
                                    Escolha entre fotografia/arte (Imagen & Gemini) ou vídeo em movimento (Veo / Flow)
                                </CardDescription>
                            </div>

                            {/* Mode Switcher */}
                            <div className="inline-flex rounded-xl bg-slate-200/80 dark:bg-slate-800 p-1">
                                <button
                                    type="button"
                                    onClick={() => setMode("image")}
                                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                        mode === "image"
                                            ? "bg-white dark:bg-slate-950 text-emerald-700 dark:text-emerald-400 shadow-sm"
                                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                                    }`}
                                >
                                    <ImageIcon className="h-4 w-4" />
                                    Gerar Imagem
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMode("video");
                                        if (aspectRatio === "1:1") setAspectRatio("9:16");
                                    }}
                                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                        mode === "video"
                                            ? "bg-white dark:bg-slate-950 text-purple-700 dark:text-purple-400 shadow-sm"
                                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                                    }`}
                                >
                                    <Video className="h-4 w-4" />
                                    Gerar Vídeo (Flow / Veo)
                                </button>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="pt-5 space-y-5">
                        {/* Prompt Box */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                    {mode === "image"
                                        ? "1. Descreva a Imagem ou Produto"
                                        : "1. Descreva a Cena e o Movimento do Vídeo"}
                                </Label>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={enhancing || !prompt.trim()}
                                    onClick={handleEnhancePrompt}
                                    className="h-7 text-xs gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                                >
                                    {enhancing ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Wand2 className="h-3.5 w-3.5" />
                                    )}
                                    ✨ Melhorar Prompt & Criar Legenda com IA
                                </Button>
                            </div>
                            <Textarea
                                rows={4}
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder={
                                    mode === "image"
                                        ? "Ex.: Fone de ouvido bluetooth branco sobre uma mesa moderna iluminada por neon suave, estética de anúncio de oferta do Mercado Livre..."
                                        : "Ex.: Mulher loira jovem em frente a uma loja apresentando novidade e gesticulando com sorriso natural..."
                                }
                                className="resize-none text-sm"
                            />
                        </div>

                        {/* Fala / Narração em Português + Voz Neural (Modo Vídeo) */}
                        {mode === "video" && (
                            <div className="space-y-3 p-3.5 rounded-xl border border-purple-500/25 bg-purple-500/5">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <Label className="text-xs font-semibold uppercase tracking-wider text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
                                        🎙️ Fala / Locução em Português & Áudio do Vídeo
                                    </Label>
                                    <select
                                        value={voiceId}
                                        onChange={(e) => setVoiceId(e.target.value)}
                                        className="h-8 rounded-lg border border-purple-300 dark:border-purple-800 bg-white dark:bg-slate-900 px-2.5 text-xs font-medium text-purple-900 dark:text-purple-200"
                                    >
                                        <option value="br_001">👩 Voz Feminina Natural (Vitória PT-BR + Trilha)</option>
                                        <option value="br_003">👱‍♀️ Voz Feminina Vibrante (Jovem Reels/Status + Trilha)</option>
                                        <option value="br_005">👨 Voz Masculina Comercial (Locutor PT-BR + Trilha)</option>
                                        <option value="none">🎵 Apenas Trilha Sonora Ambiente (Sem Fala)</option>
                                    </select>
                                </div>
                                {voiceId !== "none" && (
                                    <div className="space-y-1">
                                        <Textarea
                                            rows={2}
                                            value={speechText}
                                            onChange={(e) => setSpeechText(e.target.value)}
                                            placeholder="Digite o que será falado no vídeo em português (ex.: Olá! Venha conhecer as ofertas exclusivas da nossa loja hoje mesmo!). Se deixar em branco, a IA cria a fala automaticamente!"
                                            className="resize-none text-xs bg-white dark:bg-slate-950"
                                        />
                                        <p className="text-[11px] text-purple-700/80 dark:text-purple-300/80">
                                            ✨ O vídeo será gerado com <strong>movimento multi-ângulo coerente</strong> (personagem/cena mudando de pose e gesticulando), <strong>locução falada em português</strong> e <strong>trilha de áudio</strong>.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Style Presets */}
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                2. Estilo Visual (Preset)
                            </Label>
                            <div className="flex flex-wrap gap-1.5">
                                {STYLE_PRESETS.map((preset) => {
                                    const active = stylePreset === preset.value;
                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => setStylePreset(active ? "" : preset.value)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                                                active
                                                    ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                                                    : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300"
                                            }`}
                                        >
                                            {preset.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Format / Aspect Ratio + Model Selection */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                    3. Formato / Proporção
                                </Label>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setAspectRatio("9:16")}
                                        className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                                            aspectRatio === "9:16"
                                                ? "border-emerald-600 bg-emerald-50/70 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                                : "border-slate-200 hover:bg-slate-50 text-slate-600"
                                        }`}
                                    >
                                        <Smartphone className="h-4 w-4 mb-1" />
                                        <span>9:16</span>
                                        <span className="text-[10px] opacity-75">Status / Reels</span>
                                    </button>

                                    {mode === "image" && (
                                        <button
                                            type="button"
                                            onClick={() => setAspectRatio("1:1")}
                                            className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                                                aspectRatio === "1:1"
                                                    ? "border-emerald-600 bg-emerald-50/70 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                                    : "border-slate-200 hover:bg-slate-50 text-slate-600"
                                            }`}
                                        >
                                            <Square className="h-4 w-4 mb-1" />
                                            <span>1:1</span>
                                            <span className="text-[10px] opacity-75">Post / Grupo</span>
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => setAspectRatio("16:9")}
                                        className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                                            aspectRatio === "16:9"
                                                ? "border-emerald-600 bg-emerald-50/70 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                                : "border-slate-200 hover:bg-slate-50 text-slate-600"
                                        }`}
                                    >
                                        <Monitor className="h-4 w-4 mb-1" />
                                        <span>16:9</span>
                                        <span className="text-[10px] opacity-75">Horizontal</span>
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                
                                

                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                    4. Motor de Inteligência Artificial
                                </Label>
                                {mode === "image" ? (
                                    <select
                                        value={imageModel}
                                        onChange={(e) => setImageModel(e.target.value)}
                                        className="w-full h-10 rounded-lg border border-slate-200 bg-white dark:bg-slate-900 px-3 text-xs font-medium"
                                    >
                                        <option value="flux-1-ultra-hd">📸 Black Forest Labs FLUX.1 Ultra-HD (Fotográfico 8K)</option>
                                        <option value="auto">⚡ Automático (Gemini Flash Image + FLUX.1)</option>
                                        <option value="gemini-2.5-flash-image">🎨 Gemini 2.5 Flash Image (Nano Banana)</option>
                                        <option value="gemini-3.1-flash-image">🚀 Gemini 3.1 Flash Image (Nano Banana 2)</option>
                                    </select>
                                ) : (
                                    <select
                                        value={videoModel}
                                        onChange={(e) => setVideoModel(e.target.value)}
                                        className="w-full h-10 rounded-lg border border-slate-200 bg-white dark:bg-slate-900 px-3 text-xs font-medium"
                                    >
                                        <option value="minimax-h3-turbo">⚡ Automático (Colab GPU → Nuvem Grátis → Veo)</option>
                                        <option value="colab-wan">🔥 Google Colab GPU (Wan 2.1 / A100-L4)</option>
                                        <option value="veo-3.0-fast-generate-001">🚀 Google Veo 3.0 Fast (Oficial / Créditos)</option>
                                        <option value="veo-3.0-generate-001">🎬 Google Veo 3.0 Cinema Ultra-HD</option>
                                        <option value="veo-2.0-generate-001">🎬 Google Veo 2.0 (Vídeo Real Oficial)</option>
                                        <option value="cinematic-multiscene">🎞️ Cinematográfico Rápido (Transições & Trilha)</option>
                                    </select>
                                )}
                                <p className="text-[11px] text-muted-foreground">
                                    {mode === "image"
                                        ? "O modo Automático escolhe o melhor modelo disponível na sua conta Gemini."
                                        : "Geração de vídeo com movimento contínuo de pessoas e câmera (leva cerca de 45 a 80s na nuvem com 0% uso de RAM do celular)."}
                                </p>
                            </div>
                        </div>

                        {/* Reference Image (Product Photo or Image-to-Video) */}
                        <div className="space-y-2 pt-1">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                {mode === "image"
                                    ? "5. Foto de Referência do Produto (Opcional - Trocar Cenário)"
                                    : "5. Imagem Base para Animar em Vídeo (Opcional - Image-to-Video)"}
                            </Label>

                            {referenceImagePreview ? (
                                <div className="flex items-center gap-3 p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
                                    <img
                                        src={referenceImagePreview}
                                        alt="Referência"
                                        className="h-14 w-14 rounded-lg object-cover border"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                                            {sourceGalleryFilename
                                                ? `Da galeria: ${sourceGalleryFilename}`
                                                : "Foto de referência carregada"}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground truncate">
                                            {mode === "image"
                                                ? "O Gemini usará esta foto como base para criar o novo anúncio."
                                                : "O Google Veo / Flow dará movimento cinematográfico a esta imagem."}
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={clearReferenceImage}
                                        className="h-8 w-8 text-slate-500 hover:text-red-600"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        onChange={handleUploadReferenceImage}
                                        className="hidden"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="text-xs gap-2"
                                    >
                                        <Upload className="h-3.5 w-3.5" />
                                        Enviar Foto do Produto / Imagem Base
                                    </Button>
                                    <span className="text-[11px] text-muted-foreground">
                                        {mode === "video"
                                            ? "Ou clique em 'Animar em Vídeo' em qualquer imagem da galeria abaixo"
                                            : "Ideal para colocar fotos reais de produtos em cenários profissionais"}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Optional Caption */}
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                                6. Legenda para WhatsApp (Opcional)
                            </Label>
                            <Textarea
                                rows={2}
                                value={caption}
                                onChange={(e) => setCaption(e.target.value)}
                                placeholder="Legenda que acompanhará a foto/vídeo no Status ou Grupo (ex.: 🔥 Oferta Imperdível hoje! Garanta no link: https://meli.la/...)"
                                className="resize-none text-xs"
                            />
                        </div>

                        {/* Generate CTA */}
                        <Button
                            type="button"
                            disabled={generating}
                            onClick={handleGenerate}
                            className={`w-full h-11 text-sm font-semibold shadow-md transition-all cursor-pointer ${
                                mode === "video"
                                    ? "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
                                    : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
                            }`}
                        >
                            {generating ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    {mode === "video"
                                        ? "Renderizando Vídeo no Google Veo / Flow (pode levar ~1 min)..."
                                        : "Gerando Imagem em Alta Definição..."}
                                </>
                            ) : mode === "video" ? (
                                <>
                                    <Film className="h-4 w-4 mr-2" />
                                    Gerar Vídeo (Google Veo / Flow)
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4 mr-2" />
                                    Gerar Imagem com IA
                                </>
                            )}
                        </Button>
                    </CardContent>
                </Card>

                {/* Right Column: Live Stage Preview */}
                <Card className="lg:col-span-5 border-slate-200/80 shadow-sm flex flex-col">
                    <CardHeader className="pb-3 border-b bg-slate-50/50 dark:bg-slate-900/30">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base">Palco de Visualização</CardTitle>
                                <CardDescription>
                                    Prévia da criação selecionada e disparo rápido
                                </CardDescription>
                            </div>
                            {activePreview && (
                                <Badge variant="outline" className="text-[11px] uppercase">
                                    {activePreview.type === "video" ? "🎬 Vídeo MP4" : "🖼️ Imagem PNG"} •{" "}
                                    {activePreview.aspectRatio}
                                </Badge>
                            )}
                        </div>
                    </CardHeader>

                    <CardContent className="flex-1 flex flex-col justify-between p-4 gap-4">
                        {activePreview ? (
                            <>
                                <div className="relative rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center min-h-[320px] max-h-[440px] border border-slate-800">
                                    {activePreview.type === "video" ? (
                                        <video
                                            key={activePreview.url}
                                            src={activePreview.url}
                                            controls
                                            autoPlay
                                            loop
                                            playsInline
                                            className="max-h-[420px] w-auto object-contain"
                                        />
                                    ) : (
                                        <img
                                            src={activePreview.url}
                                            alt={activePreview.prompt}
                                            className="max-h-[420px] w-auto object-contain"
                                        />
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border text-xs space-y-1">
                                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                            <span>Modelo: {activePreview.model}</span>
                                            <span>
                                                {new Date(activePreview.createdAt).toLocaleString("pt-BR")}
                                            </span>
                                        </div>
                                        <p className="font-medium text-slate-800 dark:text-slate-200 line-clamp-2">
                                            {activePreview.prompt}
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            type="button"
                                            onClick={() => openSendModal(activePreview)}
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-xs font-semibold col-span-2 h-10"
                                        >
                                            <Send className="h-4 w-4" />
                                            Publicar / Agendar no WhatsApp (Status ou Grupos)
                                        </Button>

                                        {activePreview.type === "image" && (
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={() => handleAnimateFromGallery(activePreview)}
                                                className="gap-1.5 text-xs bg-purple-600/10 hover:bg-purple-600/20 text-purple-700 dark:text-purple-300 border border-purple-500/20"
                                            >
                                                <Film className="h-3.5 w-3.5" />
                                                Animar em Vídeo (Flow)
                                            </Button>
                                        )}

                                        <a
                                            href={activePreview.url}
                                            download={activePreview.filename}
                                            className={activePreview.type === "image" ? "" : "col-span-2"}
                                        >
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="w-full gap-1.5 text-xs"
                                            >
                                                <Download className="h-3.5 w-3.5" />
                                                Baixar {activePreview.type === "video" ? "MP4" : "PNG"}
                                            </Button>
                                        </a>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-xl border-slate-200 dark:border-slate-800">
                                <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3">
                                    <Sparkles className="h-6 w-6" />
                                </div>
                                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    Nenhuma mídia selecionada
                                </p>
                                <p className="text-xs text-muted-foreground max-w-xs mt-1">
                                    Use o painel ao lado para gerar sua primeira imagem ou vídeo com a Inteligência Artificial do Google Gemini / Flow.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Gallery Section */}
            <Card className="border-slate-200/80 shadow-sm">
                <CardHeader className="pb-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <CardTitle className="text-base">Galeria de Criações ({filteredItems.length})</CardTitle>
                        <CardDescription>
                            Histórico salvo localmente no servidor pronto para repostar ou agendar
                        </CardDescription>
                    </div>

                    <div className="flex items-center gap-1.5">
                        {(["ALL", "image", "video"] as const).map((f) => (
                            <Button
                                key={f}
                                type="button"
                                size="sm"
                                variant={galleryFilter === f ? "default" : "outline"}
                                onClick={() => setGalleryFilter(f)}
                                className="h-8 text-xs"
                            >
                                {f === "ALL"
                                    ? "Todos"
                                    : f === "image"
                                    ? "🖼️ Imagens"
                                    : "🎬 Vídeos"}
                            </Button>
                        ))}
                    </div>
                </CardHeader>

                <CardContent className="pt-5">
                    {loadingGallery ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Carregando galeria...
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground text-sm">
                            Nenhuma criação encontrada neste filtro.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {filteredItems.map((item) => {
                                const isSelected = activePreview?.id === item.id;
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => setActivePreview(item)}
                                        className={`group rounded-xl border overflow-hidden bg-white dark:bg-slate-900 transition-all cursor-pointer flex flex-col justify-between ${
                                            isSelected
                                                ? "ring-2 ring-emerald-500 border-emerald-500"
                                                : "hover:border-slate-300 shadow-xs"
                                        }`}
                                    >
                                        <div>
                                            <div className="relative h-48 bg-slate-950 flex items-center justify-center overflow-hidden">
                                                {item.type === "video" ? (
                                                    <>
                                                        <video
                                                            src={item.url}
                                                            muted
                                                            loop
                                                            playsInline
                                                            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                                                            onMouseLeave={(e) => e.currentTarget.pause()}
                                                            className="h-full w-full object-cover"
                                                        />
                                                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-purple-600/90 text-white text-[10px] font-semibold flex items-center gap-1">
                                                            <Play className="h-3 w-3 fill-current" />
                                                            VÍDEO
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <img
                                                            src={item.url}
                                                            alt={item.prompt}
                                                            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                        />
                                                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-emerald-600/90 text-white text-[10px] font-semibold">
                                                            IMAGEM
                                                        </div>
                                                    </>
                                                )}
                                                <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
                                                    {item.aspectRatio}
                                                </div>
                                            </div>

                                            <div className="p-3">
                                                <p className="text-xs font-medium text-slate-800 dark:text-slate-200 line-clamp-2">
                                                    {item.prompt}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    {new Date(item.createdAt).toLocaleString("pt-BR")}
                                                </p>
                                            </div>
                                        </div>

                                        <div
                                            className="px-3 pb-3 pt-1 flex items-center gap-1.5"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => openSendModal(item)}
                                                className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                                            >
                                                <Send className="h-3 w-3" />
                                                WhatsApp
                                            </Button>

                                            {item.type === "image" && (
                                                <Button
                                                    type="button"
                                                    size="icon"
                                                    variant="outline"
                                                    title="Animar esta imagem em Vídeo (Google Flow / Veo)"
                                                    onClick={() => handleAnimateFromGallery(item)}
                                                    className="h-8 w-8 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                                >
                                                    <Film className="h-3.5 w-3.5" />
                                                </Button>
                                            )}

                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="ghost"
                                                title="Excluir da galeria"
                                                onClick={() => handleDeleteItem(item.id)}
                                                className="h-8 w-8 text-slate-400 hover:text-red-600"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Modal 1: Configure Gemini API Key */}
            <Dialog open={showKeyModal} onOpenChange={setShowKeyModal}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <KeyRound className="h-5 w-5 text-emerald-600" />
                            Configurar Chave Google Gemini / Flow
                        </DialogTitle>
                        <DialogDescription>
                            Insira sua chave <code>GEMINI_API_KEY</code> gerada no{" "}
                            <a
                                href="https://aistudio.google.com/apikey"
                                target="_blank"
                                rel="noreferrer"
                                className="underline text-emerald-600 font-medium"
                            >
                                Google AI Studio
                            </a>
                            . Ela será salva na configuração desta sessão e usada para gerar imagens, vídeos e legendas.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 py-2">
                        <Label className="text-xs font-semibold">Chave da API (AIzaSy...)</Label>
                        <Input
                            type="password"
                            placeholder="AIzaSy..."
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                        />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowKeyModal(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSaveApiKey}
                            disabled={savingKey}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                            {savingKey ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                            Salvar Chave API
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal 1B: Conectar Google Colab GPU (A100 / L4 / T4) */}
            <Dialog open={showColabModal} onOpenChange={setShowColabModal}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Video className="h-5 w-5 text-purple-600" />
                            Conectar Google Colab GPU (Wan 2.1 / A100)
                        </DialogTitle>
                        <DialogDescription>
                            Use a GPU <strong>A100 / L4 / T4</strong> do seu Google Colab para gerar vídeos cinematográficos reais com <strong>Wan 2.1</strong> e conectar direto no MarcFlow.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-3 space-y-2">
                            <p className="text-xs font-semibold">Passo 1: Copie e rode este código em uma célula do Google Colab (com GPU A100/L4):</p>
                            <textarea
                                id="colab-cell-script-box"
                                readOnly
                                value={colabCellScript}
                                rows={4}
                                onFocus={(e) => e.currentTarget.select()}
                                className="w-full rounded-md border bg-white dark:bg-slate-950 p-2 font-mono text-[10px] text-slate-700 dark:text-slate-300 resize-none"
                            />
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="w-full"
                                onClick={async () => {
                                    const box = document.getElementById("colab-cell-script-box") as HTMLTextAreaElement | null;
                                    let copied = false;
                                    try {
                                        if (navigator.clipboard?.writeText) {
                                            await navigator.clipboard.writeText(colabCellScript);
                                            copied = true;
                                        }
                                    } catch {}
                                    if (!copied && box) {
                                        box.focus();
                                        box.select();
                                        box.setSelectionRange(0, colabCellScript.length);
                                        try {
                                            copied = document.execCommand("copy");
                                        } catch {}
                                    }
                                    if (copied) {
                                        toast.success("Código do Colab copiado! Cole em uma célula do Colab e execute.");
                                    } else {
                                        toast.info("Selecione o código na caixa acima e pressione Ctrl+C para copiar.");
                                    }
                                }}
                            >
                                Copiar Código da Célula do Colab
                            </Button>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Passo 2: Cole o link gerado pelo Colab (trycloudflare.com)</Label>
                            <Input
                                type="url"
                                placeholder="https://xxxx-xxxx.trycloudflare.com"
                                value={colabUrlInput}
                                onChange={(e) => setColabUrlInput(e.target.value)}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowColabModal(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSaveColabUrl}
                            disabled={savingColab}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                        >
                            {savingColab ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                            Salvar Conexão Colab
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal 2: Publish / Schedule to WhatsApp (Status, Groups, Contacts) */}
            <Dialog open={sendModalOpen} onOpenChange={setSendModalOpen}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Send className="h-5 w-5 text-emerald-600" />
                            Publicar ou Agendar no WhatsApp
                        </DialogTitle>
                        <DialogDescription>
                            Envie a mídia gerada diretamente para o seu Status (Stories), Grupos de Ofertas ou Contatos.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {/* Target Type Selector */}
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase text-slate-600">
                                1. Onde deseja publicar?
                            </Label>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTargetType("status");
                                        setSelectedJids([]);
                                    }}
                                    className={`flex flex-col items-center p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                                        targetType === "status"
                                            ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                            : "border-slate-200 hover:bg-slate-50 text-slate-600"
                                    }`}
                                >
                                    <Radio className="h-4 w-4 mb-1" />
                                    Status (Stories)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTargetType("groups");
                                        setSelectedJids([]);
                                    }}
                                    className={`flex flex-col items-center p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                                        targetType === "groups"
                                            ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                            : "border-slate-200 hover:bg-slate-50 text-slate-600"
                                    }`}
                                >
                                    <Users className="h-4 w-4 mb-1" />
                                    Grupos ({groups.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTargetType("contacts");
                                        setSelectedJids([]);
                                    }}
                                    className={`flex flex-col items-center p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                                        targetType === "contacts"
                                            ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                            : "border-slate-200 hover:bg-slate-50 text-slate-600"
                                    }`}
                                >
                                    <UserCheck className="h-4 w-4 mb-1" />
                                    Contatos
                                </button>
                            </div>
                        </div>

                        {/* Group or Contact Picker */}
                        {targetType === "groups" && (
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Selecione os Grupos:</Label>
                                <div className="max-h-36 overflow-y-auto border rounded-lg p-2 space-y-1">
                                    {groups.length === 0 ? (
                                        <p className="text-xs text-muted-foreground p-2">Nenhum grupo sincronizado.</p>
                                    ) : (
                                        groups.map((g) => {
                                            const checked = selectedJids.includes(g.id);
                                            return (
                                                <div
                                                    key={g.id}
                                                    onClick={() => toggleJidSelection(g.id)}
                                                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${
                                                        checked
                                                            ? "bg-emerald-50 text-emerald-900 font-medium"
                                                            : "hover:bg-slate-50"
                                                    }`}
                                                >
                                                    <span className="truncate">{g.subject}</span>
                                                    {checked && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}

                        {targetType === "contacts" && (
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold">Digite um número (com DDD) ou selecione:</Label>
                                <Input
                                    placeholder="Ex.: 5511999999999"
                                    value={manualJid}
                                    onChange={(e) => setManualJid(e.target.value)}
                                    className="text-xs h-9"
                                />
                                {contacts.length > 0 && (
                                    <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1">
                                        {contacts.slice(0, 40).map((c) => {
                                            const checked = selectedJids.includes(c.jid);
                                            const label = c.name || c.notify || c.jid.split("@")[0];
                                            return (
                                                <div
                                                    key={c.jid}
                                                    onClick={() => toggleJidSelection(c.jid)}
                                                    className={`flex items-center justify-between px-2.5 py-1 rounded-md text-xs cursor-pointer ${
                                                        checked
                                                            ? "bg-emerald-50 text-emerald-900 font-medium"
                                                            : "hover:bg-slate-50"
                                                    }`}
                                                >
                                                    <span className="truncate">{label}</span>
                                                    {checked && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Caption + Quick Affiliate Link Insertion */}
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold uppercase text-slate-600">
                                2. Legenda da Publicação
                            </Label>
                            <Textarea
                                rows={3}
                                value={sendCaption}
                                onChange={(e) => setSendCaption(e.target.value)}
                                placeholder="Digite a legenda ou insira um link de afiliado abaixo..."
                                className="text-xs resize-none"
                            />

                            {recentAffiliates.length > 0 && (
                                <div className="pt-1">
                                    <p className="text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
                                        <ShoppingBag className="h-3 w-3" />
                                        Inserir link de afiliado recente na legenda:
                                    </p>
                                    <div className="flex flex-wrap gap-1">
                                        {recentAffiliates.slice(0, 4).map((aff) => (
                                            <button
                                                key={aff.id}
                                                type="button"
                                                onClick={() => {
                                                    if (!aff.shortUrl) return;
                                                    const block = `${aff.productTitle ? `🔥 *${aff.productTitle}*\n` : ""}🛒 Confira aqui: ${aff.shortUrl}`;
                                                    setSendCaption((prev) =>
                                                        prev ? `${prev}\n\n${block}` : block
                                                    );
                                                }}
                                                className="px-2 py-1 rounded border text-[10px] bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 truncate max-w-[210px] cursor-pointer"
                                            >
                                                + {aff.productTitle || aff.shortUrl}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Send Now vs Schedule */}
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-slate-600">
                                3. Quando enviar?
                            </Label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSendMode("now")}
                                    className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                                        sendMode === "now"
                                            ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                                            : "border-slate-200 text-slate-600"
                                    }`}
                                >
                                    <Send className="h-3.5 w-3.5" />
                                    Publicar Agora
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSendMode("schedule")}
                                    className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                                        sendMode === "schedule"
                                            ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                                            : "border-slate-200 text-slate-600"
                                    }`}
                                >
                                    <CalendarClock className="h-3.5 w-3.5" />
                                    Agendar Horário
                                </button>
                            </div>

                            {sendMode === "schedule" && (
                                <div className="pt-1">
                                    <Input
                                        type="datetime-local"
                                        value={sendAt}
                                        onChange={(e) => setSendAt(e.target.value)}
                                        className="text-xs"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSendModalOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSendToWhatsapp}
                            disabled={sendingWhatsapp}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                        >
                            {sendingWhatsapp ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : sendMode === "schedule" ? (
                                <CalendarClock className="h-4 w-4" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                            {sendMode === "schedule" ? "Confirmar Agendamento" : "Publicar Agora"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Floating AI Servers Status Pill (Bottom-Right) */}
            <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
                {providersOpen && (
                    <Card className="w-80 max-w-[calc(100vw-2rem)] shadow-2xl border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
                        <CardHeader className="py-2.5 px-3 border-b flex flex-row items-center justify-between space-y-0">
                            <div>
                                <CardTitle className="text-xs font-bold flex items-center gap-1.5">
                                    <Radio className="h-3.5 w-3.5 text-emerald-500" />
                                    Status dos Motores de IA
                                </CardTitle>
                                <CardDescription className="text-[10px]">
                                    Disponibilidade e créditos em tempo real
                                </CardDescription>
                            </div>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => selectedSession && fetchProviderStatus(selectedSession)}
                                disabled={loadingProviders}
                            >
                                {loadingProviders ? <Loader2 className="h-3 w-3 animate-spin" /> : "Atualizar"}
                            </Button>
                        </CardHeader>
                        <CardContent className="p-2.5 space-y-2 max-h-72 overflow-y-auto">
                            {providers.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground text-center py-3">
                                    {loadingProviders ? "Verificando servidores..." : "Selecione uma sessão para verificar."}
                                </p>
                            ) : (
                                providers.map((p) => {
                                    const dotClass =
                                        p.status === "online"
                                            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                                            : p.status === "limited"
                                            ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]"
                                            : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]";
                                    const badgeText =
                                        p.status === "online"
                                            ? "Com Crédito / OK"
                                            : p.status === "limited"
                                            ? "Limitado"
                                            : p.status === "exhausted"
                                            ? "Sem Cota / Crédito"
                                            : "Offline";

                                    return (
                                        <div
                                            key={p.id}
                                            className="flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
                                        >
                                            <div className="flex items-start gap-2 min-w-0">
                                                <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${dotClass}`} />
                                                <div className="min-w-0">
                                                    <div className="text-[11px] font-semibold truncate">{p.name}</div>
                                                    <div className="text-[10px] text-muted-foreground leading-tight break-words">
                                                        {p.detail}
                                                    </div>
                                                </div>
                                            </div>
                                            <Badge
                                                variant="outline"
                                                className={`text-[9px] px-1.5 py-0 h-4 shrink-0 ${
                                                    p.status === "online"
                                                        ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                                                        : p.status === "limited"
                                                        ? "border-amber-300 text-amber-700 bg-amber-50"
                                                        : "border-red-300 text-red-700 bg-red-50"
                                                }`}
                                            >
                                                {badgeText}
                                            </Badge>
                                        </div>
                                    );
                                })
                            )}
                        </CardContent>
                    </Card>
                )}

                {(() => {
                    const videoOnlineCount = providers.filter((p) => p.category === "video" && p.status === "online").length;
                    const totalOnlineCount = providers.filter((p) => p.status === "online").length;
                    const dotColor =
                        providers.length === 0
                            ? "bg-slate-400"
                            : videoOnlineCount > 0
                            ? "bg-emerald-500 animate-pulse"
                            : totalOnlineCount > 0
                            ? "bg-amber-500"
                            : "bg-red-500";
                    return (
                        <button
                            type="button"
                            onClick={() => setProvidersOpen((v) => !v)}
                            className="flex items-center gap-2 px-3 py-2 rounded-full bg-slate-900/90 dark:bg-slate-800/95 text-white shadow-lg border border-slate-700/80 hover:bg-slate-800 transition-all text-xs font-medium backdrop-blur"
                        >
                            <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
                            <span>
                                {providers.length === 0
                                    ? "Motores IA"
                                    : videoOnlineCount > 0
                                    ? `Vídeo IA Ativo (${totalOnlineCount}/${providers.length})`
                                    : `Sem Cota de Vídeo (${totalOnlineCount}/${providers.length})`}
                            </span>
                        </button>
                    );
                })()}
            </div>
        </div>
    );
}
