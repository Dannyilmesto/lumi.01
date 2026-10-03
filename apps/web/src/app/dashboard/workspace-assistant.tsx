"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  Paperclip,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { WebSource } from "@/lib/web-types";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AssistantMarkdown } from "@/components/assistant-markdown";

const ASSISTANT_PAGE_PATH = "/dashboard/assistente";

type SpeechResultEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type OrganizationChoice = { id: string; name: string };
type AssistantDocumentChoice = {
  id: string;
  fileName: string;
  sourceType: string;
  scannedAt: string | null;
  pageCount: number | null;
};
type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  attachmentName?: string;
  sourcePages?: number[];
  documentName?: string | null;
  scannedNow?: boolean;
  webSources?: WebSource[];
  webNotice?: string;
};
function welcomeMessage(userName: string): ChatMessage {
  return {
    id: "welcome",
    role: "ASSISTANT",
    content: `Ciao ${userName}! Sono Lumi. Puoi chiedermi qualsiasi cosa, anche su preventivi e listini. Allega un PDF solo quando vuoi che lo analizzi.`,
  };
}

const ChatMessageRow = memo(function ChatMessageRow({
  message,
}: {
  message: ChatMessage;
}) {
  return (
    <article
      className={`lumi-chat-message ${message.role === "USER" ? "is-user" : "is-assistant"}`}
    >
      <span className="lumi-chat-role">
        {message.role === "USER" ? "Tu" : "Lumi"}
        {message.scannedNow ? " · PDF analizzato" : ""}
      </span>
      {message.role === "ASSISTANT" ? (
        <AssistantMarkdown content={message.content} />
      ) : (
        <p>{message.content}</p>
      )}
      {message.attachmentName && (
        <div className="lumi-chat-citations">
          <span>
            <Paperclip aria-hidden="true" size={13} />
            {message.attachmentName}
          </span>
        </div>
      )}
      {message.webNotice && (
        <p className="lumi-chat-upload-note">{message.webNotice}</p>
      )}
      {!!message.webSources?.length && (
        <div
          className="lumi-chat-citations"
          aria-label="Fonti web consultate"
        >
          {message.webSources.map((source) => (
            <div key={source.id}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                [{source.id}] {source.publisher} — {source.title}
              </a>
              <small className="lumi-chat-source-time">
                {source.publishedAt
                  ? `Pubblicato: ${new Date(source.publishedAt).toLocaleString("it-IT")}. `
                  : ""}
                Consultato:{" "}
                {new Date(source.retrievedAt).toLocaleString("it-IT")}
              </small>
            </div>
          ))}
        </div>
      )}
      {!!(message.documentName || message.sourcePages?.length) && (
        <div className="lumi-chat-citations">
          {message.documentName && (
            <span>{message.documentName}</span>
          )}
          {message.sourcePages?.map((page) => (
            <span key={page}>Pagina {page}</span>
          ))}
        </div>
      )}
    </article>
  );
});

