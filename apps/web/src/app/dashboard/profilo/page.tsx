import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { publicUserSelect } from '@/lib/profile-api';
import { ProfileWorkspace } from '@/components/profile/profile-workspace';
export const metadata = { title: 'Profilo Utente | Lumi' };
export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const [user, memberships] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { ...publicUserSelect, email: true, createdAt: true },
    }),
    prisma.membership.findMany({
      where: { userId: session.user.id },
      select: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return (
    <ProfileWorkspace
      initialProfile={{ ...user, createdAt: user.createdAt.toISOString() }}
      organizations={memberships.map((member) => member.organization)}
    />
  );
}
