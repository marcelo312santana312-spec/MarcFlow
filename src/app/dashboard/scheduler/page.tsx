"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
    Trash2, Plus, CalendarClock, RefreshCw, Pencil, CheckCircle2, XCircle,
    Send, Copy, Upload, Paperclip, Users, User, UserPlus, Clock, FileText, Image, Film, Mic, Sparkles, X, Search, ChevronDown, ChevronUp, Tag, FolderKanban,
    FileSpreadsheet, Download, ShieldCheck, AlertTriangle, Info, Check, Repeat, BellRing, UserCheck, CheckSquare, Square,
    Workflow, GitBranch, Radio, History
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import moment from "moment-timezone";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";

interface ScheduledMessage {
    id: string;
    jid: string;
    content: string | null;
    sendAt: string;
    status: string;
    mediaUrl?: string;
    mediaType?: string;
    cronExpression?: string;
    recurrenceRule?: string;
    groupId?: string | null;
    notifyJid?: string | null;
    createdAt?: string;
}

interface ContactItem {
    jid: string;
    name?: string;
    notify?: string;
}

interface GroupItem {
    jid: string;
    subject?: string;
}

const TEMPLATE_VARS = [
    { tag: "{primeiro-nome}", label: "Primeiro Nome" },
    { tag: "{nome}", label: "Nome Completo" },
    { tag: "{telefone}", label: "Telefone" },
    { tag: "{data}", label: "Data Atual" },
    { tag: "{hora}", label: "Hora Atual" },
    { tag: "{dia-semana}", label: "Dia da Semana" },
];

