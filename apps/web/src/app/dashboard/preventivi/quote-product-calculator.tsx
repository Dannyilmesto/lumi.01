"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  buildProductEstimateText,
  calculateCatalogProduct,
  formatEuro,
  type CatalogProduct,
} from "@/lib/product-calculator";

type CalculatorLine = {
  id: string;
  productId: string;
  quantity: number;
  widthMm: number | null;
  heightMm: number | null;
};

const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export function QuoteProductCalculator({
  products,
  manageHref,
  compact = false,
}: {
  products: CatalogProduct[];
  manageHref?: string;
  compact?: boolean;
}) {
  const [lines, setLines] = useState<CalculatorLine[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(
    products[0]?.id ?? "",
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const selectedProduct = products.find(
    (product) => product.id === selectedProductId,
  );

  useEffect(() => {
    if (!products.some((product) => product.id === selectedProductId))
      setSelectedProductId(products[0]?.id ?? "");
  }, [products, selectedProductId]);

  const calculatedLines = useMemo(
    () =>
      lines.flatMap((line) => {
        const product = products.find((item) => item.id === line.productId);
        if (!product) return [];
        return [
          {
            ...line,
            product,
            calculation: calculateCatalogProduct(
              product,
              line.quantity,
              line.widthMm,
              line.heightMm,
            ),
          },
        ];
      }),
    [lines, products],
  );
  const completeLines = calculatedLines.filter(
    (line) =>
      line.calculation.unitPrice !== null &&
      line.calculation.totalPrice !== null,
  );
  const total = completeLines.reduce(
    (sum, line) => sum + (line.calculation.totalPrice ?? 0),
    0,
  );
  const allLinesComplete = completeLines.length === calculatedLines.length;

  function addLine() {
    if (!selectedProduct) return;
    setError("");
    setCopied(false);
    setLines((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        productId: selectedProduct.id,
        quantity: 1,
        widthMm: null,
        heightMm: null,
      },
    ]);
  }

  function updateLine(id: string, changes: Partial<CalculatorLine>) {
    setCopied(false);
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...changes } : line)),
    );
  }

  async function copyEstimate() {
    if (!calculatedLines.length || !allLinesComplete) {
      setError(
        "Completa le dimensioni e le quantità prima di copiare il calcolo.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(
        buildProductEstimateText(completeLines),
      );
      setError("");
      setCopied(true);
    } catch {
      setCopied(false);
      setError(
        "Non riesco a copiare il testo. Controlla i permessi del browser.",
      );
    }
  }

  return (
    <section
      className={`quote-product-calculator${compact ? " is-compact" : " mt-8 rounded-3xl border border-sky-200 bg-sky-50/60 p-5 shadow-sm sm:p-7"}`}
    >
      <div
        className={`flex flex-wrap items-start justify-between gap-4${compact ? " qpc-header" : ""}`}
      >
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.15em] text-sky-800">
            Calcolatore
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Calcola prodotti
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Calcola i prezzi dal catalogo aziendale e copia un riepilogo
            ordinato. Questo calcolo è indipendente e non modifica i preventivi
            salvati.
          </p>
        </div>
        {!compact && (
          <Link
            href={manageHref ?? "/dashboard/prodotti"}
            className="rounded-xl border border-sky-300 bg-white px-3 py-2 text-sm font-semibold text-sky-900 hover:bg-sky-100"
          >
            Gestisci prodotti
          </Link>
        )}
      </div>

      {products.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-sky-300 bg-white px-5 py-8 text-center">
          <p className="font-medium text-slate-800">
            Aggiungi prima i prodotti
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Inserisci prezzi al m² o prezzi fissi nel catalogo aziendale.
          </p>
          <Link
            href={manageHref ?? "/dashboard/prodotti"}
            className="mt-3 inline-flex rounded-xl border border-sky-300 px-3 py-2 text-sm font-semibold text-sky-900 hover:bg-sky-100"
          >
            Apri il catalogo prodotti
          </Link>
        </div>
      ) : (
        <>
          <div
            className={`mt-5 flex flex-col gap-3 sm:flex-row${compact ? " qpc-add-row" : ""}`}
          >
            <label className="block flex-1 text-sm font-medium text-slate-700">
              Prodotto
              <select
                value={selectedProductId}
                onChange={(event) => setSelectedProductId(event.target.value)}
                className={inputClass}
              >
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ·{" "}
                    {product.pricingMode === "AREA"
                      ? `${product.price} €/m²`
                      : `${product.price} €/pezzo`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={addLine}
              className={`self-end rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800${compact ? " qpc-add-button" : ""}`}
            >
              Aggiungi al calcolo
            </button>
          </div>

          {lines.length > 0 && (
            <div className="mt-5 space-y-3">
              {calculatedLines.map((line, index) => (
                <article
                  key={line.id}
                  className={`grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[minmax(150px,1.1fr)_minmax(90px,0.55fr)_minmax(150px,1.1fr)_minmax(190px,1fr)_auto]${compact ? " qpc-line" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Prodotto {index + 1}
                    </p>
                    <p className="mt-1 truncate font-semibold text-slate-900">
                      {line.product.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {line.product.pricingMode === "AREA"
                        ? `${line.product.price} €/m²${line.product.minimumBillableArea ? ` · minimo ${line.product.minimumBillableArea} m²` : ""}`
                        : `${line.product.price} €/pezzo`}
                    </p>
                  </div>

                  <label className="block text-sm font-medium text-slate-700">
                    Quantità
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      step="1"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.id, {
                          quantity:
                            event.target.value === ""
                              ? 0
                              : Number(event.target.value),
                        })
                      }
                      className={inputClass}
                    />
                  </label>

                  {line.product.pricingMode === "AREA" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-sm font-medium text-slate-700">
                        Larghezza (mm)
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={line.widthMm ?? ""}
                          onChange={(event) =>
                            updateLine(line.id, {
                              widthMm:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-700">
                        Altezza (mm)
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={line.heightMm ?? ""}
                          onChange={(event) =>
                            updateLine(line.id, {
                              heightMm:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                          className={inputClass}
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="self-center text-sm text-slate-500">
                      Prezzo fisso, non servono dimensioni.
                    </p>
                  )}

                  <div
                    className={`grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm${compact ? " qpc-prices" : ""}`}
                  >
                    <p>
                      <span className="block text-xs text-slate-500">
                        Prezzo unitario
                      </span>
                      <strong>
                        {line.calculation.unitPrice === null
                          ? "Inserisci le misure"
                          : formatEuro(line.calculation.unitPrice)}
                      </strong>
                    </p>
                    <p>
                      <span className="block text-xs text-slate-500">
                        Totale riga
                      </span>
                      <strong>
                        {line.calculation.totalPrice === null
                          ? "—"
                          : formatEuro(line.calculation.totalPrice)}
                      </strong>
                    </p>
                    {line.calculation.areaSqm !== null && (
                      <p className="col-span-2 text-xs text-slate-600">
                        Superficie:{" "}
                        {line.calculation.areaSqm.toLocaleString("it-IT", {
                          maximumFractionDigits: 3,
                        })}{" "}
                        m²
                        {line.calculation.billableAreaSqm !==
                          line.calculation.areaSqm &&
                          ` · fatturati ${line.calculation.billableAreaSqm?.toLocaleString("it-IT", { maximumFractionDigits: 3 })} m²`}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    aria-label={`Rimuovi ${line.product.name}`}
                    onClick={() =>
                      setLines((current) =>
                        current.filter((item) => item.id !== line.id),
                      )
                    }
                    className="self-center rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                  >
                    Rimuovi
                  </button>
                </article>
              ))}

              <div
                className={`flex flex-col gap-3 rounded-2xl bg-slate-900 p-4 text-white sm:flex-row sm:items-center sm:justify-between${compact ? " qpc-total" : ""}`}
              >
                <p className="text-lg font-semibold">
                  Totale calcolato: {formatEuro(total)}
                </p>
                <button
                  type="button"
                  disabled={!allLinesComplete}
                  onClick={() => void copyEstimate()}
                  className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {copied ? "Testo copiato" : "Copia riepilogo"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
    </section>
  );
}
