import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  privateJson,
  ProfileError,
  profileApi,
  profileBody,
} from '@/lib/profile-api';
import { contactFields } from '@/lib/contacts';

export const runtime = 'nodejs';

async function accessibleContact(id: string, userId: string) {
  return prisma.customer.findFirst({
    where: {
      id,
      organization: { members: { some: { userId } } },
    },
    select: { id: true },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return profileApi(request, async ({ userId }) => {
    const { id } = await params;
    const contact = await accessibleContact(id, userId);
    if (!contact) throw new ProfileError('Contatto non disponibile.', 404);
    const data = contactFields.parse(await profileBody(request));
    const item = await prisma.customer.update({ where: { id }, data });
    return privateJson({ item });
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return profileApi(request, async ({ userId }) => {
    const { id } = await params;
    z.string().min(1).max(128).parse(id);
    const result = await prisma.customer.deleteMany({
      where: {
        id,
        organization: { members: { some: { userId } } },
      },
    });
    if (!result.count) throw new ProfileError('Contatto non disponibile.', 404);
    return privateJson({ deleted: true });
  });
}