export function WorkspaceAssistant({
  userName,
  organizations,
}: {
  userName: string;
  organizations: OrganizationChoice[];
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isAssistantPage = pathname === ASSISTANT_PAGE_PATH;
  const requestedOrganizationId = searchParams.get("organizationId");
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id ?? "",
  );
  const [documents, setDocuments] = useState<AssistantDocumentChoice[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    welcomeMessage(userName),
  ]);
  const [open, setOpen] = useState(isAssistantPage);
  const [hasUnread, setHasUnread] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [draft, setDraft] = useState("");
  const [actionMode, setActionMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState(
    "Lumi sta formulando la risposta…",
  );
  const [error, setError] = useState("");
  const [chatNotice, setChatNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState("");
  const [recording, setRecording] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerForm = useRef<HTMLFormElement>(null);
  const messagesViewport = useRef<HTMLDivElement>(null);
  const endOfMessages = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const [showReturnToLatest, setShowReturnToLatest] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const organizationRef = useRef(organizationId);
  const previousPathnameRef = useRef(pathname);
  const chatVisibleRef = useRef(isAssistantPage);
  const requestRef = useRef<{
    controller: AbortController;
    stoppedByUser: boolean;
  } | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);

  // La chat è "attiva" quando il pannello è visibile: solo allora ha senso interrogare servizi.
  const panelActive = isAssistantPage || open;
  const documentsLoadedFor = useRef("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const checkHealth = async () => {
      try {
        const response = await fetch("/api/assistant/health", {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = (await response.json()) as { available?: boolean };
        if (active) setLlmAvailable(response.ok && result.available === true);
      } catch {
        if (active && !controller.signal.aborted) setLlmAvailable(false);
      }
    };
    void checkHealth();
    // Nessun polling a chat chiusa o con la scheda in background.
    const interval = panelActive
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void checkHealth();
        }, 60_000)
      : undefined;
    return () => {
      active = false;
      controller.abort();
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [panelActive]);

  const changeOrganization = useCallback(
    (nextOrganizationId: string) => {
      if (organizationRef.current === nextOrganizationId) return;
      requestRef.current?.controller.abort();
      requestRef.current = null;
      uploadControllerRef.current?.abort();
      uploadControllerRef.current = null;
      recognitionRef.current?.stop();
      if (fileInput.current) fileInput.current.value = "";
      organizationRef.current = nextOrganizationId;
      documentsLoadedFor.current = "";
      setOrganizationId(nextOrganizationId);
      setDocumentId("");
      setDocuments([]);
      setMessages([welcomeMessage(userName)]);
      setDraft("");
      setError("");
      setChatNotice("");
      setUploadNotice("");
      setBusy(false);
      setUploading(false);
    },
    [userName],
  );

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    if (isAssistantPage) {
      setOpen(true);
      setShowWelcome(false);
      setHasUnread(false);
    } else if (previousPathname === ASSISTANT_PAGE_PATH) {
      recognitionRef.current?.stop();
      setOpen(false);
    }
    previousPathnameRef.current = pathname;
  }, [isAssistantPage, pathname]);

  useEffect(() => {
    chatVisibleRef.current = isAssistantPage || open;
  }, [isAssistantPage, open]);

  useEffect(() => {
    if (searchParams.get("assistant") !== "open") return;
    setOpen(true);
    setShowWelcome(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("assistant");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${pathname}${query ? `?${query}` : ""}`,
    );
  }, [pathname, searchParams]);

  useEffect(() => {
    if (
      requestedOrganizationId &&
      organizations.some((item) => item.id === requestedOrganizationId)
    )
      changeOrganization(requestedOrganizationId);
  }, [organizations, requestedOrganizationId, changeOrganization]);

  useEffect(() => {
    if (!organizationId) {
      setDocuments([]);
      return;
    }
    // L'elenco PDF serve solo con la chat visibile e basta caricarlo una volta per azienda.
    if (!panelActive || documentsLoadedFor.current === organizationId) return;
    const controller = new AbortController();
    fetch(
      "/api/assistant/documents?organizationId=" +
        encodeURIComponent(organizationId),
      { signal: controller.signal },
    )
      .then(async (response) => {
        const result = (await response.json()) as {
          documents?: AssistantDocumentChoice[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Errore documenti.");
        if (
          !controller.signal.aborted &&
          organizationRef.current === organizationId
        ) {
          setDocuments(result.documents ?? []);
          documentsLoadedFor.current = organizationId;
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted && caught instanceof Error)
          setError(caught.message);
      });
    return () => controller.abort();
  }, [organizationId, panelActive]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowWelcome(false), 12_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (open && followOutput.current) {
      // Durante lo streaming lo scroll animato verrebbe riavviato a ogni frame:
      // si segue il testo in modo immediato, e animato solo per i nuovi messaggi.
      const streaming = busy && messages.at(-1)?.role === "ASSISTANT";
      const smooth =
        !streaming &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      endOfMessages.current?.scrollIntoView({
        behavior: smooth ? "smooth" : "instant",
      });
      setShowReturnToLatest(false);
    }
  }, [open, messages, busyMessage, busy]);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
      requestRef.current?.controller.abort();
      requestRef.current = null;
      uploadControllerRef.current?.abort();
      uploadControllerRef.current = null;
    },
    [],
  );

  function currentOrganizationId() {
    return organizationRef.current;
  }

  function stopReply() {
    const request = requestRef.current;
    if (!request) return;
    request.stoppedByUser = true;
    request.controller.abort();
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content =
      draft.trim() ||
      (documentId && !actionMode ? "Analizza il PDF allegato." : "");
    const activeOrganizationId = currentOrganizationId();
    if (!content || busy || uploading || requestRef.current) return;
    if (!activeOrganizationId) {
      setError("Prima crea o seleziona un’azienda nel dashboard.");
      return;
    }
    if (activeOrganizationId !== organizationId) {
      changeOrganization(activeOrganizationId);
      setError(
        "Ho aggiornato l’azienda della chat. Scegli il PDF e invia di nuovo la richiesta.",
      );
      return;
    }
    const asksAboutPdf =
      /\b(pdf|document\w*|listin\w*|catalog\w*|file|scansion\w*|analizz\w*|interpret\w*|legg\w*|estrai\w*|riassum\w*)\b/i.test(
        content,
      );
    const asksAboutBusiness =
      /\b(preventiv\w*|bozz\w*|client\w*|fornitor\w*|listin\w*|catalog\w*|serrament\w*|infiss\w*|finestr\w*|port\w*|ordin\w*|fattur\w*|scont\w*|aliquot\w*|iva|spedizion\w*|pagament\w*|euro|€)\b/i.test(
        content,
      );
    const asksAboutCatalogItem =
      /\b(prezz\w*|cost\w*|prodott\w*|codic\w*|modell\w*|articol\w*|misur\w*|color\w*)\b/i.test(
        content,
      );
    const usesDocumentContext =
      asksAboutPdf ||
      (Boolean(documentId) && (asksAboutBusiness || asksAboutCatalogItem));
    const needsPdfScan = Boolean(
      selectedDocument && !selectedDocument.scannedAt && usesDocumentContext,
    );
    setBusyMessage(
      needsPdfScan
        ? "Sto leggendo il PDF con Python e l’AI…"
        : usesDocumentContext
          ? "Sto consultando i dati pertinenti…"
          : "Lumi sta formulando la risposta…",
    );
    setBusy(true);
    recognitionRef.current?.stop();
    setError("");
    setChatNotice("");
    setUploadNotice("");
    const recentHistory = messages
      .filter((message) => message.content.trim())
      .slice(-20);
    // Pin the latest cited PDF result to the history window so later follow-up
    // questions can operate on that answer even after several chat exchanges.
    const priorDocumentResult = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "ASSISTANT" &&
          message.content.trim() &&
          message.sourcePages?.length,
      );
    const history = [
      ...recentHistory.filter(
        (message) => message.id !== priorDocumentResult?.id,
      ),
      ...(priorDocumentResult ? [priorDocumentResult] : []),
    ]
      .slice(-20)
      .map(({ role, content: messageContent }) => ({
        role,
        content: messageContent.slice(0, 5_000),
      }));
    const nextMessages = [
      ...messages,
      {
        id: crypto.randomUUID(),
        role: "USER" as const,
        content,
        attachmentName: !actionMode ? selectedDocument?.fileName : undefined,
      },
    ];
    const userMessageId = nextMessages.at(-1)!.id;
    const assistantMessageId = crypto.randomUUID();
    let streamedText = "";
    let streamPlaceholderAdded = false;
    let scannedNow = false;
    const activeRequest = {
      controller: new AbortController(),
      stoppedByUser: false,
    };
    requestRef.current = activeRequest;
    const isCurrentRequest = () => requestRef.current === activeRequest;
    setMessages(nextMessages);
    setDraft("");
    try {
      if (actionMode) {
        const askAction = async (payload: object) => {
          const response = await fetch("/api/assistant/actions", {
            method: "POST",
            signal: activeRequest.controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: activeOrganizationId,
              ...payload,
            }),
          });
          const result = (await response.json()) as {
            error?: string;
            message?: string;
            sources?: WebSource[];
            webNotice?: string;
            pending?: { name: string; arguments: Record<string, unknown> };
            actions?: {
              name: string;
              result: { href?: string; download?: string; quoteId?: string };
            }[];
          };
          if (!response.ok)
            throw new Error(result.error || "Azione non riuscita.");
          return result;
        };
        let result = await askAction({ content });
        if (result.pending) {
          if (window.confirm(result.message || "Confermi questa operazione?"))
            result = await askAction({ confirmedTool: result.pending });
          else
            result = {
              message: "Operazione annullata.",
              actions: result.actions,
            };
        }
        if (!isCurrentRequest()) return;
        streamedText = result.message || "Operazione completata.";
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "ASSISTANT",
            content: streamedText,
            webSources: result.sources,
            webNotice: result.webNotice,
          },
        ]);
        window.dispatchEvent(new Event("lumi:data-changed"));
        for (const action of result.actions || []) {
          if (action.result.download) {
            const link = document.createElement("a");
            link.href = action.result.download;
            link.click();
          }
          const href =
            action.result.href ||
            (action.result.quoteId
              ? `/dashboard/preventivi/${encodeURIComponent(action.result.quoteId)}/documento`
              : "");
          if (href) window.location.assign(href);
        }
        return;
      }
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        signal: activeRequest.controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: activeOrganizationId,
          content,
          documentId: documentId || undefined,
          history,
        }),
      });
      if (!isCurrentRequest()) return;
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          failure?.error ?? "Non è stato possibile ricevere la risposta.",
        );
      }

      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const pageHeader = response.headers.get("X-Lumi-Source-Pages") ?? "";
        let sourcePages = pageHeader
          .split(",")
          .map(Number)
          .filter((page) => Number.isInteger(page) && page > 0);
        const encodedName = response.headers.get("X-Lumi-Document-Name");
        let documentName = encodedName ? decodeURIComponent(encodedName) : null;
        scannedNow = response.headers.get("X-Lumi-Scanned-Now") === "true";
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Il flusso di risposta è vuoto. Riprova.");

        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "ASSISTANT",
            content: "",
            sourcePages,
            documentName,
            scannedNow,
          },
        ]);
        streamPlaceholderAdded = true;

        // I token possono arrivare più spesso dei frame: la chat si aggiorna al massimo una volta per frame.
        let frame = 0;
        const commitStreamedText = () => {
          frame = 0;
          if (!isCurrentRequest()) return;
          const updatedText = streamedText;
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantMessageId && item.content !== updatedText
                ? { ...item, content: updatedText }
                : item,
            ),
          );
        };
        const scheduleStreamedText = () => {
          if (!frame) frame = window.requestAnimationFrame(commitStreamedText);
        };
        const flushStreamedText = () => {
          if (frame) window.cancelAnimationFrame(frame);
          commitStreamedText();
        };

        const decoder = new TextDecoder();
        let buffer = "";
        let completed = false;
        const processEvent = (block: string) => {
          activeRequest.controller.signal.throwIfAborted();
          if (!isCurrentRequest()) return;
          const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data) return;
          const message = JSON.parse(data) as {
            type?: string;
            content?: string;
            error?: string;
            message?: string;
            sourcePages?: number[];
            documentName?: string | null;
            scannedNow?: boolean;
            sources?: WebSource[];
            notice?: string;
          };
          if (message.type === "status" && message.message) {
            setBusyMessage(message.message);
          } else if (message.type === "web_sources") {
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantMessageId
                  ? {
                      ...item,
                      webSources: message.sources ?? [],
                      webNotice: message.notice,
                    }
                  : item,
              ),
            );
          } else if (message.type === "metadata") {
            sourcePages = (message.sourcePages ?? []).filter(
              (page) => Number.isInteger(page) && page > 0,
            );
            documentName = message.documentName ?? null;
            scannedNow ||= message.scannedNow === true;
            const metadata = { sourcePages, documentName, scannedNow };
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantMessageId
                  ? { ...item, ...metadata }
                  : item,
              ),
            );
          } else if (message.type === "token" && message.content) {
            streamedText += message.content;
            setBusyMessage("Lumi sta rispondendo…");
            scheduleStreamedText();
          } else if (message.type === "done") {
            completed = true;
          } else if (message.type === "error") {
            throw new Error(message.error ?? "La risposta si è interrotta.");
          }
        };

        try {
          let ended = false;
          while (!ended && !completed) {
            const { value, done } = await reader.read();
            activeRequest.controller.signal.throwIfAborted();
            buffer += decoder.decode(value, { stream: !done });
            let boundary = /\r?\n\r?\n/.exec(buffer);
            while (boundary && !completed) {
              processEvent(buffer.slice(0, boundary.index));
              buffer = buffer.slice(boundary.index + boundary[0].length);
              boundary = /\r?\n\r?\n/.exec(buffer);
            }
            if (done) ended = true;
          }
          if (!completed && buffer.trim()) processEvent(buffer);
        } finally {
          flushStreamedText();
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        if (!completed || !streamedText.trim())
          throw new Error("La risposta è terminata prima di essere completa.");
      } else {
        const result = (await response.json()) as {
          error?: string;
          reply?: string;
          sourcePages?: number[];
          documentName?: string | null;
          scannedNow?: boolean;
        };
        if (!result.reply)
          throw new Error(
            result.error ?? "Non è stato possibile ricevere la risposta.",
          );
        if (!isCurrentRequest()) return;
        activeRequest.controller.signal.throwIfAborted();
        streamedText = result.reply;
        scannedNow = result.scannedNow === true;
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "ASSISTANT",
            content: result.reply!,
            sourcePages: result.sourcePages ?? [],
            documentName: result.documentName,
            scannedNow: result.scannedNow,
          },
        ]);
      }
    } catch (caught) {
      if (!isCurrentRequest()) return;
      if (activeRequest.stoppedByUser) {
        setChatNotice(
          streamedText.trim()
            ? "Risposta interrotta. Il testo ricevuto resta nella chat."
            : "Richiesta interrotta. Puoi modificare il messaggio e inviarlo di nuovo.",
        );
      } else {
        setError(
          caught instanceof Error ? caught.message : "Errore durante l’invio.",
        );
      }
      if (!streamedText.trim()) {
        setMessages((current) =>
          current.filter(
            (message) =>
              message.id !== userMessageId &&
              (!streamPlaceholderAdded || message.id !== assistantMessageId),
          ),
        );
        setDraft(content);
      }
    } finally {
      if (isCurrentRequest()) {
        requestRef.current = null;
        setBusy(false);
        if (!chatVisibleRef.current) setHasUnread(true);
        if (scannedNow)
          void refreshDocuments(activeOrganizationId).catch(() => {
            if (organizationRef.current === activeOrganizationId)
              setUploadNotice(
                "PDF analizzato. Riapri la pagina per aggiornare l’elenco dei documenti.",
              );
          });
      }
    }
  }

  function toggleRecording() {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    const browserWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition =
      browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceUnavailable(true);
      return;
    }
    setVoiceUnavailable(false);
    baseTextRef.current = draft.trim();
    const recognition = new Recognition();
    recognition.lang = "it-IT";
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      setDraft([baseTextRef.current, transcript].filter(Boolean).join(" "));
    };
    recognition.onerror = () => {
      setError(
        "La dettatura si è interrotta. Puoi correggere il testo o riprovare.",
      );
      setRecording(false);
    };
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    setRecording(true);
    try {
      recognition.start();
    } catch {
      setRecording(false);
      setError(
        "Non riesco ad avviare il microfono. Controlla i permessi del browser.",
      );
    }
  }

  async function refreshDocuments(
    activeOrganizationId = currentOrganizationId(),
  ) {
    if (!activeOrganizationId) return;
    const response = await fetch(
      "/api/assistant/documents?organizationId=" +
        encodeURIComponent(activeOrganizationId),
    );
    const result = (await response.json()) as {
      documents?: AssistantDocumentChoice[];
    };
    if (response.ok && organizationRef.current === activeOrganizationId)
      setDocuments(result.documents ?? []);
  }

  async function uploadPdf(file?: File) {
    if (!file || busy || uploading) return;
    if (
      !file.name.toLowerCase().endsWith(".pdf") ||
      (file.type &&
        !["application/pdf", "application/x-pdf", "application/octet-stream"].includes(
          file.type.toLowerCase(),
        ))
    ) {
      setError("Sono supportati solo documenti PDF (.pdf).");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    if (file.size === 0 || file.size > 30 * 1024 * 1024) {
      setError(
        file.size === 0
          ? "Il PDF è vuoto. Seleziona un file con contenuto."
          : "Il PDF supera il limite di 30 MB.",
      );
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    const activeOrganizationId = currentOrganizationId();
    if (!activeOrganizationId) {
      setError("Prima crea o seleziona un’azienda nel dashboard.");
      return;
    }
    setUploading(true);
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setError("");
    setUploadNotice("");
    const form = new FormData();
    form.set("organizationId", activeOrganizationId);
    form.set("file", file);
    try {
      const response = await fetch("/api/assistant/documents", {
        method: "POST",
        signal: controller.signal,
        body: form,
      });
      const result = (await response.json()) as {
        document?: { id: string; fileName: string };
        error?: string;
      };
      if (!response.ok || !result.document)
        throw new Error(
          result.error ?? "Non è stato possibile archiviare il PDF.",
        );
      await refreshDocuments(activeOrganizationId);
      if (
        controller.signal.aborted ||
        uploadControllerRef.current !== controller
      )
        return;
      setDocumentId(result.document.id);
      setUploadNotice(
        `“${result.document.fileName}” è pronto. Chiedimi qualcosa sul PDF per iniziare l’analisi.`,
      );
    } catch (caught) {
      if (
        controller.signal.aborted ||
        uploadControllerRef.current !== controller
      )
        return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Errore durante il caricamento.",
      );
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
        setUploading(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    }
  }

  const selectedDocument = documents.find((item) => item.id === documentId);
  const leavingAssistantPage =
    !isAssistantPage &&
    previousPathnameRef.current === ASSISTANT_PAGE_PATH;
  const showPanel = isAssistantPage || (open && !leavingAssistantPage);

  return (
    <div className={`lumi-chat-widget${isAssistantPage ? " is-page" : ""}`}>
      {showWelcome && !showPanel && (
        <div className="lumi-chat-welcome" role="status">
          <strong>Ciao {userName}!</strong> Lumi è pronta per aiutarti.
          <button
            type="button"
            aria-label="Chiudi saluto"
            onClick={() => setShowWelcome(false)}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      )}

      {showPanel && (
        <section
          className={`lumi-chat-panel${isAssistantPage ? " is-page-panel" : ""}`}
          aria-label={isAssistantPage ? "Conversazione con Lumi AI" : "Assistente Lumi"}
          aria-live="polite"
        >
          <header className="lumi-chat-header">
            <div className="lumi-chat-avatar" aria-hidden="true">
              <Sparkles size={20} strokeWidth={1.8} />
            </div>
            <div className="lumi-chat-heading">
              <strong>{isAssistantPage ? "Lumi AI" : "Lumi"}</strong>
              <span
                role="status"
                className={
                  llmAvailable === false
                    ? "is-offline"
                    : llmAvailable === null
                      ? "is-checking"
                      : "is-ready"
                }
              >
                {llmAvailable === false
                  ? "Motore AI offline"
                  : llmAvailable === null
                    ? "Verifico motore locale…"
                    : "AI locale pronta"}
              </span>
            </div>
            {isAssistantPage ? (
              <span className="lumi-chat-session-label">Conversazione personale</span>
            ) : (
              <button
                type="button"
                className="lumi-chat-close"
                onClick={() => setOpen(false)}
                aria-label="Riduci chat"
                title="Riduci a icona"
              >
                <X aria-hidden="true" size={18} />
              </button>
            )}
          </header>

          <div
            className="lumi-chat-messages"
            aria-live="polite"
            ref={messagesViewport}
            onScroll={(event) => {
              const viewport = event.currentTarget;
              const isNearBottom =
                viewport.scrollHeight -
                  viewport.scrollTop -
                  viewport.clientHeight <
                72;
              followOutput.current = isNearBottom;
              setShowReturnToLatest(!isNearBottom);
            }}
          >
            {messages.map((message) => (
              <ChatMessageRow key={message.id} message={message} />
            ))}
            {isAssistantPage && messages.length === 1 && !busy && (
              <div className="lumi-chat-prompts" aria-label="Esempi di richieste">
                {[
                  "Aiutami a creare un preventivo",
                  "Riassumi un listino o un PDF",
                  "Cosa posso fare con Lumi?",
                ].map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    onClick={() => setDraft(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <div className="lumi-chat-thinking" role="status">
                <LoaderCircle aria-hidden="true" size={15} />
                {busyMessage}
              </div>
            )}
            <div ref={endOfMessages} />
          </div>

          {error && (
            <div className="lumi-chat-error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                disabled={!draft.trim() || busy || uploading}
                onClick={() => composerForm.current?.requestSubmit()}
              >
                Riprova
              </button>
            </div>
          )}
          {showReturnToLatest && (
            <button
              type="button"
              className="lumi-chat-return"
              onClick={() => {
                followOutput.current = true;
                messagesViewport.current?.scrollTo({
                  top: messagesViewport.current.scrollHeight,
                  behavior: "smooth",
                });
                setShowReturnToLatest(false);
              }}
            >
              Torna all’ultima risposta <ArrowDown aria-hidden="true" size={15} />
            </button>
          )}
          {chatNotice && (
            <p className="lumi-chat-upload-note" role="status">
              {chatNotice}
            </p>
          )}
          <form
            className="lumi-chat-composer"
            onSubmit={sendMessage}
            ref={composerForm}
          >
            {!actionMode && selectedDocument && (
              <div className="lumi-chat-attachment">
                <div>
                  <Paperclip aria-hidden="true" size={15} />
                  <span className="lumi-chat-attachment-name">
                    {selectedDocument.fileName}
                  </span>
                  <small>
                    {selectedDocument.scannedAt
                      ? "PDF analizzato"
                      : "PDF · sarà analizzato alla domanda"}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label={`Rimuovi ${selectedDocument.fileName} dalla chat`}
                  title="Rimuovi allegato"
                  disabled={busy || uploading}
                  onClick={() => {
                    setDocumentId("");
                    setUploadNotice("");
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {!actionMode && selectedDocument && !selectedDocument.scannedAt && (
              <p className="lumi-chat-pdf-note">
                Lo analizzo con Python e l’AI locale quando mi chiedi qualcosa
                sul PDF.
              </p>
            )}
            {!actionMode && selectedDocument && (
              <a
                className="lumi-chat-original-link"
                href={`/api/assistant/documents/${encodeURIComponent(selectedDocument.id)}/original`}
                target="_blank"
                rel="noreferrer"
              >
                Apri PDF originale ↗
              </a>
            )}
            {uploadNotice && (
              <p className="lumi-chat-upload-note" role="status">
                {uploadNotice}
              </p>
            )}
            {uploading && (
              <p className="lumi-chat-upload-note" role="status">
                Caricamento PDF…
              </p>
            )}
            <textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(
                  event.currentTarget.scrollHeight,
                  180,
                )}px`;
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  composerForm.current?.requestSubmit();
                }
              }}
              placeholder={
                actionMode
                  ? "Chiedi a Lumi di eseguire un’azione…"
                  : "Chiedi qualcosa a Lumi…"
              }
              maxLength={12_000}
              rows={2}
              aria-label="Messaggio per Lumi"
              disabled={busy}
            />
            <div className="lumi-chat-composer-footer">
              <span>
                {voiceUnavailable
                  ? "La dettatura non è disponibile in questo browser."
                  : recording
                    ? "Sto ascoltando…"
                    : actionMode
                      ? "Posso agire su agenda, note, clienti, preventivi e archivio."
                      : selectedDocument
                        ? "Verifica le cifre nel PDF originale."
                        : "Posso rispondere su qualsiasi argomento."}
              </span>
              <div className="lumi-chat-actions">
                {!actionMode && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="sr-only"
                      disabled={busy || uploading}
                      onChange={(event) =>
                        void uploadPdf(event.target.files?.[0])
                      }
                    />
                    <button
                      type="button"
                      className="lumi-chat-attach-button"
                      aria-label={
                        uploading
                          ? "Caricamento PDF in corso"
                          : "Allega un PDF"
                      }
                      title={uploading ? "Caricamento in corso…" : "Allega PDF"}
                      disabled={busy || uploading || !organizationId}
                      onClick={() => fileInput.current?.click()}
                    >
                      {uploading ? (
                        <LoaderCircle className="is-spinning" aria-hidden="true" size={17} />
                      ) : (
                        <Paperclip aria-hidden="true" size={17} />
                      )}
                    </button>
                  </>
                )}
                <details className="lumi-chat-options">
                  <summary aria-label="Opzioni chat" title="Opzioni chat">
                    <MoreHorizontal aria-hidden="true" size={19} />
                  </summary>
                  <div className="lumi-chat-options-menu">
                    <label>
                      Modalità
                      <select
                        value={actionMode ? "actions" : "chat"}
                        disabled={busy || uploading}
                        onChange={(event) =>
                          setActionMode(event.target.value === "actions")
                        }
                      >
                        <option value="chat">Chat e PDF</option>
                        <option value="actions">Azioni nell’app</option>
                      </select>
                    </label>
                    {!actionMode && (
                      <label>
                        PDF analizzati
                        <select
                          value={documentId}
                          onChange={(event) => {
                            setDocumentId(event.target.value);
                            setUploadNotice("");
                          }}
                          disabled={busy || uploading || documents.length === 0}
                        >
                          <option value="">Chat generale · nessun PDF</option>
                          {documents.map((document) => (
                            <option key={document.id} value={document.id}>
                              {document.fileName}
                              {document.scannedAt
                                ? " · analizzato"
                                : " · da analizzare"}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {organizations.length > 1 && (
                      <label>
                        Azienda
                        <select
                          value={organizationId}
                          disabled={busy || uploading}
                          onChange={(event) =>
                            changeOrganization(event.target.value)
                          }
                        >
                          {organizations.map((organization) => (
                            <option key={organization.id} value={organization.id}>
                              {organization.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </details>
                <button
                  type="button"
                  className={`lumi-chat-microphone ${recording ? "is-recording" : ""}`}
                  aria-label={
                    recording ? "Ferma dettatura" : "Detta un messaggio"
                  }
                  title={recording ? "Ferma dettatura" : "Detta un messaggio"}
                  onClick={toggleRecording}
                  disabled={busy}
                >
                {recording ? (
                  <Square aria-hidden="true" size={15} />
                ) : (
                  <Mic aria-hidden="true" size={17} />
                )}
                </button>
                {busy ? (
                <button
                  type="button"
                  className="lumi-chat-stop"
                  onClick={stopReply}
                >
                  <Square aria-hidden="true" size={14} />
                  Interrompi
                </button>
                ) : (
                <button
                  type="submit"
                  className="lumi-chat-send"
                  disabled={
                      uploading ||
                      (!draft.trim() && (!documentId || actionMode))
                    }
                  >
                    <Send aria-hidden="true" size={15} />
                    Invia
                  </button>
                )}
              </div>
            </div>
          </form>
        </section>
      )}

      {!isAssistantPage && !showPanel && (
        <button
          type="button"
          className={`lumi-chat-launcher${busy ? " is-busy" : ""}${hasUnread ? " has-unread" : ""}`}
          aria-label={
            busy
              ? "Apri chat con Lumi, risposta in corso"
              : hasUnread
                ? "Apri chat con Lumi, nuova risposta"
                : "Apri chat con Lumi"
          }
          aria-expanded={false}
          onClick={() => {
            setOpen(true);
            setHasUnread(false);
            setShowWelcome(false);
          }}
        >
          <span className="lumi-chat-launcher-mark" aria-hidden="true">
            <Sparkles size={17} strokeWidth={1.8} />
          </span>
          <span>Chiedi a Lumi</span>
          {(busy || hasUnread) && (
            <span
              className={`lumi-chat-launcher-indicator${busy ? " is-active" : ""}`}
              aria-hidden="true"
            />
          )}
        </button>
      )}
    </div>
  );
}
