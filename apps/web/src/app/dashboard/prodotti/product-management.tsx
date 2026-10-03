"use client";

import { useState, type FormEvent } from "react";

type Product = {
  id: string;
  name: string;
  pricingMode: "AREA" | "FIXED";
  price: string;
  minimumBillableArea: string | null;
};

const inputClass =
  "mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export function ProductManagement({
  organizationId,
  initialProducts,
}: {
  organizationId: string;
  initialProducts: Product[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pricingMode, setPricingMode] = useState<"AREA" | "FIXED">("AREA");
  const [price, setPrice] = useState("");
  const [minimumBillableArea, setMinimumBillableArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function resetForm() {
    setEditingId(null);
    setName("");
    setPricingMode("AREA");
    setPrice("");
    setMinimumBillableArea("");
  }

  function editProduct(product: Product) {
    setEditingId(product.id);
    setName(product.name);
    setPricingMode(product.pricingMode);
    setPrice(product.price);
    setMinimumBillableArea(product.minimumBillableArea ?? "");
    setError("");
    setNotice("");
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");

    const payload = {
      ...(editingId ? {} : { organizationId }),
      name,
      pricingMode,
      price,
      minimumBillableArea:
        pricingMode === "AREA" && minimumBillableArea.trim()
          ? minimumBillableArea
          : null,
    };

    try {
      const response = await fetch(
        editingId
          ? `/api/products/${encodeURIComponent(editingId)}`
          : "/api/products",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        product?: Product;
      };
      if (!response.ok || !result.product)
        throw new Error(
          result.error ?? "Non è stato possibile salvare il prodotto.",
        );

      setProducts((current) => {
        const next = editingId
          ? current.map((item) =>
              item.id === editingId ? result.product! : item,
            )
          : [...current, result.product!];
        return next.sort((left, right) =>
          left.name.localeCompare(right.name, "it"),
        );
      });
      setNotice(editingId ? "Prodotto aggiornato." : "Prodotto aggiunto.");
      resetForm();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Errore durante il salvataggio del prodotto.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteProduct(product: Product) {
    if (busy || !window.confirm(`Eliminare “${product.name}” dal catalogo?`))
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/products/${encodeURIComponent(product.id)}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          result.error ?? "Non è stato possibile eliminare il prodotto.",
        );
      setProducts((current) =>
        current.filter((item) => item.id !== product.id),
      );
      if (editingId === product.id) resetForm();
      setNotice("Prodotto eliminato.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Errore durante l’eliminazione del prodotto.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <h2 className="text-xl font-semibold">
          {editingId ? "Modifica prodotto" : "Aggiungi un prodotto"}
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Scegli se il prezzo dipende dalla superficie oppure è fisso per ogni
          pezzo.
        </p>
        <form className="mt-5 space-y-4" onSubmit={saveProduct}>
          <label className="block text-sm font-medium text-slate-700">
            Nome prodotto
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              placeholder="Es. Zanzariera"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Modalità di prezzo
            <select
              value={pricingMode}
              onChange={(event) =>
                setPricingMode(event.target.value as "AREA" | "FIXED")
              }
              className={inputClass}
            >
              <option value="AREA">Prezzo al m²</option>
              <option value="FIXED">Prezzo fisso per pezzo</option>
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-700">
            {pricingMode === "AREA"
              ? "Prezzo al m² (€)"
              : "Prezzo per pezzo (€)"}
            <input
              required
              type="number"
              min="0.01"
              max="9999999999.99"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className={inputClass}
              placeholder="0,00"
            />
          </label>

          {pricingMode === "AREA" && (
            <label className="block text-sm font-medium text-slate-700">
              Minimo fatturabile (m²)
              <input
                required
                type="number"
                min="0.001"
                max="9999999.999"
                step="0.001"
                value={minimumBillableArea}
                onChange={(event) => setMinimumBillableArea(event.target.value)}
                className={inputClass}
                placeholder="Es. 0,5"
              />
            </label>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
            >
              {notice}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
            >
              {busy
                ? "Salvataggio…"
                : editingId
                  ? "Salva modifiche"
                  : "Aggiungi prodotto"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Annulla
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Catalogo</h2>
            <p className="mt-1 text-sm text-slate-500">
              {products.length === 1
                ? "1 prodotto salvato"
                : `${products.length} prodotti salvati`}
            </p>
          </div>
        </div>
        {products.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center">
            <p className="font-medium text-slate-800">Il catalogo è vuoto</p>
            <p className="mt-2 text-sm text-slate-500">
              Aggiungi il primo prodotto per iniziare a calcolare i preventivi.
            </p>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {products.map((product) => (
              <li
                key={product.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">
                    {product.name}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {product.pricingMode === "AREA"
                      ? `${product.price} €/m²${product.minimumBillableArea ? ` · minimo ${product.minimumBillableArea} m²` : ""}`
                      : `${product.price} € / pezzo`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => editProduct(product)}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Modifica
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteProduct(product)}
                    className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    Elimina
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
