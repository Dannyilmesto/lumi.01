import { z } from 'zod';
import { sendMail } from '@/lib/email-service';
import { prisma } from '@/lib/prisma';
import {
  privateJson,
  ProfileError,
  profileApi,
  profileBody,
} from '@/lib/profile-api';

export const runtime = 'nodejs';

const sendSchema = z.object({
  to: z.string().trim().email().max(254),
  subject: z.string().trim().min(1).max(500).refine((value) => !/[\r\n]/.test(value)),
  body: z.string().trim().min(1).max(50_000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return profileApi(request, async ({ userId }) => {
    const { id } = await params;
    const input = sendSchema.parse(await profileBody(request));
    const account = await prisma.emailAccount.findFirst({
      where: { id, userId },
    });
    if (!account)
      throw new ProfileError('Account email non disponibile.', 404);
    try {
      await sendMail(account, input);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Autorizzazione'))
        throw new ProfileError(error.message, 401);
      if (error instanceof Error && error.message.startsWith('Accesso'))
        throw new ProfileError(error.message, 401);
      console.error('Unable to send mailbox message.', {
        accountId: account.id,
        provider: account.provider,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      throw new ProfileError('Non è stato possibile inviare il messaggio.', 502);
    }
    return privateJson({ sent: true }, 202);
  });
}
