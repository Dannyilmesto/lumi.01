'use client';

import { useState, type FormEvent } from 'react';
import {
  errorMessage,
  profileFetch,
  useProfileResource,
} from './profile-client';

type Field = { id: string; label: string; value: string };

export function ProfileFields() {
  const resource = useProfileResource<{ items: Field[] }>(
    '/api/profile/fields',
  );
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await profileFetch('/api/profile/fields', {
        method: 'POST',
        body: JSON.stringify({ label, value }),
      });
      setLabel('');
      setValue('');
      await resource.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Eliminare questo campo dal profilo?')) return;
    setBusy(true);
    setError('');
    try {
      await profileFetch('/api/profile/fields', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
      await resource.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-custom-fields">
      <h2>Campi personalizzati</h2>
      {resource.error && <p role="alert">{resource.error}</p>}
      {error && <p role="alert">{error}</p>}
      <dl>
        {resource.data?.items.map((field) => (
          <div key={field.id}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(field.id)}
            >
              Elimina
            </button>
          </div>
        ))}
      </dl>
      <form onSubmit={(event) => void add(event)}>
        <input
          aria-label="Nome del nuovo campo"
          placeholder="Nome del campo"
          maxLength={80}
          required
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <input
          aria-label="Valore del nuovo campo"
          placeholder="Valore"
          maxLength={2000}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="submit"
          className="profile-button secondary"
          disabled={busy}
        >
          Aggiungi campo
        </button>
      </form>
    </div>
  );
}
