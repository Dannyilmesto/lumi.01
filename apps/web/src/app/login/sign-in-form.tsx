'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

type FormMode = 'sign-in' | 'sign-up' | 'forgot-password';

export function AuthForm() {
  const [mode, setMode] = useState<FormMode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');

    try {
      if (mode === 'forgot-password') {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (result.error) throw new Error(result.error.message ?? 'Richiesta non riuscita.');
        setMessage('Se l’indirizzo è registrato, riceverai un link per reimpostare la password.');
      } else if (mode === 'sign-up') {
        const result = await authClient.signUp.email({ name, email, password, callbackURL: '/dashboard' });
        if (result.error) throw new Error(result.error.message ?? 'Registrazione non riuscita.');
        setMessage('Account creato. Apri l’email ricevuta da Mailpit e verifica il tuo indirizzo per accedere.');
      } else {
        const result = await authClient.signIn.email({ email, password, callbackURL: '/dashboard' });
        if (result.error) throw new Error(result.error.message ?? 'Accesso non riuscito.');
        window.location.assign('/dashboard');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Si è verificato un errore.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {mode === 'sign-in'
          ? 'Accedi al tuo spazio'
          : mode === 'sign-up'
            ? 'Crea il tuo account'
            : 'Reimposta la password'}
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {mode === 'sign-in'
          ? 'Gestisci listini e preventivi della tua azienda.'
          : mode === 'sign-up'
            ? 'Ti invieremo un link per verificare il tuo indirizzo email.'
            : 'Inserisci la tua email e ti invieremo un link sicuro.'}
      </p>

      <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
        {mode === 'sign-up' && (
          <label className="block text-sm font-medium text-slate-700">
            Nome
            <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
        </label>
        {mode !== 'forgot-password' && (
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input required type="password" minLength={8} maxLength={128} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" />
          </label>
        )}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{message}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white transition hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60">
          {busy ? 'Attendi…' : mode === 'sign-in' ? 'Accedi' : mode === 'sign-up' ? 'Crea account' : 'Invia link'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        {mode === 'forgot-password' ? 'Ricordi la password?' : mode === 'sign-in' ? 'Non hai ancora un account?' : 'Hai già un account?'}{' '}
        <button type="button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(''); setMessage(''); }} className="font-semibold text-slate-900 underline underline-offset-4">
          {mode === 'sign-in' ? 'Registrati' : 'Accedi'}
        </button>
      </p>
      {mode === 'sign-in' && (
        <button type="button" onClick={() => { setMode('forgot-password'); setError(''); setMessage(''); }} className="mt-3 block w-full text-center text-sm text-slate-500 underline underline-offset-4">
          Password dimenticata?
        </button>
      )}
    </section>
  );
}
