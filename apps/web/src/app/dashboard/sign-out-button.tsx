'use client';

// Il client di autenticazione (~40 kB) serve solo all'uscita: lo scarichiamo al primo hover/focus o al click.
const loadAuthClient = () => import('@/lib/auth-client');

export function SignOutButton() {
  return (
    <button
      onPointerEnter={() => void loadAuthClient()}
      onFocus={() => void loadAuthClient()}
      onClick={async () => {
        const { authClient } = await loadAuthClient();
        await authClient.signOut();
        window.location.assign('/login');
      }}
      className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white"
    >
      Esci
    </button>
  );
}
