import { z } from 'zod';
import { contactFields } from '@/lib/contacts';
import { prisma } from '@/lib/prisma';
import {
  pagination,
  privateJson,
  ProfileError,
  profileApi,
  profileBody,
} from '@/lib/profile-api';

export const runtime = 'nodejs';

const createContact = contactFields.extend({
  organizationId: z.string().min(1).max(128),
});

export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const url = new URL(request.url);
    const organizationId = z.string().min(1).max(128).parse(
      url.searchParams.get('organizationId'),
    );
    const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
    const page = pagination(url, 30);
    const membership = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { organizationId: true },
    });
    if (!membership) throw new ProfileError('Azienda non disponibile.', 404);

    const items = await prisma.customer.findMany({
      where: {
        organizationId,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
                { company: { contains: query, mode: 'insensitive' } },
                { city: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: page.take,
      skip: page.skip,
    });
    return privateJson({
      items: items.slice(0, page.size),
      nextOffset: items.length > page.size ? page.offset + page.size : null,
    });
  });
}

export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { organizationId, ...data } = createContact.parse(
      await profileBody(request),
    );
    const membership = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { organizationId: true },
    });
    if (!membership) throw new ProfileError('Azienda non disponibile.', 404);

    const item = await prisma.customer.create({
      data: { ...data, organizationId },
    });
    return privateJson({ item }, 201);
  });
}
