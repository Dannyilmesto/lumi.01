import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  idSchema,
  pagination,
  profileApi,
  profileBody,
  ProfileError,
  privateJson,
  publicUserSelect,
} from '@/lib/profile-api';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return profileApi(request, async () => {
    const url = new URL(request.url);
    const kind = z
      .enum(['notes', 'quotes'])
      .parse(url.searchParams.get('kind') || 'notes');
    const page = pagination(url);
    if (kind === 'notes') {
      const posts = await prisma.publicBulletin.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.take,
        skip: page.skip,
        select: {
          id: true,
          title: true,
          content: true,
          createdAt: true,
          updatedAt: true,
          author: { select: publicUserSelect },
        },
      });
      return privateJson({
        items: posts.slice(0, page.size),
        nextOffset: posts.length > page.size ? page.offset + page.size : null,
      });
    }
    const posts = await prisma.publicQuote.findMany({
      where: { quote: { deletedAt: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.take,
      skip: page.skip,
      select: {
        id: true,
        title: true,
        amount: true,
        currency: true,
        details: true,
        createdAt: true,
        author: { select: publicUserSelect },
      },
    });
    return privateJson({
      items: posts
        .slice(0, page.size)
        .map((post) => ({ ...post, amount: post.amount?.toString() ?? null })),
      nextOffset: posts.length > page.size ? page.offset + page.size : null,
    });
  });
}
export async function DELETE(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { id, kind } = z
      .object({ id: idSchema, kind: z.enum(['notes', 'quotes']) })
      .parse(await profileBody(request));
    const result =
      kind === 'notes'
        ? await prisma.publicBulletin.deleteMany({
            where: { id, authorId: userId },
          })
        : await prisma.publicQuote.deleteMany({
            where: { id, authorId: userId },
          });
    if (!result.count)
      throw new ProfileError('Pubblicazione non disponibile.', 404);
    return privateJson({ ok: true });
  });
}
