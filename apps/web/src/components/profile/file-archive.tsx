'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Entry = { name: string; directory: boolean; size: number };
type LocalHandle = {
  name: string;
  kind: 'file' | 'directory';
  getFile?: () => Promise<File>;
  values?: () => AsyncIterable<LocalHandle>;
};
type Queued = { name: string; handle?: LocalHandle; files?: File[] };

function join(...parts: string[]) {
  return parts.filter(Boolean).join('/');
}

export function FileArchive() {
  const [folder, setFolder] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [queued, setQueued] = useState<Queued[]>([]);
  const [busy, setBusy] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const fallback = useRef<HTMLInputElement>(null);

  const load = useCallback(async (relative: string) => {
    try {
      const response = await fetch(
        `/api/profile/archive?path=${encodeURIComponent(relative)}`,
        { cache: 'no-store' },
      );
      const data = (await response.json()) as {
        entries?: Entry[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || 'Archivio non disponibile.');
      setEntries(data.entries || []);
      setFolder(relative);
      setError('');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Archivio non disponibile.',
      );
    }
  }, []);

  useEffect(() => {
    fallback.current?.setAttribute('webkitdirectory', '');
    void load('');
  }, [load]);

  async function selectFolder() {
    const picker = (
      window as Window & { showDirectoryPicker?: () => Promise<LocalHandle> }
    ).showDirectoryPicker;
    if (!picker) {
      fallback.current?.click();
      return;
    }
    try {
      const handle = await picker.call(window);
      setQueued((items) => [...items, { name: handle.name, handle }]);
      setStatus(
        `${handle.name} aggiunta alla coda. Puoi aggiungere altre cartelle.`,
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError')
        return;
      setError(
        caught instanceof Error ? caught.message : 'Selezione non riuscita.',
      );
    }
  }

  async function createDirectory(relative: string) {
    const response = await fetch('/api/profile/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relative }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(data?.error || `Impossibile creare ${relative}.`);
    }
  }

  async function createFolder() {
    const name = newFolder.trim();
    if (!name) return;
    if (name.includes('/') || name.includes('\\')) {
      setError('Il nome della cartella non può contenere / o \\.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createDirectory(join(folder, name));
      setNewFolder('');
      setStatus(`Cartella ${name} creata.`);
      await load(folder);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Creazione non riuscita.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: Entry) {
    const message = entry.directory
      ? `Eliminare la cartella “${entry.name}” e tutto il suo contenuto?`
      : `Eliminare il file “${entry.name}”?`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/profile/archive', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: join(folder, entry.name) }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || 'Eliminazione non riuscita.');
      }
      setStatus(entry.directory ? 'Cartella eliminata.' : 'File eliminato.');
      await load(folder);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Eliminazione non riuscita.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function upload(relative: string, file: File) {
    const response = await fetch(
      `/api/profile/archive?path=${encodeURIComponent(relative)}`,
      {
        method: 'PUT',
        body: file,
      },
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(
        `${relative}: ${data?.error || 'caricamento non riuscito'}`,
      );
    }
    setStatus(`Importato ${relative}`);
  }

  async function importHandle(handle: LocalHandle, prefix: string) {
    const relative = join(prefix, handle.name);
    if (handle.kind === 'file') {
      if (!handle.getFile) throw new Error('File non disponibile.');
      await upload(relative, await handle.getFile());
    } else {
      await createDirectory(relative);
      if (!handle.values) throw new Error('La cartella non può essere letta.');
      for await (const child of handle.values())
        await importHandle(child, relative);
    }
  }

  async function importQueued() {
    if (!queued.length) return;
    setBusy(true);
    setError('');
    try {
      for (const item of queued) {
        if (item.handle) await importHandle(item.handle, folder);
        else
          for (const file of item.files || []) {
            const relative =
              file.webkitRelativePath || join(item.name, file.name);
            await upload(join(folder, relative), file);
          }
        setQueued((current) => current.slice(1));
      }
      setStatus('Importazione completata.');
      await load(folder);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Importazione interrotta.',
      );
      await load(folder);
    } finally {
      setBusy(false);
    }
  }

  const breadcrumbs = folder ? folder.split('/') : [];
  return (
    <section className="profile-panel profile-file-archive">
      <div className="profile-section-heading">
        <div>
          <h2>Archivio file e cartelle</h2>
          <p>
            Importa cartelle complete e conserva nomi, struttura e qualsiasi
            formato di file.
          </p>
        </div>
      </div>
      <div className="profile-inline">
        <button
          type="button"
          className="profile-button"
          disabled={busy}
          onClick={() => void selectFolder()}
        >
          Aggiungi cartella
        </button>
        <button
          type="button"
          className="profile-button secondary"
          disabled={busy || !queued.length}
          onClick={() => void importQueued()}
        >
          Importa {queued.length || ''} cartelle
        </button>
      </div>
      <form
        className="profile-archive-create"
        onSubmit={(event) => {
          event.preventDefault();
          void createFolder();
        }}
      >
        <input
          aria-label="Nome nuova cartella"
          placeholder="Nome nuova cartella"
          value={newFolder}
          maxLength={180}
          disabled={busy}
          onChange={(event) => setNewFolder(event.target.value)}
        />
        <button
          type="submit"
          className="profile-button secondary"
          disabled={busy || !newFolder.trim()}
        >
          Crea cartella
        </button>
      </form>
      <input
        ref={fallback}
        type="file"
        multiple
        className="sr-only"
        aria-label="Seleziona una cartella da importare"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length)
            setQueued((current) => [
              ...current,
              {
                name: files[0].webkitRelativePath.split('/')[0] || 'Cartella',
                files,
              },
            ]);
          event.target.value = '';
        }}
      />
      {queued.length > 0 && (
        <p className="profile-muted">
          In coda: {queued.map((item) => item.name).join(', ')}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="profile-error">
          {error}
        </p>
      )}
      <nav
        className="profile-archive-breadcrumbs"
        aria-label="Percorso archivio"
      >
        <button type="button" onClick={() => void load('')}>
          Archivio
        </button>
        {breadcrumbs.map((name, index) => (
          <button
            type="button"
            key={index}
            onClick={() => void load(breadcrumbs.slice(0, index + 1).join('/'))}
          >
            / {name}
          </button>
        ))}
      </nav>
      <ul className="profile-archive-list">
        {entries.map((entry) => (
          <li key={entry.name}>
            <div className="profile-archive-entry">
              {entry.directory ? (
                <button
                  type="button"
                  onClick={() => void load(join(folder, entry.name))}
                >
                  📁 {entry.name}
                </button>
              ) : (
                <a
                  href={`/api/profile/archive?path=${encodeURIComponent(join(folder, entry.name))}&download=1`}
                >
                  📄 {entry.name}
                </a>
              )}
              {!entry.directory && (
                <small>
                  {new Intl.NumberFormat('it-IT').format(entry.size)} byte
                </small>
              )}
            </div>
            <button
              type="button"
              className="profile-archive-delete"
              disabled={busy}
              aria-label={`Elimina ${entry.directory ? 'cartella' : 'file'} ${entry.name}`}
              onClick={() => void remove(entry)}
            >
              Elimina
            </button>
          </li>
        ))}
      </ul>
      {!entries.length && <p className="profile-muted">La cartella è vuota.</p>}
    </section>
  );
}
