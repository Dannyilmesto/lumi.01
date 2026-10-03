'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Profile } from '@/lib/profile-types';
import { Avatar, Feedback } from './profile-ui';
import { errorMessage, profileFetch } from './profile-client';
import { ProfileFields } from './profile-fields';

export function ProfileHeader({
  profile,
  onUpdate,
}: {
  profile: Profile;
  onUpdate: (value: Profile) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name);
  const [preset, setPreset] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const file = useRef<HTMLInputElement>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const updated = await profileFetch<Profile>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name, preset }),
      });
      onUpdate(updated);
      setEditing(false);
      setNotice('Profilo aggiornato.');
      setPreset(undefined);
      router.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function upload(photo: File | undefined) {
    if (!photo) return;
    setBusy(true);
    setError('');
    try {
      const data = new FormData();
      data.set('file', photo);
      const updated = await profileFetch<Profile>('/api/profile/avatar', {
        method: 'POST',
        body: data,
      });
      onUpdate(updated);
      setPreset(undefined);
      setNotice('Foto del profilo aggiornata.');
      router.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }
  return (
    <section className="profile-identity">
      <div className="profile-identity-main">
        <Avatar person={profile} size={90} />
        <div>
          <span className="profile-eyebrow">IL TUO SPAZIO PERSONALE</span>
          <h1>{profile.name}</h1>
          <p>{profile.email}</p>
          <small>
            Iscritto dal{' '}
            {new Date(profile.createdAt).toLocaleDateString('it-IT')}
          </small>
        </div>
        <button
          className="profile-button secondary"
          onClick={() => {
            setName(profile.name);
            setPreset(undefined);
            setEditing(!editing);
          }}
          disabled={busy}
        >
          {editing ? 'Chiudi' : 'Modifica profilo'}
        </button>
      </div>
      <Feedback error={error} notice={notice} />
      {editing && (
        <form onSubmit={save} className="profile-identity-form">
          <label>
            Nome visualizzato
            <input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <fieldset disabled={busy}>
            <legend>Scegli un avatar</legend>
            <div className="profile-avatar-presets">
              {['sky', 'mint', 'lilac', 'sun', 'rose', 'ocean'].map(
                (value, index) => (
                  <button
                    type="button"
                    key={value}
                    aria-label={`Avatar ${index + 1}`}
                    aria-pressed={preset === value}
                    onClick={() => setPreset(value)}
                  >
                    <Avatar
                      person={{
                        name: `preset ${index + 1}`,
                        image: `/avatars/${value}.svg`,
                        avatarPreset: value,
                      }}
                      size={52}
                    />
                  </button>
                ),
              )}
            </div>
          </fieldset>
          <div className="profile-inline">
            <button
              type="button"
              className="profile-button secondary"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              Carica una foto
            </button>
            <span className="profile-muted">
              PNG, JPEG o WebP · massimo 5 MB
            </span>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <div>
            <button className="profile-button" disabled={busy}>
              {busy ? 'Salvataggio…' : 'Salva profilo'}
            </button>
          </div>
        </form>
      )}
      <ProfileFields />
    </section>
  );
}
