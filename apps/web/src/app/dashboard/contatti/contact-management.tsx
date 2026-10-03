'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  company: string | null;
  email: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  fiscalCode: string | null;
  vatNumber: string | null;
  notes: string | null;
};

type ContactForm = {
  [Field in Exclude<keyof Contact, 'id'>]: string;
};
type ContactField = keyof ContactForm;

const emptyForm: ContactForm = {
  name: '',
  phone: '',
  company: '',
  email: '',
  address: '',
  postalCode: '',
  city: '',
  province: '',
  country: '',
  fiscalCode: '',
  vatNumber: '',
  notes: '',
};

const inputClass =
  'mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

function formFromContact(contact: Contact): ContactForm {
  return {
    name: contact.name,
    phone: contact.phone ?? '',
    company: contact.company ?? '',
    email: contact.email ?? '',
    address: contact.address ?? '',
    postalCode: contact.postalCode ?? '',
    city: contact.city ?? '',
    province: contact.province ?? '',
    country: contact.country ?? '',
    fiscalCode: contact.fiscalCode ?? '',
    vatNumber: contact.vatNumber ?? '',
    notes: contact.notes ?? '',
  };
}

function contactAddress(contact: Contact) {
  return [
    contact.address,
    [contact.postalCode, contact.city].filter(Boolean).join(' '),
    contact.province,
    contact.country,
  ]
    .filter(Boolean)
    .join(', ');
}

