'use client';
import {
  memo,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  ChatEntry,
  DirectMessage,
  PageResult,
  Person,
} from '@/lib/profile-types';
import {
  profileFetch,
  useProfileResource,
  errorMessage,
} from './profile-client';
import { Avatar, EmptyState, Feedback, Pager } from './profile-ui';

function titleOf(chat: ChatEntry, userId: string) {
  return chat.type === 'group'
    ? chat.name || 'Gruppo'
    : chat.members.find((member) => member.user.id !== userId)?.user.name ||
        'Utente non disponibile';
}
function mergeMessages(current: DirectMessage[], incoming: DirectMessage[]) {
  return [
    ...new Map(
      [...current, ...incoming].map((message) => [message.id, message]),
    ).values(),
  ].sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1));
}
const messageTime = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

// Memoizzato: scrivere nel campo di testo non deve rieseguire il rendering di tutta la cronologia.
const MessageBubble = memo(function MessageBubble({
  message,
  mine,
}: {
  message: DirectMessage;
  mine: boolean;
}) {
  const createdAt = new Date(message.createdAt);
  return (
    <article className={`profile-message ${mine ? 'mine' : ''}`}>
      <strong>{message.sender?.name || 'Utente eliminato'}</strong>
      <p>{message.text}</p>
      <time dateTime={message.createdAt}>
        {Number.isNaN(createdAt.getTime())
          ? 'Invalid Date'
          : messageTime.format(createdAt)}
      </time>
    </article>
  );
});

function PeoplePicker({
  selected,
  onChange,
  maximum = 19,
  exclude = [],
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  maximum?: number;
  exclude?: string[];
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const resource = useProfileResource<PageResult<Person>>(
    `/api/people?offset=${offset}&q=${encodeURIComponent(search)}`,
  );
  const chosen = useProfileResource<PageResult<Person>>(
    `/api/people?${selected.length ? selected.map((id) => `id=${encodeURIComponent(id)}`).join('&') : 'id=__none__'}`,
  );
  return (
    <div className="profile-people-picker">
      {selected.length > 0 && (
        <p className="profile-muted">
          Destinatari:{' '}
          {chosen.data?.items.map((person) => person.name).join(', ') ||
            'Caricamento nomi…'}
        </p>
      )}
      <div className="profile-search">
        <input
          aria-label="Cerca utenti per nome"
          placeholder="Cerca un utente per nome…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              setOffset(0);
              setSearch(query);
            }
          }}
        />
        <button
          type="button"
          onClick={() => {
            setOffset(0);
            setSearch(query);
          }}
        >
          Cerca
        </button>
      </div>
      <Feedback error={resource.error} />
      <p className="profile-muted">
        {selected.length} selezionati ·{' '}
        <button type="button" onClick={() => onChange([])}>
          Azzera selezione
        </button>
      </p>
      <div className="profile-people">
        {resource.data?.items
          .filter((person) => !exclude.includes(person.id))
          .map((person) => (
            <label key={person.id}>
              <input
                type="checkbox"
                checked={selected.includes(person.id)}
                disabled={
                  !selected.includes(person.id) && selected.length >= maximum
                }
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, person.id]
                      : selected.filter((id) => id !== person.id),
                  )
                }
              />
              <Avatar person={person} size={34} />
              <span>{person.name}</span>
            </label>
          ))}
        {resource.loading ? (
          <p>Caricamento utenti…</p>
        ) : (
          resource.data?.items.length === 0 && <p>Nessun utente trovato.</p>
        )}
      </div>
      <div className="profile-pager">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          ← Precedenti
        </button>
        <button
          type="button"
          disabled={resource.data?.nextOffset == null}
          onClick={() => setOffset(resource.data?.nextOffset ?? offset)}
        >
          Successivi →
        </button>
      </div>
    </div>
  );
}

