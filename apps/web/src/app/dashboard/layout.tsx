import { Suspense } from 'react';
import { DashboardNavigation } from '@/components/profile/dashboard-navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { WorkspaceAssistant } from './workspace-assistant';

/** Carica i dati della chat in uno Suspense separato: la pagina non attende queste query. */
async function Assistant({
  userId,
  fallbackName,
}: {
  userId: string;
  fallbackName: string;
}) {
  const [organizations, profile] = await Promise.all([
    prisma.membership.findMany({
      where: { userId },
      select: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    }),
  ]);

  return (
    <WorkspaceAssistant
      userName={profile?.name ?? fallbackName}
      organizations={organizations.map(({ organization }) => organization)}
    />
  );
}

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  return (
    <div className="manager-shell">
      {session && (
        <Suspense>
          <DashboardNavigation />
        </Suspense>
      )}
      <div className="manager-shell-main">{children}</div>
      {session && (
        <Suspense fallback={null}>
          <Assistant userId={session.user.id} fallbackName={session.user.name} />
        </Suspense>
      )}
    </div>
  );
}
