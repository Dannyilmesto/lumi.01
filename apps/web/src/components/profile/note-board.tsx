'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { Note, PageResult } from '@/lib/profile-types';
import {
  errorMessage,
  profileFetch,
  useProfileResource,
} from './profile-client';
import { EmptyState, Feedback, Pager } from './profile-ui';

export function NoteBoard() {
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const resource = useProfileResource<PageResult<Note>>(
    `/api/profile/notes?offset=${offset}&q=${encodeURIComponent(search)}`,
  );
  const [editing, setEditing] = useState<Note | null | undefined>();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [link, setLink] = useState<Note['link']>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [targets, setTargets] = useState<NonNullable<Note['link']>[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (editing === undefined || !linkQuery.trim()) {
      setTargets([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/profile/note-targets?q=${encodeURIComponent(linkQuery)}`,
          { signal: controller.signal },
        );
        if (response.ok)
          setTargets(
            ((await response.json()) as { items: NonNullable<Note['link']>[] })
              .items,
          );
      } catch {
        /* An interrupted search leaves the selected link unchanged. */
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [editing, linkQuery]);
  function edit(note: Note | null) {
    if (
      editing !== undefined &&
      !window.confirm(
        'Sostituire il testo della nota aperta? Le modifiche non salvate verranno perse.',
      )
    )
      return;
    setEditing(note);
    setTitle(note?.title || '');
    setContent(note?.content || '');
    setLink(note?.link || null);
    setLinkQuery('');
    setNotice('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    resource.setError('');
    try {
      await profileFetch('/api/profile/notes', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title,
          content,
          link: link ? { type: link.type, id: link.id } : null,
          ...(editing
            ? { id: editing.id, version: editing.version, action: 'update' }
            : {}),
        }),
      });
      setEditing(undefined);
      setNotice(
        editing?.isPublic
          ? 'Nota privata salvata. Usa “Aggiorna bacheca” per pubblicare anche le modifiche.'
          : 'Nota salvata.',
      );
      await resource.reload();
    } catch (error) {
      resource.setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function action(note: Note, kind: 'publish' | 'unpublish' | 'delete') {
    const message =
      kind === 'publish'
        ? `Pubblicare “${note.title}” con tutto il suo testo per tutti gli utenti della piattaforma?`
        : kind === 'delete'
          ? 'Eliminare questa nota e la sua eventuale pubblicazione?'
          : 'Ritirare la nota dalla bacheca pubblica?';
    if (!window.confirm(message)) return;
    setBusy(true);
    resource.setError('');
    try {
      await profileFetch('/api/profile/notes', {
        method: kind === 'delete' ? 'DELETE' : 'PATCH',
        body: JSON.stringify({
          id: note.id,
          action: kind,
          confirmPublic: kind === 'publish',
          version: note.version,
        }),
      });
      if (editing?.id === note.id && kind === 'delete') setEditing(undefined);
      setNotice(
        kind === 'publish'
          ? 'Nota pubblicata.'
          : kind === 'unpublish'
            ? 'Pubblicazione ritirata.'
            : 'Nota eliminata.',
      );
      await resource.reload();
    } catch (error) {
      resource.setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-panel">
      <div className="profile-section-heading">
        <div>
          <h2>Le tue note</h2>
          <p>Appunti privati, idee e promemoria. Scegli tu cosa condividere.</p>
        </div>
        <button
          className="profile-button"
          disabled={busy}
          onClick={() => edit(null)}
        >
          + Nuova nota
        </button>
      </div>
      <Feedback error={resource.error} notice={notice} />
      <form
        className="profile-search"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setSearch(query);
        }}
      >
        <input
          aria-label="Cerca nelle note"
          value={query}
          placeholder="Cerca titolo o testo…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="profile-button secondary">Cerca</button>
      </form>
      {editing !== undefined && (
        <form className="profile-form" onSubmit={save}>
          <h3>{editing ? 'Modifica nota' : 'Nuova nota privata'}</h3>
          <label>
            Titolo
            <input
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Testo
            <textarea
              required
              maxLength={20000}
              rows={7}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Collega a un cliente o preventivo (facoltativo)
            <input
              value={linkQuery}
              onChange={(event) => setLinkQuery(event.target.value)}
              placeholder="Cerca nome cliente o titolo preventivo…"
              disabled={busy}
            />
          </label>
          {link && (
            <div className="profile-inline">
              <span>
                Collegata a{' '}
                {link.type === 'customer' ? 'cliente' : 'preventivo'}:{' '}
                {link.label}
              </span>
              <button type="button" onClick={() => setLink(null)}>
                Rimuovi collegamento
              </button>
            </div>
          )}
          {targets.length > 0 && (
            <div className="profile-note-targets">
              {targets.map((target) => (
                <button
                  type="button"
                  key={`${target.type}:${target.id}`}
                  onClick={() => {
                    setLink(target);
                    setTargets([]);
                    setLinkQuery('');
                  }}
                >
                  {target.type === 'customer' ? 'Cliente' : 'Preventivo'} ·{' '}
                  {target.label}
                </button>
              ))}
            </div>
          )}
          <div className="profile-inline">
            <button disabled={busy} className="profile-button">
              {busy ? 'Salvataggio…' : 'Salva nota'}
            </button>
            <button
              type="button"
              className="profile-button secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Chiudere senza salvare le modifiche?'))
                  setEditing(undefined);
              }}
            >
              Annulla
            </button>
          </div>
        </form>
      )}
      {resource.loading ? (
        <EmptyState>Caricamento note…</EmptyState>
      ) : !resource.data?.items.length ? (
        <EmptyState>Non ci sono note. Crea il tuo primo appunto.</EmptyState>
      ) : (
        <div className="profile-note-grid">
          {resource.data.items.map((note) => (
            <article className="profile-note-card" key={note.id}>
              <div className="profile-inline">
                <span
                  className={`profile-badge ${note.isPublic ? 'public' : ''}`}
                >
                  {note.isPublic ? 'In bacheca' : 'Privata'}
                </span>
                <time>
                  {new Date(note.updatedAt).toLocaleDateString('it-IT')}
                </time>
              </div>
              <h3>{note.title}</h3>
              <p className="profile-note-preview">{note.content}</p>
              {note.link && (
                <p className="profile-muted">
                  {note.link.type === 'customer' ? 'Cliente' : 'Preventivo'}:{' '}
                  {note.link.label}
                </p>
              )}
              <div className="profile-card-actions">
                <button disabled={busy} onClick={() => edit(note)}>
                  Modifica
                </button>
                <button
                  disabled={busy}
                  onClick={() => void action(note, 'publish')}
                >
                  {note.isPublic ? 'Aggiorna bacheca' : 'Pubblica'}
                </button>
                {note.isPublic && (
                  <button
                    disabled={busy}
                    onClick={() => void action(note, 'unpublish')}
                  >
                    Ritira
                  </button>
                )}
                <button
                  disabled={busy}
                  className="danger"
                  onClick={() => void action(note, 'delete')}
                >
                  Elimina
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Pager
        offset={offset}
        next={resource.data?.nextOffset ?? null}
        onChange={setOffset}
      />
    </section>
  );
}
