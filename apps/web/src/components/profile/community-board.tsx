'use client';
import { useState } from 'react';
import type { PageResult, PublicPost, SharedQuote } from '@/lib/profile-types';
import { Avatar, EmptyState, Feedback, Pager } from './profile-ui';
import {
  profileFetch,
  useProfileResource,
  errorMessage,
} from './profile-client';
import { QuoteLines } from './quote-vault';
export function CommunityBoard({
  userId,
  onContact,
  active,
}: {
  userId: string;
  onContact: (id: string) => void;
  active: boolean;
}) {
  const [kind, setKind] = useState<'notes' | 'quotes'>('notes');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const resource = useProfileResource<PageResult<PublicPost | SharedQuote>>(
    `/api/community?kind=${kind}&offset=${offset}`,
    active ? 10000 : 0,
  );
  async function withdraw(id: string) {
    if (!window.confirm('Ritirare questa pubblicazione dalla bacheca?')) return;
    setBusy(true);
    try {
      await profileFetch('/api/community', {
        method: 'DELETE',
        body: JSON.stringify({ id, kind }),
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
          <h2>La bacheca della community</h2>
          <p>
            Note e preventivi condivisi volontariamente dagli utenti della
            piattaforma.
          </p>
        </div>
        <button
          className="profile-button secondary"
          onClick={() => void resource.reload()}
        >
          Aggiorna
        </button>
      </div>
      <div className="profile-subtabs profile-inline">
        <button
          aria-pressed={kind === 'notes'}
          onClick={() => {
            setKind('notes');
            setOffset(0);
          }}
        >
          Note pubbliche
        </button>
        <button
          aria-pressed={kind === 'quotes'}
          onClick={() => {
            setKind('quotes');
            setOffset(0);
          }}
        >
          Preventivi pubblici
        </button>
      </div>
      <Feedback error={resource.error} />
      {resource.loading ? (
        <EmptyState>Caricamento bacheca…</EmptyState>
      ) : !resource.data?.items.length ? (
        <EmptyState>
          La bacheca è ancora vuota. Puoi pubblicare una nota o un preventivo
          dal tuo profilo.
        </EmptyState>
      ) : (
        <div className="profile-feed">
          {resource.data.items.map((post) => (
            <article key={post.id} className="profile-post">
              <header>
                <Avatar person={post.author} />
                <div>
                  <strong>{post.author.name}</strong>
                  <time>
                    {new Date(post.createdAt).toLocaleString('it-IT')}
                  </time>
                </div>
                {post.author.id === userId ? (
                  <button
                    disabled={busy}
                    onClick={() => void withdraw(post.id)}
                  >
                    Ritira
                  </button>
                ) : (
                  <button onClick={() => onContact(post.author.id)}>
                    Scrivi all’autore
                  </button>
                )}
              </header>
              <h3>{post.title}</h3>
              {'content' in post ? (
                <p className="profile-post-content">{post.content}</p>
              ) : (
                <QuoteLines quote={post} />
              )}
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
