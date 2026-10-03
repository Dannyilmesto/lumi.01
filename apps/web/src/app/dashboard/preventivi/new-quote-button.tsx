'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewQuoteButton({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function createQuote() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      const result = (await response.json()) as {
        quoteId?: string;
        error?: string;
      };
      if (!response.ok || !result.quoteId) {
        throw new Error(
          result.error ?? 'Non è stato possibile creare la bozza.',
        );
      }
      router.push(
        '/dashboard/preventivi/' + encodeURIComponent(result.quoteId),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Errore durante la creazione della bozza.',
      );
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={createQuote}
        disabled={busy}
        className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {busy ? 'Creo la bozza…' : 'Nuovo preventivo'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
