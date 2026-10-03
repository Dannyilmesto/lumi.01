'use client';
import { useState, type FormEvent } from 'react';
import type { CalendarEntry, CalendarMember } from '@/lib/profile-types';
import {
  errorMessage,
  profileFetch,
  useProfileResource,
} from './profile-client';
import { EmptyState, Feedback } from './profile-ui';

type CalendarDraft = Pick<
  CalendarEntry,
  'title' | 'date' | 'time' | 'kind' | 'description' | 'completed' | 'assignedUserId'
>;

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const fresh = (date: string, assignedUserId: string): CalendarDraft => ({
  title: '',
  date,
  time: null,
  kind: 'event',
  description: '',
  completed: false,
  assignedUserId,
});
export function CalendarView() {
  const [month, setMonth] = useState(() => localDay(new Date()).slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [entry, setEntry] = useState<
    CalendarEntry | CalendarDraft | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const resource = useProfileResource<{
    items: CalendarEntry[];
    members: CalendarMember[];
    currentUserId: string;
    shared: boolean;
    limited: boolean;
  }>(`/api/profile/calendar?month=${month}`);
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const leading = (start.getDay() + 6) % 7;
  const days = new Date(year, monthNumber, 0).getDate();
  const today = localDay(new Date());
  const events = resource.data?.items || [];
  const dayEvents = selected
    ? events.filter((event) => event.date === selected)
    : [];
  function editEntry(value: CalendarEntry | CalendarDraft | null) {
    if (
      entry &&
      !window.confirm('Chiudere le modifiche non salvate dell’evento aperto?')
    )
      return;
    setEntry(value);
  }
  function changeMonth(delta: number) {
    const date = new Date(year, monthNumber - 1 + delta, 1);
    setMonth(localDay(date).slice(0, 7));
    setSelected(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!entry) return;
    setBusy(true);
    resource.setError('');
    try {
      await profileFetch('/api/profile/calendar', {
        method: 'id' in entry ? 'PATCH' : 'POST',
        body: JSON.stringify(entry),
      });
      setMonth(entry.date.slice(0, 7));
      setSelected(entry.date);
      setEntry(null);
      setNotice('Appuntamento salvato nel calendario.');
      await resource.reload();
    } catch (error) {
      resource.setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove(event: CalendarEntry) {
    if (!window.confirm(`Eliminare “${event.title}” dal calendario?`)) return;
    setBusy(true);
    try {
      await profileFetch('/api/profile/calendar', {
        method: 'DELETE',
        body: JSON.stringify({ id: event.id }),
      });
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
          <h2>
            {resource.data?.shared ? 'Calendario aziendale' : 'Calendario personale'}
          </h2>
          <p>
            {resource.data?.shared
              ? 'Appuntamenti condivisi con il tuo team, assegnati a una persona.'
              : 'Eventi, scadenze e appunti del tuo calendario.'}
          </p>
        </div>
        <button
          className="profile-button"
          disabled={busy || resource.loading || !resource.data?.currentUserId}
          onClick={() =>
            editEntry(
              fresh(
                selected ?? today,
                resource.data?.currentUserId ?? '',
              ),
            )
          }
        >
          + Aggiungi
        </button>
      </div>
      <Feedback error={resource.error} notice={notice} />
      <div className="profile-calendar-layout">
        <div>
          <div className="profile-calendar-heading">
            <button
              aria-label="Mese precedente"
              onClick={() => changeMonth(-1)}
            >
              ←
            </button>
            <h3>
              {start.toLocaleDateString('it-IT', {
                month: 'long',
                year: 'numeric',
              })}
            </h3>
            <button aria-label="Mese successivo" onClick={() => changeMonth(1)}>
              →
            </button>
          </div>
          <div className="profile-calendar-grid">
            {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((day) => (
              <span className="weekday" key={day}>
                {day}
              </span>
            ))}
            {Array.from({ length: leading }, (_, index) => (
              <span key={`empty${index}`} />
            ))}
            {Array.from({ length: days }, (_, index) => {
              const day = `${month}-${String(index + 1).padStart(2, '0')}`;
              const dayEvents = events.filter((event) => event.date === day);
              const count = dayEvents.length;
              const eventColors = [
                ...new Set(dayEvents.map((event) => event.assignedUser.color)),
              ];
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={`${day}, ${count} appuntamenti; seleziona per visualizzarli`}
                  aria-pressed={selected === day}
                  className={`${selected === day ? 'selected' : ''} ${today === day ? 'today' : ''}`}
                  onClick={() => setSelected(day)}
                >
                  <span>{index + 1}</span>
                  {eventColors.length > 0 && (
                    <span className="profile-calendar-dots" aria-hidden="true">
                      {eventColors.slice(0, 4).map((color) => (
                        <i key={color} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="profile-calendar-members" aria-label="Utenti del calendario">
            {resource.data?.members.map((member) => (
              <span key={member.id}>
                <i style={{ backgroundColor: member.color }} />
                {member.name}
              </span>
            ))}
          </div>
        </div>
        {selected && (
          <div className="profile-day-agenda" aria-live="polite">
            <h3>
              {new Date(`${selected}T12:00:00`).toLocaleDateString('it-IT', {
                day: 'numeric',
                month: 'long',
              })}
            </h3>
            {resource.loading ? (
              <EmptyState>Caricamento…</EmptyState>
            ) : !dayEvents.length ? (
              <EmptyState>Nessun appuntamento per questo giorno.</EmptyState>
            ) : (
              dayEvents.map((event) => (
                <article
                  className={`profile-event ${event.completed ? 'completed' : ''}`}
                  key={event.id}
                  style={{ borderLeftColor: event.assignedUser.color }}
                >
                  <span className="profile-badge">
                    {event.kind === 'deadline'
                      ? 'Scadenza'
                      : event.kind === 'note'
                        ? 'Appunto'
                        : 'Evento'}{' '}
                    · {event.time || 'Tutto il giorno'}
                  </span>
                  <span className="profile-calendar-assignee">
                    <i style={{ backgroundColor: event.assignedUser.color }} />
                    {event.assignedUser.name}
                  </span>
                  <h4>{event.title}</h4>
                  {event.description && <p>{event.description}</p>}
                  {event.canManage && (
                    <div className="profile-card-actions">
                      <button disabled={busy} onClick={() => editEntry(event)}>
                        Modifica
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => void remove(event)}
                      >
                        Elimina
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        )}
      </div>
      {resource.data?.limited && (
        <p className="profile-muted">
          Visualizzati i primi 1.000 eventi del mese.
        </p>
      )}
      {entry && (
        <form className="profile-form" onSubmit={save}>
          <h3>{'id' in entry ? 'Modifica evento' : 'Nuovo evento'}</h3>
          <label>
            Titolo
            <input
              required
              maxLength={160}
              value={entry.title}
              onChange={(event) =>
                setEntry({ ...entry, title: event.target.value })
              }
            />
          </label>
          <label>
            Assegna a
            <select
              required
              value={entry.assignedUserId}
              onChange={(event) =>
                setEntry({ ...entry, assignedUserId: event.target.value })
              }
            >
              {resource.data?.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <div className="profile-form-row">
            <label>
              Data
              <input
                required
                type="date"
                value={entry.date}
                onChange={(event) =>
                  setEntry({ ...entry, date: event.target.value })
                }
              />
            </label>
            <label>
              Ora (facoltativa)
              <input
                type="time"
                value={entry.time || ''}
                onChange={(event) =>
                  setEntry({ ...entry, time: event.target.value || null })
                }
              />
            </label>
            <label>
              Tipo
              <select
                value={entry.kind}
                onChange={(event) =>
                  setEntry({
                    ...entry,
                    kind: event.target.value as CalendarEntry['kind'],
                  })
                }
              >
                <option value="event">Evento</option>
                <option value="deadline">Scadenza</option>
                <option value="note">Appunto</option>
              </select>
            </label>
          </div>
          <label>
            Descrizione
            <textarea
              maxLength={5000}
              rows={3}
              value={entry.description}
              onChange={(event) =>
                setEntry({ ...entry, description: event.target.value })
              }
            />
          </label>
          <label className="profile-check">
            <input
              type="checkbox"
              checked={entry.completed}
              onChange={(event) =>
                setEntry({ ...entry, completed: event.target.checked })
              }
            />
            Completato
          </label>
          <div className="profile-inline">
            <button disabled={busy} className="profile-button">
              Salva evento
            </button>
            <button
              type="button"
              className="profile-button secondary"
              disabled={busy}
              onClick={() => editEntry(null)}
            >
              Annulla
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
