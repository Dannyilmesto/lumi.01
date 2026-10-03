export default function Loading() {
  return (
    <main className="lumi-loading-page" aria-busy="true" aria-live="polite">
      <span className="lumi-loading-mark" aria-hidden="true" />
      <span className="sr-only">Caricamento della pagina</span>
      <div className="lumi-loading-lines" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="lumi-loading-card" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}
