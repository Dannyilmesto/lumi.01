'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CandidateReviewActions({
  priceListId,
  candidateId,
}: {
  priceListId: string;
  candidateId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function updateReview(reviewStatus: 'ACCEPTED' | 'REJECTED') {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/price-lists/${encodeURIComponent(priceListId)}/candidates/${encodeURIComponent(candidateId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewStatus }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? 'Non è stato possibile salvare la revisione.');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Errore durante il salvataggio della revisione.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => updateReview('ACCEPTED')}
        className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        Conferma lettura
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => updateReview('REJECTED')}
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Escludi
      </button>
      {error && (
        <p role="alert" className="basis-full text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
