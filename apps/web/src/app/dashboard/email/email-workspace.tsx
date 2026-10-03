'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

type EmailAccountSummary = {
  id: string;
  provider: 'GOOGLE' | 'MICROSOFT' | 'IMAP_SMTP' | 'DEMO';
  email: string;
};

type GenericServerForm = {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  password: string;
};

type GenericAccountForm = {
  email: string;
  imap: GenericServerForm;
  smtp: GenericServerForm;
};

type MailMessageSummary = {
  id: string;
  subject: string;
  from: string;
  receivedAt: string | null;
  preview: string;
  isRead: boolean;
};

type MailMessage = MailMessageSummary & {
  to: string[];
  body: string;
};

const inputClass =
  'mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

const emptyServer: GenericServerForm = {
  host: '',
  port: '',
  secure: true,
  user: '',
  password: '',
};

const emptyGenericAccount: GenericAccountForm = {
  email: '',
  imap: { ...emptyServer, port: '993' },
  smtp: { ...emptyServer, port: '465' },
};

const callbackMessages: Record<string, string> = {
  provider: 'Il provider email selezionato non è riconosciuto.',
  state: 'Il collegamento è scaduto o non valido. Riprova.',
  cancelled: 'Collegamento account annullato.',
  connection: 'Non è stato possibile completare il collegamento email.',
};

const mailDateFormat = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function dateLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : mailDateFormat.format(date);
}

