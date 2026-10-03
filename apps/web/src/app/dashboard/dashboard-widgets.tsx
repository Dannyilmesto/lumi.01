'use client';

import { useRouter } from 'next/navigation';
import { CalendarView } from '@/components/profile/calendar-view';
import { CommunityBoard } from '@/components/profile/community-board';

export function DashboardWidgets({ userId }: { userId: string }) {
  const router = useRouter();

  return (
    <section
      className="crm-dashboard-widgets crm-dashboard-workspaces profile-workspace"
      aria-label="Calendario e bacheca della community"
    >
      <div className="crm-dashboard-workspace-card">
        <CalendarView />
      </div>
      <div className="crm-dashboard-workspace-card">
        <CommunityBoard
          active
          userId={userId}
          onContact={(id) =>
            router.push(
              `/dashboard/profilo?tab=messages&with=${encodeURIComponent(id)}`,
            )
          }
        />
      </div>
    </section>
  );
}
