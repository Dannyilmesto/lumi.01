"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isApprovedQuoteStatus } from "@/lib/quote-status";

export type QuoteListEntry = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  deletedAt: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  currency: string;
  total: string | null;
  items: {
    description: string;
    quantity: string;
    totalPrice: string | null;
  }[];
  itemCount: number;
  messageCount: number;
  canRename: boolean;
};

const statusLabel: Record<string, string> = {
  DRAFT: "Bozza",
  SENT: "Inviato",
  ACCEPTED: "Approvato",
  APPROVED: "Approvato",
  REJECTED: "Rifiutato",
  ARCHIVED: "Chiuso",
  CLOSED: "Chiuso",
};

const statusClass: Record<string, string> = {
  DRAFT: "quote-status-draft",
  SENT: "quote-status-sent",
  ACCEPTED: "quote-status-approved",
  APPROVED: "quote-status-approved",
  REJECTED: "quote-status-rejected",
  ARCHIVED: "quote-status-closed",
  CLOSED: "quote-status-closed",
};

function quoteShareText(quote: QuoteListEntry) {
  const amount = (value: string) =>
    new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: quote.currency,
    }).format(Number(value));
  const lines = [
    `Preventivo: ${quote.title}`,
    `Cliente: ${quote.customerName}`,
    "",
    "Dettaglio:",
    ...(quote.items.length
      ? quote.items.map(
          (item) =>
            `- ${item.description} · quantità ${item.quantity}${
              item.totalPrice === null ? "" : ` · ${amount(item.totalPrice)}`
            }`,
        )
      : ["Nessuna riga prodotto inserita."]),
    ...(quote.total === null ? [] : ["", `Totale: ${amount(quote.total)}`]),
  ];
  return lines.join("\n");
}

