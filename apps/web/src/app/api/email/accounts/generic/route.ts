import { encryptEmailToken, isEmailTokenEncryptionConfigured } from '@/lib/email-crypto';
import {
  genericEmailAccountSchema,
  verifyGenericEmailAccount,
} from '@/lib/generic-email';
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
    const config = genericEmailAccountSchema.parse(await profileBody(request));
    if (!isEmailTokenEncryptionConfigured())
      throw new ProfileError('La posta non è configurata dal gestore dell’app.');
    try {
      await verifyGenericEmailAccount(config);
    } catch (error) {
      console.error('Generic mailbox verification failed.', {
        imapHost: config.imap.host,
        smtpHost: config.smtp.host,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      throw new ProfileError(
        'Verifica account non riuscita. Controlla host, porte, TLS e credenziali dei server IMAP/SMTP.',
        400,
      );
    }

    const email = config.email.toLowerCase();
    const account = await prisma.emailAccount.upsert({
      where: {
        userId_provider_email: {
          userId,
          provider: 'IMAP_SMTP',
          email,
        },
      },
      create: {
        userId,
        provider: 'IMAP_SMTP',
        providerAccountId: config.imap.user,
        email,
        accessTokenEncrypted: 'generic-imap-smtp',
        configEncrypted: encryptEmailToken(JSON.stringify(config)),
        scope: 'IMAP INBOX; SMTP send',
      },
      update: {
        providerAccountId: config.imap.user,
        configEncrypted: encryptEmailToken(JSON.stringify(config)),
      },
      select: { id: true, email: true, provider: true },
    });
    return privateJson({ account }, 201);
  });
}
