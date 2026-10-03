import { z } from 'zod';
import { listMailMessages } from '@/lib/email-service';
import { prisma } from '@/lib/prisma';
import {
  privateJson,
  ProfileError,
  profileApi,
} from '@/lib/profile-api';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return profileApi(request, async ({ userId }) => {
    const { id } = await params;
    z.string().min(1).max(128).parse(id);
    const account = await prisma.emailAccount.findFirst({
      where: { id, userId },
    });
    if (!account)
      throw new ProfileError('Account email non disponibile.', 404);
    try {
      return privateJson({ messages: await listMailMessages(account) });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Autorizzazione'))
        throw new ProfileError(error.message, 401);
      if (error instanceof Error && error.message.startsWith('Accesso'))
        throw new ProfileError(error.message, 401);
      console.error('Unable to list mailbox messages.', {
        accountId: account.id,
        provider: account.provider,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      throw new ProfileError('Non è stato possibile caricare i messaggi.', 502);
    }
  });
}
