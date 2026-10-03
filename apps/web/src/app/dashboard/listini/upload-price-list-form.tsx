'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';

type UploadResponse = {
  error?: string;
  priceList?: { name: string; version: string };
};

export function UploadPriceListForm({
  organizationId,
}: {
  organizationId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/price-lists', {
        method: 'POST',
        body: new FormData(form),
      });
      const result = (await response.json()) as UploadResponse;
      if (!response.ok)
        throw new Error(
          result.error ?? 'Non è stato possibile caricare il PDF.',
        );

      setSuccess(
        `Listino “${result.priceList?.name}”, versione ${result.priceList?.version}, salvato.`,
      );
      form.reset();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Si è verificato un errore durante il caricamento.',
      );
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <label className="block text-sm font-medium text-slate-700">
        Fornitore
        <input
          name="supplierName"
          required
          maxLength={120}
          autoComplete="organization"
          placeholder="Es. Fornitore S.r.l."
          className={inputClass}
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Nome del listino
        <input
          name="name"
          required
          maxLength={160}
          placeholder="Es. Avvolgibili PVC"
          className={inputClass}
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Versione
        <input
          name="version"
          required
          maxLength={80}
          placeholder="Es. 2026"
          className={inputClass}
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Documento PDF
        <input
          name="file"
          type="file"
          required
          accept="application/pdf,.pdf"
          className="mt-1.5 block w-full cursor-pointer rounded-xl border border-slate-300 bg-white text-sm text-slate-700 file:mr-4 file:border-0 file:bg-slate-100 file:px-4 file:py-3 file:font-semibold file:text-slate-800 hover:file:bg-slate-200"
        />
        <span className="mt-1.5 block text-xs font-normal text-slate-500">
          Solo PDF, massimo 30 MB.
        </span>
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"
        >
          {success}
        </p>
      )}

      <button
        disabled={busy}
        className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? 'Caricamento e salvataggio…' : 'Carica listino PDF'}
      </button>
    </form>
  );
}
