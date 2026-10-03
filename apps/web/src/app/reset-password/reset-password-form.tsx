'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

export function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setError('Il link di reimpostazione manca o non è valido. Richiedine uno nuovo.');
      setBusy(false);
      return;
    }

    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) throw new Error(result.error.message ?? 'Non è stato possibile reimpostare la password.');
      setMessage('Password aggiornata. Ora puoi accedere.');
      window.setTimeout(() => window.location.assign('/login'), 1200);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Si è verificato un errore.');
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Scegli una nuova password</h1>
      <form onSubmit={handleSubmit} className="mt-7 space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Nuova password
          <input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
        </label>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{message}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
          {busy ? 'Attendi…' : 'Aggiorna password'}
        </button>
      </form>
    </section>
  );
}