export function EmailWorkspace({
  initialAccounts,
  providers,
  callbackError,
}: {
  initialAccounts: EmailAccountSummary[];
  providers: {
    google: boolean;
    microsoft: boolean;
    encryption: boolean;
    generic: boolean;
    demo: boolean;
  };
  callbackError: string | null;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [selectedAccountId, setSelectedAccountId] = useState(
    initialAccounts[0]?.id ?? '',
  );
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [activeMessage, setActiveMessage] = useState<MailMessage | null>(null);
  const [search, setSearch] = useState('');
  const [compose, setCompose] = useState(false);
  const [showProviderOptions, setShowProviderOptions] = useState(false);
  const [showGenericForm, setShowGenericForm] = useState(false);
  const [genericForm, setGenericForm] =
    useState<GenericAccountForm>(emptyGenericAccount);
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState(
    callbackError ? callbackMessages[callbackError] ?? callbackMessages.connection : '',
  );
  const [notice, setNotice] = useState('');

  const messagesRequest = useRef<AbortController | null>(null);

  async function loadMessages(accountId: string) {
    // Un cambio rapido di account non deve far comparire la posta di quello precedente.
    messagesRequest.current?.abort();
    const controller = new AbortController();
    messagesRequest.current = controller;
    setLoadingMessages(true);
    setError('');
    setActiveMessage(null);
    try {
      const response = await fetch(
        `/api/email/accounts/${encodeURIComponent(accountId)}/messages`,
        { signal: controller.signal },
      );
      const result = (await response.json()) as {
        error?: string;
        messages?: MailMessageSummary[];
      };
      if (!response.ok || !result.messages)
        throw new Error(result.error ?? 'Non è stato possibile caricare la posta.');
      if (controller.signal.aborted) return;
      setMessages(result.messages);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setMessages([]);
      setError(
        caught instanceof Error ? caught.message : 'Errore durante il caricamento della posta.',
      );
    } finally {
      if (messagesRequest.current === controller) {
        messagesRequest.current = null;
        setLoadingMessages(false);
      }
    }
  }

  useEffect(() => {
    if (selectedAccountId) void loadMessages(selectedAccountId);
    else setMessages([]);
  }, [selectedAccountId]);

  useEffect(() => () => messagesRequest.current?.abort(), []);

  async function connectAccount(provider: 'GOOGLE' | 'MICROSOFT') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/email/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const result = (await response.json()) as {
        authorizationUrl?: string;
        error?: string;
      };
      if (!response.ok || !result.authorizationUrl)
        throw new Error(
          result.error ?? 'Non è stato possibile avviare il collegamento.',
        );
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Errore durante il collegamento dell’account.',
      );
      setBusy(false);
    }
  }

  async function addDemoAccount() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/email/accounts/demo', {
        method: 'POST',
      });
      const result = (await response.json()) as {
        error?: string;
        account?: EmailAccountSummary;
      };
      if (!response.ok || !result.account)
        throw new Error(result.error ?? 'Non è stato possibile creare la casella demo.');
      setAccounts((current) => [...current, result.account!]);
      setSelectedAccountId(result.account.id);
      setNotice('Casella demo pronta con messaggi di esempio.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Errore durante la creazione della casella demo.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function addGenericAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        email: genericForm.email,
        imap: {
          ...genericForm.imap,
          port: Number(genericForm.imap.port),
        },
        smtp: {
          ...genericForm.smtp,
          port: Number(genericForm.smtp.port),
        },
      };
      const response = await fetch('/api/email/accounts/generic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: string;
        account?: EmailAccountSummary;
      };
      if (!response.ok || !result.account)
        throw new Error(result.error ?? 'Non è stato possibile aggiungere l’account.');
      setAccounts((current) => {
        const next = current.filter(
          (account) => account.id !== result.account?.id,
        );
        return [...next, result.account!];
      });
      setSelectedAccountId(result.account.id);
      setGenericForm(emptyGenericAccount);
      setShowGenericForm(false);
      setNotice('Account email verificato e aggiunto.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Errore durante l’aggiunta dell’account.',
      );
    } finally {
      setBusy(false);
    }
  }

  function updateGenericServer(
    server: 'imap' | 'smtp',
    field: keyof GenericServerForm,
    value: string | boolean,
  ) {
    setGenericForm((current) => ({
      ...current,
      [server]: { ...current[server], [field]: value },
    }));
  }

  async function openMessage(message: MailMessageSummary) {
    if (!selectedAccountId || busy) return;
    setBusy(true);
    setError('');
    setActiveMessage(null);
    try {
      const response = await fetch(
        `/api/email/accounts/${encodeURIComponent(selectedAccountId)}/messages/${encodeURIComponent(message.id)}`,
      );
      const result = (await response.json()) as {
        error?: string;
        message?: MailMessage;
      };
      if (!response.ok || !result.message)
        throw new Error(result.error ?? 'Non è stato possibile aprire il messaggio.');
      setActiveMessage(result.message);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Errore durante l’apertura del messaggio.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccountId || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        `/api/email/accounts/${encodeURIComponent(selectedAccountId)}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: recipient, subject, body }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? 'Non è stato possibile inviare il messaggio.');
      setCompose(false);
      setRecipient('');
      setSubject('');
      setBody('');
      setNotice('Email inviata.');
      await loadMessages(selectedAccountId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Errore durante l’invio dell’email.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(account: EmailAccountSummary) {
    if (
      busy ||
      !window.confirm(`Scollegare ${account.email} da questa app?`)
    )
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        `/api/email/accounts/${encodeURIComponent(account.id)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? 'Non è stato possibile scollegare l’account.');
      const nextAccounts = accounts.filter((item) => item.id !== account.id);
      setAccounts(nextAccounts);
      if (selectedAccountId === account.id) {
        setSelectedAccountId(nextAccounts[0]?.id ?? '');
        setActiveMessage(null);
        setMessages([]);
      }
      setNotice('Account email scollegato.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Errore durante la rimozione dell’account.',
      );
    } finally {
      setBusy(false);
    }
  }

  const selectedAccount = accounts.find(
    (account) => account.id === selectedAccountId,
  );
  const visibleMessages = messages.filter((message) => {
    const query = search.trim().toLocaleLowerCase('it');
    return (
      !query ||
      `${message.subject} ${message.from} ${message.preview}`
        .toLocaleLowerCase('it')
        .includes(query)
    );
  });

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="border-b border-slate-200 pb-5">
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
          Spazio personale
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Email</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Collega la tua casella e aggiungi altri account personali. Puoi
          leggere la posta in arrivo e inviare email dai tuoi indirizzi.
        </p>
      </header>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">I tuoi account</h2>
            <p className="mt-1 text-sm text-slate-500">
              {accounts.length
                ? `${accounts.length} ${accounts.length === 1 ? 'account collegato' : 'account collegati'}`
                : 'Nessun account email collegato'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            aria-expanded={showProviderOptions}
            onClick={() => {
              setShowGenericForm(false);
              setShowProviderOptions((visible) => !visible);
            }}
            className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {showProviderOptions ? 'Chiudi' : 'Aggiungi account'}
          </button>
          <button
            type="button"
            disabled={busy || !providers.demo}
            onClick={() => void addDemoAccount()}
            className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Crea account prova
          </button>
        </div>

        {showProviderOptions && !showGenericForm && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">
              Scegli il tipo di account
            </h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                disabled={busy || !providers.google || !providers.encryption}
                onClick={() => void connectAccount('GOOGLE')}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block">Gmail</span>
                {(!providers.google || !providers.encryption) && (
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Non configurato dall’amministratore
                  </span>
                )}
              </button>
              <button
                type="button"
                disabled={busy || !providers.microsoft || !providers.encryption}
                onClick={() => void connectAccount('MICROSOFT')}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block">Outlook / Microsoft 365</span>
                {(!providers.microsoft || !providers.encryption) && (
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Non configurato dall’amministratore
                  </span>
                )}
              </button>
              <button
                type="button"
                disabled={busy || !providers.generic}
                onClick={() => {
                  setShowProviderOptions(false);
                  setShowGenericForm(true);
                }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block">Altro account (IMAP/SMTP)</span>
                {!providers.generic && (
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Non disponibile
                  </span>
                )}
              </button>
            </div>
          </div>
        )}

        {showGenericForm && (
          <form
            onSubmit={addGenericAccount}
            className="mt-5 grid gap-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
          >
            <div>
              <button
                type="button"
                onClick={() => {
                  setShowGenericForm(false);
                  setShowProviderOptions(true);
                }}
                className="text-sm font-semibold text-sky-800 hover:underline"
              >
                ← Torna ai provider
              </button>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Inserisci i parametri IMAP e SMTP del provider. L’app verifica
                entrambi i server prima di salvare; le password sono cifrate e
                non vengono mostrate di nuovo.
              </p>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Indirizzo email
              <input
                required
                type="email"
                maxLength={254}
                value={genericForm.email}
                onChange={(event) =>
                  setGenericForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                className={inputClass}
              />
            </label>
            {(['imap', 'smtp'] as const).map((server) => (
              <fieldset
                key={server}
                className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2"
              >
                <legend className="px-1 text-sm font-semibold text-slate-800">
                  {server.toUpperCase()}
                </legend>
                <label className="block text-sm font-medium text-slate-700">
                  Server host
                  <input
                    required
                    maxLength={253}
                    value={genericForm[server].host}
                    onChange={(event) =>
                      updateGenericServer(server, 'host', event.target.value)
                    }
                    placeholder={
                      server === 'imap'
                        ? 'imap.example.com'
                        : 'smtp.example.com'
                    }
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Porta
                  <input
                    required
                    type="number"
                    min="1"
                    max="65535"
                    value={genericForm[server].port}
                    onChange={(event) =>
                      updateGenericServer(server, 'port', event.target.value)
                    }
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Nome utente
                  <input
                    required
                    maxLength={254}
                    autoComplete="username"
                    value={genericForm[server].user}
                    onChange={(event) =>
                      updateGenericServer(server, 'user', event.target.value)
                    }
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Password
                  <input
                    required
                    type="password"
                    maxLength={1000}
                    autoComplete="new-password"
                    value={genericForm[server].password}
                    onChange={(event) =>
                      updateGenericServer(server, 'password', event.target.value)
                    }
                    className={inputClass}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={genericForm[server].secure}
                    onChange={(event) =>
                      updateGenericServer(
                        server,
                        'secure',
                        event.target.checked,
                      )
                    }
                    className="size-4"
                  />
                  Usa TLS diretto
                </label>
              </fieldset>
            ))}
            <button
              disabled={busy}
              className="w-fit rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
            >
              {busy ? 'Verifica e salvataggio…' : 'Verifica e aggiungi account'}
            </button>
          </form>
        )}

        {accounts.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {accounts.map((account) => (
              <li
                key={account.id}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${selectedAccountId === account.id ? 'border-sky-700 bg-sky-50 text-sky-900' : 'border-slate-200 text-slate-700'}`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedAccountId(account.id)}
                  aria-pressed={selectedAccountId === account.id}
                  className="font-medium"
                >
                  {account.email}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Scollega ${account.email}`}
                  onClick={() => void removeAccount(account)}
                  className="rounded-full px-1 font-bold text-slate-500 hover:bg-white hover:text-red-700 disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {selectedAccount ? (
        <section className="mt-6 grid min-h-[560px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)]">
          <div className="min-w-0 border-b border-slate-200 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
              <div>
                <h2 className="font-semibold">Posta in arrivo</h2>
                <p className="text-xs text-slate-500">
                  {selectedAccount.email}
                  {selectedAccount.provider === 'DEMO' && ' · casella simulata'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveMessage(null);
                    setCompose(true);
                    setError('');
                  }}
                  className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
                >
                  Scrivi
                </button>
                <button
                  type="button"
                  disabled={loadingMessages}
                  onClick={() => void loadMessages(selectedAccount.id)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Aggiorna
                </button>
              </div>
            </div>
            <div className="border-b border-slate-200 p-3">
              <label className="sr-only" htmlFor="email-search">
                Cerca nella posta
              </label>
              <input
                id="email-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cerca in mittente, oggetto e anteprima…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-600"
              />
            </div>
            {loadingMessages ? (
              <p className="p-5 text-sm text-slate-500">Caricamento messaggi…</p>
            ) : visibleMessages.length ? (
              <ul className="max-h-[650px] divide-y divide-slate-100 overflow-y-auto">
                {visibleMessages.map((message) => (
                  <li key={message.id}>
                    <button
                      type="button"
                      onClick={() => void openMessage(message)}
                      className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${!message.isRead ? 'bg-sky-50/50' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={`truncate text-sm ${message.isRead ? 'text-slate-700' : 'font-semibold text-slate-950'}`}
                        >
                          {message.from || '(mittente sconosciuto)'}
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {dateLabel(message.receivedAt)}
                        </span>
                      </div>
                      <p
                        className={`mt-1 truncate text-sm ${message.isRead ? 'text-slate-700' : 'font-semibold text-slate-950'}`}
                      >
                        {message.subject}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                        {message.preview}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-slate-500">
                {search ? 'Nessun messaggio corrisponde alla ricerca.' : 'La posta in arrivo è vuota.'}
              </p>
            )}
          </div>

          <div className="min-w-0 p-5 sm:p-7">
            {selectedAccount.provider === 'DEMO' && !compose && !activeMessage && (
              <p className="mb-4 rounded-xl bg-violet-50 p-3 text-sm leading-6 text-violet-900">
                Account di prova: i messaggi sono simulati e non vengono
                recapitati a indirizzi reali. Per provare l’invio, usa come
                destinatario {selectedAccount.email}.
              </p>
            )}
            {compose ? (
              <form className="space-y-4" onSubmit={sendMessage}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold">Nuova email</h2>
                  <button
                    type="button"
                    onClick={() => setCompose(false)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Chiudi
                  </button>
                </div>
                <label className="block text-sm font-medium text-slate-700">
                  Da
                  <input
                    readOnly
                    value={selectedAccount.email}
                    className={`${inputClass} bg-slate-50`}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  A
                  <input
                    required
                    type="email"
                    maxLength={254}
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    className={inputClass}
                    placeholder={
                      selectedAccount.provider === 'DEMO'
                        ? selectedAccount.email
                        : 'destinatario@example.com'
                    }
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Oggetto
                  <input
                    required
                    maxLength={500}
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Messaggio
                  <textarea
                    required
                    rows={12}
                    maxLength={50_000}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className={inputClass}
                  />
                </label>
                <button
                  disabled={busy}
                  className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
                >
                  {busy ? 'Invio…' : 'Invia email'}
                </button>
              </form>
            ) : activeMessage ? (
              <article>
                <p className="text-sm text-slate-500">
                  {dateLabel(activeMessage.receivedAt)}
                </p>
                <h2 className="mt-2 break-words text-xl font-semibold">
                  {activeMessage.subject}
                </h2>
                <p className="mt-3 break-words text-sm text-slate-600">
                  <strong>Da:</strong> {activeMessage.from}
                </p>
                <p className="mt-1 break-words text-sm text-slate-600">
                  <strong>A:</strong>{' '}
                  {activeMessage.to.join(', ') || selectedAccount.email}
                </p>
                <hr className="my-5 border-slate-200" />
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-800">
                  {activeMessage.body}
                </pre>
              </article>
            ) : (
              <div className="grid min-h-[400px] place-content-center text-center">
                <span className="text-4xl text-slate-300" aria-hidden="true">
                  ✉
                </span>
                <p className="mt-3 font-medium text-slate-800">
                  Seleziona un messaggio
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Oppure scrivi una nuova email dall’account selezionato.
                </p>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
          <span className="text-4xl text-slate-300" aria-hidden="true">
            ✉
          </span>
          <h2 className="mt-3 text-lg font-semibold text-slate-900">
            Collega il tuo account email
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Ogni utente registrato può aggiungere la propria casella e altri
            account. I token vengono cifrati e ogni account resta visibile solo
            al proprietario.
          </p>
        </section>
      )}
    </main>
  );
}
