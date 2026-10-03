import { prisma } from '@/lib/prisma';
import { createDemoMailbox } from '@/lib/generic-email';
import {
  privateJson,
  ProfileError,
  profileApi,
} from '@/lib/profile-api';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const existing = await prisma.emailAccount.count({
      where: { userId, provider: 'DEMO' },
    });
    if (existing >= 5)
      throw new ProfileError('Puoi creare al massimo 5 caselle demo.', 409);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    if (!user) throw new ProfileError('Utente non disponibile.', 404);
    const account = await createDemoMailbox(userId, user.name);
    return privateJson({ account }, 201);
  });
}
