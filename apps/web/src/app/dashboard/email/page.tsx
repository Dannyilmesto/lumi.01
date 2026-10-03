import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isEmailTokenEncryptionConfigured } from '@/lib/email-crypto';
import { isEmailProviderConfigured } from '@/lib/email-oauth';
import { prisma } from '@/lib/prisma';
import { EmailWorkspace } from './email-workspace';

export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const [accounts, query] = await Promise.all([
    prisma.emailAccount.findMany({
      where: { userId: session.user.id },
      select: { id: true, provider: true, email: true },
      orderBy: { createdAt: 'asc' },
    }),
    searchParams,
  ]);

  return (
    <EmailWorkspace
      initialAccounts={accounts}
      providers={{
        google: isEmailProviderConfigured('GOOGLE'),
        microsoft: isEmailProviderConfigured('MICROSOFT'),
        encryption: isEmailTokenEncryptionConfigured(),
        generic: isEmailTokenEncryptionConfigured(),
        demo: true,
      }}
      callbackError={query.error ?? null}
    />
  );
}