export function ContactManagement({
  organizationId,
  initialContacts,
  initialNextOffset,
}: {
  organizationId: string;
  initialContacts: Contact[];
  initialNextOffset: number | null;
}) {
  const router = useRouter();
  const [contacts, setContacts] = useState(initialContacts);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  }

  function updateField(field: ContactField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  // Solo l'ultima richiesta può aggiornare la lista: una risposta lenta e vecchia non deve sovrascrivere quella nuova.
  const latestLoad = useRef(0);

  async function loadContacts(query: string, newOffset: number) {
    const sequence = ++latestLoad.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        organizationId,
        offset: String(newOffset),
      });
      if (query) params.set('q', query);
      const response = await fetch(`/api/contacts?${params.toString()}`);
      const result = (await response.json()) as {
        error?: string;
        items?: Contact[];
        nextOffset?: number | null;
      };
      if (!response.ok || !result.items)
        throw new Error(result.error ?? 'Non è stato possibile caricare i contatti.');
      if (sequence !== latestLoad.current) return;
      setContacts(result.items);
      setNextOffset(result.nextOffset ?? null);
      setOffset(newOffset);
      setAppliedSearch(query);
    } catch (caught) {
      if (sequence !== latestLoad.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : 'Errore durante il caricamento dei contatti.',
      );
    } finally {
      if (sequence === latestLoad.current) setLoading(false);
    }
  }

  async function searchContacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadContacts(search.trim(), 0);
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    const payload = {
      ...form,
      ...(editingId ? {} : { organizationId }),
    };
    try {
      const response = await fetch(
        editingId
          ? `/api/contacts/${encodeURIComponent(editingId)}`
          : '/api/contacts',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? 'Non è stato possibile salvare il contatto.');
      const wasEditing = Boolean(editingId);
      resetForm();
      setNotice(wasEditing ? 'Contatto aggiornato.' : 'Contatto aggiunto.');
      const query = wasEditing ? appliedSearch : '';
      setSearch(query);
      await loadContacts(query, wasEditing ? offset : 0);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Errore durante il salvataggio del contatto.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteContact(contact: Contact) {
    if (
      saving ||
      !window.confirm(`Eliminare il contatto “${contact.name}”?`)
    )
      return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        `/api/contacts/${encodeURIComponent(contact.id)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? 'Non è stato possibile eliminare il contatto.');
      if (editingId === contact.id) resetForm();
      setNotice('Contatto eliminato.');
      const newOffset =
        contacts.length === 1 && offset > 0 ? Math.max(0, offset - 30) : offset;
      await loadContacts(appliedSearch, newOffset);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Errore durante l’eliminazione del contatto.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function createQuote(contact: Contact) {
    if (saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          customerId: contact.id,
          saveToProfile: false,
        }),
      });
      const result = (await response.json()) as {
        quoteId?: string;
        error?: string;
      };
      if (!response.ok || !result.quoteId)
        throw new Error(
          result.error ?? 'Non è stato possibile aprire il preventivo.',
        );
      router.push(
        `/dashboard/preventivi/${encodeURIComponent(result.quoteId)}/documento`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Errore durante la creazione del preventivo.',
      );
      setSaving(false);
    }
  }

  function editContact(contact: Contact) {
    setEditingId(contact.id);
    setForm(formFromContact(contact));
    setError('');
    setNotice('');
  }

  function textField(
    field: ContactField,
    label: string,
    options: { required?: boolean; type?: string; maxLength?: number } = {},
  ) {
    return (
      <label className="block text-sm font-medium text-slate-700" key={field}>
        {label}
        <input
          required={options.required}
          type={options.type ?? 'text'}
          maxLength={options.maxLength}
          value={form[field] ?? ''}
          onChange={(event) => updateField(field, event.target.value)}
          className={inputClass}
        />
      </label>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)]">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <h2 className="text-xl font-semibold">
          {editingId ? 'Modifica contatto' : 'Registra un contatto'}
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Solo nome e telefono sono obbligatori. Gli altri dati possono essere
          aggiunti o aggiornati in seguito.
        </p>
        <form className="mt-5 space-y-4" onSubmit={saveContact}>
          <div className="grid gap-4 sm:grid-cols-2">
            {textField('name', 'Nome e cognome', {
              required: true,
              maxLength: 160,
            })}
            {textField('phone', 'Numero di telefono', {
              required: true,
              type: 'tel',
              maxLength: 80,
            })}
            {textField('email', 'Email', {
              type: 'email',
              maxLength: 254,
            })}
            {textField('company', 'Azienda', { maxLength: 160 })}
          </div>

          <fieldset className="rounded-2xl border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">
              Indirizzo di abitazione
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                {textField('address', 'Via e numero civico', {
                  maxLength: 240,
                })}
              </div>
              {textField('postalCode', 'CAP', { maxLength: 32 })}
              {textField('city', 'Città', { maxLength: 100 })}
              {textField('province', 'Provincia', { maxLength: 100 })}
              {textField('country', 'Paese', { maxLength: 100 })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            {textField('fiscalCode', 'Codice fiscale', { maxLength: 32 })}
            {textField('vatNumber', 'Partita IVA', { maxLength: 32 })}
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Note
            <textarea
              rows={3}
              maxLength={5000}
              value={form.notes ?? ''}
              onChange={(event) => updateField('notes', event.target.value)}
              className={inputClass}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
            >
              {notice}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={saving}
              className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
            >
              {saving
                ? 'Salvataggio…'
                : editingId
                  ? 'Salva modifiche'
                  : 'Aggiungi contatto'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Annulla
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div>
          <h2 className="text-xl font-semibold">Rubrica contatti</h2>
          <p className="mt-1 text-sm text-slate-500">
            {loading
              ? 'Ricerca in corso…'
              : `${contacts.length}${nextOffset !== null ? '+' : ''} contatti visualizzati`}
          </p>
        </div>
        <form className="mt-5 flex gap-2" onSubmit={searchContacts}>
          <label className="sr-only" htmlFor="contact-search">
            Cerca contatti
          </label>
          <input
            id="contact-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome, telefono, email, azienda o città…"
            className={`${inputClass} mt-0 min-w-0`}
          />
          <button
            disabled={loading}
            className="shrink-0 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cerca
          </button>
        </form>

        {contacts.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center">
            <p className="font-medium text-slate-800">
              {appliedSearch ? 'Nessun contatto trovato' : 'La rubrica è vuota'}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {appliedSearch
                ? 'Prova con un altro nome, numero o indirizzo.'
                : 'Aggiungi il primo contatto usando il modulo.'}
            </p>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {contacts.map((contact) => {
              const address = contactAddress(contact);
              return (
                <li key={contact.id} className="px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {contact.name}
                      </p>
                      {contact.company && (
                        <p className="mt-0.5 text-sm text-slate-600">
                          {contact.company}
                        </p>
                      )}
                      {(contact.phone || contact.email) && (
                        <p className="mt-1 text-sm text-slate-700">
                          {contact.phone && (
                            <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                          )}
                          {contact.phone && contact.email && ' · '}
                          {contact.email && (
                          <>
                            <a href={`mailto:${contact.email}`}>
                              {contact.email}
                            </a>
                          </>
                          )}
                        </p>
                      )}
                      {address && (
                        <p className="mt-1 text-sm text-slate-500">{address}</p>
                      )}
                      {(contact.fiscalCode || contact.vatNumber) && (
                        <p className="mt-1 text-xs text-slate-500">
                          {contact.fiscalCode &&
                            `C.F. ${contact.fiscalCode}`}
                          {contact.fiscalCode && contact.vatNumber && ' · '}
                          {contact.vatNumber && `P. IVA ${contact.vatNumber}`}
                        </p>
                      )}
                      {contact.notes && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                          {contact.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void createQuote(contact)}
                        className="rounded-xl bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
                      >
                        {saving ? 'Apertura…' : 'Edita preventivo'}
                      </button>
                      <button
                        type="button"
                        onClick={() => editContact(contact)}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Modifica
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void deleteContact(contact)}
                        className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        Elimina
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={loading || offset === 0}
            onClick={() =>
              void loadContacts(appliedSearch, Math.max(0, offset - 30))
            }
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            ← Precedenti
          </button>
          <span className="text-sm text-slate-500">
            Pagina {Math.floor(offset / 30) + 1}
          </span>
          <button
            type="button"
            disabled={loading || nextOffset === null}
            onClick={() => {
              if (nextOffset !== null)
                void loadContacts(appliedSearch, nextOffset);
            }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Successivi →
          </button>
        </div>
      </section>
    </div>
  );
}
