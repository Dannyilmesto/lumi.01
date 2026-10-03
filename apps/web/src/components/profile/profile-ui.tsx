'use client';
import Image from 'next/image';
import type { ReactNode } from 'react';
import type { Person } from '@/lib/profile-types';
export function Avatar({
  person,
  size = 44,
}: {
  person: Pick<Person, 'name' | 'image' | 'avatarPreset'>;
  size?: number;
}) {
  const source =
    person.image?.startsWith('/api/profile/avatar/') ||
    person.image?.startsWith('/avatars/')
      ? person.image
      : `/avatars/${['sky', 'mint', 'lilac', 'sun', 'rose', 'ocean'].includes(person.avatarPreset) ? person.avatarPreset : 'sky'}.svg`;
  return (
    <Image
      unoptimized
      src={source}
      alt={`Avatar di ${person.name}`}
      width={size}
      height={size}
      className="profile-avatar"
      style={{ width: size, height: size }}
    />
  );
}
export function Feedback({
  error,
  notice,
}: {
  error?: string;
  notice?: string;
}) {
  return (
    <>
      {error && (
        <p className="profile-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="profile-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="profile-empty">{children}</div>;
}
export function Pager({
  offset,
  next,
  onChange,
}: {
  offset: number;
  next: number | null;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="profile-pager">
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - 30))}
      >
        ← Precedenti
      </button>
      <span>Pagina {Math.floor(offset / 30) + 1}</span>
      <button
        disabled={next === null}
        onClick={() => next !== null && onChange(next)}
      >
        Successivi →
      </button>
    </div>
  );
}
