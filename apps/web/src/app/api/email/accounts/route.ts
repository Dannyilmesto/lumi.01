import { prisma } from '@/lib/prisma';
import { isEmailTokenEncryptionConfigured } from '@/lib/email-crypto';
import { privateJson, profileApi } from '@/lib/profile-api';
import { isEmailProviderConfigured } from '@/lib/email-oauth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const accounts = await prisma.emailAccount.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        email: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return privateJson({
      accounts,
      providers: {
        google: isEmailProviderConfigured('GOOGLE'),
        microsoft: isEmailProviderConfigured('MICROSOFT'),
        encryption: isEmailTokenEncryptionConfigured(),
        generic: isEmailTokenEncryptionConfigured(),
        demo: true,
      },
    });
  });
}
