'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Profile } from '@/lib/profile-types';
import {
  profileTab,
  profileTabs,
  type ProfileTab,
} from '@/lib/dashboard-modules';
import { ProfileHeader } from './profile-header';
import { NoteBoard } from './note-board';
import { CalendarView } from './calendar-view';
import { CommunityBoard } from './community-board';

// Schede pesanti: il codice si scarica solo quando l'utente le apre.
const QuoteVault = dynamic(() => import('./quote-vault').then((m) => m.QuoteVault));
const FileArchive = dynamic(() => import('./file-archive').then((m) => m.FileArchive));
const ChatList = dynamic(() => import('./chat-list').then((m) => m.ChatList));
export function ProfileWorkspace({
  initialProfile,
  organizations,
}: {
  initialProfile: Profile;
  organizations: { id: string; name: string }[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const router = useRouter();
  const search = useSearchParams();
  const tab = profileTab(search.get('tab'));
  const recipient = search.get('with');
  const [visited, setVisited] = useState<ProfileTab[]>([tab]);
  useEffect(() => {
    setVisited((current) =>
      current.includes(tab) ? current : [...current, tab],
    );
  }, [tab]);
  function open(value: ProfileTab, userId?: string) {
    router.replace(
      `/dashboard/profilo?tab=${value}${userId ? `&with=${encodeURIComponent(userId)}` : ''}`,
      { scroll: false },
    );
  }
  return (
    <main className="profile-workspace">
      {tab === 'notes' && (
        <ProfileHeader profile={profile} onUpdate={setProfile} />
      )}
      <div className="profile-body">
        <nav className="profile-tabs" aria-label="Sezioni del profilo">
          {profileTabs.map((item) => (
            <button
              key={item.id}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => open(item.id)}
            >
              <span aria-hidden="true">{item.symbol}</span>
              {item.label}
            </button>
          ))}
          <p>
            Personale quando serve.
            <br />
            Condiviso quando scegli tu.
          </p>
        </nav>
        <div className="profile-content">
          {profileTabs
            .filter((item) => visited.includes(item.id) || item.id === tab)
            .map((item) => (
              <div key={item.id} hidden={tab !== item.id}>
                {item.id === 'notes' ? (
                  <NoteBoard />
                ) : item.id === 'calendar' ? (
                  <CalendarView />
                ) : item.id === 'quotes' ? (
                  <QuoteVault organizations={organizations} />
                ) : item.id === 'archive' ? (
                  <FileArchive />
                ) : item.id === 'community' ? (
                  <CommunityBoard
                    active={tab === item.id}
                    userId={profile.id}
                    onContact={(id) => open('messages', id)}
                  />
                ) : (
                  <ChatList
                    active={tab === item.id}
                    userId={profile.id}
                    recipient={recipient}
                  />
                )}
              </div>
            ))}
        </div>
      </div>
    </main>
  );
}
