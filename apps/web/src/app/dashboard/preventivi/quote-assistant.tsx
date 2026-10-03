"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type QuoteMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  sources: QuoteCitation[];
  createdAt: string;
};

type QuoteCitation = {
  pageNumber: number;
  priceListName: string;
  version: string;
  uncertainOcr: boolean;
};

type AssistantPriceList = {
  id: string;
  name: string;
  version: string;
  status: string;
  pageCount: number;
  uncertainOcrPages: number[];
};

type QuoteItem = {
  id: string;
  category: string;
  description: string;
  quantity: string;
  widthMm: number | null;
  heightMm: number | null;
  configuration: Record<string, string>;
  pricingStatus: string;
  unitPrice: string | null;
  totalPrice: string | null;
};

type SpeechResultEvent = {
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & {
      isFinal?: boolean;
    }
  >;
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

export function QuoteAssistant({
  quoteId,
  initialMessages,
  initialItems,
  priceLists,
  llmModel,
}: {
  quoteId: string;
  initialMessages: QuoteMessage[];
  initialItems: QuoteItem[];
  priceLists: AssistantPriceList[];
  llmModel: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [items, setItems] = useState(initialItems);
  const [selectedPriceListId, setSelectedPriceListId] = useState(
    priceLists[0]?.id ?? "",
  );
  const selectedPriceList = priceLists.find(
    (priceList) => priceList.id === selectedPriceListId,
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    [],
  );

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
    setError("");
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

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy || !selectedPriceListId) return;

    setBusy(true);
    setError("");
    recognitionRef.current?.stop();
    try {
      const response = await fetch(
        "/api/quotes/" + encodeURIComponent(quoteId) + "/messages",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, priceListId: selectedPriceListId }),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        messages?: QuoteMessage[];
        items?: QuoteItem[];
      };
      if (!response.ok || !result.messages || !result.items) {
        throw new Error(
          result.error ?? "Non è stato possibile salvare la richiesta.",
        );
      }
      setMessages(result.messages);
      setItems(result.items);
      setDraft("");
      baseTextRef.current = "";
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Errore durante l’invio.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
      <section className="flex min-h-[620px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
            Lumi · AI locale · {llmModel}
          </p>
          <h2 className="mt-1 text-xl font-semibold">Parla con il listino</h2>
          {priceLists.length > 0 ? (
            <label className="mt-4 block max-w-xl text-sm font-medium text-slate-700">
              Listino da interpretare
              <select
                value={selectedPriceListId}
                onChange={(event) => setSelectedPriceListId(event.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {priceLists.map((priceList) => (
                  <option key={priceList.id} value={priceList.id}>
                    {priceList.name} · {priceList.version}
                    {priceList.status === "NEEDS_REVIEW"
                      ? " · da verificare"
                      : " · attivo"}
                  </option>
                ))}
              </select>
              {selectedPriceList && (
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  {selectedPriceList.pageCount} pagine
                  {selectedPriceList.uncertainOcrPages.length > 0
                    ? " · " +
                      selectedPriceList.uncertainOcrPages.length +
                      " pagine con OCR da controllare"
                    : ""}
                </span>
              )}
            </label>
          ) : (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Prima carica un PDF e completa la sua analisi nella sezione
              Listini: così Lumi potrà leggerlo e citarne le pagine.
            </p>
          )}
        </div>

        <div
          className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-4 py-5 sm:px-6"
          aria-live="polite"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={
                "max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 " +
                (message.role === "USER"
                  ? "ml-auto bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-800")
              }
            >
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-70">
                {message.role === "USER" ? "Tu" : "Assistente"}
              </p>
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-2">
                  {message.sources.map((source, index) => (
                    <span
                      key={source.pageNumber + "-" + index}
                      title={source.priceListName + " · " + source.version}
                      className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-900"
                    >
                      PDF p. {source.pageNumber}
                      {source.uncertainOcr ? " · OCR da verificare" : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={sendMessage}
          className="border-t border-slate-200 p-4 sm:p-5"
        >
          <label htmlFor="quote-request" className="sr-only">
            Richiesta del preventivo
          </label>
          <textarea
            id="quote-request"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={3000}
            rows={3}
            placeholder="Es. due porte battenti bianche, serie Classic, misura 80 × 210 cm…"
            className="w-full resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={toggleRecording}
                aria-pressed={recording}
                className={
                  "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold " +
                  (recording
                    ? "border-red-300 bg-red-50 text-red-800"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
                }
              >
                <span aria-hidden="true">{recording ? "■" : "●"}</span>
                {recording ? "Ferma dettatura" : "Detta richiesta"}
              </button>
              {voiceUnavailable && (
                <p className="max-w-64 text-xs text-amber-900">
                  La dettatura non è supportata da questo browser. Puoi scrivere
                  la richiesta.
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={busy || !draft.trim() || !selectedPriceListId}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Salvo…" : "Invia richiesta"}
            </button>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            La dettatura viene trascritta dal browser. Controlla il testo prima
            di inviarlo.
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            In avvio locale, il PDF e la conversazione vengono elaborati sul tuo
            Modello locale tramite llama.cpp; non servono chiavi API cloud.
            Verifica sul documento le cifre e le righe indicate come OCR da
            controllare.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </form>
      </section>

      <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
          Riepilogo bozza
        </p>
        <h2 className="mt-1 text-xl font-semibold">
          {items.length === 1 ? "1 riga" : items.length + " righe"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          I prezzi sono lasciati vuoti fino alla verifica e all’associazione del
          listino corretto.
        </p>

        {items.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-600">
            Le righe riconosciute appariranno qui.
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {items.map((item, index) => (
              <li
                key={item.id}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {index + 1}. {item.quantity} × {item.category}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.widthMm && item.heightMm
                        ? item.widthMm + " × " + item.heightMm + " mm"
                        : "Misure da completare"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
                    Da quotare
                  </span>
                </div>
                {Object.keys(item.configuration).length > 0 && (
                  <p className="mt-3 text-xs text-slate-600">
                    {Object.entries(item.configuration)
                      .map(([key, value]) => key + ": " + value)
                      .join(" · ")}
                  </p>
                )}
                <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
                  Prezzo:{" "}
                  <span className="font-medium">da listino verificato</span>
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-blue-900">
          Lumi interpreta il PDF e il dialogo, cita le pagine di riferimento e
          ti chiede i dettagli mancanti. Gli importi restano da verificare: non
          vengono calcolati né inventati.
        </div>
      </aside>
    </div>
  );
}