export default function SchedulerPage() {
    const { sessionId: selectedSessionId } = useSession();

    const [messages, setMessages] = useState<ScheduledMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [systemTimezone, setSystemTimezone] = useState("America/Sao_Paulo");
    const [activeTab, setActiveTab] = useState("pending");

    // Contacts and Groups
    const [contacts, setContacts] = useState<ContactItem[]>([]);
    const [groups, setGroups] = useState<GroupItem[]>([]);

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [destinationMode, setDestinationMode] = useState<"contact" | "multi_contact" | "group" | "status" | "manual">("manual");
    const [newJid, setNewJid] = useState("");
    const [newContent, setNewContent] = useState("");
    const [newSendAt, setNewSendAt] = useState("");
    const [newSendTime, setNewSendTime] = useState("09:00");
    const [newMediaUrl, setNewMediaUrl] = useState("");
    const [newMediaType, setNewMediaType] = useState("image");
    const [newMediaFileName, setNewMediaFileName] = useState("");
    const [uploadingMedia, setUploadingMedia] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Searchable Contact & Group pickers
    const [contactSearch, setContactSearch] = useState("");
    const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);
    const [groupSearch, setGroupSearch] = useState("");
    const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
    const contactDropdownRef = useRef<HTMLDivElement>(null);
    const groupDropdownRef = useRef<HTMLDivElement>(null);

    // Multi-contact and Manager Notification states
    const [selectedMultiJids, setSelectedMultiJids] = useState<string[]>([]);
    const [multiContactSearch, setMultiContactSearch] = useState("");
    const [groupDescription, setGroupDescription] = useState("");
    const [notifyManager, setNotifyManager] = useState(false);
    const [notifyManagerJid, setNotifyManagerJid] = useState("");
    const [notifyManagerSearch, setNotifyManagerSearch] = useState("");
    const [isNotifyDropdownOpen, setIsNotifyDropdownOpen] = useState(false);
    const notifyDropdownRef = useRef<HTMLDivElement>(null);

    // Group collapse and batch action states
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [sendingNowGroupId, setSendingNowGroupId] = useState<string | null>(null);
    const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);

    // Add Members to Existing Group states
    const [isAddMembersOpen, setIsAddMembersOpen] = useState(false);
    const [targetAddGroup, setTargetAddGroup] = useState<{ groupId: string; groupName: string; messages: ScheduledMessage[]; firstMsg: ScheduledMessage; total: number } | null>(null);
    const [selectedAddJids, setSelectedAddJids] = useState<string[]>([]);
    const [addContactSearch, setAddContactSearch] = useState("");
    const [isAddingMembers, setIsAddingMembers] = useState(false);

    // Flow Trigger states
    const [availableFlows, setAvailableFlows] = useState<Array<{ id: string; name: string; status: string; publishedAt: string | null }>>([]);
    const [scheduleActionType, setScheduleActionType] = useState<"text" | "flow">("text");
    const [selectedFlowId, setSelectedFlowId] = useState("");

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (contactDropdownRef.current && !contactDropdownRef.current.contains(e.target as Node)) {
                setIsContactDropdownOpen(false);
            }
            if (groupDropdownRef.current && !groupDropdownRef.current.contains(e.target as Node)) {
                setIsGroupDropdownOpen(false);
            }
            if (notifyDropdownRef.current && !notifyDropdownRef.current.contains(e.target as Node)) {
                setIsNotifyDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Recurrence State for Create
    const [isRecurring, setIsRecurring] = useState("once");
    const [recurrenceType, setRecurrenceType] = useState("days");
    const [recurringMinutes, setRecurringMinutes] = useState(15);
    const [recurringHours, setRecurringHours] = useState(1);
    const [recurringDays, setRecurringDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [customCron, setCustomCron] = useState("");

    // Delete state
    const [deleteId, setDeleteId] = useState<string | null>(null);

    // Sending now state
    const [sendingNowId, setSendingNowId] = useState<string | null>(null);

    // Edit state
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editIsGroupMode, setEditIsGroupMode] = useState(false);
    const [editGroupName, setEditGroupName] = useState("");
    const [editGroupTotal, setEditGroupTotal] = useState(0);
    const [editDestinationMode, setEditDestinationMode] = useState<"contact" | "group" | "status" | "manual">("manual");
    const [editJid, setEditJid] = useState("");
    const [editContent, setEditContent] = useState("");
    const [editSendAt, setEditSendAt] = useState("");
    const [editSendTime, setEditSendTime] = useState("");
    const [editMediaUrl, setEditMediaUrl] = useState("");
    const [editMediaType, setEditMediaType] = useState("image");
    const [editIsRecurring, setEditIsRecurring] = useState("once");
    const [editRecurrenceType, setEditRecurrenceType] = useState("days");
    const [editRecurringMinutes, setEditRecurringMinutes] = useState(15);
    const [editRecurringHours, setEditRecurringHours] = useState(1);
    const [editRecurringDays, setEditRecurringDays] = useState<number[]>([]);
    const [editCustomCron, setEditCustomCron] = useState("");

    // Import in bulk states
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importBaseDate, setImportBaseDate] = useState("");
    const [importDelaySeconds, setImportDelaySeconds] = useState(30);
    const [importDefaultMessage, setImportDefaultMessage] = useState("Olá {primeiro-nome}, passando para te avisar sobre o nosso encontro!");
    const [importMediaUrl, setImportMediaUrl] = useState("");
    const [importMediaType, setImportMediaType] = useState("image");
    const [importMediaFileName, setImportMediaFileName] = useState("");
    const [uploadingImportMedia, setUploadingImportMedia] = useState(false);
    const [isProcessingImport, setIsProcessingImport] = useState(false);
    const [importIsRecurring, setImportIsRecurring] = useState("once");
    const [importRecurrenceType, setImportRecurrenceType] = useState("days");
    const [importRecurringDays, setImportRecurringDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [importSendTime, setImportSendTime] = useState("09:00");
    const [importPreview, setImportPreview] = useState<Array<{ phone: string; name: string; previewText: string; time: string; recurrence?: string; valid: boolean }>>([]);
    const [importSummary, setImportSummary] = useState<{ total: number; valid: number; invalid: number }>({ total: 0, valid: 0, invalid: 0 });
    const importFileInputRef = useRef<HTMLInputElement>(null);
    const importMediaInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetch('/api/settings/system')
            .then(res => res.json())
            .then(data => {
                if (data.status && data.data?.timezone) {
                    setSystemTimezone(data.data.timezone);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (selectedSessionId) {
            fetchMessages(selectedSessionId, activeTab);
            fetchContactsAndGroups(selectedSessionId);
        } else {
            setMessages([]);
            setContacts([]);
            setGroups([]);
            setAvailableFlows([]);
        }
    }, [selectedSessionId, activeTab]);

    const fetchContactsAndGroups = async (sessionId: string) => {
        try {
            const [cRes, gRes, fRes] = await Promise.all([
                fetch(`/api/contacts/${sessionId}?limit=all`).then(r => r.ok ? r.json() : null),
                fetch(`/api/groups/${sessionId}`).then(r => r.ok ? r.json() : null),
                fetch(`/api/flows/${sessionId}`).then(r => r.ok ? r.json() : null),
            ]);
            if (cRes?.data) setContacts(Array.isArray(cRes.data) ? cRes.data : cRes.data.contacts || []);
            if (gRes?.data) setGroups(Array.isArray(gRes.data) ? gRes.data : []);
            if (fRes?.data) setAvailableFlows(Array.isArray(fRes.data) ? fRes.data : []);
        } catch { }
    };

    const fetchMessages = async (sessionId: string, tab: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/scheduler/${sessionId}?tab=${tab}`);
            if (res.ok) {
                const data = await res.json();
                setMessages(data?.data || []);
            } else {
                setMessages([]);
            }
        } catch (error) {
            toast.error("Falha ao carregar as mensagens agendadas");
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, isEditMode = false) => {
        const file = e.target.files?.[0];
        if (!file || !selectedSessionId) return;

        setUploadingMedia(true);
        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch(`/api/scheduler/${selectedSessionId}/upload`, {
                method: "POST",
                body: formData,
            });

            const data = await res.json();
            if (data.status && data.data?.mediaUrl) {
                if (isEditMode) {
                    setEditMediaUrl(data.data.mediaUrl);
                    setEditMediaType(data.data.mediaType);
                } else {
                    setNewMediaUrl(data.data.mediaUrl);
                    setNewMediaType(data.data.mediaType);
                    setNewMediaFileName(data.data.fileName);
                }
                toast.success(`Arquivo "${file.name}" anexado com sucesso!`);
            } else {
                toast.error(data.message || "Erro no envio do arquivo");
            }
        } catch {
            toast.error("Erro ao enviar o arquivo");
        } finally {
            setUploadingMedia(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const insertVariable = (tag: string, isEdit = false) => {
        if (isEdit) {
            setEditContent(prev => prev + " " + tag);
        } else {
            setNewContent(prev => prev + " " + tag);
        }
    };

    const downloadTemplate = () => {
        try {
            const wb = XLSX.utils.book_new();
            const sampleData = [
                {
                    "Telefone": "11999991111",
                    "Nome": "Maria Silva",
                    "Recorrente": "Diário",
                    "Horario": "09:00",
                    "Mensagem": "Olá {primeiro-nome}, lembrete diário do seu compromisso!",
                    "DataEnvio": ""
                },
                {
                    "Telefone": "11988882222",
                    "Nome": "João Santos",
                    "Recorrente": "Seg a Sex",
                    "Horario": "14:30",
                    "Mensagem": "Olá {primeiro-nome}, passando para conferir as tarefas do dia útil!",
                    "DataEnvio": ""
                },
                {
                    "Telefone": "11977773333",
                    "Nome": "Carlos Oliveira",
                    "Recorrente": "Toda Terça",
                    "Horario": "19:00",
                    "Mensagem": "Olá {primeiro-nome}, nosso encontro semanal é hoje!",
                    "DataEnvio": ""
                },
                {
                    "Telefone": "21966664444",
                    "Nome": "Ana Paula",
                    "Recorrente": "Não",
                    "Horario": "",
                    "Mensagem": "Olá {primeiro-nome}, aviso importante de disparo único!",
                    "DataEnvio": moment().tz(systemTimezone).add(2, 'hour').format('YYYY-MM-DD HH:mm')
                }
            ];
            const ws = XLSX.utils.json_to_sheet(sampleData);
            XLSX.utils.book_append_sheet(wb, ws, "Contatos");
            XLSX.writeFile(wb, "modelo_agendamento_com_recorrencia.xlsx");
            toast.success("Planilha modelo com coluna de Recorrência baixada!");
        } catch {
            toast.error("Erro ao gerar o modelo de planilha.");
        }
    };

    const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportFile(file);

        try {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
            const sheetName = wb.SheetNames[0];
            if (!sheetName) {
                toast.error("A planilha está vazia.");
                return;
            }
            const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sheetName], { defval: "" });

            let valid = 0;
            let invalid = 0;
            const previewList: Array<{ phone: string; name: string; previewText: string; time: string; recurrence: string; valid: boolean }> = [];

            const baseMoment = importBaseDate ? moment.tz(importBaseDate, systemTimezone) : moment().tz(systemTimezone).add(5, "minutes");

            rows.forEach((row, idx) => {
                let rawPhone = "";
                let rawName = "";
                let rawMsg = "";
                let rawRec = "";
                let rawTime = "";
                let rawDate = "";

                for (const [k, v] of Object.entries(row)) {
                    const norm = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
                    if (norm.includes("telefone") || norm.includes("numero") || norm.includes("whatsapp") || norm.includes("phone") || norm.includes("celular")) {
                        rawPhone = String(v);
                    } else if (norm.includes("nome") || norm.includes("name") || norm.includes("cliente")) {
                        rawName = String(v);
                    } else if (norm.includes("mensagem") || norm.includes("texto") || norm.includes("message")) {
                        rawMsg = String(v);
                    } else if (norm.includes("recorren") || norm.includes("frequencia") || norm.includes("repetir") || norm.includes("tipo")) {
                        rawRec = String(v);
                    } else if (norm.includes("horario") || norm.includes("hora") || norm.includes("time")) {
                        rawTime = String(v);
                    } else if (norm.includes("data") || norm.includes("date") || norm.includes("sendat")) {
                        rawDate = String(v);
                    }
                }

                const digits = rawPhone.replace(/\D/g, "");
                const isValid = digits.length >= 10 && digits.length <= 15;
                if (isValid) valid++; else invalid++;

                // Identificar texto de recorrência
                let recDisplay = "📅 Envio Único";
                const cleanRec = rawRec.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const timeStr = rawTime.trim() || "09:00";

                if (cleanRec && cleanRec !== "nao" && cleanRec !== "false" && cleanRec !== "0" && cleanRec !== "unico") {
                    if (cleanRec.includes("diari") || cleanRec.includes("todo dia")) recDisplay = `🔄 Diário às ${timeStr}`;
                    else if (cleanRec.includes("seg a sex") || cleanRec.includes("uteis")) recDisplay = `🔄 Seg a Sex às ${timeStr}`;
                    else if (cleanRec.includes("fim de semana")) recDisplay = `🔄 Fim de semana às ${timeStr}`;
                    else recDisplay = `🔄 ${rawRec.trim()} às ${timeStr}`;
                } else if (importIsRecurring === "recurring") {
                    recDisplay = `🔄 Recorrente (${importRecurringDays.length === 7 ? 'Diário' : 'Personalizado'})`;
                }

                if (idx < 5) {
                    const scheduledTime = baseMoment.clone().add(idx * importDelaySeconds, 'seconds').format('DD/MM HH:mm:ss');
                    const firstName = rawName.split(/\s+/)[0] || "";
                    let previewText = rawMsg || importDefaultMessage;
                    previewText = previewText.replace(/\{primeiro-nome\}/gi, firstName || "{primeiro-nome}").replace(/\{nome\}/gi, rawName || "{nome}").replace(/\{telefone\}/gi, digits);
                    previewList.push({
                        phone: digits || "Inválido",
                        name: rawName || "Sem nome",
                        previewText,
                        time: scheduledTime,
                        recurrence: recDisplay,
                        valid: isValid
                    });
                }
            });

            setImportSummary({ total: rows.length, valid, invalid });
            setImportPreview(previewList);
            toast.info(`Planilha lida: ${valid} contatos válidos encontrados.`);
        } catch {
            toast.error("Erro ao analisar a planilha. Verifique se o formato é válido.");
        }
    };

    const handleImportMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedSessionId) return;

        setUploadingImportMedia(true);
        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch(`/api/scheduler/${selectedSessionId}/upload`, {
                method: "POST",
                body: formData,
            });

            const data = await res.json();
            if (data.status && data.data?.mediaUrl) {
                setImportMediaUrl(data.data.mediaUrl);
                setImportMediaType(data.data.mediaType);
                setImportMediaFileName(data.data.fileName);
                toast.success(`Arquivo "${file.name}" anexado à importação!`);
            } else {
                toast.error(data.message || "Erro no envio da mídia");
            }
        } catch {
            toast.error("Erro ao enviar a mídia");
        } finally {
            setUploadingImportMedia(false);
            if (importMediaInputRef.current) importMediaInputRef.current.value = "";
        }
    };

    const handleExecuteImport = async () => {
        if (!importFile || !selectedSessionId) {
            toast.error("Selecione um arquivo de planilha (.xlsx, .xls ou .csv)");
            return;
        }
        if (importSummary.valid === 0) {
            toast.error("Nenhum contato válido encontrado na planilha");
            return;
        }

        setIsProcessingImport(true);
        try {
            const formData = new FormData();
            formData.append("file", importFile);
            formData.append("defaultMessage", importDefaultMessage);
            formData.append("baseDate", importBaseDate || moment().tz(systemTimezone).add(5, "minutes").format("YYYY-MM-DDTHH:mm"));
            formData.append("delaySeconds", String(importDelaySeconds));
            if (importMediaUrl) {
                formData.append("mediaUrl", importMediaUrl);
                formData.append("mediaType", importMediaType);
            }

            if (importIsRecurring === "recurring") {
                const cronData = buildCronData(
                    "recurring",
                    importRecurrenceType,
                    30,
                    1,
                    importRecurringDays,
                    "",
                    `${moment().format('YYYY-MM-DD')}T${importSendTime}:00`
                );
                if (cronData.cronExpression) {
                    formData.append("cronExpression", cronData.cronExpression);
                }
                if (cronData.recurrenceRule) {
                    formData.append("recurrenceRule", cronData.recurrenceRule);
                }
            }

            const res = await fetch(`/api/scheduler/${selectedSessionId}/import`, {
                method: "POST",
                body: formData,
            });

            const data = await res.json();
            if (data.status) {
                toast.success(data.message || "Importação em massa concluída com sucesso!");
                setIsImportModalOpen(false);
                setImportFile(null);
                setImportPreview([]);
                setImportSummary({ total: 0, valid: 0, invalid: 0 });
                setImportMediaUrl("");
                setImportMediaFileName("");
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error(data.message || "Erro na importação em massa");
            }
        } catch {
            toast.error("Ocorreu um erro ao processar a importação");
        } finally {
            setIsProcessingImport(false);
        }
    };

    const handleSendNow = async (msgId: string) => {
        if (!selectedSessionId) return;
        setSendingNowId(msgId);
        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${msgId}/send-now`, {
                method: "POST",
            });
            const data = await res.json();
            if (data.status) {
                toast.success("Mensagem enviada com sucesso agora!");
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error(data.message || "Falha ao enviar mensagem");
            }
        } catch {
            toast.error("Erro ao enviar mensagem agora");
        } finally {
            setSendingNowId(null);
        }
    };

    const handleDuplicate = (msg: ScheduledMessage) => {
        setNewJid(msg.jid.split('@')[0]);
        setDestinationMode(msg.jid.includes("@g.us") ? "group" : "contact");
        setNewContent(msg.content || "");
        setNewMediaUrl(msg.mediaUrl || "");
        setNewMediaType(msg.mediaType || "image");
        setNewSendAt(moment().tz(systemTimezone).add(1, 'hour').format('YYYY-MM-DDTHH:mm'));
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
        toast.info("Agendamento duplicado no formulário! Ajuste a data e confirme.");
    };

    const parseRecurrence = (ruleStr: string | undefined, cronExpr: string | undefined, setRecurring: any, setType: any, setMins: any, setHrs: any, setDays: any, setCron: any) => {
        if (!cronExpr) {
            setRecurring("once");
            return;
        }
        setRecurring("recurring");
        setCron(cronExpr);
        if (ruleStr) {
            try {
                const rule = JSON.parse(ruleStr);
                setType(rule.type || "cron");
                if (rule.type === "minutes") setMins(rule.value);
                if (rule.type === "hours") setHrs(rule.value);
                if (rule.type === "days") setDays(rule.value);
            } catch {
                setType("cron");
            }
        } else {
            setType("cron");
        }
    };

    const handleEdit = (msg: ScheduledMessage) => {
        setEditIsGroupMode(false);
        setEditGroupName("");
        setEditGroupTotal(0);
        setEditId(msg.id);
        const isGroup = msg.jid.includes("@g.us");
        const isStatus = msg.jid === "status@broadcast";
        setEditDestinationMode(isStatus ? "status" : isGroup ? "group" : "manual");
        setEditJid(isStatus ? "status@broadcast" : msg.jid.split('@')[0]);
        setEditContent(msg.content || "");
        setEditMediaUrl(msg.mediaUrl || "");
        setEditMediaType(msg.mediaType || "image");

        const localIso = moment.tz(msg.sendAt, systemTimezone).format('YYYY-MM-DDTHH:mm');
        setEditSendAt(localIso);
        const localTime = moment.tz(msg.sendAt, systemTimezone).format('HH:mm');
        setEditSendTime(localTime);

        parseRecurrence(msg.recurrenceRule, msg.cronExpression, setEditIsRecurring, setEditRecurrenceType, setEditRecurringMinutes, setEditRecurringHours, setEditRecurringDays, setEditCustomCron);
        setIsEditOpen(true);
    };

    const handleEditGroup = (item: { groupId: string; groupName: string; messages: ScheduledMessage[]; firstMsg: ScheduledMessage; total: number }) => {
        const msg = item.firstMsg;
        setEditIsGroupMode(true);
        setEditGroupName(item.groupName);
        setEditGroupTotal(item.total);
        setEditId(msg.id);
        setEditDestinationMode("manual");
        setEditJid(item.groupName);
        setEditContent(msg.content || "");
        setEditMediaUrl(msg.mediaUrl || "");
        setEditMediaType(msg.mediaType || "image");

        const localIso = moment.tz(msg.sendAt, systemTimezone).format('YYYY-MM-DDTHH:mm');
        setEditSendAt(localIso);
        const localTime = moment.tz(msg.sendAt, systemTimezone).format('HH:mm');
        setEditSendTime(localTime);

        parseRecurrence(msg.recurrenceRule, msg.cronExpression, setEditIsRecurring, setEditRecurrenceType, setEditRecurringMinutes, setEditRecurringHours, setEditRecurringDays, setEditCustomCron);
        setIsEditOpen(true);
    };

    const openAddMembersModal = (group: { groupId: string; groupName: string; messages: ScheduledMessage[]; firstMsg: ScheduledMessage; total: number }) => {
        setTargetAddGroup(group);
        setSelectedAddJids([]);
        setAddContactSearch("");
        setIsAddMembersOpen(true);
    };

    const toggleAddContact = (jid: string) => {
        setSelectedAddJids(prev =>
            prev.includes(jid) ? prev.filter(j => j !== jid) : [...prev, jid]
        );
    };

    const handleConfirmAddMembers = async () => {
        if (!selectedSessionId || !targetAddGroup || selectedAddJids.length === 0) {
            toast.error("Selecione ao menos um novo contato para adicionar");
            return;
        }

        setIsAddingMembers(true);
        try {
            const first = targetAddGroup.firstMsg;
            const res = await fetch(`/api/scheduler/${selectedSessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jids: selectedAddJids,
                    groupId: targetAddGroup.groupId,
                    groupName: targetAddGroup.groupName,
                    content: first.content,
                    sendAt: first.sendAt,
                    mediaUrl: first.mediaUrl,
                    mediaType: first.mediaType,
                    cronExpression: first.cronExpression,
                    recurrenceRule: first.recurrenceRule,
                    notifyJid: getScheduleBadges(first).notifyJid
                })
            });

            const data = await res.json();
            if (res.ok && data.status) {
                toast.success(`${selectedAddJids.length} novo(s) contato(s) adicionado(s) ao grupo!`);
                setIsAddMembersOpen(false);
                setSelectedAddJids([]);
                setTargetAddGroup(null);
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error(data.message || "Falha ao adicionar contatos ao grupo");
            }
        } catch {
            toast.error("Ocorreu um erro ao adicionar contatos");
        } finally {
            setIsAddingMembers(false);
        }
    };

    const buildCronData = (isRec: string, type: string, mins: number, hrs: number, days: number[], custom: string, finalSendAt: string) => {
        if (isRec === "once") return { cronExpression: null, recurrenceRule: null };

        let cron = "";
        const rule: any = { type };

        if (type === "minutes") {
            cron = `*/${mins} * * * *`;
            rule.value = mins;
        } else if (type === "hours") {
            cron = `0 */${hrs} * * *`;
            rule.value = hrs;
        } else if (type === "days") {
            const date = new Date(finalSendAt);
            const m = date.getMinutes();
            const h = date.getHours();
            const dStr = days.length > 0 ? days.join(',') : '*';
            cron = `${m} ${h} * * ${dStr}`;
            rule.value = days;
        } else {
            cron = custom;
            rule.value = custom;
        }

        return { cronExpression: cron, recurrenceRule: JSON.stringify(rule) };
    };

    const handleSaveSchedule = async () => {
        const isMulti = destinationMode === "multi_contact";

        if (!selectedSessionId) {
            toast.error("Nenhuma sessão de WhatsApp selecionada");
            return;
        }

        if (isMulti) {
            if (selectedMultiJids.length === 0) {
                toast.error("Selecione pelo menos um contato para o grupo");
                return;
            }
        } else if (destinationMode === "status") {
            // Status do WhatsApp não exige preenchimento de número
        } else {
            if (!newJid) {
                toast.error("Preencha o destinatário");
                return;
            }
        }

        if (scheduleActionType === "flow") {
            if (!selectedFlowId) {
                toast.error("Selecione um fluxo do Flow Builder para disparar");
                return;
            }
        } else {
            if (!newContent && !newMediaUrl) {
                toast.error("Preencha a mensagem ou anexe uma mídia");
                return;
            }
        }

        if (notifyManager && !notifyManagerJid) {
            toast.error("Informe o número ou contato do gestor/supervisor a ser avisado");
            return;
        }

        let finalSendAt = newSendAt;
        if (isRecurring === "recurring") {
            if (recurrenceType === "days") {
                if (!newSendTime) {
                    toast.error("Informe o horário do dia");
                    return;
                }
                finalSendAt = `${moment().format('YYYY-MM-DD')}T${newSendTime}:00`;
            } else {
                finalSendAt = moment().tz(systemTimezone).format('YYYY-MM-DDTHH:mm:ss');
            }
        } else {
            if (!newSendAt) {
                toast.error("Informe a data e hora de envio");
                return;
            }
        }

        let jid = newJid.trim();
        if (destinationMode === "status") {
            jid = "status@broadcast";
        } else if (destinationMode === "group") {
            if (!jid.endsWith("@g.us")) jid = `${jid.replace(/\D/g, "")}@g.us`;
        } else if (!isMulti) {
            const clean = jid.split("@")[0].replace(/\D/g, "");
            jid = `${clean}@s.whatsapp.net`;
        }

        let cleanNotifyJid: string | null = null;
        if (notifyManager && notifyManagerJid) {
            const cleanN = notifyManagerJid.split("@")[0].replace(/\D/g, "");
            if (cleanN) {
                cleanNotifyJid = `${cleanN}@s.whatsapp.net`;
            }
        }

        const cronData = buildCronData(isRecurring, recurrenceType, recurringMinutes, recurringHours, recurringDays, customCron, finalSendAt);
        const chosenFlow = scheduleActionType === "flow" ? availableFlows.find(f => f.id === selectedFlowId) : null;
        const flowExtra = scheduleActionType === "flow" && selectedFlowId ? {
            scheduleType: "flow",
            flowId: selectedFlowId,
            flowName: chosenFlow?.name || "Fluxo Automação",
            content: `⚡ Iniciar Fluxo: "${chosenFlow?.name || "Fluxo Automação"}"`,
        } : {};

        try {
            const payload = isMulti
                ? {
                    jids: selectedMultiJids,
                    groupName: groupDescription.trim() || undefined,
                    notifyJid: cleanNotifyJid,
                    content: newContent,
                    sendAt: finalSendAt,
                    mediaUrl: newMediaUrl,
                    mediaType: newMediaType,
                    ...flowExtra,
                    ...cronData
                }
                : {
                    jid,
                    notifyJid: cleanNotifyJid,
                    content: newContent,
                    sendAt: finalSendAt,
                    mediaUrl: newMediaUrl,
                    mediaType: newMediaType,
                    ...flowExtra,
                    ...cronData
                };

            const res = await fetch(`/api/scheduler/${selectedSessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok && data.status) {
                toast.success(
                    isMulti
                        ? `Agendamento criado com sucesso para ${selectedMultiJids.length} pessoas!`
                        : "Mensagem agendada com sucesso!"
                );
                setShowForm(false);
                setNewJid("");
                setSelectedMultiJids([]);
                setMultiContactSearch("");
                setGroupDescription("");
                setNotifyManager(false);
                setNotifyManagerJid("");
                setNotifyManagerSearch("");
                setNewContent("");
                setNewSendAt("");
                setNewSendTime("09:00");
                setNewMediaUrl("");
                setNewMediaFileName("");
                setNewMediaType("image");
                setScheduleActionType("text");
                setSelectedFlowId("");
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error(data.message || "Falha ao agendar a mensagem");
            }
        } catch {
            toast.error("Ocorreu um erro ao salvar o agendamento");
        }
    };

    const handleUpdateSchedule = async () => {
        if (!selectedSessionId || !editId || !editJid || (!editContent && !editMediaUrl)) {
            toast.error("Preencha os campos obrigatórios");
            return;
        }

        let finalSendAt = editSendAt;
        if (editIsRecurring === "recurring") {
            if (editRecurrenceType === "days") {
                if (!editSendTime) {
                    toast.error("Informe o horário do dia");
                    return;
                }
                finalSendAt = `${moment().format('YYYY-MM-DD')}T${editSendTime}:00`;
            } else {
                finalSendAt = moment().tz(systemTimezone).format('YYYY-MM-DDTHH:mm:ss');
            }
        } else {
            if (!editSendAt) {
                toast.error("Informe a data e hora de envio");
                return;
            }
        }

        let jid = editJid.trim();
        if (editDestinationMode === "status" || editJid === "status@broadcast") {
            jid = "status@broadcast";
        } else if (editDestinationMode === "group") {
            if (!jid.endsWith("@g.us")) jid = `${jid.replace(/\D/g, "")}@g.us`;
        } else {
            const clean = jid.split("@")[0].replace(/\D/g, "");
            jid = `${clean}@s.whatsapp.net`;
        }

        const cronData = buildCronData(editIsRecurring, editRecurrenceType, editRecurringMinutes, editRecurringHours, editRecurringDays, editCustomCron, finalSendAt);

        try {
            const bodyPayload = editIsGroupMode
                ? {
                    updateWholeGroup: true,
                    groupName: editGroupName,
                    jid: "group@s.whatsapp.net",
                    content: editContent,
                    sendAt: finalSendAt,
                    mediaUrl: editMediaUrl,
                    mediaType: editMediaType,
                    ...cronData
                }
                : {
                    jid,
                    content: editContent,
                    sendAt: finalSendAt,
                    mediaUrl: editMediaUrl,
                    mediaType: editMediaType,
                    ...cronData
                };

            const res = await fetch(`/api/scheduler/${selectedSessionId}/${editId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload)
            });

            if (res.ok) {
                toast.success(editIsGroupMode ? "Grupo atualizado com sucesso para todos os contatos!" : "Agendamento atualizado com sucesso!");
                setIsEditOpen(false);
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error("Falha ao atualizar o agendamento");
            }
        } catch {
            toast.error("Ocorreu um erro ao atualizar");
        }
    };

    const confirmDelete = async () => {
        if (deleteGroupId) {
            try {
                const sampleMsg = messages.find(m => getScheduleBadges(m).groupId === deleteGroupId);
                if (sampleMsg) {
                    const res = await fetch(`/api/scheduler/${selectedSessionId}/${sampleMsg.id}?deleteWholeGroup=true`, { method: "DELETE" });
                    if (res.ok) {
                        toast.success("Grupo de agendamentos excluído com sucesso!");
                        fetchMessages(selectedSessionId, activeTab);
                    } else {
                        toast.error("Falha ao excluir o grupo");
                    }
                }
            } catch {
                toast.error("Falha ao excluir o grupo");
            } finally {
                setDeleteGroupId(null);
            }
            return;
        }

        if (!deleteId) return;
        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${deleteId}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Agendamento excluído");
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error("Falha ao excluir");
            }
        } catch {
            toast.error("Falha ao excluir o agendamento");
        } finally {
            setDeleteId(null);
        }
    };

    const handleToggleActive = async (scheduleId: string, makeActive: boolean, toggleWholeGroup = false) => {
        if (!selectedSessionId) return;
        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${scheduleId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ active: makeActive, toggleWholeGroup }),
            });
            const data = await res.json();
            if (res.ok && data.status) {
                toast.success(data.message || (makeActive ? "Agendamento ativado!" : "Agendamento pausado!"));
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error(data.message || "Falha ao alterar status do agendamento");
            }
        } catch {
            toast.error("Erro ao alterar status do agendamento");
        }
    };

    const handleSendGroupNow = async (gMessages: ScheduledMessage[]) => {
        if (!selectedSessionId || gMessages.length === 0) return;
        const gId = getScheduleBadges(gMessages[0]).groupId || "group";
        setSendingNowGroupId(gId);
        toast.info(`Disparando ${gMessages.length} mensagens do grupo agora...`);
        try {
            let successCount = 0;
            for (const msg of gMessages) {
                const res = await fetch(`/api/scheduler/${selectedSessionId}/${msg.id}/send-now`, { method: "POST" });
                const data = await res.json();
                if (data.status) successCount++;
            }
            toast.success(`${successCount} de ${gMessages.length} mensagens disparadas com sucesso!`);
            fetchMessages(selectedSessionId, activeTab);
        } catch {
            toast.error("Erro ao enviar mensagens do grupo");
        } finally {
            setSendingNowGroupId(null);
        }
    };

    const formatRecurrenceLabel = (cron?: string | null, ruleStr?: string | null) => {
        if (!cron) return "Disparo Único";
        try {
            if (ruleStr) {
                const rule = typeof ruleStr === "string" ? JSON.parse(ruleStr) : ruleStr;
                if (rule.type === "minutes") return `A cada ${rule.value} min`;
                if (rule.type === "hours") return `A cada ${rule.value} hora(s)`;
                if (rule.type === "days" && Array.isArray(rule.value)) {
                    const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
                    if (rule.value.length === 7) return "Todos os dias";
                    if (rule.value.length === 5 && !rule.value.includes(0) && !rule.value.includes(6)) return "Seg a Sex";
                    if (rule.value.length === 2 && rule.value.includes(0) && rule.value.includes(6)) return "Fins de semana";
                    return `Toda ${rule.value.map((d: number) => days[d]).join(", ")}`;
                }
            }
            const parts = cron.trim().split(/\s+/);
            if (parts.length === 5) {
                const [m, h, , , d] = parts;
                const timeStr = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
                if (d === "*" || d === "0,1,2,3,4,5,6") return `Diariamente às ${timeStr}`;
                if (d === "1,2,3,4,5") return `Seg a Sex às ${timeStr}`;
                const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
                const dList = d.split(",").map(x => days[parseInt(x)] || x).join(", ");
                return `${dList} às ${timeStr}`;
            }
        } catch { }
        return "Recorrente";
    };

    const getContactOrGroupName = (jid: string) => {
        if (jid === "status@broadcast") {
            return `🟣 Meu Status (WhatsApp Story)`;
        }
        if (jid.includes("@g.us")) {
            const g = groups.find(group => group.jid === jid);
            if (g?.subject) return `👥 ${g.subject}`;
        } else {
            const c = contacts.find(contact => contact.jid === jid || contact.jid.startsWith(jid.split('@')[0]));
            if (c?.name || c?.notify) return `👤 ${c.name || c.notify}`;
        }
        return jid.split('@')[0];
    };

    const filteredMessages = messages.filter(m =>
        (m.content || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.jid.includes(searchTerm) ||
        getContactOrGroupName(m.jid).toLowerCase().includes(searchTerm.toLowerCase())
    );

    const filteredContacts = contacts.filter(c => {
        if (!contactSearch.trim()) return true;
        const q = contactSearch.toLowerCase().trim();
        const name = (c.name || "").toLowerCase();
        const notify = (c.notify || "").toLowerCase();
        const phone = c.jid.split('@')[0];
        return name.includes(q) || notify.includes(q) || phone.includes(q);
    });

    const filteredMultiContacts = contacts.filter(c => {
        if (!multiContactSearch.trim()) return true;
        const q = multiContactSearch.toLowerCase().trim();
        const name = (c.name || "").toLowerCase();
        const notify = (c.notify || "").toLowerCase();
        const phone = c.jid.split('@')[0];
        return name.includes(q) || notify.includes(q) || phone.includes(q);
    });

    const filteredNotifyContacts = contacts.filter(c => {
        if (!notifyManagerSearch.trim()) return true;
        const q = notifyManagerSearch.toLowerCase().trim();
        const name = (c.name || "").toLowerCase();
        const notify = (c.notify || "").toLowerCase();
        const phone = c.jid.split('@')[0];
        return name.includes(q) || notify.includes(q) || phone.includes(q);
    });

    const toggleMultiContact = (jid: string) => {
        setSelectedMultiJids(prev =>
            prev.includes(jid) ? prev.filter(j => j !== jid) : [...prev, jid]
        );
    };

    const selectAllFilteredContacts = () => {
        const toAdd = filteredMultiContacts.map(c => c.jid);
        setSelectedMultiJids(prev => Array.from(new Set([...prev, ...toAdd])));
    };

    const deselectAllMultiContacts = () => {
        setSelectedMultiJids([]);
    };

    const getScheduleBadges = (msg: ScheduledMessage) => {
        let hasGroupBatch = !!msg.groupId;
        let groupId = msg.groupId || null;
        let groupName: string | null = null;
        let hasNotify = !!msg.notifyJid;
        let notifyJid = msg.notifyJid || null;
        let isFlow = false;
        let flowId: string | null = null;
        let flowName: string | null = null;

        if (msg.recurrenceRule) {
            try {
                const parsed = JSON.parse(msg.recurrenceRule);
                if (parsed.groupId) {
                    hasGroupBatch = true;
                    groupId = parsed.groupId;
                }
                if (parsed.groupName) {
                    groupName = parsed.groupName;
                }
                if (parsed.notifyJid) {
                    hasNotify = true;
                    notifyJid = parsed.notifyJid;
                }
                if (parsed.flowId || parsed.scheduleType === "flow") {
                    isFlow = true;
                    flowId = parsed.flowId || null;
                    flowName = parsed.flowName || null;
                }
            } catch { }
        }
        if (!isFlow && msg.content && msg.content.startsWith("⚡ Iniciar Fluxo:")) {
            isFlow = true;
            flowName = msg.content.replace('⚡ Iniciar Fluxo: "', '').replace('"', '');
        }
        return { hasGroupBatch, groupId, groupName, hasNotify, notifyJid, isFlow, flowId, flowName };
    };

    interface GroupedItem {
        type: "group" | "single";
        groupId?: string;
        groupName?: string;
        messages?: ScheduledMessage[];
        firstMsg?: ScheduledMessage;
        total?: number;
        singleMsg?: ScheduledMessage;
    }

    const groupedMessagesList: GroupedItem[] = useMemo(() => {
        const groupsMap = new Map<string, ScheduledMessage[]>();
        const groupNameMap = new Map<string, string>();
        const processedGroupIds = new Set<string>();
        const result: GroupedItem[] = [];

        // Agrupa mensagens pertencentes a grupos
        for (const msg of filteredMessages) {
            const info = getScheduleBadges(msg);
            if (info.groupId) {
                if (!groupsMap.has(info.groupId)) {
                    groupsMap.set(info.groupId, []);
                    if (info.groupName) {
                        groupNameMap.set(info.groupId, info.groupName);
                    }
                }
                groupsMap.get(info.groupId)!.push(msg);
            }
        }

        // Constrói a lista mantendo a ordem de aparição dos agendamentos
        for (const msg of filteredMessages) {
            const info = getScheduleBadges(msg);
            if (info.groupId) {
                if (!processedGroupIds.has(info.groupId)) {
                    processedGroupIds.add(info.groupId);
                    const groupMsgs = groupsMap.get(info.groupId) || [msg];
                    const name = info.groupName || groupNameMap.get(info.groupId) || `Grupo (${groupMsgs.length} pessoas)`;
                    result.push({
                        type: "group",
                        groupId: info.groupId,
                        groupName: name,
                        messages: groupMsgs,
                        firstMsg: groupMsgs[0],
                        total: groupMsgs.length
                    });
                }
            } else {
                result.push({
                    type: "single",
                    singleMsg: msg
                });
            }
        }

        return result;
    }, [filteredMessages, contacts, groups]);

    const toggleGroupCollapse = (gId: string) => {
        setCollapsedGroups(prev => {
            const isCurrentCollapsed = prev[gId] !== false;
            return {
                ...prev,
                [gId]: !isCurrentCollapsed
            };
        });
    };

    const toggleCollapseAll = () => {
        const anyCollapsed = groupedMessagesList.some(item => item.type === "group" && item.groupId && collapsedGroups[item.groupId] !== false);
        const newState: Record<string, boolean> = {};
        groupedMessagesList.forEach(item => {
            if (item.type === "group" && item.groupId) {
                newState[item.groupId] = !anyCollapsed;
            }
        });
        setCollapsedGroups(newState);
    };

    const filteredGroups = groups.filter(g => {
        if (!groupSearch.trim()) return true;
        const q = groupSearch.toLowerCase().trim();
        const subject = (g.subject || "").toLowerCase();
        const jid = g.jid.toLowerCase();
        return subject.includes(q) || jid.includes(q);
    });

    const renderRecurrenceForm = (
        isRec: string, setRec: any,
        type: string, setType: any,
        mins: number, setMins: any,
        hrs: number, setHrs: any,
        days: number[], setDays: any,
        cron: string, setCron: any,
        sendAtStr: string, setSendAtStr: any,
        sendTimeStr: string, setSendTimeStr: any
    ) => {
        const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

        const getSummaryText = () => {
            if (isRec === "once") {
                return sendAtStr ? `Disparo único programado para ${moment(sendAtStr).format('DD/MM/YYYY [às] HH:mm')}` : "Defina a data e horário do disparo único";
            }
            if (type === "minutes") return `Repetir a cada ${mins} minuto(s) sem parar`;
            if (type === "hours") return `Repetir a cada ${hrs} hora(s) continuamente`;
            if (type === "days") {
                const time = sendTimeStr || "09:00";
                if (days.length === 7) return `Repetir TODOS OS DIAS às ${time}`;
                if (days.length === 5 && !days.includes(0) && !days.includes(6)) return `Repetir de SEGUNDA A SEXTA às ${time}`;
                if (days.length === 2 && days.includes(0) && days.includes(6)) return `Repetir nos FINS DE SEMANA às ${time}`;
                if (days.length > 0) return `Repetir toda ${days.map(d => dayNames[d]).join(', ')} às ${time}`;
                return "Selecione ao menos um dia da semana";
            }
            return `Expressão Cron: ${cron || "Não definida"}`;
        };

        return (
            <div className="space-y-4 border-2 border-primary/20 p-4 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 shadow-xs">
                <div>
                    <Label className="font-semibold text-sm flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-primary" /> Tipo de Agendamento
                    </Label>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setRec("once")}
                            className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                                isRec === "once"
                                    ? "border-primary bg-primary/10 text-primary font-bold shadow-xs"
                                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-muted-foreground"
                            }`}
                        >
                            <CalendarClock className="w-4 h-4" />
                            <span>📅 Envio Único (Uma vez)</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                setRec("recurring");
                                if (!sendTimeStr) setSendTimeStr("09:00");
                            }}
                            className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                                isRec === "recurring"
                                    ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold shadow-xs"
                                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-muted-foreground"
                            }`}
                        >
                            <Repeat className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            <span>🔄 Recorrente (Repetir Sempre)</span>
                        </button>
                    </div>
                </div>

                {isRec === "once" && (
                    <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800 animate-in fade-in-50">
                        <Label className="text-xs font-semibold">Data e Hora do Envio</Label>
                        <Input type="datetime-local" value={sendAtStr} onChange={e => setSendAtStr(e.target.value)} />
                        <p className="text-xs text-muted-foreground">O sistema enviará a mensagem exatamente neste momento (Fuso: {systemTimezone}).</p>
                    </div>
                )}

                {isRec === "recurring" && (
                    <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800 animate-in fade-in-50">
                        {/* ATALHOS RÁPIDOS */}
                        <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-muted-foreground">Atalhos de Repetição:</Label>
                            <div className="flex flex-wrap gap-1.5">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={type === "days" && days.length === 7 ? "default" : "outline"}
                                    className="text-xs h-7 px-2.5"
                                    onClick={() => { setType("days"); setDays([0, 1, 2, 3, 4, 5, 6]); }}
                                >
                                    Todos os Dias
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={type === "days" && days.length === 5 && !days.includes(0) && !days.includes(6) ? "default" : "outline"}
                                    className="text-xs h-7 px-2.5"
                                    onClick={() => { setType("days"); setDays([1, 2, 3, 4, 5]); }}
                                >
                                    Seg a Sex (Dias Úteis)
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={type === "days" && days.length === 2 && days.includes(0) && days.includes(6) ? "default" : "outline"}
                                    className="text-xs h-7 px-2.5"
                                    onClick={() => { setType("days"); setDays([0, 6]); }}
                                >
                                    Fins de Semana
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={type === "hours" ? "default" : "outline"}
                                    className="text-xs h-7 px-2.5"
                                    onClick={() => setType("hours")}
                                >
                                    A cada X Horas
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={type === "minutes" ? "default" : "outline"}
                                    className="text-xs h-7 px-2.5"
                                    onClick={() => setType("minutes")}
                                >
                                    A cada X Minutos
                                </Button>
                            </div>
                        </div>

                        {type === "days" && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold">Selecione os dias da semana:</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {dayNames.map((d, i) => {
                                            const isSelected = days.includes(i);
                                            return (
                                                <button
                                                    key={d}
                                                    type="button"
                                                    onClick={() => {
                                                        if (isSelected) setDays(days.filter(x => x !== i));
                                                        else setDays([...days, i]);
                                                    }}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                                        isSelected
                                                            ? "bg-primary text-primary-foreground border-primary shadow-xs"
                                                            : "bg-background text-foreground border-slate-300 dark:border-slate-700 hover:border-primary/50"
                                                    }`}
                                                >
                                                    {d}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Horário do disparo diário:</Label>
                                    <Input
                                        type="time"
                                        value={sendTimeStr || "09:00"}
                                        onChange={e => setSendTimeStr(e.target.value)}
                                        className="w-36 text-sm font-semibold"
                                    />
                                </div>
                            </div>
                        )}

                        {type === "hours" && (
                            <div className="flex items-center gap-2">
                                <Label className="text-xs font-semibold">Repetir a cada</Label>
                                <Input type="number" min={1} max={24} value={hrs} onChange={e => setHrs(parseInt(e.target.value) || 1)} className="w-20" />
                                <Label className="text-xs">hora(s)</Label>
                            </div>
                        )}

                        {type === "minutes" && (
                            <div className="flex items-center gap-2">
                                <Label className="text-xs font-semibold">Repetir a cada</Label>
                                <Input type="number" min={1} max={1440} value={mins} onChange={e => setMins(parseInt(e.target.value) || 1)} className="w-24" />
                                <Label className="text-xs">minutos</Label>
                            </div>
                        )}

                        {type === "cron" && (
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold">Expressão Cron (5 campos)</Label>
                                <Input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 9 * * 0 (todo domingo às 9h)" />
                            </div>
                        )}

                        {/* RESUMO DA REGRA */}
                        <div className="p-3 rounded-lg bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 flex items-start gap-2 text-xs text-blue-900 dark:text-blue-200">
                            <Repeat className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                            <div>
                                <span className="font-bold">Regra ativa: </span>
                                <span>{getSummaryText()} (Fuso: {systemTimezone})</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                            <CalendarClock className="h-6 w-6 text-primary" /> Agendador Inteligente
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Agende mensagens únicas ou recorrentes com texto dinâmico, mídias e seleção rápida de contatos/grupos.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        <Button variant="outline" size="sm" onClick={() => selectedSessionId && fetchMessages(selectedSessionId, activeTab)} disabled={loading || !selectedSessionId}>
                            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Atualizar
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setImportBaseDate(moment().tz(systemTimezone).add(5, 'minutes').format('YYYY-MM-DDTHH:mm'));
                                setIsImportModalOpen(true);
                            }}
                            disabled={!selectedSessionId}
                            className="text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-medium"
                        >
                            <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600 dark:text-emerald-400" />
                            Importar Planilha
                        </Button>
                        <Button size="sm" onClick={() => setShowForm(!showForm)} disabled={!selectedSessionId}>
                            <Plus className="h-4 w-4 mr-2" /> Novo Agendamento
                        </Button>
                    </div>
                </div>

                <SearchFilter
                    placeholder="Buscar agendamentos por texto, número ou grupo..."
                    onSearch={setSearchTerm}
                />

                {/* FORMULÁRIO DE NOVO AGENDAMENTO */}
                {showForm && (
                    <Card className="border-2 border-primary/30 shadow-sm animate-in fade-in duration-200">
                        <CardHeader>
                            <CardTitle className="text-lg">Novo Agendamento de Mensagem</CardTitle>
                            <CardDescription>Escolha o destinatário, defina o horário/recorrência e personalize sua mensagem.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            {/* DESTINATÁRIO */}
                            <div className="space-y-3">
                                <Label className="font-semibold text-sm">Destinatário</Label>
                                <Tabs value={destinationMode} onValueChange={(v: any) => { setDestinationMode(v); setNewJid(v === "status" ? "status@broadcast" : ""); setContactSearch(""); setGroupSearch(""); }}>
                                    <TabsList className="grid grid-cols-5 max-w-2xl">
                                        <TabsTrigger value="manual" className="text-xs flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Digitar Número</TabsTrigger>
                                        <TabsTrigger value="contact" className="text-xs flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Contato Único</TabsTrigger>
                                        <TabsTrigger value="multi_contact" className="text-xs flex items-center gap-1.5 font-semibold text-primary"><Users className="w-3.5 h-3.5 text-primary" /> Grupo de Pessoas</TabsTrigger>
                                        <TabsTrigger value="group" className="text-xs flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Grupo WhatsApp</TabsTrigger>
                                        <TabsTrigger value="status" className="text-xs flex items-center gap-1.5 font-semibold text-purple-600 dark:text-purple-400"><History className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" /> Status (Story)</TabsTrigger>
                                    </TabsList>
                                </Tabs>

                                {destinationMode === "manual" && (
                                    <div className="space-y-1">
                                        <Input
                                            value={newJid}
                                            onChange={e => setNewJid(e.target.value)}
                                            placeholder="Ex.: 5511999999999 (DDD + Número sem traços)"
                                        />
                                        <p className="text-xs text-muted-foreground">Informe o número com DDD (código do país 55 já incluído ou digitado).</p>
                                    </div>
                                )}

                                {destinationMode === "contact" && (
                                    <div className="space-y-1 relative" ref={contactDropdownRef}>
                                        {newJid ? (
                                            <div className="flex items-center justify-between p-3 border rounded-lg bg-primary/5 border-primary/20">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                                                        <User className="w-5 h-5" />
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold text-sm">
                                                            {getContactOrGroupName(newJid).replace('👤 ', '')}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {newJid.split('@')[0]}
                                                        </div>
                                                    </div>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setNewJid("");
                                                        setContactSearch("");
                                                        setIsContactDropdownOpen(true);
                                                    }}
                                                    className="text-xs text-muted-foreground hover:text-foreground"
                                                >
                                                    <X className="w-4 h-4 mr-1" /> Trocar Contato
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <div className="relative">
                                                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                    <Input
                                                        value={contactSearch}
                                                        onChange={e => {
                                                            setContactSearch(e.target.value);
                                                            setIsContactDropdownOpen(true);
                                                        }}
                                                        onFocus={() => setIsContactDropdownOpen(true)}
                                                        placeholder="Digite o nome ou telefone para filtrar..."
                                                        className="pl-9 pr-8"
                                                    />
                                                    {contactSearch && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setContactSearch("")}
                                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>

                                                {isContactDropdownOpen && (
                                                    <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-popover text-popover-foreground border rounded-md shadow-lg p-1 animate-in fade-in-50 zoom-in-95">
                                                        {filteredContacts.length === 0 ? (
                                                            <div className="py-6 text-center text-sm text-muted-foreground">
                                                                {contacts.length === 0
                                                                    ? "Nenhum contato sincronizado nesta sessão"
                                                                    : `Nenhum contato encontrado para "${contactSearch}"`}
                                                            </div>
                                                        ) : (
                                                            filteredContacts.slice(0, 100).map(c => {
                                                                const displayName = c.name || c.notify || "Sem nome";
                                                                const phone = c.jid.split('@')[0];
                                                                return (
                                                                    <button
                                                                        key={c.jid}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setNewJid(c.jid);
                                                                            setIsContactDropdownOpen(false);
                                                                            setContactSearch("");
                                                                        }}
                                                                        className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent text-left transition-colors text-sm"
                                                                    >
                                                                        <div className="flex items-center gap-2.5">
                                                                            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                                                                                <User className="w-3.5 h-3.5" />
                                                                            </div>
                                                                            <div>
                                                                                <div className="font-medium text-foreground">{displayName}</div>
                                                                                <div className="text-xs text-muted-foreground">{phone}</div>
                                                                            </div>
                                                                        </div>
                                                                    </button>
                                                                );
                                                            })
                                                        )}
                                                        {filteredContacts.length > 100 && (
                                                            <div className="text-center text-[11px] text-muted-foreground py-1 border-t mt-1">
                                                                Mostrando os 100 primeiros. Continue digitando para refinar.
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {destinationMode === "multi_contact" && (
                                    <div className="space-y-3 p-3.5 rounded-xl border border-primary/20 bg-primary/5">
                                        {/* NOME / DESCRIÇÃO DO GRUPO */}
                                        <div className="space-y-1.5 p-3 rounded-lg border bg-background shadow-2xs">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                                    <Tag className="w-3.5 h-3.5 text-primary" /> Nome / Descrição do Grupo (Para identificar na lista)
                                                </Label>
                                                <span className="text-[11px] text-muted-foreground">Opcional</span>
                                            </div>
                                            <Input
                                                value={groupDescription}
                                                onChange={e => setGroupDescription(e.target.value)}
                                                placeholder="Ex.: Equipe de Vendas, Líderes de PG, Avisos Reunião de Domingo..."
                                                className="h-9 text-xs"
                                            />
                                        </div>

                                        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
                                            <div className="relative flex-1">
                                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                <Input
                                                    value={multiContactSearch}
                                                    onChange={e => setMultiContactSearch(e.target.value)}
                                                    placeholder="Buscar contato por nome ou número..."
                                                    className="pl-9 pr-8 h-9 text-xs bg-background"
                                                />
                                                {multiContactSearch && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setMultiContactSearch("")}
                                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={selectAllFilteredContacts}
                                                    className="text-xs h-9 bg-background"
                                                    disabled={filteredMultiContacts.length === 0}
                                                >
                                                    <CheckSquare className="w-3.5 h-3.5 mr-1 text-primary" />
                                                    Selecionar Todos ({filteredMultiContacts.length})
                                                </Button>
                                                {selectedMultiJids.length > 0 && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={deselectAllMultiContacts}
                                                        className="text-xs h-9 text-muted-foreground hover:text-red-500"
                                                    >
                                                        <X className="w-3.5 h-3.5 mr-1" />
                                                        Limpar ({selectedMultiJids.length})
                                                    </Button>
                                                )}
                                            </div>
                                        </div>

                                        {/* RESUMO DOS SELECIONADOS */}
                                        <div className="p-3 rounded-lg border bg-background space-y-2">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-semibold flex items-center gap-1.5 text-foreground">
                                                    <Users className="w-4 h-4 text-primary" />
                                                    {selectedMultiJids.length === 0 ? (
                                                        <span className="text-muted-foreground">Nenhum contato selecionado ainda</span>
                                                    ) : (
                                                        <span className="text-primary font-bold">
                                                            {selectedMultiJids.length} {selectedMultiJids.length === 1 ? 'pessoa selecionada' : 'pessoas selecionadas no grupo'}
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="text-muted-foreground text-[11px]">
                                                    {contacts.length} contatos sincronizados
                                                </span>
                                            </div>

                                            {selectedMultiJids.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1 border-t">
                                                    {selectedMultiJids.map(jid => {
                                                        const contact = contacts.find(c => c.jid === jid);
                                                        const label = contact?.name || contact?.notify || jid.split('@')[0];
                                                        return (
                                                            <span
                                                                key={jid}
                                                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
                                                            >
                                                                <span className="max-w-[140px] truncate">{label}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleMultiContact(jid)}
                                                                    className="hover:bg-primary/20 rounded-full p-0.5 text-primary"
                                                                    title="Remover"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        {/* LISTA ROLÁVEL COM CHECKBOXES */}
                                        <div className="border rounded-lg max-h-56 overflow-y-auto divide-y bg-background">
                                            {filteredMultiContacts.length === 0 ? (
                                                <div className="p-6 text-center text-xs text-muted-foreground">
                                                    {contacts.length === 0
                                                        ? "Nenhum contato sincronizado nesta sessão"
                                                        : `Nenhum contato encontrado para "${multiContactSearch}"`}
                                                </div>
                                            ) : (
                                                filteredMultiContacts.slice(0, 100).map(c => {
                                                    const isSelected = selectedMultiJids.includes(c.jid);
                                                    const displayName = c.name || c.notify || "Sem nome";
                                                    const phone = c.jid.split('@')[0];
                                                    return (
                                                        <div
                                                            key={c.jid}
                                                            onClick={() => toggleMultiContact(c.jid)}
                                                            className={`flex items-center justify-between p-2.5 hover:bg-slate-50 dark:hover:bg-slate-900/60 cursor-pointer transition-colors text-xs ${
                                                                isSelected ? "bg-primary/5" : ""
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                                                    isSelected
                                                                        ? "bg-primary border-primary text-primary-foreground"
                                                                        : "border-slate-300 dark:border-slate-700 bg-background"
                                                                }`}>
                                                                    {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                                                </div>
                                                                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0 text-xs">
                                                                    <User className="w-3.5 h-3.5" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="font-semibold text-foreground truncate">{displayName}</div>
                                                                    <div className="text-[11px] text-muted-foreground">{phone}</div>
                                                                </div>
                                                            </div>

                                                            {isSelected && (
                                                                <span className="text-[10px] font-semibold text-primary px-2 py-0.5 rounded-full bg-primary/10 shrink-0">
                                                                    Selecionado
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                )}

                                {destinationMode === "group" && (
                                    <div className="space-y-1 relative" ref={groupDropdownRef}>
                                        {newJid ? (
                                            <div className="flex items-center justify-between p-3 border rounded-lg bg-primary/5 border-primary/20">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                                                        <Users className="w-5 h-5" />
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold text-sm">
                                                            {getContactOrGroupName(newJid).replace('👥 ', '')}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {newJid}
                                                        </div>
                                                    </div>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setNewJid("");
                                                        setGroupSearch("");
                                                        setIsGroupDropdownOpen(true);
                                                    }}
                                                    className="text-xs text-muted-foreground hover:text-foreground"
                                                >
                                                    <X className="w-4 h-4 mr-1" /> Trocar Grupo
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <div className="relative">
                                                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                    <Input
                                                        value={groupSearch}
                                                        onChange={e => {
                                                            setGroupSearch(e.target.value);
                                                            setIsGroupDropdownOpen(true);
                                                        }}
                                                        onFocus={() => setIsGroupDropdownOpen(true)}
                                                        placeholder="Digite o nome do grupo para filtrar..."
                                                        className="pl-9 pr-8"
                                                    />
                                                    {groupSearch && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setGroupSearch("")}
                                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>

                                                {isGroupDropdownOpen && (
                                                    <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-popover text-popover-foreground border rounded-md shadow-lg p-1 animate-in fade-in-50 zoom-in-95">
                                                        {filteredGroups.length === 0 ? (
                                                            <div className="py-6 text-center text-sm text-muted-foreground">
                                                                {groups.length === 0
                                                                    ? "Nenhum grupo encontrado nesta sessão"
                                                                    : `Nenhum grupo encontrado para "${groupSearch}"`}
                                                            </div>
                                                        ) : (
                                                            filteredGroups.map(g => (
                                                                <button
                                                                    key={g.jid}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setNewJid(g.jid);
                                                                        setIsGroupDropdownOpen(false);
                                                                        setGroupSearch("");
                                                                    }}
                                                                    className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent text-left transition-colors text-sm"
                                                                >
                                                                    <div className="flex items-center gap-2.5">
                                                                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                                                                            <Users className="w-3.5 h-3.5" />
                                                                        </div>
                                                                        <div>
                                                                            <div className="font-medium text-foreground">{g.subject || g.jid}</div>
                                                                            <div className="text-xs text-muted-foreground">{g.jid}</div>
                                                                        </div>
                                                                    </div>
                                                                </button>
                                                            ))
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {destinationMode === "status" && (
                                    <div className="p-4 rounded-xl border-2 border-purple-200 dark:border-purple-900/60 bg-purple-50/50 dark:bg-purple-950/20 space-y-2 animate-in fade-in-50">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold">
                                                <History className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="font-semibold text-sm text-purple-950 dark:text-purple-100 flex items-center gap-2">
                                                    Status do WhatsApp (Stories 24h)
                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-200 text-purple-900 dark:bg-purple-900 dark:text-purple-200 font-bold">Visível a todos os contatos</span>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    Esta postagem será publicada automaticamente como um Story no seu perfil do WhatsApp no dia e horário agendados (ou de forma recorrente). Você pode anexar fotos, vídeos ou escrever texto.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* RECORRÊNCIA E HORÁRIOS */}
                            {renderRecurrenceForm(
                                isRecurring, setIsRecurring,
                                recurrenceType, setRecurrenceType,
                                recurringMinutes, setRecurringMinutes,
                                recurringHours, setRecurringHours,
                                recurringDays, setRecurringDays,
                                customCron, setCustomCron,
                                newSendAt, setNewSendAt,
                                newSendTime, setNewSendTime
                            )}

                            {/* SELEÇÃO DO TIPO DE DISPARO: MENSAGEM OU FLUXO */}
                            <div className="space-y-3 pt-1 border-t">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <Label className="font-semibold text-sm">O que você deseja disparar neste agendamento?</Label>
                                    <Tabs value={scheduleActionType} onValueChange={(v: any) => setScheduleActionType(v)}>
                                        <TabsList className="grid grid-cols-2">
                                            <TabsTrigger value="text" className="text-xs flex items-center gap-1.5 font-medium">
                                                <FileText className="w-3.5 h-3.5" /> Mensagem / Mídia
                                            </TabsTrigger>
                                            <TabsTrigger value="flow" className="text-xs flex items-center gap-1.5 font-semibold text-purple-700 dark:text-purple-300">
                                                <Workflow className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" /> Disparar Fluxo (Botões / Enquete)
                                            </TabsTrigger>
                                        </TabsList>
                                    </Tabs>
                                </div>

                                {scheduleActionType === "flow" ? (
                                    <div className="p-4 rounded-xl border-2 border-purple-200 dark:border-purple-900/60 bg-purple-50/50 dark:bg-purple-950/20 space-y-3 animate-in fade-in-50">
                                        <div className="flex items-start gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0 mt-0.5">
                                                <Workflow className="w-5 h-5" />
                                            </div>
                                            <div className="space-y-1 flex-1">
                                                <Label className="font-bold text-sm text-purple-950 dark:text-purple-100">
                                                    Selecione o Fluxo Visual a ser iniciado
                                                </Label>
                                                <p className="text-xs text-muted-foreground">
                                                    No horário agendado, o robô iniciará automaticamente o fluxo para cada contato selecionado. O fluxo pode conter perguntas, menus numéricos ou enquetes com botões clicáveis (ex: <strong>Confirmado</strong>, <strong>Reagendar</strong>, <strong>Cancelar</strong>) e avançar pelas respostas programadas por você.
                                                </p>
                                            </div>
                                        </div>

                                        <div className="space-y-2 pt-1">
                                            <Select value={selectedFlowId} onValueChange={setSelectedFlowId}>
                                                <SelectTrigger className="bg-background border-purple-300 dark:border-purple-800 h-10">
                                                    <SelectValue placeholder="Selecione um fluxo publicado do Flow Builder..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availableFlows.length === 0 ? (
                                                        <div className="p-4 text-xs text-muted-foreground text-center">
                                                            Nenhum fluxo encontrado nesta sessão.
                                                        </div>
                                                    ) : (
                                                        availableFlows.map(f => (
                                                            <SelectItem key={f.id} value={f.id}>
                                                                <div className="flex items-center gap-2">
                                                                    <GitBranch className="w-3.5 h-3.5 text-purple-600" />
                                                                    <span className="font-medium text-foreground">{f.name}</span>
                                                                    {f.status === "ACTIVE" ? (
                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 font-semibold">Ativo / Publicado</span>
                                                                    ) : (
                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 font-semibold">{f.status}</span>
                                                                    )}
                                                                </div>
                                                            </SelectItem>
                                                        ))
                                                    )}
                                                </SelectContent>
                                            </Select>

                                            {availableFlows.length === 0 && (
                                                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between">
                                                    <span>Você ainda não tem fluxos criados. Acesse o <strong>Flow Builder</strong> para criar seus fluxos com botões interativos.</span>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 text-xs bg-background"
                                                        onClick={() => window.open("/dashboard/flows", "_blank")}
                                                    >
                                                        Abrir Flow Builder
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* CONTEÚDO DA MENSAGEM */}
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <Label className="font-semibold text-sm">Mensagem de Texto</Label>
                                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Clique nas variáveis para inserir:
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap gap-1.5 pb-1">
                                                {TEMPLATE_VARS.map(v => (
                                                    <button
                                                        key={v.tag}
                                                        type="button"
                                                        onClick={() => insertVariable(v.tag)}
                                                        className="px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground transition-colors border"
                                                    >
                                                        {v.label}
                                                    </button>
                                                ))}
                                            </div>

                                            <Textarea
                                                rows={4}
                                                value={newContent}
                                                onChange={e => setNewContent(e.target.value)}
                                                placeholder="Ex.: Olá {primeiro-nome}, lembrete do nosso encontro hoje às 19h! Te esperamos lá."
                                            />
                                        </div>

                                        {/* ANEXO DE MÍDIA / ARQUIVO */}
                                        <div className="space-y-3 border p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50">
                                            <Label className="font-semibold text-sm flex items-center gap-2">
                                                <Paperclip className="w-4 h-4 text-primary" /> Anexo de Mídia (Opcional)
                                            </Label>

                                            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                                                <input
                                                    type="file"
                                                    ref={fileInputRef}
                                                    className="hidden"
                                                    onChange={e => handleFileUpload(e, false)}
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() => fileInputRef.current?.click()}
                                                    disabled={uploadingMedia}
                                                >
                                                    <Upload className={`w-4 h-4 mr-2 ${uploadingMedia ? 'animate-spin' : ''}`} />
                                                    {uploadingMedia ? "Enviando arquivo..." : "Escolher arquivo do computador"}
                                                </Button>

                                                <span className="text-xs text-muted-foreground">ou cole uma URL de mídia abaixo:</span>
                                            </div>

                                            <div className="grid sm:grid-cols-3 gap-3">
                                                <div className="sm:col-span-2 space-y-1">
                                                    <Input
                                                        value={newMediaUrl}
                                                        onChange={e => { setNewMediaUrl(e.target.value); setNewMediaFileName(""); }}
                                                        placeholder="https://exemplo.com/imagem.jpg ou arquivo local"
                                                    />
                                                    {newMediaFileName && (
                                                        <p className="text-xs text-emerald-600 font-medium">📎 Anexado: {newMediaFileName}</p>
                                                    )}
                                                </div>

                                                <div className="space-y-1">
                                                    <Select value={newMediaType} onValueChange={setNewMediaType}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="image"><span className="flex items-center gap-1.5"><Image className="w-3.5 h-3.5" /> Imagem</span></SelectItem>
                                                            <SelectItem value="video"><span className="flex items-center gap-1.5"><Film className="w-3.5 h-3.5" /> Vídeo</span></SelectItem>
                                                            <SelectItem value="audio"><span className="flex items-center gap-1.5"><Mic className="w-3.5 h-3.5" /> Áudio / Voz (PTT)</span></SelectItem>
                                                            <SelectItem value="document"><span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Documento / PDF</span></SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* AVISO PARA GESTOR / SUPERVISOR */}
                            <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label className="font-semibold text-sm flex items-center gap-2 text-indigo-950 dark:text-indigo-200">
                                            <BellRing className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                            Aviso de Gestão / Notificar Supervisor
                                        </Label>
                                        <p className="text-xs text-muted-foreground">
                                            Enviar um relatório automático no WhatsApp de um gestor quando o envio for concluído (mostrando quem recebeu e quem falhou).
                                        </p>
                                    </div>
                                    <Switch
                                        checked={notifyManager}
                                        onCheckedChange={setNotifyManager}
                                    />
                                </div>

                                {notifyManager && (
                                    <div className="pt-3 border-t border-indigo-200/60 dark:border-indigo-900/40 space-y-2 animate-in fade-in-50" ref={notifyDropdownRef}>
                                        <Label className="text-xs font-semibold text-foreground">
                                            WhatsApp do Gestor / Supervisor que receberá o relatório:
                                        </Label>

                                        {notifyManagerJid ? (
                                            <div className="flex items-center justify-between p-2.5 border rounded-lg bg-background">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 flex items-center justify-center font-bold text-xs">
                                                        <UserCheck className="w-4 h-4" />
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold text-xs text-foreground">
                                                            {getContactOrGroupName(notifyManagerJid).replace('👤 ', '')}
                                                        </div>
                                                        <div className="text-[11px] text-muted-foreground">
                                                            {notifyManagerJid.split('@')[0]}
                                                        </div>
                                                    </div>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setNotifyManagerJid("");
                                                        setNotifyManagerSearch("");
                                                        setIsNotifyDropdownOpen(true);
                                                    }}
                                                    className="text-xs text-muted-foreground hover:text-foreground h-8"
                                                >
                                                    <X className="w-3.5 h-3.5 mr-1" /> Trocar Gestor
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                <div className="relative">
                                                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                    <Input
                                                        value={notifyManagerSearch}
                                                        onChange={e => {
                                                            setNotifyManagerSearch(e.target.value);
                                                            setIsNotifyDropdownOpen(true);
                                                        }}
                                                        onFocus={() => setIsNotifyDropdownOpen(true)}
                                                        placeholder="Buscar contato ou digitar telefone do gestor (ex: 5511999999999)..."
                                                        className="pl-9 pr-8 text-xs h-9 bg-background"
                                                    />
                                                    {notifyManagerSearch && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setNotifyManagerSearch("")}
                                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>

                                                {notifyManagerSearch.replace(/\D/g, "").length >= 10 && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                            const clean = notifyManagerSearch.replace(/\D/g, "");
                                                            setNotifyManagerJid(`${clean}@s.whatsapp.net`);
                                                            setIsNotifyDropdownOpen(false);
                                                        }}
                                                        className="text-xs h-8 w-full justify-start text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800"
                                                    >
                                                        <Check className="w-3.5 h-3.5 mr-1.5" /> Usar número digitado: <strong>{notifyManagerSearch.replace(/\D/g, "")}</strong>
                                                    </Button>
                                                )}

                                                {isNotifyDropdownOpen && (
                                                    <div className="max-h-48 overflow-y-auto bg-popover text-popover-foreground border rounded-md shadow-lg p-1 animate-in fade-in-50 zoom-in-95 text-xs">
                                                        {filteredNotifyContacts.length === 0 ? (
                                                            <div className="py-4 text-center text-xs text-muted-foreground">
                                                                Nenhum contato encontrado. Digite o número com DDD acima para selecionar.
                                                            </div>
                                                        ) : (
                                                            filteredNotifyContacts.slice(0, 50).map(c => {
                                                                const displayName = c.name || c.notify || "Sem nome";
                                                                const phone = c.jid.split('@')[0];
                                                                return (
                                                                    <button
                                                                        key={c.jid}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setNotifyManagerJid(c.jid);
                                                                            setIsNotifyDropdownOpen(false);
                                                                            setNotifyManagerSearch("");
                                                                        }}
                                                                        className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent text-left transition-colors"
                                                                    >
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold">
                                                                                <User className="w-3 h-3" />
                                                                            </div>
                                                                            <div>
                                                                                <div className="font-medium text-foreground">{displayName}</div>
                                                                                <div className="text-[11px] text-muted-foreground">{phone}</div>
                                                                            </div>
                                                                        </div>
                                                                    </button>
                                                                );
                                                            })
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <p className="text-[11px] text-muted-foreground">
                                            ℹ️ Assim que todos os envios forem processados, este número receberá um resumo com: Total enviado, Sucessos, Falhas e o detalhe de cada pessoa.
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                                <Button
                                    onClick={handleSaveSchedule}
                                    disabled={
                                        (scheduleActionType === "flow" ? !selectedFlowId : (!newContent && !newMediaUrl)) ||
                                        (destinationMode === "multi_contact" ? selectedMultiJids.length === 0 : !newJid) ||
                                        (notifyManager && !notifyManagerJid) ||
                                        uploadingMedia
                                    }
                                >
                                    Salvar Agendamento
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* LISTAGEM DE AGENDAMENTOS */}
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="mb-4">
                        <TabsTrigger value="pending" className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4" /> Fila de Pendentes ({messages.filter(m => m.status === 'PENDING').length})
                        </TabsTrigger>
                        <TabsTrigger value="history" className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" /> Histórico de Processados
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="pending" className="mt-0">
                        {loading ? (
                            <div className="text-center p-8 text-muted-foreground flex items-center justify-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin" /> Carregando agendamentos...
                            </div>
                        ) : filteredMessages.length === 0 ? (
                            <div className="text-center p-10 text-muted-foreground border rounded-lg bg-slate-50 dark:bg-slate-900/30">
                                <CalendarClock className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                                <p className="font-medium">Nenhuma mensagem agendada pendente.</p>
                                <p className="text-xs mt-1">Clique em &quot;Novo Agendamento&quot; para programar um disparo.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {groupedMessagesList.some(item => item.type === "group") && (
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between px-1 py-1 gap-2 text-xs text-muted-foreground">
                                        <span>Exibindo <strong>{filteredMessages.length}</strong> agendamentos organizados em grupos e mensagens individuais</span>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={toggleCollapseAll}
                                            className="h-7 text-xs font-medium text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 shadow-2xs"
                                        >
                                            <FolderKanban className="w-3.5 h-3.5 mr-1.5" />
                                            {groupedMessagesList.some(item => item.type === "group" && item.groupId && collapsedGroups[item.groupId] !== false)
                                                ? "Expandir Todos os Grupos"
                                                : "Recolher Todos os Grupos"}
                                        </Button>
                                    </div>
                                )}

                                <div className="grid gap-3">
                                    {groupedMessagesList.map(item => {
                                        if (item.type === "group" && item.groupId && item.messages && item.firstMsg) {
                                            const isCollapsed = collapsedGroups[item.groupId] !== false;
                                            const first = item.firstMsg;
                                            const { hasNotify, isFlow, flowName } = getScheduleBadges(first);
                                            const isGroupActive = item.messages.some(m => m.status !== "PAUSED");

                                            return (
                                                <Card key={`group-${item.groupId}`} className={`border-2 overflow-hidden shadow-2xs transition-colors ${isGroupActive ? "border-indigo-200/80 dark:border-indigo-900/60 hover:border-indigo-300" : "border-dashed border-slate-300 dark:border-slate-700 opacity-75"}`}>
                                                    <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20">
                                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                                            <div className="space-y-1.5 flex-1 min-w-0">
                                                                <div className="font-bold flex flex-wrap items-center gap-2">
                                                                    <span className="flex items-center gap-1.5 text-indigo-950 dark:text-indigo-200 text-base">
                                                                        <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                                                        {item.groupName}
                                                                    </span>
                                                                    {isGroupActive ? (
                                                                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                                            🟢 Ativo
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                                                            ⏸️ Pausado
                                                                        </span>
                                                                    )}
                                                                    <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                                                        👥 {item.total} {item.total === 1 ? 'destinatário' : 'destinatários'}
                                                                    </span>
                                                                    {isFlow && (
                                                                        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 flex items-center gap-1.5 border border-purple-200 dark:border-purple-800">
                                                                            <Workflow className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                                                            <span>Fluxo: {flowName || "Automação"}</span>
                                                                        </span>
                                                                    )}
                                                                    {first.cronExpression ? (
                                                                        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 flex items-center gap-1.5 border border-blue-200 dark:border-blue-800">
                                                                            <Repeat className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                                                            <span>{formatRecurrenceLabel(first.cronExpression, first.recurrenceRule)}</span>
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 flex items-center gap-1 border border-slate-200 dark:border-slate-700">
                                                                            <CalendarClock className="w-3 h-3 text-slate-500" />
                                                                            <span>Envio Único</span>
                                                                        </span>
                                                                    )}
                                                                    {first.mediaUrl && (
                                                                        <span className="text-xs px-2 py-0.5 rounded font-normal bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 flex items-center gap-1">
                                                                            📎 {first.mediaType || 'mídia'}
                                                                        </span>
                                                                    )}
                                                                    {hasNotify && (
                                                                        <span className="text-xs px-2 py-0.5 rounded font-normal bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 flex items-center gap-1" title="Avisa gestor após disparo">
                                                                            🔔 Notifica Gestão
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                <div className="text-sm font-medium text-slate-800 dark:text-slate-200 line-clamp-2">
                                                                    {isFlow ? (
                                                                        <span className="font-semibold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                                                                            <Workflow className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                                                                            Inicia o Fluxo Visual: &ldquo;{flowName || first.content}&rdquo;
                                                                        </span>
                                                                    ) : (
                                                                        first.content || <span className="italic text-muted-foreground">[Sem texto - apenas mídia]</span>
                                                                    )}
                                                                </div>

                                                                <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-0.5">
                                                                    <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                                                    <span>Próximo envio: <strong>{moment(first.sendAt).tz(systemTimezone).format('DD/MM/YYYY [às] HH:mm:ss')}</strong></span>
                                                                </div>
                                                            </div>

                                                            {/* AÇÕES DO GRUPO */}
                                                            <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center flex-wrap">
                                                                <div
                                                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-background/80 mr-1"
                                                                    title={isGroupActive ? "Desativar / Pausar envio deste grupo" : "Ativar envio deste grupo"}
                                                                >
                                                                    <Switch
                                                                        checked={isGroupActive}
                                                                        onCheckedChange={(checked) => handleToggleActive(first.id, checked, true)}
                                                                    />
                                                                    <span className="text-xs font-medium text-muted-foreground">
                                                                        {isGroupActive ? "Ativo" : "Pausado"}
                                                                    </span>
                                                                </div>

                                                                <Button
                                                                    variant={isCollapsed ? "default" : "outline"}
                                                                    size="sm"
                                                                    className={`text-xs h-8 font-semibold shadow-2xs transition-all ${
                                                                        isCollapsed
                                                                            ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                                                            : "border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                                                                    }`}
                                                                    onClick={() => toggleGroupCollapse(item.groupId!)}
                                                                    title={isCollapsed ? "Clique para expandir os destinatários deste grupo" : "Clique para recolher os destinatários deste grupo"}
                                                                >
                                                                    {isCollapsed ? (
                                                                        <>
                                                                            <ChevronDown className="w-4 h-4 mr-1" />
                                                                            Expandir ({item.total})
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <ChevronUp className="w-4 h-4 mr-1" />
                                                                            Recolher Grupo
                                                                        </>
                                                                    )}
                                                                </Button>

                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="text-xs h-8 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                                                    onClick={() => openAddMembersModal({
                                                                        groupId: item.groupId!,
                                                                        groupName: item.groupName!,
                                                                        messages: item.messages!,
                                                                        firstMsg: item.firstMsg!,
                                                                        total: item.total!
                                                                    })}
                                                                    title="Adicionar mais pessoas a este grupo"
                                                                >
                                                                    <UserPlus className="w-3.5 h-3.5 mr-1 text-emerald-600 dark:text-emerald-400" />
                                                                    Adicionar Pessoas
                                                                </Button>

                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="text-xs h-8 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                                    onClick={() => handleEditGroup({
                                                                        groupId: item.groupId!,
                                                                        groupName: item.groupName!,
                                                                        messages: item.messages!,
                                                                        firstMsg: item.firstMsg!,
                                                                        total: item.total!
                                                                    })}
                                                                    title="Editar mensagem, data ou horário deste grupo"
                                                                >
                                                                    <Pencil className="w-3.5 h-3.5 mr-1" />
                                                                    Editar Grupo
                                                                </Button>

                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="text-xs h-8 text-primary hover:bg-primary/10"
                                                                    onClick={() => handleSendGroupNow(item.messages!)}
                                                                    disabled={sendingNowGroupId === item.groupId}
                                                                    title="Disparar todas as mensagens deste grupo agora"
                                                                >
                                                                    <Send className={`w-3.5 h-3.5 mr-1 ${sendingNowGroupId === item.groupId ? 'animate-pulse' : ''}`} />
                                                                    {sendingNowGroupId === item.groupId ? "Enviando..." : "Enviar Todos Agora"}
                                                                </Button>

                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                                                                    onClick={() => setDeleteGroupId(item.groupId!)}
                                                                    title="Excluir o grupo inteiro"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* LISTA EXPANSÍVEL DE DESTINATÁRIOS DO GRUPO */}
                                                    {!isCollapsed && (
                                                        <div className="p-3 bg-background divide-y border-t border-indigo-100 dark:border-indigo-900/40">
                                                            <div className="pb-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                                                                <span>Destinatários deste grupo ({item.total}):</span>
                                                                <span>Intervalo inteligente anti-bloqueio entre envios</span>
                                                            </div>
                                                            {item.messages.map((m, idx) => (
                                                                <div key={m.id} className="py-2 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-900/50 px-2 rounded-md transition-colors">
                                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                                        <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-[10px] shrink-0">
                                                                            {idx + 1}
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <span className="font-semibold text-foreground">
                                                                                {getContactOrGroupName(m.jid).replace('👤 ', '')}
                                                                            </span>
                                                                            <span className="text-[11px] text-muted-foreground ml-2">
                                                                                {m.jid.split('@')[0]} • Envio: {moment(m.sendAt).tz(systemTimezone).format('HH:mm:ss')}
                                                                            </span>
                                                                        </div>
                                                                    </div>

                                                                    <div className="flex items-center gap-1 shrink-0">
                                                                        <Switch
                                                                            checked={m.status !== "PAUSED"}
                                                                            onCheckedChange={(checked) => handleToggleActive(m.id, checked, false)}
                                                                            title={m.status !== "PAUSED" ? "Pausar este destinatário" : "Ativar este destinatário"}
                                                                        />
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="h-7 px-2 text-[11px]"
                                                                            onClick={() => handleSendNow(m.id)}
                                                                            disabled={sendingNowId === m.id}
                                                                        >
                                                                            <Send className="w-3 h-3 mr-1" />
                                                                            Enviar
                                                                        </Button>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-7 w-7 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                                            onClick={() => handleEdit(m)}
                                                                            title="Editar este destinatário individualmente"
                                                                        >
                                                                            <Pencil className="w-3.5 h-3.5" />
                                                                        </Button>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-7 w-7 text-red-500 hover:bg-red-50"
                                                                            onClick={() => setDeleteId(m.id)}
                                                                            title="Remover esta pessoa deste envio"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* BARRA INFERIOR DE EXPANDIR / RECOLHER */}
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleGroupCollapse(item.groupId!)}
                                                        className="w-full py-1.5 px-3 bg-indigo-50/70 dark:bg-indigo-950/40 hover:bg-indigo-100/80 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs font-medium flex items-center justify-center gap-1.5 border-t border-indigo-100 dark:border-indigo-900/40 transition-colors cursor-pointer"
                                                    >
                                                        {isCollapsed ? (
                                                            <>
                                                                <ChevronDown className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                                                Clique aqui para ver os {item.total} destinatários deste grupo
                                                            </>
                                                        ) : (
                                                            <>
                                                                <ChevronUp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                                                Recolher destinatários
                                                            </>
                                                        )}
                                                    </button>
                                                </Card>
                                            );
                                        }

                                        // Renderização para item individual (single)
                                        const msg = item.singleMsg!;
                                        const { hasGroupBatch, hasNotify, isFlow, flowName } = getScheduleBadges(msg);
                                        const isMsgActive = msg.status !== "PAUSED";

                                        return (
                                            <Card key={msg.id} className={`transition-colors ${isMsgActive ? "hover:border-primary/40" : "border-dashed opacity-70 bg-slate-50/50 dark:bg-slate-900/20"}`}>
                                                <CardContent className="flex flex-col sm:flex-row justify-between p-4 gap-4 items-start sm:items-center">
                                                    <div className="space-y-1.5 flex-1 min-w-0">
                                                        <div className="font-bold flex flex-wrap items-center gap-2">
                                                             <span>{getContactOrGroupName(msg.jid)}</span>
                                                             {isMsgActive ? (
                                                                 <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                                     🟢 Ativo
                                                                 </span>
                                                             ) : (
                                                                 <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                                                     ⏸️ Pausado
                                                                 </span>
                                                             )}
                                                             {msg.jid === "status@broadcast" ? (
                                                                 <span className="text-xs px-2 py-0.5 rounded font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                                                     🟣 Status WhatsApp (Story)
                                                                 </span>
                                                             ) : msg.jid.includes("@g.us") ? (
                                                                 <span className="text-xs px-2 py-0.5 rounded font-normal bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">Grupo</span>
                                                             ) : (
                                                                 <span className="text-xs px-2 py-0.5 rounded font-normal bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{msg.jid.split('@')[0]}</span>
                                                             )}
                                                             {isFlow && (
                                                                 <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 flex items-center gap-1.5 border border-purple-200 dark:border-purple-800">
                                                                     <Workflow className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                                                     <span>Fluxo: {flowName || "Automação"}</span>
                                                                 </span>
                                                             )}
                                                             {msg.cronExpression ? (
                                                                 <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 flex items-center gap-1.5 border border-blue-200 dark:border-blue-800">
                                                                     <Repeat className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                                                     <span>{formatRecurrenceLabel(msg.cronExpression, msg.recurrenceRule)}</span>
                                                                 </span>
                                                             ) : (
                                                                 <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 flex items-center gap-1 border border-slate-200 dark:border-slate-700">
                                                                     <CalendarClock className="w-3 h-3 text-slate-500" />
                                                                     <span>Envio Único</span>
                                                                 </span>
                                                             )}
                                                             {msg.mediaUrl && (
                                                                 <span className="text-xs px-2 py-0.5 rounded font-normal bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 flex items-center gap-1">
                                                                     📎 {msg.mediaType || 'mídia'}
                                                                 </span>
                                                             )}
                                                             {hasNotify && (
                                                                 <span className="text-xs px-2 py-0.5 rounded font-normal bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 flex items-center gap-1" title="Avisa supervisor após envio">
                                                                     🔔 Notifica Gestão
                                                                 </span>
                                                             )}
                                                         </div>

                                                         <div className="text-sm font-medium text-slate-800 dark:text-slate-200 line-clamp-2">
                                                             {isFlow ? (
                                                                 <span className="font-semibold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                                                                     <Workflow className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                                                                     Inicia o Fluxo Visual: &ldquo;{flowName || msg.content}&rdquo;
                                                                 </span>
                                                             ) : (
                                                                 msg.content || <span className="italic text-muted-foreground">[Sem texto - apenas mídia]</span>
                                                             )}
                                                         </div>

                                                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                                                            <Clock className="w-3.5 h-3.5" />
                                                            {isMsgActive ? (
                                                                <span>Próximo envio: <strong>{moment(msg.sendAt).tz(systemTimezone).format('DD/MM/YYYY [às] HH:mm:ss')}</strong></span>
                                                            ) : (
                                                                <span className="text-amber-700 dark:text-amber-400 font-medium">
                                                                    Agendamento desativado (próximo horário seria {moment(msg.sendAt).tz(systemTimezone).format('DD/MM/YYYY [às] HH:mm:ss')})
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                                                        <div
                                                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-background mr-1"
                                                            title={isMsgActive ? "Clique para desativar / pausar este agendamento" : "Clique para ativar este agendamento"}
                                                        >
                                                            <Switch
                                                                checked={isMsgActive}
                                                                onCheckedChange={(checked) => handleToggleActive(msg.id, checked, false)}
                                                            />
                                                            <span className="text-xs font-medium text-muted-foreground">
                                                                {isMsgActive ? "Ativo" : "Pausado"}
                                                            </span>
                                                        </div>

                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="text-primary hover:bg-primary/10"
                                                            onClick={() => handleSendNow(msg.id)}
                                                            disabled={sendingNowId === msg.id}
                                                            title="Disparar esta mensagem agora imediatamente"
                                                        >
                                                            <Send className={`w-3.5 h-3.5 mr-1.5 ${sendingNowId === msg.id ? 'animate-pulse' : ''}`} />
                                                            {sendingNowId === msg.id ? "Enviando..." : "Enviar Agora"}
                                                        </Button>

                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleDuplicate(msg)}
                                                            title="Duplicar agendamento"
                                                        >
                                                            <Copy className="w-4 h-4 text-slate-600" />
                                                        </Button>

                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleEdit(msg)}
                                                            title="Editar"
                                                        >
                                                            <Pencil className="w-4 h-4 text-slate-600" />
                                                        </Button>

                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setDeleteId(msg.id)}
                                                            className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                                                            title="Excluir"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="history" className="mt-0">
                        {loading ? (
                            <div className="text-center p-8 text-muted-foreground">Carregando histórico...</div>
                        ) : filteredMessages.length === 0 ? (
                            <div className="text-center p-10 text-muted-foreground border rounded-lg bg-slate-50 dark:bg-slate-900/30">
                                Nenhum registro no histórico.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {groupedMessagesList.some(item => item.type === "group") && (
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between px-1 py-1 gap-2 text-xs text-muted-foreground">
                                        <span>Histórico consolidado com grupos e mensagens avulsas</span>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={toggleCollapseAll}
                                            className="h-7 text-xs font-medium text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 shadow-2xs"
                                        >
                                            <FolderKanban className="w-3.5 h-3.5 mr-1.5" />
                                            {groupedMessagesList.some(item => item.type === "group" && item.groupId && collapsedGroups[item.groupId] !== false)
                                                ? "Expandir Todos os Grupos"
                                                : "Recolher Todos os Grupos"}
                                        </Button>
                                    </div>
                                )}

                                <div className="grid gap-3">
                                    {groupedMessagesList.map(item => {
                                        if (item.type === "group" && item.groupId && item.messages && item.firstMsg) {
                                            const isCollapsed = collapsedGroups[item.groupId] !== false;
                                            const first = item.firstMsg;
                                            const sentCount = item.messages.filter(m => m.status === 'SENT').length;
                                            const failedCount = item.messages.filter(m => m.status === 'FAILED').length;
                                            const { hasNotify, isFlow, flowName } = getScheduleBadges(first);

                                            return (
                                                <Card key={`history-group-${item.groupId}`} className="border-2 border-slate-200 dark:border-slate-800 overflow-hidden opacity-90">
                                                    <div className="p-4 bg-slate-50/80 dark:bg-slate-900/60">
                                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                                            <div className="space-y-1 flex-1">
                                                                <div className="font-bold flex flex-wrap items-center gap-2">
                                                                    <span className="flex items-center gap-1.5 text-foreground">
                                                                        <Users className="w-4 h-4 text-indigo-600" />
                                                                        {item.groupName}
                                                                    </span>
                                                                    <span className="text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300">
                                                                        ✅ {sentCount} enviada(s)
                                                                    </span>
                                                                    {failedCount > 0 && (
                                                                        <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">
                                                                            ❌ {failedCount} falha(s)
                                                                        </span>
                                                                    )}
                                                                    {isFlow && (
                                                                        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 flex items-center gap-1.5 border border-purple-200 dark:border-purple-800">
                                                                            <Workflow className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                                                            <span>Fluxo: {flowName || "Automação"}</span>
                                                                        </span>
                                                                    )}
                                                                    {hasNotify && (
                                                                        <span className="text-xs px-2 py-0.5 rounded font-normal bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                                                            🔔 Relatório Enviado
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                                    {isFlow ? (
                                                                        <span className="font-semibold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                                                                            <Workflow className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                                                                            Fluxo Visual: &ldquo;{flowName || first.content}&rdquo;
                                                                        </span>
                                                                    ) : (
                                                                        first.content || "[Somente mídia]"
                                                                    )}
                                                                </div>
                                                                <div className="text-xs text-muted-foreground">
                                                                    Processado em: {moment(first.sendAt).tz(systemTimezone).format('DD/MM/YYYY [às] HH:mm:ss')}
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-2">
                                                                <Button
                                                                    variant={isCollapsed ? "default" : "outline"}
                                                                    size="sm"
                                                                    className={`text-xs h-8 font-semibold shadow-2xs transition-all ${
                                                                        isCollapsed
                                                                            ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                                                            : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                                    }`}
                                                                    onClick={() => toggleGroupCollapse(item.groupId!)}
                                                                    title={isCollapsed ? "Clique para expandir os destinatários deste grupo" : "Clique para recolher os destinatários deste grupo"}
                                                                >
                                                                    {isCollapsed ? (
                                                                        <>
                                                                            <ChevronDown className="w-4 h-4 mr-1.5" />
                                                                            Expandir ({item.total})
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <ChevronUp className="w-4 h-4 mr-1.5" />
                                                                            Recolher Grupo
                                                                        </>
                                                                    )}
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => setDeleteGroupId(item.groupId!)}
                                                                    className="text-red-500 hover:bg-red-50"
                                                                    title="Excluir histórico deste grupo"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {!isCollapsed && (
                                                        <div className="p-3 bg-background divide-y border-t">
                                                            {item.messages.map((m, idx) => (
                                                                <div key={m.id} className="py-2 flex items-center justify-between text-xs px-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-muted-foreground">{idx + 1}.</span>
                                                                        <span className="font-medium text-foreground">{getContactOrGroupName(m.jid).replace('👤 ', '')}</span>
                                                                        <span className="text-muted-foreground">({m.jid.split('@')[0]})</span>
                                                                    </div>
                                                                    <div>
                                                                        {m.status === 'SENT' ? (
                                                                            <span className="text-emerald-600 font-medium">✅ Enviada</span>
                                                                        ) : (
                                                                            <span className="text-red-500 font-medium">❌ Falhou</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* BARRA INFERIOR DE EXPANDIR / RECOLHER */}
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleGroupCollapse(item.groupId!)}
                                                        className="w-full py-1.5 px-3 bg-slate-100/70 dark:bg-slate-900/50 hover:bg-slate-200/80 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300 text-xs font-medium flex items-center justify-center gap-1.5 border-t border-slate-200 dark:border-slate-800 transition-colors cursor-pointer"
                                                    >
                                                        {isCollapsed ? (
                                                            <>
                                                                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                                                Clique aqui para ver os {item.total} destinatários deste grupo
                                                            </>
                                                        ) : (
                                                            <>
                                                                <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                                                                Recolher destinatários
                                                            </>
                                                        )}
                                                    </button>
                                                </Card>
                                            );
                                        }

                                        const msg = item.singleMsg!;
                                        const { isFlow, flowName } = getScheduleBadges(msg);
                                        return (
                                            <Card key={msg.id} className="opacity-80">
                                                <CardContent className="flex flex-col sm:flex-row justify-between p-4 gap-4 items-start sm:items-center">
                                                    <div className="space-y-1 flex-1">
                                                        <div className="font-bold flex items-center gap-2">
                                                            <span>{getContactOrGroupName(msg.jid)}</span>
                                                            {isFlow && (
                                                                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 flex items-center gap-1.5 border border-purple-200 dark:border-purple-800">
                                                                    <Workflow className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                                                    <span>Fluxo: {flowName || "Automação"}</span>
                                                                </span>
                                                            )}
                                                            {msg.status === 'SENT' ? (
                                                                <span className="text-xs px-2 py-0.5 rounded font-normal bg-green-100 text-green-800 flex items-center gap-1">
                                                                    <CheckCircle2 className="w-3 h-3" /> Enviada com Sucesso
                                                                </span>
                                                            ) : (
                                                                <span className="text-xs px-2 py-0.5 rounded font-normal bg-red-100 text-red-800 flex items-center gap-1">
                                                                    <XCircle className="w-3 h-3" /> Falhou no Envio
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm font-medium">
                                                            {isFlow ? (
                                                                <span className="font-semibold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                                                                    <Workflow className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                                                                    Fluxo Visual: &ldquo;{flowName || msg.content}&rdquo;
                                                                </span>
                                                            ) : (
                                                                msg.content || "[Somente mídia]"
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            Processada em: {moment(msg.sendAt).tz(systemTimezone).format('DD/MM/YYYY [às] HH:mm:ss')}
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-1.5">
                                                        <Button variant="ghost" size="icon" onClick={() => handleDuplicate(msg)} title="Reagendar / Duplicar">
                                                            <Copy className="w-4 h-4" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(msg.id)} className="text-red-500 hover:bg-red-50">
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

                {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO INDIVIDUAL */}
                <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
                            <AlertDialogDescription>Esta mensagem não será mais enviada. Deseja prosseguir?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete} className="bg-red-600">Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO DE GRUPO INTEIRO */}
                <AlertDialog open={!!deleteGroupId} onOpenChange={(o) => !o && setDeleteGroupId(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Excluir grupo inteiro de mensagens?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Esta ação cancelará e excluirá o envio de mensagens para todos os contatos deste grupo. Deseja prosseguir?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Sim, Excluir Grupo</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* MODAL DE EDIÇÃO */}
                <Dialog open={isEditOpen} onOpenChange={o => !o && setIsEditOpen(false)}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Pencil className="w-5 h-5 text-primary" />
                                {editIsGroupMode ? `Editar Grupo: ${editGroupName}` : "Editar Agendamento"}
                            </DialogTitle>
                            {editIsGroupMode && (
                                <DialogDescription className="text-xs text-indigo-700 dark:text-indigo-300">
                                    👥 As alterações de mensagem, mídia, data ou horário serão aplicadas para todos os {editGroupTotal} contatos deste grupo.
                                </DialogDescription>
                            )}
                        </DialogHeader>
                        <div className="space-y-4 py-3">
                            {editIsGroupMode ? (
                                <div className="space-y-1.5 p-3 rounded-lg border bg-indigo-50/50 dark:bg-indigo-950/20">
                                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                                        <Tag className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> Nome / Descrição do Grupo
                                    </Label>
                                    <Input
                                        value={editGroupName}
                                        onChange={e => setEditGroupName(e.target.value)}
                                        placeholder="Ex.: Líderes de PG, Vendas..."
                                        className="bg-background text-xs"
                                    />
                                </div>
                            ) : editDestinationMode === "status" || editJid === "status@broadcast" ? (
                                <div className="p-3 rounded-lg border border-purple-200 bg-purple-50/50 dark:border-purple-800 dark:bg-purple-950/20 flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-300 flex items-center justify-center shrink-0">
                                        <History className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-purple-900 dark:text-purple-200">Postagem nos Stories do Status</p>
                                        <p className="text-xs text-purple-700 dark:text-purple-300">Este agendamento será publicado no Status (visível para seus contatos).</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label>Destinatário (JID ou Telefone)</Label>
                                    <Input value={editJid} onChange={e => setEditJid(e.target.value)} />
                                    {editJid && (
                                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                                            Identificado como: <span className="font-medium text-foreground">{getContactOrGroupName(editJid)}</span>
                                        </p>
                                    )}
                                </div>
                            )}

                            {renderRecurrenceForm(
                                editIsRecurring, setEditIsRecurring,
                                editRecurrenceType, setEditRecurrenceType,
                                editRecurringMinutes, setEditRecurringMinutes,
                                editRecurringHours, setEditRecurringHours,
                                editRecurringDays, setEditRecurringDays,
                                editCustomCron, setEditCustomCron,
                                editSendAt, setEditSendAt,
                                editSendTime, setEditSendTime
                            )}

                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <Label>Mensagem</Label>
                                    <div className="flex gap-1">
                                        {TEMPLATE_VARS.map(v => (
                                            <button key={v.tag} type="button" onClick={() => insertVariable(v.tag, true)} className="px-1.5 py-0.5 rounded text-[10px] bg-secondary border">
                                                {v.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <Textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={3} />
                            </div>

                            <div className="grid sm:grid-cols-3 gap-3">
                                <div className="sm:col-span-2 space-y-1">
                                    <Label>URL da Mídia (ou caminho)</Label>
                                    <Input value={editMediaUrl} onChange={e => setEditMediaUrl(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Tipo de Mídia</Label>
                                    <Select value={editMediaType} onValueChange={setEditMediaType}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="image">Imagem</SelectItem>
                                            <SelectItem value="video">Vídeo</SelectItem>
                                            <SelectItem value="audio">Áudio (PTT)</SelectItem>
                                            <SelectItem value="document">Documento</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
                            <Button onClick={handleUpdateSchedule} disabled={(!editContent && !editMediaUrl) || (!editIsGroupMode && !editJid)}>
                                Salvar Alterações
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* MODAL DE ADICIONAR PESSOAS AO GRUPO EXISTENTE */}
                <Dialog open={isAddMembersOpen} onOpenChange={o => !o && !isAddingMembers && setIsAddMembersOpen(false)}>
                    <DialogContent className="max-w-xl max-h-[85vh] flex flex-col">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-indigo-950 dark:text-indigo-200">
                                <UserPlus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                Adicionar Pessoas ao Grupo
                            </DialogTitle>
                            {targetAddGroup && (
                                <DialogDescription className="text-xs">
                                    Grupo: <strong>{targetAddGroup.groupName}</strong> (Atualmente com {targetAddGroup.total} pessoas)
                                </DialogDescription>
                            )}
                        </DialogHeader>

                        <div className="space-y-3 py-2 flex-1 overflow-y-auto">
                            {/* CAMPO DE BUSCA */}
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={addContactSearch}
                                    onChange={e => setAddContactSearch(e.target.value)}
                                    placeholder="Buscar contatos por nome ou telefone..."
                                    className="pl-9 pr-8 text-xs h-9"
                                />
                                {addContactSearch && (
                                    <button
                                        type="button"
                                        onClick={() => setAddContactSearch("")}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>

                            {/* CHIPS DOS NOVOS SELECIONADOS */}
                            {selectedAddJids.length > 0 && (
                                <div className="p-2.5 rounded-lg border bg-indigo-50/50 dark:bg-indigo-950/20 space-y-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-indigo-950 dark:text-indigo-200">
                                            Novos a adicionar ({selectedAddJids.length}):
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedAddJids([])}
                                            className="text-[11px] text-muted-foreground hover:text-red-500"
                                        >
                                            Limpar seleção
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                                        {selectedAddJids.map(jid => {
                                            const c = contacts.find(contact => contact.jid === jid);
                                            const label = c?.name || c?.notify || jid.split('@')[0];
                                            return (
                                                <span
                                                    key={jid}
                                                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                                                >
                                                    <span className="max-w-[130px] truncate">{label}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleAddContact(jid)}
                                                        className="hover:bg-indigo-200 dark:hover:bg-indigo-800 rounded-full p-0.5"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* LISTA DE CONTATOS */}
                            <div className="border rounded-lg max-h-60 overflow-y-auto divide-y bg-background text-xs">
                                {(() => {
                                    const currentGroupJids = targetAddGroup?.messages.map(m => m.jid) || [];
                                    const filtered = contacts.filter(c => {
                                        if (!addContactSearch.trim()) return true;
                                        const q = addContactSearch.toLowerCase().trim();
                                        const name = (c.name || "").toLowerCase();
                                        const notify = (c.notify || "").toLowerCase();
                                        const phone = c.jid.split('@')[0];
                                        return name.includes(q) || notify.includes(q) || phone.includes(q);
                                    });

                                    if (filtered.length === 0) {
                                        return (
                                            <div className="p-6 text-center text-muted-foreground">
                                                Nenhum contato encontrado.
                                            </div>
                                        );
                                    }

                                    return filtered.slice(0, 80).map(c => {
                                        const alreadyInGroup = currentGroupJids.some(j => j === c.jid || j.startsWith(c.jid.split('@')[0]));
                                        const isSelected = selectedAddJids.includes(c.jid);
                                        const displayName = c.name || c.notify || "Sem nome";
                                        const phone = c.jid.split('@')[0];

                                        return (
                                            <div
                                                key={c.jid}
                                                onClick={() => !alreadyInGroup && toggleAddContact(c.jid)}
                                                className={`flex items-center justify-between p-2.5 transition-colors ${
                                                    alreadyInGroup
                                                        ? "opacity-50 bg-slate-50 dark:bg-slate-900/40 cursor-not-allowed"
                                                        : "hover:bg-slate-50 dark:hover:bg-slate-900/60 cursor-pointer"
                                                } ${isSelected ? "bg-indigo-50/70 dark:bg-indigo-950/30" : ""}`}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                                        alreadyInGroup
                                                            ? "border-slate-300 bg-slate-200 text-slate-400"
                                                            : isSelected
                                                                ? "bg-indigo-600 border-indigo-600 text-white"
                                                                : "border-slate-300 dark:border-slate-700 bg-background"
                                                    }`}>
                                                        {(isSelected || alreadyInGroup) && <Check className="w-3 h-3 stroke-[3]" />}
                                                    </div>
                                                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                                                        <User className="w-3.5 h-3.5" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-foreground truncate">{displayName}</div>
                                                        <div className="text-[11px] text-muted-foreground">{phone}</div>
                                                    </div>
                                                </div>

                                                <div>
                                                    {alreadyInGroup ? (
                                                        <span className="text-[10px] text-muted-foreground bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                                                            Já está no grupo
                                                        </span>
                                                    ) : isSelected ? (
                                                        <span className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/60 px-2 py-0.5 rounded-full">
                                                            Selecionado
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        </div>

                        <DialogFooter className="pt-2 border-t">
                            <Button variant="ghost" onClick={() => setIsAddMembersOpen(false)} disabled={isAddingMembers}>
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleConfirmAddMembers}
                                disabled={selectedAddJids.length === 0 || isAddingMembers}
                                className="bg-indigo-600 hover:bg-indigo-700"
                            >
                                {isAddingMembers ? "Adicionando..." : `Confirmar e Adicionar (${selectedAddJids.length})`}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* MODAL DE IMPORTAÇÃO EM MASSA (EXCEL / CSV) */}
                <Dialog open={isImportModalOpen} onOpenChange={o => !o && !isProcessingImport && setIsImportModalOpen(false)}>
                    <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
                        <DialogHeader>
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pr-6">
                                <div>
                                    <DialogTitle className="text-xl flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                                        <FileSpreadsheet className="w-5 h-5 text-emerald-600" /> Importar Planilha em Massa
                                    </DialogTitle>
                                    <DialogDescription className="text-xs">
                                        Crie dezenas ou centenas de agendamentos automáticos a partir de um arquivo .xlsx, .xls ou .csv.
                                    </DialogDescription>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={downloadTemplate}
                                    className="text-xs text-primary border-primary/30 hover:bg-primary/5 flex items-center gap-1.5"
                                >
                                    <Download className="w-3.5 h-3.5" /> Baixar Modelo (.xlsx)
                                </Button>
                            </div>
                        </DialogHeader>

                        <div className="space-y-5 py-2">
                            {/* PASSO 1: UPLOAD DO ARQUIVO */}
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold flex items-center gap-1.5">
                                    <Upload className="w-4 h-4 text-primary" /> 1. Arquivo de Planilha (.xlsx, .xls ou .csv)
                                </Label>
                                <input
                                    type="file"
                                    ref={importFileInputRef}
                                    accept=".xlsx,.xls,.csv"
                                    className="hidden"
                                    onChange={handleImportFileSelect}
                                />
                                {importFile ? (
                                    <div className="flex items-center justify-between p-3.5 border-2 border-emerald-500/40 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold">
                                                <FileSpreadsheet className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="font-semibold text-sm text-foreground">{importFile.name}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {(importFile.size / 1024).toFixed(1)} KB • {importSummary.valid} contatos válidos identificados
                                                </div>
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => importFileInputRef.current?.click()}
                                            className="text-xs hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                        >
                                            Trocar Arquivo
                                        </Button>
                                    </div>
                                ) : (
                                    <div
                                        onClick={() => importFileInputRef.current?.click()}
                                        className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 rounded-lg p-6 text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-900/20"
                                    >
                                        <FileSpreadsheet className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
                                        <p className="text-sm font-medium">Clique aqui para selecionar sua planilha</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Formatos suportados: Excel (.xlsx, .xls) ou CSV. Colunas reconhecidas: <strong>Telefone</strong>, <strong>Nome</strong>, <strong>Recorrente</strong> (ex: Diário, Seg a Sex, Toda Terça ou Não), <strong>Horario</strong> e <strong>Mensagem</strong>.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* PASSO 2: CONFIGURAÇÃO DE HORÁRIO E ANTI-BLOQUEIO */}
                            <div className="space-y-3 border p-4 rounded-lg bg-slate-50/60 dark:bg-slate-900/40">
                                <Label className="text-sm font-semibold flex items-center gap-1.5">
                                    <ShieldCheck className="w-4 h-4 text-emerald-600" /> 2. Intervalo Anti-Bloqueio & Horário de Início
                                </Label>

                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Data e Hora do Primeiro Envio</Label>
                                        <Input
                                            type="datetime-local"
                                            value={importBaseDate}
                                            onChange={e => setImportBaseDate(e.target.value)}
                                        />
                                        <p className="text-[11px] text-muted-foreground">Fuso horário: {systemTimezone}</p>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label className="text-xs flex items-center justify-between">
                                            <span>Intervalo entre cada envio:</span>
                                            <span className="font-bold text-primary">{importDelaySeconds} segundos</span>
                                        </Label>
                                        <div className="flex gap-2">
                                            {[15, 30, 45, 60].map(sec => (
                                                <Button
                                                    key={sec}
                                                    type="button"
                                                    size="sm"
                                                    variant={importDelaySeconds === sec ? "default" : "outline"}
                                                    className="flex-1 text-xs h-8"
                                                    onClick={() => setImportDelaySeconds(sec)}
                                                >
                                                    {sec}s
                                                </Button>
                                            ))}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                                            <Info className="w-3 h-3 text-primary shrink-0" />
                                            Espaça os disparos na linha do tempo para proteger seu número.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* RECORRÊNCIA PARA A PLANILHA */}
                            <div className="space-y-3 border p-4 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/50">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div>
                                        <Label className="text-sm font-semibold flex items-center gap-1.5 text-blue-950 dark:text-blue-200">
                                            <Repeat className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Repetição Automática para a Lista (Recorrência)
                                        </Label>
                                        <p className="text-xs text-muted-foreground">Envio único na data prevista ou repetição contínua para os contatos.</p>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={importIsRecurring === "once" ? "default" : "outline"}
                                            className="text-xs h-8"
                                            onClick={() => setImportIsRecurring("once")}
                                        >
                                            📅 Envio Único
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={importIsRecurring === "recurring" ? "default" : "outline"}
                                            className="text-xs h-8 font-semibold text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800"
                                            onClick={() => setImportIsRecurring("recurring")}
                                        >
                                            🔄 Recorrente
                                        </Button>
                                    </div>
                                </div>

                                {importIsRecurring === "recurring" && (
                                    <div className="space-y-3 pt-2 border-t border-blue-200 dark:border-blue-900/50 animate-in fade-in-50">
                                        <div className="flex flex-wrap gap-1.5">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={importRecurringDays.length === 7 ? "default" : "outline"}
                                                className="text-xs h-7"
                                                onClick={() => setImportRecurringDays([0, 1, 2, 3, 4, 5, 6])}
                                            >
                                                Todos os Dias
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={importRecurringDays.length === 5 && !importRecurringDays.includes(0) && !importRecurringDays.includes(6) ? "default" : "outline"}
                                                className="text-xs h-7"
                                                onClick={() => setImportRecurringDays([1, 2, 3, 4, 5])}
                                            >
                                                Seg a Sex (Dias Úteis)
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={importRecurringDays.length === 2 && importRecurringDays.includes(0) && importRecurringDays.includes(6) ? "default" : "outline"}
                                                className="text-xs h-7"
                                                onClick={() => setImportRecurringDays([0, 6])}
                                            >
                                                Fins de Semana
                                            </Button>
                                        </div>

                                        <div className="flex flex-wrap gap-1.5">
                                            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d, i) => (
                                                <button
                                                    key={d}
                                                    type="button"
                                                    onClick={() => {
                                                        if (importRecurringDays.includes(i)) setImportRecurringDays(importRecurringDays.filter(x => x !== i));
                                                        else setImportRecurringDays([...importRecurringDays, i]);
                                                    }}
                                                    className={`px-3 py-1 rounded text-xs font-semibold border transition-all ${
                                                        importRecurringDays.includes(i)
                                                            ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                                                            : "bg-background text-foreground border-slate-300 dark:border-slate-700"
                                                    }`}
                                                >
                                                    {d}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Label className="text-xs font-semibold">Horário fixo do disparo:</Label>
                                            <Input
                                                type="time"
                                                value={importSendTime}
                                                onChange={e => setImportSendTime(e.target.value)}
                                                className="w-32 text-xs font-semibold"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* PASSO 3: MENSAGEM PADRÃO & VARIÁVEIS */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <Label className="text-sm font-semibold">3. Mensagem Padrão / Template</Label>
                                    <span className="text-xs text-muted-foreground">Clique para inserir:</span>
                                </div>

                                <div className="flex flex-wrap gap-1.5 pb-1">
                                    {TEMPLATE_VARS.map(v => (
                                        <button
                                            key={v.tag}
                                            type="button"
                                            onClick={() => setImportDefaultMessage(prev => prev + " " + v.tag)}
                                            className="px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground transition-colors border"
                                        >
                                            {v.label}
                                        </button>
                                    ))}
                                </div>

                                <Textarea
                                    rows={3}
                                    value={importDefaultMessage}
                                    onChange={e => setImportDefaultMessage(e.target.value)}
                                    placeholder="Ex.: Olá {primeiro-nome}, segue seu lembrete personalizado!"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    💡 Se a planilha tiver a coluna <strong>Mensagem</strong> preenchida para uma linha, ela será usada. Caso esteja em branco, será usada esta mensagem padrão acima com as variáveis do cliente.
                                </p>
                            </div>

                            {/* PASSO 4: ANEXO DE MÍDIA OPCIONAL */}
                            <div className="space-y-2 border p-3 rounded-lg bg-slate-50/50 dark:bg-slate-900/30">
                                <Label className="text-sm font-semibold flex items-center gap-1.5">
                                    <Paperclip className="w-4 h-4 text-primary" /> Anexo Opcional para Toda a Lista
                                </Label>
                                <input
                                    type="file"
                                    ref={importMediaInputRef}
                                    className="hidden"
                                    onChange={handleImportMediaUpload}
                                />
                                <div className="flex items-center gap-3">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => importMediaInputRef.current?.click()}
                                        disabled={uploadingImportMedia}
                                    >
                                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                                        {uploadingImportMedia ? "Enviando arquivo..." : "Anexar Imagem, Vídeo ou PDF"}
                                    </Button>
                                    {importMediaUrl && (
                                        <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-2.5 py-1 rounded border border-green-200">
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            <span>{importMediaFileName || "Arquivo anexado"}</span>
                                            <button
                                                type="button"
                                                onClick={() => { setImportMediaUrl(""); setImportMediaFileName(""); }}
                                                className="text-red-500 hover:text-red-700 ml-1"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* PASSO 5: PRÉ-VISUALIZAÇÃO */}
                            {importPreview.length > 0 && (
                                <div className="space-y-2 pt-2 border-t">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="font-semibold text-foreground">Prévia das Primeiras Mensagens:</span>
                                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                            {importSummary.valid} válidos / {importSummary.invalid} inválidos
                                        </span>
                                    </div>

                                    <div className="border rounded-md overflow-x-auto text-xs">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b">
                                                    <th className="p-2">Telefone</th>
                                                    <th className="p-2">Nome</th>
                                                    <th className="p-2">Frequência (Planilha)</th>
                                                    <th className="p-2">Horário Previsto</th>
                                                    <th className="p-2">Mensagem Gerada</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {importPreview.map((item, i) => (
                                                    <tr key={i} className="border-b hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                                        <td className="p-2 font-mono font-medium">{item.phone}</td>
                                                        <td className="p-2">{item.name}</td>
                                                        <td className="p-2 whitespace-nowrap">
                                                            <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                                                                (item.recurrence || "").includes("Recorrente") || (item.recurrence || "").includes("Diário") || (item.recurrence || "").includes("Seg") || (item.recurrence || "").includes("🔄")
                                                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-900"
                                                                    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                                            }`}>
                                                                {item.recurrence || "📅 Envio Único"}
                                                            </span>
                                                        </td>
                                                        <td className="p-2 whitespace-nowrap text-muted-foreground">{item.time}</td>
                                                        <td className="p-2 max-w-xs truncate text-muted-foreground" title={item.previewText}>{item.previewText}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>

                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button
                                variant="ghost"
                                onClick={() => setIsImportModalOpen(false)}
                                disabled={isProcessingImport}
                            >
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleExecuteImport}
                                disabled={!importFile || importSummary.valid === 0 || isProcessingImport}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                            >
                                {isProcessingImport ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                        Criando Agendamentos...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-4 h-4 mr-2" />
                                        Agendar {importSummary.valid > 0 ? `${importSummary.valid} Mensagens` : "em Massa"}
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
