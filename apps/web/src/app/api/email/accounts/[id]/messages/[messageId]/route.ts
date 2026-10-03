import { readMailMessage } from '@/lib/email-service';
import { prisma } from '@/lib/prisma';
import {
  privateJson,
  ProfileError,
  profileApi,
} from '@/lib/profile-api';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  return profileApi(request, async ({ userId }) => {
    const { id, messageId } = await params;
    const account = await prisma.emailAccount.findFirst({
      where: { id, userId },
    });
    if (!account)
      throw new ProfileError('Account email non disponibile.', 404);
    try {
      return privateJson({ message: await readMailMessage(account, messageId) });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Autorizzazione'))
        throw new ProfileError(error.message, 401);
      if (error instanceof Error && error.message.startsWith('Accesso'))
        throw new ProfileError(error.message, 401);
      console.error('Unable to read mailbox message.', {
        accountId: account.id,
        provider: account.provider,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      throw new ProfileError('Non è stato possibile aprire il messaggio.', 502);
    }
  });
}
