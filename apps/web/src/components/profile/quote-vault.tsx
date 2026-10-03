"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  formatAmount,
  type PageResult,
  type PersonalQuote,
  type PublicQuoteItem,
} from "@/lib/profile-types";
import {
  profileFetch,
  useProfileResource,
  errorMessage,
} from "./profile-client";
import { isApprovedQuoteStatus } from "@/lib/quote-status";
import { EmptyState, Feedback, Pager } from "./profile-ui";

type Preview = {
  id: string;
  title: string;
  currency: string;
  amount: string | null;
  details: PublicQuoteItem[];
  version: string;
};
function quoteShareText(quote: PersonalQuote) {
  const amount = (value: string) =>
    formatAmount(value, quote.currency);
  return [
    `Preventivo: ${quote.title}`,
    `Azienda: ${quote.organizationName}`,
    ...(quote.customerName ? [`Cliente: ${quote.customerName}`] : []),
    "",
    "Dettaglio:",
    ...(quote.shareItems.length
      ? quote.shareItems.map(
          (item) =>
            `- ${item.description} · quantità ${item.quantity} ${item.unit}${
              item.totalPrice === null ? "" : ` · ${amount(item.totalPrice)}`
            }`,
        )
      : ["Nessuna riga prodotto inserita."]),
    ...(quote.shareAmount === null
      ? []
      : ["", `Totale: ${amount(quote.shareAmount)}`]),
  ].join("\n");
}
export function QuoteLines({
  quote,
}: {
  quote: Pick<Preview, "details" | "currency" | "amount">;
}) {
  return (
    <>
      <div className="profile-table-scroll">
        <table className="profile-table">
          <thead>
            <tr>
              <th>Descrizione</th>
              <th>Quantità</th>
              <th>Prezzo unitario</th>
              <th>Totale</th>
            </tr>
          </thead>
          <tbody>
            {quote.details.map((item, index) => (
              <tr key={index}>
                <td>{item.description}</td>
                <td>
                  {item.quantity} {item.unit}
                </td>
                <td>
                  {item.unitPrice === null
                    ? "Da definire"
                    : formatAmount(item.unitPrice, quote.currency)}
                </td>
                <td>
                  {item.totalPrice === null
                    ? "Da definire"
                    : formatAmount(item.totalPrice, quote.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="profile-quote-total">
        Totale:{" "}
        {quote.amount === null
          ? "Da definire"
          : formatAmount(quote.amount, quote.currency)}
      </p>
    </>
  );
}
export function QuoteVault({
  organizations,
}: {
  organizations: { id: string; name: string }[];
}) {
  const [mode, setMode] = useState("saved");
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id || "",
  );
  const [busy, setBusy] = useState(false);
  const [archivingId, setArchivingId] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const previewPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (previews) {
      previewPanel.current?.scrollIntoView({ block: "start" });
      previewPanel.current?.focus({ preventScroll: true });
    }
  }, [previews]);
  const resource = useProfileResource<PageResult<PersonalQuote>>(
    `/api/profile/quotes?offset=${offset}&q=${encodeURIComponent(search)}&available=${mode === "available" ? 1 : 0}&archived=${mode === "archived" ? 1 : 0}&trash=${mode === "trash" ? 1 : 0}`,
  );
  const selectedCanBeDeleted =
    selected.length > 0 &&
    Boolean(resource.data) &&
    selected.every(
      (id) => resource.data?.items.find((item) => item.id === id)?.canShare,
    );
  function page(value: number) {
    setOffset(value);
    setSelected([]);
  }
  async function create() {
    setBusy(true);
    resource.setError("");
    try {
      const quote = await profileFetch<{ quoteId: string }>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          ...(organizationId ? { organizationId } : {}),
          saveToProfile: false,
        }),
      });
      window.location.assign(
        `/dashboard/preventivi/${quote.quoteId}/documento`,
      );
    } catch (error) {
      resource.setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string, ids = selected) {
    if (!ids.length && action !== "empty-trash") return;
    if (action === "trash" || action === "delete") {
      const selectedQuotes =
        resource.data?.items.filter((item) => ids.includes(item.id)) ?? [];
      if (
        selectedQuotes.length !== ids.length ||
        selectedQuotes.some((item) => !item.canShare)
      ) {
        resource.setError(
          "Puoi spostare nel cestino o eliminare solo i preventivi creati da te o quelli di un’azienda che amministri.",
        );
        return;
      }
      const prompt =
        action === "trash"
          ? `Spostare ${ids.length} preventivo/i nel cestino? Potrai ripristinarli in seguito.`
          : `Eliminare definitivamente ${ids.length} preventivo/i dal cestino e tutti i relativi documenti e allegati? L’operazione non si può annullare.`;
      if (!window.confirm(prompt)) return;
      if (
        action === "delete" &&
        selectedQuotes.some((item) => isApprovedQuoteStatus(item.status)) &&
        !window.confirm(
          "La selezione contiene preventivi approvati. Confermi l’eliminazione definitiva?",
        )
      )
        return;
    }
    if (
      action === "empty-trash" &&
      (!window.confirm(
        "Svuotare il cestino? Verranno eliminati definitivamente i preventivi che puoi gestire. L’operazione non si può annullare.",
      ) ||
        !window.confirm(
          "Confermi anche l’eliminazione definitiva di eventuali preventivi approvati?",
        ))
    )
      return;
    setBusy(true);
    resource.setError("");
    setNotice("");
    try {
      if (action === "preview") {
        setPreviews(
          await Promise.all(
            ids.map((id) =>
              profileFetch<Preview>(
                `/api/profile/quotes?preview=${encodeURIComponent(id)}`,
              ),
            ),
          ),
        );
        return;
      }
      if (
        action === "unpublish" &&
        !window.confirm("Ritirare i preventivi selezionati dalla bacheca?")
      )
        return;
      const result = await profileFetch<{ permanentlyDeletedCount?: number }>(
        "/api/profile/quotes",
        {
          method: "POST",
          body: JSON.stringify({
            ...(ids.length ? { quoteIds: ids } : {}),
            action,
            ...(action === "delete" || action === "empty-trash"
              ? { confirmDelete: true, confirmProtected: true }
              : {}),
            confirmPublic: action === "publish",
            versions: previews
              ? Object.fromEntries(
                  previews.map((item) => [item.id, item.version]),
                )
              : undefined,
          }),
        },
      );
      setPreviews(null);
      setSelected([]);
      setNotice(
        action === "publish"
          ? "Preventivi pubblicati."
          : action === "delete"
            ? `${result.permanentlyDeletedCount ?? ids.length} preventivo/i eliminato/i definitivamente.`
            : action === "empty-trash"
              ? `${result.permanentlyDeletedCount ?? 0} preventivo/i eliminato/i definitivamente dal cestino.`
              : action === "trash"
                ? `${ids.length} preventivo/i spostato/i nel cestino.`
                : action === "restore-trash"
                  ? `${ids.length} preventivo/i ripristinato/i dal cestino.`
                  : action === "archive"
                    ? "Preventivi archiviati nel tuo profilo."
                    : "Operazione completata.",
      );
      await resource.reload();
    } catch (error) {
      resource.setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function savePdfToArchive(quote: PersonalQuote) {
    setArchivingId(quote.id);
    resource.setError("");
    setNotice("");
    try {
      const result = await profileFetch<{ path: string }>(
        "/api/profile/archive/quotes",
        {
          method: "POST",
          body: JSON.stringify({ quoteId: quote.id }),
        },
      );
      setNotice(`PDF salvato nell’Archivio: ${result.path}`);
    } catch (error) {
      resource.setError(errorMessage(error));
    } finally {
      setArchivingId("");
    }
  }
  async function renameQuote(quote: PersonalQuote) {
    const title = titleDraft.trim();
    if (!title || title.length > 160) {
      resource.setError("Il nome deve contenere da 1 a 160 caratteri.");
      return;
    }
    setBusy(true);
    resource.setError("");
    setNotice("");
    try {
      await profileFetch(`/api/quotes/${encodeURIComponent(quote.id)}/title`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setRenamingId("");
      setNotice("Nome del preventivo aggiornato.");
      await resource.reload();
    } catch (error) {
      resource.setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-panel">
      <div className="profile-section-heading">
        <div>
          <h2>I miei preventivi</h2>
          <p>
            Raccogli i tuoi documenti e aprili nell’editor con immagini ed
            esportazione PDF.
          </p>
        </div>
      </div>
      <div className="profile-editor-launch">
        <div>
          <h3>Un nuovo preventivo, da un foglio pronto</h3>
          <p>Il modello generico Lumi è già impostato per iniziare.</p>
        </div>
        <div className="profile-inline">
          {organizations.length > 0 && (
            <select
              aria-label="Azienda per il nuovo preventivo"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="profile-button"
            disabled={busy || (organizations.length > 0 && !organizationId)}
            onClick={() => void create()}
          >
            {busy
              ? "Preparazione editor…"
              : organizations.length
                ? "Vai all’Editor Preventivi →"
                : "Crea e apri l’Editor Preventivi →"}
          </button>
        </div>
      </div>
      <Feedback error={resource.error} notice={notice} />
      <div
        className="profile-inline profile-subtabs"
        role="group"
        aria-label="Raccolte preventivi"
      >
        {[
          ["saved", "Salvati"],
          ["archived", "Archivio"],
          ["available", "Dalle mie aziende"],
          ["trash", "Cestino"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              page(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="profile-muted">
        L’archivio è personale. Lo stato commerciale del preventivo rimane
        quello dello spazio aziendale.
      </p>
      <form
        className="profile-search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query);
          page(0);
        }}
      >
        <input
          aria-label="Cerca preventivi"
          placeholder="Cerca per titolo o cliente…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="profile-button secondary">Cerca</button>
      </form>
      <div className="profile-bulk">
        <span>{selected.length}/20 selezionati</span>
        {mode === "trash" ? (
          <>
            <button
              disabled={busy || !resource.data?.items.length}
              onClick={() => void act("empty-trash", [])}
            >
              Svuota cestino
            </button>
            <button
              disabled={busy || !selected.length}
              onClick={() => void act("restore-trash")}
            >
              Ripristina dal cestino
            </button>
            <button
              disabled={busy || !selected.length || !selectedCanBeDeleted}
              onClick={() => void act("delete")}
            >
              Elimina definitivamente
            </button>
          </>
        ) : (
          <button
            disabled={busy || !selected.length}
            onClick={() =>
              void act(
                mode === "archived"
                  ? "restore"
                  : mode === "available"
                    ? "save"
                    : "archive",
              )
            }
          >
            {mode === "archived"
              ? "Ripristina"
              : mode === "available"
                ? "Salva nel profilo"
                : "Archivia"}
          </button>
        )}
        {mode !== "trash" && (
          <button
            disabled={busy || !selected.length}
            onClick={() => void act("preview")}
          >
            Condividi in bacheca
          </button>
        )}
        {mode !== "trash" && (
          <button
            disabled={busy || !selected.length}
            onClick={() => void act("unpublish")}
          >
            Ritira dalla bacheca
          </button>
        )}
        {mode !== "trash" && (
          <button
            disabled={busy || !selected.length || !selectedCanBeDeleted}
            onClick={() => void act("trash")}
          >
            Sposta nel cestino
          </button>
        )}
      </div>
      {resource.loading ? (
        <EmptyState>Caricamento preventivi…</EmptyState>
      ) : !resource.data?.items.length ? (
        <EmptyState>
          {mode === "trash"
            ? "Il cestino è vuoto. I preventivi che sposti qui potranno essere ripristinati oppure eliminati definitivamente."
            : "Nessun preventivo in questa raccolta. Crea un documento oppure aggiungilo dalle tue aziende."}
        </EmptyState>
      ) : (
        <div className="profile-quote-list">
          {resource.data.items.map((quote) => (
            <article key={quote.id} className="profile-quote-row">
              <input
                type="checkbox"
                aria-label={`Seleziona ${quote.title}`}
                checked={selected.includes(quote.id)}
                disabled={
                  busy ||
                  (!selected.includes(quote.id) && selected.length >= 20)
                }
                onChange={(event) =>
                  setSelected((value) =>
                    event.target.checked
                      ? [...value, quote.id]
                      : value.filter((id) => id !== quote.id),
                  )
                }
              />
              <div>
                {quote.deletedAt && (
                  <small>
                    Nel cestino dal{" "}
                    {new Date(quote.deletedAt).toLocaleDateString("it-IT")}
                  </small>
                )}
                {renamingId === quote.id ? (
                  <form
                    className="profile-inline"
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
                    />
                    <button disabled={busy} type="submit">
                      Salva nome
                    </button>
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() => setRenamingId("")}
                    >
                      Annulla
                    </button>
                  </form>
                ) : (
                  <h3>{quote.title}</h3>
                )}
                <p>
                  {quote.organizationName}
                  {quote.customerName ? ` · ${quote.customerName}` : ""} ·{" "}
                  {(
                    {
                      DRAFT: "Bozza",
                      SENT: "Inviato",
                      ACCEPTED: "Approvato",
                      APPROVED: "Approvato",
                      REJECTED: "Rifiutato",
                      ARCHIVED: "Chiuso",
                      CLOSED: "Chiuso",
                    } as Record<string, string>
                  )[quote.status] || quote.status}
                </p>
                <small>
                  Totale registrato:{" "}
                  {formatAmount(quote.amount, quote.currency)}
                  {quote.isPublic ? " · In bacheca" : ""}
                </small>
              </div>
              <div className="profile-inline">
                {mode !== "trash" && (
                  <Link
                    className="profile-button secondary"
                    href={`/dashboard/preventivi/${quote.id}/documento`}
                  >
                    Apri editor
                  </Link>
                )}
                {mode !== "trash" &&
                  quote.canShare &&
                  renamingId !== quote.id && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setTitleDraft(quote.title);
                        setRenamingId(quote.id);
                      }}
                    >
                      Rinomina
                    </button>
                  )}
                {mode !== "trash" && (
                  <button
                    disabled={busy || Boolean(archivingId)}
                    onClick={() => void savePdfToArchive(quote)}
                  >
                    {archivingId === quote.id
                      ? "Salvataggio…"
                      : "Salva PDF in Archivio"}
                  </button>
                )}
                {mode !== "trash" && quote.canShare && (
                  <>
                    <a
                      className="profile-button secondary"
                      href={`mailto:${encodeURIComponent(quote.customerEmail ?? "")}?${new URLSearchParams(
                        {
                          subject: `Preventivo: ${quote.title}`,
                          body: quoteShareText(quote),
                        },
                      ).toString()}`}
                    >
                      Invia via email
                    </a>
                    <a
                      className="profile-button secondary"
                      href={`https://wa.me/${(quote.customerPhone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(quoteShareText(quote))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Invia via WhatsApp
                    </a>
                    <button
                      disabled={busy}
                      onClick={() => void act("preview", [quote.id])}
                    >
                      Condividi
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void act("trash", [quote.id])}
                    >
                      Sposta nel cestino
                    </button>
                  </>
                )}
                {mode === "trash" && quote.canShare && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => void act("restore-trash", [quote.id])}
                    >
                      Ripristina
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void act("delete", [quote.id])}
                    >
                      Elimina definitivamente
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <Pager
        offset={offset}
        next={resource.data?.nextOffset ?? null}
        onChange={page}
      />
      {previews && (
        <section
          ref={previewPanel}
          tabIndex={-1}
          className="profile-public-preview"
          aria-label="Anteprima pubblicazione"
        >
          <div className="profile-section-heading">
            <div>
              <h3>Controlla prima di pubblicare</h3>
              <p>
                Questo contenuto sarà visibile a tutti gli utenti autenticati
                della piattaforma. Controlla anche le descrizioni: potrebbero
                contenere dati personali inseriti manualmente.
              </p>
            </div>
          </div>
          <p className="profile-muted">
            La pubblicazione è una copia di titolo, voci e prezzi. Il documento
            Word/PDF, i dati cliente e gli allegati rimangono nell’azienda.
          </p>
          {previews.map((quote) => (
            <article key={quote.id}>
              <h3>{quote.title}</h3>
              <QuoteLines quote={quote} />
            </article>
          ))}
          <div className="profile-inline">
            <button
              disabled={busy}
              className="profile-button"
              onClick={() =>
                void act(
                  "publish",
                  previews.map((item) => item.id),
                )
              }
            >
              Confermo: pubblica per tutti gli utenti
            </button>
            <button
              disabled={busy}
              className="profile-button secondary"
              onClick={() => setPreviews(null)}
            >
              Annulla
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
