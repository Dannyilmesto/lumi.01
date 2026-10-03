import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';

export default function NotFound() {
  return (
    <main className="lumi-state-page">
      <BrandLogo href="/login" size="large" />
      <section className="lumi-state-card" aria-labelledby="not-found-title">
        <span className="lumi-state-code">404</span>
        <h1 id="not-found-title">Questa pagina non esiste</h1>
        <p>Il link potrebbe non essere aggiornato o la pagina potrebbe essere stata spostata.</p>
        <Link className="lumi-state-action" href="/dashboard">
          Torna alla panoramica
        </Link>
      </section>
    </main>
  );
}
