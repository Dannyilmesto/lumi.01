"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import CharacterCount from "@tiptap/extension-character-count";
import Placeholder from "@tiptap/extension-placeholder";
import { isApprovedQuoteStatus } from "@/lib/quote-status";
import {
  DocumentImage,
  DocumentTableCell,
  DocumentTableHeader,
  PageBreak,
  ParagraphIndent,
} from "@/components/quote-editor-extensions";
import {
  documentContentCss,
  type DocumentSettings,
} from "@/lib/quote-document-format";
import type { CatalogProduct } from "@/lib/product-calculator";

// Il calcolatore è visibile solo dopo il click sul pulsante: non serve nel primo caricamento.
const QuoteProductCalculator = dynamic(() =>
  import("@/app/dashboard/preventivi/quote-product-calculator").then(
    (module) => module.QuoteProductCalculator,
  ),
);

type InitialDocument = {
  html: string;
  settings: DocumentSettings;
  revision: number;
  updatedAt: string | null;
  title: string;
  status: string;
  templateHtml: string;
  itemsHtml: string;
};
type Version = {
  revision: number;
  createdAt: string;
  html?: string;
  settings?: DocumentSettings;
};
type Tab = "Testo" | "Inserisci" | "Pagina" | "Revisione";
type ReferenceQuote = {
  id: string;
  title: string;
  customerName: string | null;
};
type ReferenceDocument = { id: string; title: string; html: string };
type ReferenceMode = "price-lists" | "quotes";
type ReferencePriceList = {
  id: string;
  name: string;
  version: string;
  status: string;
  supplier: { name: string };
};

