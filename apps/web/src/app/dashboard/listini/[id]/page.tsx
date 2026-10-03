import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CandidateReviewActions } from "../candidate-review-actions";

const pageSize = 40;

const kindLabels = {
  BASE_PRICE: "Prezzo base",
  SURCHARGE: "Supplemento",
  DISCOUNT: "Sconto",
  PERCENTAGE_RULE: "Regola percentuale",
  SHIPPING_OR_PACKAGING: "Trasporto o imballaggio",
  UNCLASSIFIED_AMOUNT: "Importo da classificare",
} as const;

function jsonArray(value: Prisma.JsonValue): Prisma.JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function jsonStrings(value: Prisma.JsonValue) {
  return jsonArray(value).filter(
    (item): item is string => typeof item === "string",
  );
}

function jsonObjects(value: Prisma.JsonValue): Prisma.JsonObject[] {
  return jsonArray(value).filter(
    (item): item is Prisma.JsonObject =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function objectString(value: Prisma.JsonObject, key: string) {
  const field = value[key];
  return typeof field === "string" ? field : "";
}

function jsonNumber(value: Prisma.JsonValue | null, key: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const field = value[key];
  return typeof field === "number" ? field : null;
}

function queryPage(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function PriceListReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const priceList = await prisma.priceList.findFirst({
    where: {
      id,
      supplier: {
        organization: { members: { some: { userId: session.user.id } } },
      },
    },
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
      extractedAt: true,
      extractionSummary: true,
      supplier: { select: { name: true } },
      _count: { select: { candidates: true } },
    },
  });
  if (!priceList) notFound();

  const totalCandidates = priceList._count.candidates;
  const totalPages = Math.max(1, Math.ceil(totalCandidates / pageSize));
  const currentPage = Math.min(queryPage(query.page), totalPages);

  const [candidates, reviewCounts] = await Promise.all([
    prisma.extractionCandidate.findMany({
      where: { priceListId: id },
      orderBy: [{ pdfPageNumber: "asc" }, { createdAt: "asc" }],
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.extractionCandidate.groupBy({
      by: ["reviewStatus"],
      where: { priceListId: id },
      _count: { _all: true },
    }),
  ]);

  const counts = {
    NEEDS_REVIEW: 0,
    ACCEPTED: 0,
    REJECTED: 0,
  };
  for (const group of reviewCounts)
    counts[group.reviewStatus] = group._count._all;

  const summary =
    typeof priceList.extractionSummary === "object" &&
    priceList.extractionSummary !== null &&
    !Array.isArray(priceList.extractionSummary)
      ? priceList.extractionSummary
      : null;
  const summaryWarnings = summary
    ? jsonStrings(summary.warnings as Prisma.JsonValue)
    : [];
  const lowTextPages = summary
    ? jsonArray(summary.pagesWithLittleText as Prisma.JsonValue).filter(
        (item): item is number => typeof item === "number",
      )
    : [];
  const ocrCompletedPages = summary
    ? jsonArray(summary.pagesOcrCompleted as Prisma.JsonValue).filter(
        (item): item is number => typeof item === "number",
      )
    : [];
  const ocrReviewPages = summary
    ? jsonArray(summary.pagesOcrNeedsReview as Prisma.JsonValue).filter(
        (item): item is number => typeof item === "number",
      )
    : [];

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="border-b border-slate-200 pb-6">
        <Link
          href="/dashboard/listini"
          className="text-sm font-medium text-slate-600 hover:text-slate-950"
        >
          ← Torna all’archivio
        </Link>
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
          {priceList.supplier.name} · versione {priceList.version}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {priceList.name}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          I candidati sono righe copiate dal PDF e restano inattivi. “Conferma
          lettura” approva solo la lettura della riga; non crea né attiva un
          prodotto o un prezzo.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={`/api/price-lists/${encodeURIComponent(id)}/original`}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Scarica PDF originale
          </a>
          {priceList.extractedAt && (
            <span className="self-center text-sm text-slate-500">
              Analizzato il {priceList.extractedAt.toLocaleString("it-IT")}
            </span>
          )}
        </div>
      </header>

      <section
        className="mt-6 grid gap-3 sm:grid-cols-3"
        aria-label="Riepilogo revisione"
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-2xl font-semibold">{totalCandidates}</p>
          <p className="text-sm text-slate-600">Candidati estratti</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-2xl font-semibold text-amber-900">
            {counts.NEEDS_REVIEW}
          </p>
          <p className="text-sm text-amber-800">Da revisionare</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-2xl font-semibold">
            {counts.ACCEPTED + counts.REJECTED}
          </p>
          <p className="text-sm text-slate-600">Già revisionati</p>
        </div>
      </section>

      {lowTextPages.length > 0 && (
        <aside className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          Alcune pagine contengono poco testo selezionabile:{" "}
          {lowTextPages.join(", ")}. Controllale nel PDF originale; l’estrazione
          testuale può non aver letto tabelle o importi incorporati come
          immagini.
        </aside>
      )}
      {(ocrCompletedPages.length > 0 || ocrReviewPages.length > 0) && (
        <aside className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
          OCR locale eseguito su{" "}
          {ocrCompletedPages.length + ocrReviewPages.length} pagine. Da
          controllare con particolare attenzione:{" "}
          {ocrReviewPages.length > 0 ? ocrReviewPages.join(", ") : "nessuna"}.
        </aside>
      )}
      {summaryWarnings.length > 0 && (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Avvertenze dell’estrazione ({summaryWarnings.length})
          </summary>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
            {summaryWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      {candidates.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <h2 className="font-semibold text-slate-900">
            Nessun candidato trovato
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Verifica il PDF originale. Le pagine scansionate richiedono il
            passaggio OCR.
          </p>
        </section>
      ) : (
        <>
          <ol className="mt-6 space-y-4">
            {candidates.map((candidate) => {
              const amounts = jsonObjects(candidate.amounts);
              const percentages = jsonObjects(candidate.percentages);
              const codes = jsonStrings(candidate.finishCodeCandidates);
              const models = jsonStrings(candidate.modelCandidates);
              const dimensions = jsonStrings(candidate.dimensionCandidates);
              const warnings = jsonStrings(candidate.warnings);
              const statusText =
                candidate.reviewStatus === "ACCEPTED"
                  ? "Lettura confermata"
                  : candidate.reviewStatus === "REJECTED"
                    ? "Escluso"
                    : "Da revisionare";

              return (
                <li
                  key={candidate.id}
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {kindLabels[candidate.kind]}
                      </span>
                      <span className="text-sm font-medium text-slate-600">
                        Pagina PDF {candidate.pdfPageNumber}
                        {candidate.printedPageNumber
                          ? ` · pagina stampata ${candidate.printedPageNumber}`
                          : ""}
                      </span>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${candidate.reviewStatus === "NEEDS_REVIEW" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}
                    >
                      {statusText}
                    </span>
                  </div>

                  {candidate.sectionLabel && (
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {candidate.sectionLabel}
                    </p>
                  )}
                  <blockquote className="mt-3 rounded-2xl bg-slate-50 p-4 font-mono text-sm leading-6 text-slate-900">
                    {candidate.sourceExcerpt}
                  </blockquote>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {amounts.map((amount, index) => (
                      <span
                        key={`amount-${index}`}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-900"
                      >
                        {objectString(amount, "raw")}
                      </span>
                    ))}
                    {percentages.map((percentage, index) => (
                      <span
                        key={`percentage-${index}`}
                        className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-900"
                      >
                        {objectString(percentage, "raw")}
                      </span>
                    ))}
                    {[...codes, ...models, ...dimensions].map(
                      (value, index) => (
                        <span
                          key={`reference-${index}-${value}`}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700"
                        >
                          {value}
                        </span>
                      ),
                    )}
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    Area nel PDF: x {jsonNumber(candidate.boundingBox, "x0")}, y{" "}
                    {jsonNumber(candidate.boundingBox, "top")} – x{" "}
                    {jsonNumber(candidate.boundingBox, "x1")}, y{" "}
                    {jsonNumber(candidate.boundingBox, "bottom")}
                  </p>

                  {warnings.length > 0 && (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-900">
                      {warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}

                  {candidate.reviewStatus === "NEEDS_REVIEW" && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <CandidateReviewActions
                        priceListId={id}
                        candidateId={candidate.id}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <nav
            aria-label="Pagine dei candidati"
            className="mt-6 flex items-center justify-between"
          >
            {currentPage > 1 ? (
              <Link
                href={`/dashboard/listini/${encodeURIComponent(id)}?page=${currentPage - 1}`}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                ← Precedenti
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-slate-500">
              Pagina {currentPage} di {totalPages}
            </span>
            {currentPage < totalPages ? (
              <Link
                href={`/dashboard/listini/${encodeURIComponent(id)}?page=${currentPage + 1}`}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Successivi →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </main>
  );
}