export function ChatList({
  userId,
  active,
  recipient,
}: {
  userId: string;
  active: boolean;
  recipient: string | null;
}) {
  const [offset, setOffset] = useState(0);
  const chats = useProfileResource<PageResult<ChatEntry>>(
    `/api/chats?offset=${offset}`,
    active ? 8000 : 0,
  );
  const [roomId, setRoomId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<'direct' | 'group'>('direct');
  const [members, setMembers] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chatSearch, setChatSearch] = useState('');
  const [chatFilter, setChatFilter] = useState<'all' | 'direct' | 'group'>('all');
  const [minimized, setMinimized] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState({ x: 0, y: 0 });
  const [launcherReady, setLauncherReady] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const draggedRef = useRef(false);

  useEffect(() => {
    const defaultPosition = {
      x: Math.max(16, Math.min(280, window.innerWidth - 74)),
      y: Math.max(16, window.innerHeight - 90),
    };
    try {
      const saved = window.localStorage.getItem('lumi-messages-launcher');
      if (saved) {
        const parsed = JSON.parse(saved) as { x?: unknown; y?: unknown };
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          defaultPosition.x = Math.min(
            Math.max(8, parsed.x),
            Math.max(8, window.innerWidth - 68),
          );
          defaultPosition.y = Math.min(
            Math.max(8, parsed.y),
            Math.max(8, window.innerHeight - 68),
          );
        }
      }
    } catch {
      // Ignore unavailable or invalid local launcher preferences.
    }
    setLauncherPosition(defaultPosition);
    setLauncherReady(true);
  }, []);

  useEffect(() => {
    function keepLauncherVisible() {
      // Se la posizione non cambia si restituisce lo stesso oggetto: nessun nuovo rendering a ogni resize.
      setLauncherPosition((position) => {
        const x = Math.min(Math.max(8, position.x), Math.max(8, window.innerWidth - 68));
        const y = Math.min(Math.max(8, position.y), Math.max(8, window.innerHeight - 68));
        return x === position.x && y === position.y ? position : { x, y };
      });
    }
    window.addEventListener('resize', keepLauncherVisible);
    return () => window.removeEventListener('resize', keepLauncherVisible);
  }, []);

  useEffect(() => {
    if (recipient) {
      setMembers([recipient]);
      setType('direct');
      setCreating(true);
    }
  }, [recipient]);

  function moveLauncher(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 5) draggedRef.current = true;
    setLauncherPosition({
      x: Math.min(
        Math.max(8, drag.originX + deltaX),
        Math.max(8, window.innerWidth - 68),
      ),
      y: Math.min(
        Math.max(8, drag.originY + deltaY),
        Math.max(8, window.innerHeight - 68),
      ),
    });
  }

  function finishLauncherDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const position = {
      x: Math.min(
        Math.max(8, drag.originX + event.clientX - drag.startX),
        Math.max(8, window.innerWidth - 68),
      ),
      y: Math.min(
        Math.max(8, drag.originY + event.clientY - drag.startY),
        Math.max(8, window.innerHeight - 68),
      ),
    };
    setLauncherPosition(position);
    dragRef.current = null;
    try {
      window.localStorage.setItem(
        'lumi-messages-launcher',
        JSON.stringify(position),
      );
    } catch {
      // The icon remains draggable for this session if storage is unavailable.
    }
  }

  const selectedChat = chats.data?.items.find((chat) => chat.id === roomId);
  if (minimized) {
    return active && launcherReady && typeof document !== 'undefined'
      ? createPortal(
      <button
        type="button"
        className="profile-messages-launcher"
        aria-label="Ripristina la sezione Messaggi"
        title="Messaggi · trascina per spostare, clicca per riaprire"
        style={{ left: launcherPosition.x, top: launcherPosition.y }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: launcherPosition.x,
            originY: launcherPosition.y,
          };
        }}
        onPointerMove={moveLauncher}
        onPointerUp={finishLauncherDrag}
        onPointerCancel={finishLauncherDrag}
        onClick={(event) => {
          if (draggedRef.current) {
            event.preventDefault();
            draggedRef.current = false;
            return;
          }
          setMinimized(false);
        }}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
            return;
          event.preventDefault();
          const directions: Record<string, [number, number]> = {
            ArrowUp: [0, -12],
            ArrowDown: [0, 12],
            ArrowLeft: [-12, 0],
            ArrowRight: [12, 0],
          };
          const [x, y] = directions[event.key];
          setLauncherPosition((position) => ({
            x: Math.min(Math.max(8, position.x + x), window.innerWidth - 68),
            y: Math.min(Math.max(8, position.y + y), window.innerHeight - 68),
          }));
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.7-.9L4 19l1.1-3.7a8 8 0 0 1-.9-3.8A7.5 7.5 0 1 1 20 11.5Z" />
          <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" />
        </svg>
        <span>{selectedChat ? titleOf(selectedChat, userId).slice(0, 1).toUpperCase() : ''}</span>
      </button>,
      document.body,
    )
      : null;
  }

  const visibleChats = (chats.data?.items ?? []).filter((chat) => {
    const matchesType = chatFilter === 'all' || chat.type === chatFilter;
    const query = chatSearch.trim().toLocaleLowerCase('it');
    const matchesSearch =
      !query ||
      `${titleOf(chat, userId)} ${chat.preview}`
        .toLocaleLowerCase('it')
        .includes(query);
    return matchesType && matchesSearch;
  });

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const chat = await profileFetch<{ id: string }>('/api/chats', {
        method: 'POST',
        body: JSON.stringify({
          type,
          memberIds: members,
          ...(type === 'group' ? { name } : {}),
        }),
      });
      setRoomId(chat.id);
      setCreating(false);
      setMembers([]);
      setName('');
      setOffset(0);
      await chats.reload();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-panel profile-messages-panel">
      <div className="profile-section-heading profile-messages-heading">
        <div>
          <span className="profile-messages-eyebrow">COLLABORAZIONE</span>
          <h2>Messaggi</h2>
          <p>
            Conversazioni personali e gruppi di lavoro, con cronologia condivisa
            tra i partecipanti.
          </p>
        </div>
        <div className="profile-messages-heading-actions">
          <button
            type="button"
            className="profile-messages-minimize"
            aria-label="Riduci Messaggi a icona"
            title="Riduci a icona"
            onClick={() => setMinimized(true)}
          >
            <span aria-hidden="true">—</span>
          </button>
          <button
            className="profile-button"
            onClick={() => setCreating(!creating)}
          >
            {creating ? 'Chiudi' : '＋ Nuova chat'}
          </button>
        </div>
      </div>
      <Feedback error={error || chats.error} />
      {creating && (
        <form className="profile-form" onSubmit={create}>
          <div className="profile-form-row">
            <label>
              Tipo di conversazione
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value as 'direct' | 'group');
                  setMembers([]);
                }}
              >
                <option value="direct">Chat privata 1 a 1</option>
                <option value="group">Gruppo</option>
              </select>
            </label>
            {type === 'group' && (
              <label>
                Nome del gruppo
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
          </div>
          <PeoplePicker
            selected={members}
            onChange={setMembers}
            maximum={type === 'direct' ? 1 : 19}
          />
          <button className="profile-button" disabled={busy || !members.length}>
            {busy
              ? 'Apertura…'
              : type === 'direct'
                ? 'Apri conversazione'
                : 'Crea gruppo'}
          </button>
        </form>
      )}
      <div className="profile-chat-layout">
        <aside className="profile-chat-sidebar" aria-label="Conversazioni">
          <div className="profile-chat-sidebar-heading">
            <div>
              <strong>Conversazioni</strong>
              <span>{chats.data?.items.length ?? 0} recenti</span>
            </div>
            <span className="profile-chat-online-dot" title="Aggiornamento in tempo reale" />
          </div>
          <label className="profile-chat-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label="Cerca conversazioni"
              placeholder="Cerca chat…"
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
            />
          </label>
          <div className="profile-chat-filters" aria-label="Filtra conversazioni">
            {([
              ['all', 'Tutte'],
              ['direct', 'Dirette'],
              ['group', 'Gruppi'],
            ] as const).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={chatFilter === value}
                onClick={() => setChatFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {visibleChats.map((chat) => (
            <button
              key={chat.id}
              className={`profile-chat-item ${roomId === chat.id ? 'selected' : ''}`}
              onClick={() => setRoomId(chat.id)}
            >
              <span className="profile-chat-symbol">
                {chat.type === 'group' ? '◎' : '◉'}
              </span>
              <span>
                <strong>{titleOf(chat, userId)}</strong>
                <small>{chat.preview || 'Nessun messaggio'}</small>
              </span>
            </button>
          ))}
          {!chats.loading && !visibleChats.length && (
            <EmptyState>
              {chatSearch || chatFilter !== 'all'
                ? 'Nessuna conversazione corrisponde al filtro.'
                : 'Nessuna conversazione. Seleziona un utente per iniziare.'}
            </EmptyState>
          )}
          <Pager
            offset={offset}
            next={chats.data?.nextOffset ?? null}
            onChange={setOffset}
          />
        </aside>
        {roomId ? (
          <ChatRoom
            key={roomId}
            id={roomId}
            userId={userId}
            active={active}
            onMinimize={() => setMinimized(true)}
            onChanged={() => void chats.reload()}
            onLeave={() => {
              setRoomId(null);
              void chats.reload();
            }}
          />
        ) : (
          <div className="profile-chat-placeholder">
            <span>✦</span>
            <h3>Uno spazio per parlarne</h3>
            <p>
              Apri una chat o crea un gruppo con le persone della piattaforma.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function ChatRoom({
  id,
  userId,
  active,
  onMinimize,
  onChanged,
  onLeave,
}: {
  id: string;
  userId: string;
  active: boolean;
  onMinimize: () => void;
  onChanged: () => void;
  onLeave: () => void;
}) {
  const room = useProfileResource<ChatEntry>(
    `/api/chats/${encodeURIComponent(id)}`,
    active ? 10000 : 0,
  );
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Connessione…');
  const [manage, setManage] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [older, setOlder] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const retry = useRef<{ text: string; clientId: string } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const alive = useRef(true);
  const lastReceived = useRef<string | null>(null);
  const [reconnect, setReconnect] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setConnection('Connessione…');
    async function connect() {
      try {
        const history = await profileFetch<{
          items: DirectMessage[];
          hasMore: boolean;
        }>(`/api/chats/${id}/messages`);
        if (cancelled) return;
        setMessages((current) => mergeMessages(current, history.items));
        setHasMore(history.hasMore);
        setLoading(false);
        setRevoked(false);
        const after =
          lastReceived.current ?? history.items.at(-1)?.sequence ?? '0';
        lastReceived.current = after;
        stream = new EventSource(`/api/chats/${id}/stream?after=${after}`);
        stream.onopen = () => setConnection('Connesso');
        stream.onerror = () => setConnection('Riconnessione in corso…');
        stream.addEventListener('retrying', () =>
          setConnection('Riconnessione in corso…'),
        );
        stream.addEventListener('revoked', () => {
          stream?.close();
          setMessages([]);
          setRevoked(true);
          setConnection('Accesso terminato');
          setError(
            'La sessione è scaduta o non fai più parte della conversazione.',
          );
        });
        stream.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as DirectMessage;
            if (!cancelled && message.chatId === id) {
              lastReceived.current = message.sequence;
              setMessages((current) => mergeMessages(current, [message]));
            }
          } catch {
            setConnection('Sincronizzazione in corso…');
          }
        };
      } catch (error) {
        if (!cancelled) {
          setError(errorMessage(error));
          setConnection('Non connesso');
          setLoading(false);
          retryTimer = setTimeout(() => {
            if (!cancelled) void connect();
          }, 5000);
        }
      }
    }
    void connect();
    return () => {
      cancelled = true;
      stream?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [id, active, reconnect]);
  useEffect(() => {
    if (nearBottom.current)
      viewport.current?.scrollTo({
        top: viewport.current.scrollHeight,
        behavior: 'auto',
      });
  }, [messages]);
  async function send(event: FormEvent) {
    event.preventDefault();
    const outgoing = text.trim();
    if (!outgoing || busy) return;
    setBusy(true);
    setError('');
    if (retry.current?.text !== outgoing)
      retry.current = { text: outgoing, clientId: crypto.randomUUID() };
    const payload = retry.current;
    try {
      const message = await profileFetch<DirectMessage>(
        `/api/chats/${id}/messages`,
        { method: 'POST', body: JSON.stringify(payload) },
      );
      if (!alive.current) return;
      setMessages((current) => mergeMessages(current, [message]));
      setText((current) => (current.trim() === outgoing ? '' : current));
      retry.current = null;
      nearBottom.current = true;
      onChanged();
    } catch (error) {
      if (alive.current)
        setError(
          `${errorMessage(error)} Puoi riprovare a inviare lo stesso testo senza duplicarlo.`,
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function loadOlder() {
    if (!messages.length) return;
    setOlder(true);
    const height = viewport.current?.scrollHeight || 0;
    try {
      const page = await profileFetch<{
        items: DirectMessage[];
        hasMore: boolean;
      }>(`/api/chats/${id}/messages?before=${messages[0].sequence}`);
      if (!alive.current) return;
      nearBottom.current = false;
      setMessages((current) => mergeMessages(current, page.items));
      setHasMore(page.hasMore);
      requestAnimationFrame(() => {
        if (viewport.current)
          viewport.current.scrollTop += viewport.current.scrollHeight - height;
      });
    } catch (error) {
      if (alive.current) setError(errorMessage(error));
    } finally {
      if (alive.current) setOlder(false);
    }
  }
  async function manageGroup(
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    if (
      action === 'leave' &&
      !window.confirm(
        'Uscire dal gruppo? Per rientrare dovrai essere aggiunto dal responsabile.',
      )
    )
      return;
    if (
      action === 'remove' &&
      !window.confirm('Rimuovere questo partecipante dal gruppo?')
    )
      return;
    if (
      action === 'add' &&
      !window.confirm(
        'Aggiungere i partecipanti selezionati? Potranno leggere tutta la cronologia del gruppo.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await profileFetch(`/api/chats/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...extra }),
      });
      if (action === 'leave') {
        onLeave();
        return;
      }
      setAdded([]);
      await room.reload();
      onChanged();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const owner = room.data?.createdById === userId;
  return (
    <div className="profile-chat-room">
      <header>
        <div>
          <div className="profile-chat-room-title">
            <span className="profile-chat-symbol">
              {room.data?.type === 'group' ? '◎' : '◉'}
            </span>
            <div>
              <h3>{room.data ? titleOf(room.data, userId) : 'Conversazione'}</h3>
          <small role="status">
            {connection}
            {room.data?.type === 'group'
              ? ` · ${room.data.members.length} partecipanti`
              : ''}
          </small>
            </div>
          </div>
          <button
            type="button"
            className="profile-messages-minimize"
            aria-label="Riduci Messaggi a icona"
            title="Riduci a icona"
            onClick={onMinimize}
          >
            <span aria-hidden="true">—</span>
          </button>
        </div>
        {room.data?.type === 'group' && (
          <button
            disabled={revoked}
            onClick={() => {
              setManage(!manage);
              setGroupName(room.data?.name || '');
            }}
          >
            Partecipanti
          </button>
        )}
      </header>
      <Feedback error={error || room.error} />
      {connection !== 'Connesso' && (
        <button
          className="profile-load-older"
          onClick={() => {
            setError('');
            setReconnect((value) => value + 1);
          }}
        >
          Riconnetti
        </button>
      )}
      {manage && room.data && (
        <div className="profile-group-settings">
          {owner && (
            <div className="profile-inline">
              <input
                aria-label="Nome del gruppo"
                maxLength={80}
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
              />
              <button
                disabled={busy || !groupName.trim()}
                onClick={() => void manageGroup('rename', { name: groupName })}
              >
                Rinomina
              </button>
            </div>
          )}
          <ul>
            {room.data.members.map(({ user }) => (
              <li key={user.id}>
                <Avatar person={user} size={28} />
                <span>
                  {user.name}
                  {user.id === room.data?.createdById ? ' · Responsabile' : ''}
                </span>
                {owner && user.id !== userId && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void manageGroup('remove', { userId: user.id })
                    }
                  >
                    Rimuovi
                  </button>
                )}
              </li>
            ))}
          </ul>
          {owner && room.data.members.length < 20 && (
            <>
              <PeoplePicker
                selected={added}
                onChange={setAdded}
                exclude={room.data.members.map((member) => member.user.id)}
                maximum={20 - room.data.members.length}
              />
              <button
                disabled={busy || !added.length}
                onClick={() => void manageGroup('add', { memberIds: added })}
              >
                Aggiungi al gruppo
              </button>
            </>
          )}
          <button
            className="danger"
            disabled={busy}
            onClick={() => void manageGroup('leave')}
          >
            Esci dal gruppo
          </button>
        </div>
      )}
      <div
        className="profile-messages"
        ref={viewport}
        role="log"
        aria-label="Messaggi della conversazione"
        onScroll={() => {
          const element = viewport.current;
          if (element)
            nearBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              100;
        }}
      >
        {hasMore && (
          <button
            disabled={older}
            className="profile-load-older"
            onClick={() => void loadOlder()}
          >
            {older ? 'Caricamento…' : 'Carica messaggi precedenti'}
          </button>
        )}
        {loading ? (
          <EmptyState>Caricamento conversazione…</EmptyState>
        ) : !messages.length ? (
          <EmptyState>
            Nessun messaggio. Scrivi per iniziare la conversazione.
          </EmptyState>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              mine={message.senderId === userId}
            />
          ))
        )}
      </div>
      <form className="profile-message-compose" onSubmit={send}>
        <textarea
          aria-label="Messaggio"
          placeholder="Scrivi un messaggio…"
          maxLength={5000}
          rows={2}
          value={text}
          disabled={revoked}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          className="profile-button"
          disabled={busy || revoked || !text.trim()}
        >
          {busy ? 'Invio…' : 'Invia ↑'}
        </button>
      </form>
    </div>
  );
}
