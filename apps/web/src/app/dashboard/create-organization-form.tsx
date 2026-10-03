'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

export function CreateOrganizationForm() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const baseSlug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36);
    const slug = `${baseSlug || 'azienda'}-${crypto.randomUUID().slice(0, 8)}`;

    try {
      const { authClient } = await import('@/lib/auth-client');
      const result = await authClient.organization.create({ name, slug });
      if (result.error) throw new Error(result.error.message ?? 'Non è stato possibile creare l’azienda.');
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Si è verificato un errore.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-4">
      <label className="block text-sm font-medium text-slate-700">
        Nome azienda
        <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
        {busy ? 'Creazione…' : 'Crea spazio aziendale'}
      </button>
    </form>
  );
}
