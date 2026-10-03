'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Errore non gestito nell’interfaccia.', error);
  }, [error]);

  return (
    <main className="lumi-state-page">
      <section className="lumi-state-card" aria-labelledby="error-title">
        <span className="lumi-state-code">Si è verificato un problema</span>
        <h1 id="error-title">La pagina non è riuscita a caricarsi</h1>
        <p>Riprova. Se il problema continua, torna alla panoramica e riapri la pagina.</p>
        <div className="lumi-state-actions">
          <button className="lumi-state-action" onClick={reset}>Riprova</button>
          <Link className="lumi-state-link" href="/dashboard">Torna alla panoramica</Link>
        </div>
      </section>
    </main>
  );
}