export function QuoteManagement({
  organizationId,
  quotes,
  trashMode = false,
  canEmptyTrash = false,
}: {
  organizationId: string;
  quotes: QuoteListEntry[];
  trashMode?: boolean;
  canEmptyTrash?: boolean;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [format, setFormat] = useState("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  function setSelected(id: string, selected: boolean) {
    setSelectedIds((current) =>
      selected
        ? [...new Set([...current, id])]
        : current.filter((selectedId) => selectedId !== id),
    );
  }

  async function renameQuote(quote: QuoteListEntry) {
    const title = titleDraft.trim();
    if (!title || title.length > 160) {
      setError("Il nome deve contenere da 1 a 160 caratteri.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/quotes/${encodeURIComponent(quote.id)}/title`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Nome non aggiornato.");
      setEditingId("");
      setNotice("Nome del preventivo aggiornato.");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Nome non aggiornato.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeQuotes(
    action: "delete" | "restore" | "permanent-delete" | "empty-trash",
    ids: string[],
  ) {
    if ((!ids.length && action !== "empty-trash") || busy) return;
    const protectedSelected = quotes.filter(
      (quote) =>
        (action === "empty-trash" || ids.includes(quote.id)) &&
        isApprovedQuoteStatus(quote.status),
    );
    if (
      action === "empty-trash" &&
      (!window.confirm(
        "Svuotare il cestino aziendale? Tutti i preventivi al suo interno verranno eliminati definitivamente.",
      ) ||
        !window.confirm(
          "Confermi anche l’eliminazione definitiva di eventuali preventivi approvati?",
        ))
    )
      return;
    if (
      action === "permanent-delete" &&
      !window.confirm(
        `Eliminare definitivamente ${ids.length} preventivo/i e tutti i relativi documenti e allegati? L’operazione non si può annullare.`,
      )
    )
      return;
    if (action === "permanent-delete" && protectedSelected.length) {
      if (
        !window.confirm(
          `La selezione contiene ${protectedSelected.length} preventivo/i approvato/i. Confermi l’eliminazione definitiva?`,
        )
      )
        return;
    }
    const confirmed =
      action !== "delete" ||
      !protectedSelected.length ||
      window.confirm(
        `La selezione contiene ${protectedSelected.length} preventivo/i approvato/i. Confermi lo spostamento nel cestino? Potrai ripristinarli in seguito.`,
      );
    if (!confirmed) return;
    if (
      action === "delete" &&
      !protectedSelected.length &&
      !window.confirm(
        `Spostare ${ids.length} preventivo/i nel cestino? Potrai ripristinarli in seguito.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/quotes", {
        method: action === "restore" ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          ...(ids.length ? { quoteIds: ids } : {}),
          ...(action === "permanent-delete" || action === "empty-trash"
            ? {
                permanent: true,
                confirmPermanent: true,
                ...(action === "empty-trash" ? { emptyTrash: true } : {}),
              }
            : {}),
          ...(protectedSelected.length ? { confirmProtected: true } : {}),
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        deletedCount?: number;
        permanentlyDeletedCount?: number;
        restoredCount?: number;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Operazione non completata.");
      setSelectedIds([]);
      setNotice(
        action === "empty-trash"
          ? `${result.permanentlyDeletedCount ?? 0} preventivo/i rimossi definitivamente dal cestino.`
          : action === "permanent-delete"
            ? `${result.permanentlyDeletedCount ?? ids.length} preventivo/i eliminato/i definitivamente.`
            : action === "delete"
              ? `${result.deletedCount ?? ids.length} preventivo/i spostato/i nel cestino.`
              : `${result.restoredCount ?? ids.length} preventivo/i ripristinato/i.`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Operazione non completata.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportSelected() {
    if (!selectedIds.length || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const query = new URLSearchParams({
        organizationId,
        format,
        ...(trashMode ? { includeDeleted: "1" } : {}),
      });
      for (const id of selectedIds) query.append("id", id);
      const response = await fetch(`/api/quotes/export?${query.toString()}`);
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? "Esportazione non riuscita.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `preventivi-selezionati.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(
        `${selectedIds.length} preventivo/i esportato/i in ${format.toUpperCase()}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Esportazione non riuscita.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {quotes.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 p-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={
                quotes.length > 0 && selectedIds.length === quotes.length
              }
              onChange={(event) =>
                setSelectedIds(
                  event.target.checked ? quotes.map((quote) => quote.id) : [],
                )
              }
              aria-label="Seleziona tutti i preventivi mostrati"
            />
            Seleziona tutti
          </label>
          <span className="text-sm text-slate-500">
            {selectedIds.length} selezionati
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              aria-label="Formato esportazione"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm"
            >
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
            <button
              type="button"
              onClick={exportSelected}
              disabled={!selectedIds.length || busy}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Esporta selezionati
            </button>
            {trashMode ? (
              <>
                {canEmptyTrash && (
                  <button
                    type="button"
                    onClick={() => changeQuotes("empty-trash", [])}
                    disabled={!quotes.length || busy}
                    className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50"
                  >
                    Svuota cestino
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => changeQuotes("restore", selectedIds)}
                  disabled={!selectedIds.length || busy}
                  className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Ripristina
                </button>
                <button
                  type="button"
                  onClick={() => changeQuotes("permanent-delete", selectedIds)}
                  disabled={!selectedIds.length || busy}
                  className="rounded-lg bg-red-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Elimina definitivamente
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => changeQuotes("delete", selectedIds)}
                disabled={!selectedIds.length || busy}
                className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Sposta nel cestino
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {quotes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-12 text-center">
          <h3 className="font-semibold text-slate-900">
            {trashMode ? "Il cestino è vuoto" : "Nessun preventivo ancora"}
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            {trashMode
              ? "I preventivi eliminati compariranno qui e potranno essere ripristinati."
              : "Crea una bozza e detta o scrivi la richiesta del cliente."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
          {quotes.map((quote) => (
            <li
              key={quote.id}
              className="flex flex-wrap items-center gap-3 px-4 py-4"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(quote.id)}
                onChange={(event) =>
                  setSelected(quote.id, event.target.checked)
                }
                aria-label={`Seleziona ${quote.title}`}
              />
              <div className="min-w-0 flex-1">
                {editingId === quote.id ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameQuote(quote);
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="Nome preventivo"
                      maxLength={160}
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      className="min-w-40 rounded-lg border border-slate-300 px-2 py-1 font-semibold"
                    />
                    <button type="submit" disabled={busy}>
                      Salva nome
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditingId("")}
                    >
                      Annulla
                    </button>
                  </form>
                ) : trashMode ? (
                  <span className="truncate font-semibold text-slate-900">
                    {quote.title}
                  </span>
                ) : (
                  <Link
                    href={
                      "/dashboard/preventivi/" + encodeURIComponent(quote.id)
                    }
                    className="truncate font-semibold text-slate-900 hover:text-blue-800"
                  >
                    {quote.title}
                  </Link>
                )}
                <p className="mt-1 text-sm text-slate-600">
                  {quote.customerName} · {quote.itemCount} righe ·{" "}
                  {quote.messageCount} messaggi
                </p>
                {quote.deletedAt && (
                  <p className="mt-1 text-xs text-slate-500">
                    Spostato nel cestino il{" "}
                    {new Date(quote.deletedAt).toLocaleDateString("it-IT")}
                  </p>
                )}
              </div>
              <span className={`quote-status-badge ${statusClass[quote.status] ?? "quote-status-draft"}`}>
                {statusLabel[quote.status] ?? quote.status}
              </span>
              <span className="text-xs text-slate-500">
                {new Date(quote.updatedAt).toLocaleDateString("it-IT")}
              </span>
              {!trashMode && (
                <>
                  <a
                    href={`mailto:${encodeURIComponent(quote.customerEmail ?? "")}?${new URLSearchParams(
                      {
                        subject: `Preventivo: ${quote.title}`,
                        body: quoteShareText(quote),
                      },
                    ).toString()}`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                  >
                    Invia via email
                  </a>
                  <a
                    href={`https://wa.me/${(quote.customerPhone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(quoteShareText(quote))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-green-300 px-3 py-1.5 text-sm font-medium text-green-800"
                  >
                    Invia via WhatsApp
                  </a>
                  {quote.canRename && editingId !== quote.id && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setTitleDraft(quote.title);
                        setEditingId(quote.id);
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      Rinomina
                    </button>
                  )}
                  <Link
                    href={`/dashboard/preventivi/${encodeURIComponent(quote.id)}/documento`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                  >
                    Documento / PDF
                  </Link>
                </>
              )}
              {trashMode ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeQuotes("restore", [quote.id])}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
                  >
                    Ripristina
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeQuotes("permanent-delete", [quote.id])}
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 disabled:opacity-50"
                  >
                    Elimina definitivamente
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => changeQuotes("delete", [quote.id])}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
                >
                  Sposta nel cestino
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
