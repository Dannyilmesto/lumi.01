import { z } from 'zod';
import { idSchema } from '@/lib/profile-api';
import { prisma } from '@/lib/prisma';
import {
  pagination,
  profileApi,
  privateJson,
  publicUserSelect,
} from '@/lib/profile-api';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const url = new URL(request.url);
    const selected = url.searchParams.getAll('id');
    const ids = selected.length
      ? z.array(idSchema).max(19).parse(selected)
      : null;
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
    const page = pagination(url, 20);
    const users = await prisma.user.findMany({
      where: {
        id: { not: userId, ...(ids ? { in: ids } : {}) },
        emailVerified: true,
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: publicUserSelect,
      take: page.take,
      skip: page.skip,
    });
    return privateJson({
      items: users.slice(0, page.size),
      nextOffset: users.length > page.size ? page.offset + page.size : null,
    });
  });
}