function Tool({
  children,
  label,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={`qe-tool${active ? " is-active" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function QuoteDocumentEditor({
  quoteId,
  initiallySaved,
  initial,
  catalogProducts,
}: {
  quoteId: string;
  initiallySaved: boolean;
  initial: InitialDocument;
  catalogProducts: CatalogProduct[];
}) {
  const endpoint = `/api/quotes/${encodeURIComponent(quoteId)}/document`;
  const draftEndpoint = `/api/quotes/${encodeURIComponent(quoteId)}/draft`;
  const [settings, setSettings] = useState(initial.settings);
  const [tab, setTab] = useState<Tab>("Testo");
  const [zoom, setZoom] = useState(85);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [referenceMode, setReferenceMode] =
    useState<ReferenceMode>("price-lists");
  const [referenceQuery, setReferenceQuery] = useState("");
  const [referenceResults, setReferenceResults] = useState<ReferenceQuote[]>(
    [],
  );
  const [referenceNextOffset, setReferenceNextOffset] = useState<number | null>(
    null,
  );
  const [reference, setReference] = useState<ReferenceDocument | null>(null);
  const [priceListQuery, setPriceListQuery] = useState("");
  const [priceLists, setPriceLists] = useState<ReferencePriceList[]>([]);
  const [priceList, setPriceList] = useState<ReferencePriceList | null>(null);
  const [referenceError, setReferenceError] = useState("");
  const [calculatorWidth, setCalculatorWidth] = useState(24);
  const [referenceWidth, setReferenceWidth] = useState(28);
  const splitRef = useRef<HTMLDivElement>(null);
  const [saveStatus, setSaveStatus] = useState(
    !initiallySaved
      ? "Preventivo non salvato"
      : initial.revision
        ? "Tutte le modifiche salvate"
        : "Modello pronto da personalizzare",
  );
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [protectedEnabled, setProtectedEnabled] = useState(
    !isApprovedQuoteStatus(initial.status),
  );
  const [revision, setRevision] = useState(initial.revision);
  const [versions, setVersions] = useState<Version[]>([]);
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [notice, setNotice] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const htmlRef = useRef(initial.html);
  const settingsRef = useRef(initial.settings);
  const revisionRef = useRef(initial.revision);
  const dirtyRef = useRef(false);
  const generation = useRef(0);
  const editorContentRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const protectedRef = useRef(!isApprovedQuoteStatus(initial.status));
  const flight = useRef<Promise<boolean> | null>(null);
  const saveQuoteRef = useRef<() => Promise<void>>(async () => undefined);
  const savedRef = useRef(initiallySaved);
  const uploadRef = useRef<(files: File[]) => Promise<void>>(
    async () => undefined,
  );
  const mounted = useRef(true);
  const uploadingRef = useRef(false);

  const searchReference = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      const response = await fetch(
        `/api/profile/quotes?available=1&offset=${offset}&q=${encodeURIComponent(referenceQuery)}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error("Ricerca non disponibile.");
      const result = (await response.json()) as {
        items: ReferenceQuote[];
        nextOffset: number | null;
      };
      setReferenceResults((current) =>
        offset
          ? [...current, ...result.items.filter((item) => item.id !== quoteId)]
          : result.items.filter((item) => item.id !== quoteId),
      );
      setReferenceNextOffset(result.nextOffset);
      setReferenceError("");
    },
    [quoteId, referenceQuery],
  );

  const searchPriceLists = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/quotes/${encodeURIComponent(quoteId)}/price-lists?q=${encodeURIComponent(priceListQuery)}`,
        { signal, cache: "no-store" },
      );
      const result = (await response.json()) as {
        priceLists?: ReferencePriceList[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Ricerca listini non disponibile.");
      setPriceLists(result.priceLists || []);
      setReferenceError("");
    },
    [priceListQuery, quoteId],
  );

  useEffect(() => {
    if (!referenceOpen || referenceMode !== "quotes") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        await searchReference(0, controller.signal);
      } catch (caught) {
        if (!controller.signal.aborted)
          setReferenceError(
            caught instanceof Error
              ? caught.message
              : "Ricerca non disponibile.",
          );
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [referenceMode, referenceOpen, searchReference]);

  useEffect(() => {
    if (!referenceOpen || referenceMode !== "price-lists") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        await searchPriceLists(controller.signal);
      } catch (caught) {
        if (!controller.signal.aborted)
          setReferenceError(
            caught instanceof Error
              ? caught.message
              : "Ricerca listini non disponibile.",
          );
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [referenceMode, referenceOpen, searchPriceLists]);

  async function openReference(item: ReferenceQuote) {
    try {
      const response = await fetch(
        `/api/quotes/${encodeURIComponent(item.id)}/document`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as { html?: string; error?: string };
      if (!response.ok || !data.html)
        throw new Error(data.error || "Preventivo non disponibile.");
      setReference({ id: item.id, title: item.title, html: data.html });
      setReferenceError("");
    } catch (caught) {
      setReferenceError(
        caught instanceof Error ? caught.message : "Apertura non riuscita.",
      );
    }
  }

  function resizePane(edge: "calculator" | "reference", clientX: number) {
    const bounds = splitRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const position = ((clientX - bounds.left) / bounds.width) * 100;
    if (edge === "calculator") {
      const maximum = 70 - (referenceOpen ? referenceWidth : 0);
      setCalculatorWidth(Math.min(maximum, Math.max(15, position)));
    } else {
      const maximum = 70 - (calculatorOpen ? calculatorWidth : 0);
      setReferenceWidth(Math.min(maximum, Math.max(15, 100 - position)));
    }
  }

  function beginResize(
    event: ReactPointerEvent<HTMLDivElement>,
    edge: "calculator" | "reference",
  ) {
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      resizePane(edge, moveEvent.clientX);
    const stop = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  }

  function markChanged() {
    generation.current += 1;
    dirtyRef.current = true;
    setSaveStatus("Modifiche non salvate");
  }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      TableKit.configure({
        table: { resizable: true },
        tableCell: false,
        tableHeader: false,
      }),
      DocumentTableCell,
      DocumentTableHeader,
      DocumentImage.configure({ allowBase64: false }),
      Subscript,
      Superscript,
      CharacterCount,
      Placeholder.configure({ placeholder: "Scrivi il tuo preventivo…" }),
      PageBreak,
      ParagraphIndent,
    ],
    content: initial.html,
    editable: !isApprovedQuoteStatus(initial.status),
    editorProps: {
      attributes: {
        class: "document-content",
        "aria-label": "Contenuto del preventivo",
        spellcheck: "true",
      },
      transformPastedHTML(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("img").forEach((img) => {
          if (!img.getAttribute("src")?.startsWith(`${endpoint}/images/`))
            img.remove();
        });
        return doc.body.innerHTML;
      },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        void uploadRef.current(files);
        return true;
      },
      handleDrop(_view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        void uploadRef.current(files);
        return true;
      },
    },
    onUpdate({ editor: current }) {
      htmlRef.current = current.getHTML();
      // Dopo la prima modifica il confronto del contenuto non serve più:
      // evita di serializzare l'intero documento in JSON a ogni battitura.
      if (editorContentRef.current !== null && dirtyRef.current) {
        markChanged();
        return;
      }
      const content = JSON.stringify(current.getJSON());
      if (editorContentRef.current === null) {
        editorContentRef.current = content;
        return;
      }
      if (content === editorContentRef.current) return;
      markChanged();
    },
    onCreate({ editor: current }) {
      editorContentRef.current = JSON.stringify(current.getJSON());
    },
  });

  const selection = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            underline: current.isActive("underline"),
            strike: current.isActive("strike"),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            table: current.isActive("table"),
            image: current.isActive("image"),
            family: current.getAttributes("textStyle").fontFamily || "Arial",
            size: current.getAttributes("textStyle").fontSize || "11pt",
            heading: current.isActive("heading")
              ? String(current.getAttributes("heading").level)
              : "p",
            align:
              current.getAttributes(
                current.isActive("heading") ? "heading" : "paragraph",
              ).textAlign || "left",
            imageWidth: Number(current.getAttributes("image").width || 480),
            imageAlign: current.getAttributes("image").align || "left",
            words: Number(current.storage.characterCount.words()),
            chars: Number(current.storage.characterCount.characters()),
          }
        : null,
  });

  const readOnly =
    !protectedEnabled || exporting || restoring || leaving || conflict;
  const leaveWithoutSaving = useCallback(
    async (href: string) => {
      setLeaving(true);
      try {
        if (!savedRef.current) {
          const response = await fetch(draftEndpoint, {
            method: "DELETE",
          });
          if (!response.ok)
            throw new Error("Bozza non eliminata. Riprova prima di uscire.");
        }
        dirtyRef.current = false;
        setPendingDiscard(null);
        window.location.assign(href);
      } catch (caught) {
        setLeaving(false);
        setError(
          caught instanceof Error
            ? caught.message
            : "Bozza non eliminata. Riprova prima di uscire.",
        );
      }
    },
    [draftEndpoint],
  );
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);
  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || flight.current || uploadingRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const saveKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveQuoteRef.current();
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        !dirtyRef.current &&
        !flight.current &&
        !uploadingRef.current &&
        savedRef.current
      )
        return;
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        !anchor.href ||
        anchor.getAttribute("href")?.startsWith("#")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (uploadingRef.current) {
        setNotice(
          "Attendi il completamento del caricamento immagini prima di uscire.",
        );
        return;
      }
      if (
        dirtyRef.current &&
        !window.confirm("Uscire senza salvare le modifiche al preventivo?")
      )
        return;
      setPendingDiscard(anchor.href);
      void leaveWithoutSaving(anchor.href);
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("keydown", saveKey);
    document.addEventListener("click", navigate, true);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("keydown", saveKey);
      document.removeEventListener("click", navigate, true);
    };
  }, [endpoint, leaveWithoutSaving]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function saveDocument(): Promise<boolean> {
    if (flight.current) {
      if (!(await flight.current)) return false;
      return saveDocument();
    }
    if (conflictRef.current || !protectedRef.current) return false;
    if (!dirtyRef.current && revisionRef.current > 0) return true;
    const savedGeneration = generation.current;
    const body = {
      html: htmlRef.current,
      settings: settingsRef.current,
      revision: revisionRef.current,
      confirmProtected:
        isApprovedQuoteStatus(initial.status) && protectedRef.current,
    };
    setSaveStatus("Salvataggio…");
    setError("");
    const task = (async () => {
      try {
        const response = await fetch(endpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        const data = await response.json();
        if (!response.ok) {
          if (data.conflict || data.requiresConfirmation) {
            conflictRef.current = true;
            setConflict(true);
          }
          throw new Error(data.error || "Salvataggio non riuscito.");
        }
        revisionRef.current = data.revision;
        if (generation.current === savedGeneration) {
          dirtyRef.current = false;
          editorContentRef.current = JSON.stringify(editor?.getJSON());
        }
        if (mounted.current) {
          setRevision(data.revision);
          setSaveStatus(
            dirtyRef.current
              ? "Modifiche da salvare"
              : "Tutte le modifiche salvate",
          );
        }
        return true;
      } catch (caught) {
        if (mounted.current) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Salvataggio non riuscito.",
          );
          setSaveStatus("Non salvato — riprova");
        }
        return false;
      } finally {
        flight.current = null;
      }
    })();
    flight.current = task;
    return task;
  }
  async function saveQuote() {
    if (!(await saveDocument())) return;
    if (savedRef.current) return;
    setSaveStatus("Salvataggio preventivo…");
    try {
      const response = await fetch("/api/profile/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteIds: [quoteId], action: "save" }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error || "Salvataggio preventivo non riuscito.");
      savedRef.current = true;
      setSaveStatus("Preventivo salvato");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Salvataggio preventivo non riuscito.",
      );
      setSaveStatus("Non salvato — riprova");
    }
  }
  saveQuoteRef.current = saveQuote;

  function updateSettings(patch: Partial<DocumentSettings>) {
    if (readOnly) return;
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    markChanged();
  }

  async function uploadImages(files: File[]) {
    if (
      !editor ||
      !protectedRef.current ||
      conflictRef.current ||
      uploadingRef.current ||
      exporting ||
      restoring ||
      leaving
    )
      return;
    setUploading(true);
    uploadingRef.current = true;
    setError("");
    try {
      for (const file of files.slice(0, 8)) {
        if (file.size > 10 * 1024 * 1024)
          throw new Error("Ogni immagine deve essere inferiore a 10 MB.");
        const form = new FormData();
        form.set("file", file);
        form.set(
          "confirmProtected",
          String(isApprovedQuoteStatus(initial.status) && protectedRef.current),
        );
        const response = await fetch(`${endpoint}/images`, {
          method: "POST",
          body: form,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Caricamento non riuscito.");
        if (!editor.isDestroyed)
          editor
            .chain()
            .focus()
            .setImage({ src: data.src, alt: data.alt })
            .run();
      }
      if (files.length > 8)
        setNotice(
          "Inserite le prime 8 immagini. Carica le altre in un secondo gruppo.",
        );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Immagine non caricata.",
      );
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  uploadRef.current = uploadImages;

  async function exportPdf(asPreview = false) {
    if (exporting || uploading) return;
    setExporting(true);
    setError("");
    try {
      if (!savedRef.current || dirtyRef.current || revisionRef.current === 0)
        throw new Error("Salva il preventivo prima di esportare.");
      const response = await fetch(
        `${endpoint}/pdf?revision=${revisionRef.current}`,
        { signal: AbortSignal.timeout(90_000) },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Esportazione non riuscita.");
      }
      const blob = await response.blob();
      if (asPreview) setPreview(URL.createObjectURL(blob));
      else
        downloadBlob(
          blob,
          `${initial.title.replace(/[\\/]/g, "-") || "preventivo"}.pdf`,
        );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Esportazione non riuscita.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function archivePdf() {
    if (archiving || exporting || uploading) return;
    setArchiving(true);
    setError("");
    try {
      if (!savedRef.current || dirtyRef.current || revisionRef.current === 0)
        throw new Error("Salva il preventivo prima di archiviarlo.");
      const response = await fetch("/api/profile/archive/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = (await response.json()) as {
        path?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || "Salvataggio in archivio non riuscito.");
      setNotice(`PDF salvato nell’Archivio: ${data.path}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Salvataggio in archivio non riuscito.",
      );
    } finally {
      setArchiving(false);
    }
  }

  function backup() {
    downloadBlob(
      new Blob(
        [
          `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Preventivo</title><style>${documentContentCss}</style></head><body class="document-content">${htmlRef.current}</body></html>`,
        ],
        { type: "text/html;charset=utf-8" },
      ),
      "preventivo-copia-locale.html",
    );
    setNotice(
      "Copia del testo salvata sul computer. Le immagini nella copia rimandano a questo gestionale.",
    );
  }

  async function loadVersions() {
    try {
      const response = await fetch(`${endpoint}/versions`);
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Cronologia non disponibile.");
      setVersions(data.versions);
      if (!data.versions.length)
        setNotice("La cronologia sarà disponibile dopo il primo salvataggio.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Cronologia non disponibile.",
      );
    }
  }

  async function restoreVersion(value: number) {
    if (
      !editor ||
      readOnly ||
      uploading ||
      !window.confirm(
        `Ripristinare la versione ${value}? Il documento attuale verrà prima salvato nella cronologia.`,
      )
    )
      return;
    setRestoring(true);
    try {
      const response = await fetch(`${endpoint}/versions?revision=${value}`);
      const data = await response.json();
      const version: Version | undefined = data.versions?.[0];
      if (!response.ok || !version?.html || !version.settings)
        throw new Error(data.error || "Versione non disponibile.");
      if (dirtyRef.current || revisionRef.current === 0)
        throw new Error(
          "Salva il documento prima di ripristinare una versione.",
        );
      editor.commands.setContent(version.html, { emitUpdate: false });
      htmlRef.current = editor.getHTML();
      settingsRef.current = version.settings;
      setSettings(version.settings);
      markChanged();
      setNotice(`Versione ${value} ripristinata come nuova modifica.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Ripristino non riuscito.",
      );
    } finally {
      setRestoring(false);
    }
  }

  async function insertCurrentItems() {
    if (!editor || readOnly) return;
    try {
      const response = await fetch(endpoint);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Voci non disponibili.");
      editor.chain().focus().insertContent(data.itemsHtml).run();
      setNotice(
        "Inserite le voci attuali e i totali disponibili del gestionale.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Voci non disponibili.",
      );
    }
  }

  function searchText(replaceAll = false) {
    if (!editor || !find.trim()) return;
    const matches: Array<{ from: number; to: number }> = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      const haystack = node.text.toLocaleLowerCase("it");
      const needle = find.toLocaleLowerCase("it");
      let start = 0;
      let at = haystack.indexOf(needle, start);
      while (at >= 0) {
        matches.push({ from: pos + at, to: pos + at + find.length });
        start = at + find.length;
        at = haystack.indexOf(needle, start);
      }
    });
    if (!matches.length) {
      setNotice(
        "Nessuna corrispondenza nel testo. La ricerca non attraversa cambi di formattazione.",
      );
      return;
    }
    if (replaceAll && !readOnly) {
      const transaction = editor.state.tr;
      for (const match of [...matches].reverse())
        transaction.insertText(replacement, match.from, match.to);
      editor.view.dispatch(transaction);
      setNotice(
        `${matches.length} sostituzioni effettuate. Usa Annulla per ripristinare.`,
      );
    } else {
      const match =
        matches.find((item) => item.from >= editor.state.selection.to) ||
        matches[0];
      editor.chain().focus().setTextSelection(match).scrollIntoView().run();
      setNotice(`${matches.length} corrispondenze trovate.`);
    }
  }

  function indent(delta: number) {
    if (!editor) return;
    if (editor.isActive("listItem")) {
      if (delta > 0) editor.chain().focus().sinkListItem("listItem").run();
      else editor.chain().focus().liftListItem("listItem").run();
      return;
    }
    const node = editor.isActive("heading") ? "heading" : "paragraph";
    const value = Number(editor.getAttributes(node).indent || 0);
    editor
      .chain()
      .focus()
      .updateAttributes(node, {
        indent: Math.max(0, Math.min(160, value + delta)),
      })
      .run();
  }

  if (!editor)
    return (
      <div className="qe-loading" role="status">
        Preparazione dell’editor…
      </div>
    );
  const dimensions = settings.format === "A4" ? [210, 297] : [216, 279];
  const width = dimensions[settings.landscape ? 1 : 0];
  const height = dimensions[settings.landscape ? 0 : 1];
  const paperStyle = {
    width: `${width}mm`,
    minHeight: `${height}mm`,
    padding: `${settings.margin}mm`,
    "--qe-content-min-height": `${height - 2 * settings.margin}mm`,
    "--document-image-max-height": `${height - 2 * settings.margin - 12}mm`,
    zoom: zoom / 100,
  } as CSSProperties;

  return (
    <section className="quote-editor" aria-label="Editor del preventivo">
      <style>{documentContentCss}</style>
      <div className="qe-commandbar">
        <div>
          <Link
            href="/dashboard/preventivi"
            className="qe-secondary mb-2 inline-flex"
          >
            ← Preventivi
          </Link>
          <span className="qe-eyebrow">DOCUMENTO DEL PREVENTIVO</span>
          <p className="qe-save-state" role="status" aria-live="polite">
            {saveStatus}
            {revision > 0 ? ` · v${revision}` : ""}
          </p>
        </div>
        <div className="qe-actions">
          <button
            type="button"
            className="qe-secondary"
            aria-expanded={calculatorOpen}
            onClick={() => setCalculatorOpen((value) => !value)}
          >
            {calculatorOpen ? "Chiudi calcolatore" : "Calcola prodotti"}
          </button>
          <button
            type="button"
            className="qe-secondary"
            aria-expanded={referenceOpen}
            onClick={() => setReferenceOpen((value) => !value)}
          >
            {referenceOpen ? "Chiudi affiancamento" : "Affianca listino"}
          </button>
          <button
            type="button"
            className="qe-secondary"
            disabled={readOnly || uploading}
            onClick={() => void saveQuote()}
          >
            Salva
          </button>
          <button
            type="button"
            className="qe-secondary"
            disabled={archiving || exporting || uploading || conflict}
            onClick={() => void archivePdf()}
          >
            {archiving ? "Archiviazione…" : "Salva in Archivio"}
          </button>
          <button
            type="button"
            className="qe-secondary"
            disabled={exporting || uploading || conflict}
            onClick={() => void exportPdf(true)}
          >
            Anteprima
          </button>
          <button
            type="button"
            className="qe-primary"
            disabled={exporting || uploading || conflict}
            onClick={() => void exportPdf()}
          >
            {exporting ? "Preparazione PDF…" : "↓ Esporta PDF"}
          </button>
        </div>
      </div>
      {isApprovedQuoteStatus(initial.status) && !protectedEnabled && (
        <div className="qe-notice">
          Il preventivo è approvato.{" "}
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Confermi di voler modificare il documento di questo preventivo approvato? Le versioni precedenti resteranno nella cronologia.",
                )
              ) {
                protectedRef.current = true;
                setProtectedEnabled(true);
              }
            }}
          >
            Abilita modifica
          </button>
        </div>
      )}
      {error && (
        <div className="qe-error" role="alert">
          {error}{" "}
          {conflict ? (
            <>
              <button type="button" onClick={backup}>
                Salva copia locale
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Ricaricare la versione del server? Le modifiche non salvate verranno perse.",
                    )
                  )
                    window.location.reload();
                }}
              >
                Ricarica
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                pendingDiscard
                  ? void leaveWithoutSaving(pendingDiscard)
                  : void saveQuote()
              }
            >
              {pendingDiscard ? "Riprova eliminazione" : "Riprova salvataggio"}
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="qe-notice" role="status">
          {notice}
          <button
            type="button"
            aria-label="Chiudi messaggio"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      <div className="qe-tabs" role="tablist" aria-label="Strumenti documento">
        {(["Testo", "Inserisci", "Pagina", "Revisione"] as Tab[]).map(
          (name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => {
                setTab(name);
                if (name === "Revisione") void loadVersions();
              }}
            >
              {name}
            </button>
          ),
        )}
        <span className="qe-shortcut">⌘ / Ctrl + S per salvare</span>
      </div>
      <div
        className="qe-ribbon"
        role="tabpanel"
        aria-label={`Strumenti ${tab}`}
      >
        {tab === "Testo" && (
          <>
            <div className="qe-group">
              <Tool
                label="Annulla"
                disabled={readOnly || !editor.can().undo()}
                onClick={() => editor.chain().focus().undo().run()}
              >
                ↶
              </Tool>
              <Tool
                label="Ripeti"
                disabled={readOnly || !editor.can().redo()}
                onClick={() => editor.chain().focus().redo().run()}
              >
                ↷
              </Tool>
            </div>
            <div className="qe-group">
              <select
                aria-label="Stile paragrafo"
                disabled={readOnly}
                value={selection?.heading || "p"}
                onChange={(event) =>
                  event.target.value === "p"
                    ? editor.chain().focus().setParagraph().run()
                    : editor
                        .chain()
                        .focus()
                        .setHeading({
                          level: Number(event.target.value) as 1 | 2 | 3,
                        })
                        .run()
                }
              >
                <option value="p">Testo normale</option>
                <option value="1">Titolo</option>
                <option value="2">Titolo 2</option>
                <option value="3">Titolo 3</option>
              </select>
              <select
                aria-label="Carattere"
                disabled={readOnly}
                value={selection?.family}
                onChange={(event) =>
                  editor.chain().focus().setFontFamily(event.target.value).run()
                }
              >
                {[
                  "Arial",
                  "Georgia",
                  "Verdana",
                  "Times New Roman",
                  "Courier New",
                ].map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
              <select
                aria-label="Dimensione carattere"
                disabled={readOnly}
                value={selection?.size}
                onChange={(event) =>
                  editor.chain().focus().setFontSize(event.target.value).run()
                }
              >
                {[
                  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72,
                ].map((size) => (
                  <option key={size} value={`${size}pt`}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <div className="qe-group">
              <Tool
                label="Grassetto"
                active={selection?.bold}
                disabled={readOnly}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <strong>B</strong>
              </Tool>
              <Tool
                label="Corsivo"
                active={selection?.italic}
                disabled={readOnly}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <em>I</em>
              </Tool>
              <Tool
                label="Sottolineato"
                active={selection?.underline}
                disabled={readOnly}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              >
                <u>U</u>
              </Tool>
              <Tool
                label="Barrato"
                active={selection?.strike}
                disabled={readOnly}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              >
                <s>S</s>
              </Tool>
              <label className="qe-color" title="Colore testo">
                A
                <input
                  type="color"
                  aria-label="Colore testo"
                  disabled={readOnly}
                  defaultValue="#172d3b"
                  onChange={(event) =>
                    editor.chain().focus().setColor(event.target.value).run()
                  }
                />
              </label>
              <label className="qe-color" title="Evidenziatore">
                ▰
                <input
                  type="color"
                  aria-label="Colore evidenziatore"
                  disabled={readOnly}
                  defaultValue="#fff09b"
                  onChange={(event) =>
                    editor
                      .chain()
                      .focus()
                      .setHighlight({ color: event.target.value })
                      .run()
                  }
                />
              </label>
              <Tool
                label="Rimuovi formattazione"
                disabled={readOnly}
                onClick={() =>
                  editor.chain().focus().unsetAllMarks().clearNodes().run()
                }
              >
                Tx
              </Tool>
            </div>
            <div className="qe-group">
              {(
                [
                  ["left", "Sinistra", "≡"],
                  ["center", "Centro", "☰"],
                  ["right", "Destra", "≡"],
                  ["justify", "Giustificato", "▤"],
                ] as const
              ).map(([value, label, glyph]) => (
                <Tool
                  key={value}
                  label={`Allinea a ${label.toLowerCase()}`}
                  active={selection?.align === value}
                  disabled={readOnly}
                  onClick={() =>
                    editor.chain().focus().setTextAlign(value).run()
                  }
                >
                  <span>
                    {glyph}
                    <small>{label.slice(0, 1)}</small>
                  </span>
                </Tool>
              ))}
              <Tool
                label="Elenco puntato"
                active={selection?.bullet}
                disabled={readOnly}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                • ≡
              </Tool>
              <Tool
                label="Elenco numerato"
                active={selection?.ordered}
                disabled={readOnly}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                1. ≡
              </Tool>
              <Tool
                label="Riduci rientro"
                disabled={readOnly}
                onClick={() => indent(-20)}
              >
                ←
              </Tool>
              <Tool
                label="Aumenta rientro"
                disabled={readOnly}
                onClick={() => indent(20)}
              >
                →
              </Tool>
            </div>
            <div className="qe-group">
              <select
                aria-label="Interlinea"
                disabled={readOnly}
                defaultValue="1.5"
                onChange={(event) =>
                  editor.chain().focus().setLineHeight(event.target.value).run()
                }
              >
                {["1", "1.15", "1.5", "2", "2.5", "3"].map((line) => (
                  <option key={line} value={line}>
                    Interlinea {line}
                  </option>
                ))}
              </select>
              <Tool
                label="Apice"
                disabled={readOnly}
                onClick={() => editor.chain().focus().toggleSuperscript().run()}
              >
                x²
              </Tool>
              <Tool
                label="Pedice"
                disabled={readOnly}
                onClick={() => editor.chain().focus().toggleSubscript().run()}
              >
                x₂
              </Tool>
            </div>
          </>
        )}
        {tab === "Inserisci" && (
          <>
            <div className="qe-group">
              <Tool
                label="Inserisci immagini"
                disabled={readOnly || uploading}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? "Caricamento…" : "▧ Immagini"}
              </Tool>
              <Tool
                label="Inserisci tabella 3 × 3"
                disabled={readOnly}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run()
                }
              >
                ▦ Tabella
              </Tool>
              <Tool
                label="Inserisci voci e totali dal gestionale"
                disabled={readOnly}
                onClick={() => void insertCurrentItems()}
              >
                Voci del preventivo
              </Tool>
              <Tool
                label="Interruzione di pagina"
                disabled={readOnly}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertContent({ type: "pageBreak" })
                    .run()
                }
              >
                Nuova pagina
              </Tool>
              <Tool
                label="Linea divisoria"
                disabled={readOnly}
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
              >
                — Linea
              </Tool>
            </div>
            <div className="qe-group">
              <input
                type="url"
                aria-label="Indirizzo collegamento"
                placeholder="https://…"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
              />
              <Tool
                label="Applica collegamento al testo selezionato"
                disabled={readOnly}
                onClick={() => {
                  if (!/^(https?:\/\/|mailto:|tel:)/i.test(linkUrl)) {
                    setError(
                      "Inserisci un collegamento https://, http://, mailto: o tel:.",
                    );
                    return;
                  }
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .setLink({ href: linkUrl })
                    .run();
                }}
              >
                Collegamento
              </Tool>
              <Tool
                label="Rimuovi collegamento"
                disabled={readOnly}
                onClick={() => editor.chain().focus().unsetLink().run()}
              >
                Scollega
              </Tool>
            </div>
          </>
        )}
        {tab === "Pagina" && (
          <>
            <label>
              Formato
              <select
                disabled={readOnly}
                value={settings.format}
                onChange={(event) =>
                  updateSettings({
                    format: event.target.value as DocumentSettings["format"],
                  })
                }
              >
                <option>A4</option>
                <option>Letter</option>
              </select>
            </label>
            <label>
              Orientamento
              <select
                disabled={readOnly}
                value={String(settings.landscape)}
                onChange={(event) =>
                  updateSettings({ landscape: event.target.value === "true" })
                }
              >
                <option value="false">Verticale</option>
                <option value="true">Orizzontale</option>
              </select>
            </label>
            <label>
              Margini
              <select
                disabled={readOnly}
                value={settings.margin}
                onChange={(event) =>
                  updateSettings({ margin: Number(event.target.value) })
                }
              >
                {[12, 15, 20, 25, 30, 35].map((margin) => (
                  <option key={margin} value={margin}>
                    {margin} mm
                  </option>
                ))}
              </select>
            </label>
            <label>
              Intestazione
              <input
                disabled={readOnly}
                maxLength={160}
                value={settings.header}
                onChange={(event) =>
                  updateSettings({ header: event.target.value })
                }
              />
            </label>
            <label>
              Piè di pagina
              <input
                disabled={readOnly}
                maxLength={160}
                value={settings.footer}
                onChange={(event) =>
                  updateSettings({ footer: event.target.value })
                }
              />
            </label>
            <label className="qe-checkbox">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={settings.pageNumbers}
                onChange={(event) =>
                  updateSettings({ pageNumbers: event.target.checked })
                }
              />{" "}
              Numeri di pagina
            </label>
          </>
        )}
        {tab === "Revisione" && (
          <>
            <div className="qe-group">
              <input
                aria-label="Testo da cercare"
                placeholder="Trova nel documento"
                value={find}
                onChange={(event) => setFind(event.target.value)}
              />
              <Tool label="Trova successivo" onClick={() => searchText()}>
                Trova
              </Tool>
              <input
                aria-label="Testo sostitutivo"
                placeholder="Sostituisci con"
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
              />
              <Tool
                label="Sostituisci tutte le occorrenze"
                disabled={readOnly}
                onClick={() => searchText(true)}
              >
                Sostituisci tutte
              </Tool>
            </div>
            <div className="qe-group">
              <select
                aria-label="Ripristina una versione"
                disabled={readOnly || versions.length === 0}
                value=""
                onChange={(event) => {
                  if (event.target.value)
                    void restoreVersion(Number(event.target.value));
                }}
              >
                <option value="">Cronologia (ultime 100)</option>
                {versions.map((version) => (
                  <option key={version.revision} value={version.revision}>
                    v{version.revision} ·{" "}
                    {new Date(version.createdAt).toLocaleString("it-IT")}
                  </option>
                ))}
              </select>
              <Tool
                label="Aggiorna cronologia"
                onClick={() => void loadVersions()}
              >
                ↻
              </Tool>
              <Tool label="Salva una copia locale del testo" onClick={backup}>
                Copia locale
              </Tool>
            </div>
          </>
        )}
      </div>
      {selection?.table && (
        <div className="qe-contextbar" aria-label="Strumenti tabella">
          <span>Tabella</span>
          <Tool
            label="Aggiungi riga"
            disabled={readOnly}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            + Riga
          </Tool>
          <Tool
            label="Aggiungi colonna"
            disabled={readOnly}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            + Colonna
          </Tool>
          <Tool
            label="Elimina riga"
            disabled={readOnly}
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            − Riga
          </Tool>
          <Tool
            label="Elimina colonna"
            disabled={readOnly}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            − Colonna
          </Tool>
          <Tool
            label="Unisci celle selezionate"
            disabled={readOnly || !editor.can().mergeCells()}
            onClick={() => editor.chain().focus().mergeCells().run()}
          >
            Unisci
          </Tool>
          <Tool
            label="Dividi cella"
            disabled={readOnly || !editor.can().splitCell()}
            onClick={() => editor.chain().focus().splitCell().run()}
          >
            Dividi
          </Tool>
          <Tool
            label="Riga intestazione"
            disabled={readOnly}
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          >
            Intestazione
          </Tool>
          <label className="qe-color">
            Sfondo
            <input
              type="color"
              aria-label="Sfondo cella"
              disabled={readOnly}
              defaultValue="#eaf3f8"
              onChange={(event) =>
                editor
                  .chain()
                  .focus()
                  .setCellAttribute("backgroundColor", event.target.value)
                  .run()
              }
            />
          </label>
          <Tool
            label="Elimina tabella"
            disabled={readOnly}
            onClick={() => {
              if (window.confirm("Eliminare questa tabella?"))
                editor.chain().focus().deleteTable().run();
            }}
          >
            Elimina tabella
          </Tool>
        </div>
      )}
      {selection?.image && (
        <div className="qe-contextbar">
          <span>Immagine selezionata</span>
          <label>
            Larghezza{" "}
            <input
              type="range"
              aria-label="Larghezza immagine"
              min="60"
              max="800"
              step="10"
              disabled={readOnly}
              value={selection.imageWidth}
              onChange={(event) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes("image", {
                    width: Number(event.target.value),
                  })
                  .run()
              }
            />{" "}
            {selection.imageWidth} px
          </label>
          {(["left", "center", "right"] as const).map((align, index) => (
            <Tool
              key={align}
              label={`Immagine ${["a sinistra", "al centro", "a destra"][index]}`}
              active={selection.imageAlign === align}
              disabled={readOnly}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes("image", { align })
                  .run()
              }
            >
              {["Sinistra", "Centro", "Destra"][index]}
            </Tool>
          ))}
          <Tool
            label="Elimina immagine dal documento"
            disabled={readOnly}
            onClick={() => editor.chain().focus().deleteSelection().run()}
          >
            Rimuovi
          </Tool>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="sr-only"
        aria-label="Carica immagini nel preventivo"
        onChange={(event) =>
          void uploadImages(Array.from(event.target.files ?? []))
        }
      />
      <div
        className={`qe-split${referenceOpen || calculatorOpen ? " is-open" : ""}${referenceOpen && calculatorOpen ? " has-both-panels" : ""}`}
        ref={splitRef}
      >
        {calculatorOpen && (
          <>
            <aside
              className="qe-reference qe-product-panel is-open"
              aria-label="Calcola prodotti"
              style={{ width: `${calculatorWidth}%` }}
            >
              <QuoteProductCalculator products={catalogProducts} compact />
            </aside>
            <div
              className="qe-divider"
              role="separator"
              aria-label="Ridimensiona pannello calcolatore"
              aria-orientation="vertical"
              aria-valuenow={Math.round(calculatorWidth)}
              aria-valuemin={15}
              aria-valuemax={Math.round(
                70 - (referenceOpen ? referenceWidth : 0),
              )}
              tabIndex={0}
              onPointerDown={(event) => beginResize(event, "calculator")}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const maximum = 70 - (referenceOpen ? referenceWidth : 0);
                  setCalculatorWidth((value) =>
                    Math.min(
                      maximum,
                      Math.max(
                        15,
                        value + (event.key === "ArrowRight" ? 3 : -3),
                      ),
                    ),
                  );
                }
              }}
            />
          </>
        )}
        <div className="qe-workspace">
          <div className="qe-paper" style={paperStyle}>
            <div
              className="qe-paper-header"
              style={{
                left: `${settings.margin}mm`,
                right: `${settings.margin}mm`,
              }}
              aria-hidden="true"
            >
              {settings.header}
            </div>
            <EditorContent editor={editor} />
            <div
              className="qe-paper-footer"
              style={{
                left: `${settings.margin}mm`,
                right: `${settings.margin}mm`,
              }}
              aria-hidden="true"
            >
              <span>{settings.footer}</span>
              <span>
                {settings.pageNumbers ? "Numerazione automatica nel PDF" : ""}
              </span>
            </div>
          </div>
        </div>
        {referenceOpen && (
          <>
            <div
              className="qe-divider"
              role="separator"
              aria-label="Ridimensiona pannello listino"
              aria-orientation="vertical"
              aria-valuenow={Math.round(referenceWidth)}
              aria-valuemin={15}
              aria-valuemax={Math.round(
                70 - (calculatorOpen ? calculatorWidth : 0),
              )}
              tabIndex={0}
              onPointerDown={(event) => beginResize(event, "reference")}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const maximum = 70 - (calculatorOpen ? calculatorWidth : 0);
                  setReferenceWidth((value) =>
                    Math.min(
                      maximum,
                      Math.max(
                        15,
                        value + (event.key === "ArrowLeft" ? 3 : -3),
                      ),
                    ),
                  );
                }
              }}
            />
            <aside
              className="qe-reference"
              aria-label="Documento di riferimento"
              style={{ width: `${referenceWidth}%` }}
            >
              <div className="qe-reference-search">
                <h2>Documento affiancato</h2>
                <div
                  className="qe-reference-tabs"
                  role="group"
                  aria-label="Tipo di documento da affiancare"
                >
                  <button
                    type="button"
                    aria-pressed={referenceMode === "price-lists"}
                    onClick={() => {
                      setReferenceMode("price-lists");
                      setReferenceError("");
                    }}
                  >
                    Listini PDF
                  </button>
                  <button
                    type="button"
                    aria-pressed={referenceMode === "quotes"}
                    onClick={() => {
                      setReferenceMode("quotes");
                      setReferenceError("");
                    }}
                  >
                    Preventivi
                  </button>
                </div>
                {referenceMode === "price-lists" ? (
                  <input
                    type="search"
                    aria-label="Cerca un listino da affiancare"
                    placeholder="Cerca listino, versione o fornitore…"
                    value={priceListQuery}
                    onChange={(event) => setPriceListQuery(event.target.value)}
                  />
                ) : (
                  <input
                    type="search"
                    aria-label="Cerca un preventivo da confrontare"
                    placeholder="Cerca per titolo o cliente…"
                    value={referenceQuery}
                    onChange={(event) => setReferenceQuery(event.target.value)}
                  />
                )}
                {referenceError && <p role="alert">{referenceError}</p>}
                <div className="qe-reference-results">
                  {referenceMode === "price-lists"
                    ? priceLists.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setPriceList(item)}
                          aria-current={
                            priceList?.id === item.id ? "true" : undefined
                          }
                        >
                          {item.name} · {item.supplier.name} · v{item.version}
                        </button>
                      ))
                    : referenceResults.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => void openReference(item)}
                          aria-current={
                            reference?.id === item.id ? "true" : undefined
                          }
                        >
                          {item.title}
                          {item.customerName ? ` · ${item.customerName}` : ""}
                        </button>
                      ))}
                </div>
                {referenceMode === "quotes" && referenceNextOffset !== null && (
                  <button
                    type="button"
                    className="qe-secondary"
                    onClick={() =>
                      void searchReference(referenceNextOffset).catch(
                        (caught) =>
                          setReferenceError(
                            caught instanceof Error
                              ? caught.message
                              : "Ricerca non disponibile.",
                          ),
                      )
                    }
                  >
                    Altri preventivi
                  </button>
                )}
              </div>
              {referenceMode === "price-lists" ? (
                priceList ? (
                  <div className="qe-reference-pdf">
                    <div>
                      <h3>{priceList.name}</h3>
                      <p>
                        {priceList.supplier.name} · versione {priceList.version}
                      </p>
                      <a
                        href={`/api/price-lists/${encodeURIComponent(priceList.id)}/original`}
                      >
                        Scarica PDF
                      </a>
                    </div>
                    <iframe
                      title={`Listino ${priceList.name}`}
                      src={`/api/price-lists/${encodeURIComponent(priceList.id)}/original?inline=1`}
                    />
                  </div>
                ) : (
                  <p className="qe-reference-empty">
                    {priceLists.length
                      ? "Seleziona un listino per aprirlo qui."
                      : "Nessun listino trovato per questa azienda."}
                  </p>
                )
              ) : reference ? (
                <div className="qe-reference-document">
                  <h3>{reference.title}</h3>
                  <div
                    className="document-content"
                    dangerouslySetInnerHTML={{ __html: reference.html }}
                  />
                </div>
              ) : (
                <p className="qe-reference-empty">
                  Seleziona un preventivo per vederlo qui.
                </p>
              )}
            </aside>
          </>
        )}
      </div>
      <footer className="qe-statusbar">
        <span>
          {selection?.words ?? 0} parole · {selection?.chars ?? 0} caratteri
        </span>
        <span className="qe-status-note">
          Il testo non modifica i prezzi del gestionale. Controlla
          l’impaginazione in Anteprima.
        </span>
        <label>
          Zoom{" "}
          <select
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            {[50, 65, 75, 85, 100, 125, 150].map((level) => (
              <option key={level} value={level}>
                {level}%
              </option>
            ))}
          </select>
        </label>
      </footer>
      {preview && (
        <div className="qe-preview-backdrop">
          <section
            className="qe-preview"
            role="dialog"
            aria-modal="true"
            aria-label="Anteprima PDF"
          >
            <header>
              <strong>Anteprima di stampa</strong>
              <a href={preview} download={`${initial.title}.pdf`}>
                Scarica PDF
              </a>
              <button type="button" onClick={() => setPreview(null)} autoFocus>
                Chiudi
              </button>
            </header>
            <iframe src={preview} title="Anteprima PDF del preventivo" />
          </section>
        </div>
      )}
    </section>
  );
}
