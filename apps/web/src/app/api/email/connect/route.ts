import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  emailAuthorizationUrl,
  isEmailProviderConfigured,
} from '@/lib/email-oauth';
import { isEmailTokenEncryptionConfigured } from '@/lib/email-crypto';
import { prisma } from '@/lib/prisma';
import {
  privateJson,
  ProfileError,
  profileApi,
  profileBody,
} from '@/lib/profile-api';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { provider } = z
      .object({ provider: z.enum(['GOOGLE', 'MICROSOFT']) })
      .parse(await profileBody(request));
    if (!isEmailTokenEncryptionConfigured())
      throw new ProfileError('La posta non è ancora configurata dal gestore dell’app.');
    if (!isEmailProviderConfigured(provider))
      throw new ProfileError(
        `Il collegamento ${provider === 'GOOGLE' ? 'Google' : 'Microsoft'} non è ancora configurato.`,
      );
    const state = randomBytes(32).toString('base64url');
    await prisma.emailOAuthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await prisma.emailOAuthState.create({
      data: {
        id: state,
        userId,
        provider,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    return privateJson({
      authorizationUrl: emailAuthorizationUrl(provider, state).toString(),
    });
  });
}
