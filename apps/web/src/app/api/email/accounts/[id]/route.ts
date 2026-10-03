import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  privateJson,
  ProfileError,
  profileApi,
} from '@/lib/profile-api';

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return profileApi(request, async ({ userId }) => {
    const { id } = await params;
    z.string().min(1).max(128).parse(id);
    const result = await prisma.emailAccount.deleteMany({
      where: { id, userId },
    });
    if (!result.count)
      throw new ProfileError('Account email non disponibile.', 404);
    return privateJson({ deleted: true });
  });
}
