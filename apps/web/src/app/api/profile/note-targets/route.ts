import { prisma } from '@/lib/prisma';
import { profileApi, privateJson } from '@/lib/profile-api';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const query = (new URL(request.url).searchParams.get('q') || '')
      .trim()
      .slice(0, 100);
    if (!query) return privateJson({ items: [] });
    const [customers, quotes] = await Promise.all([
      prisma.customer.findMany({
        where: {
          name: { contains: query, mode: 'insensitive' },
          organization: { members: { some: { userId } } },
        },
        select: { id: true, name: true },
        take: 15,
      }),
      prisma.quote.findMany({
        where: {
          title: { contains: query, mode: 'insensitive' },
          deletedAt: null,
          organization: { members: { some: { userId } } },
        },
        select: { id: true, title: true },
        take: 15,
      }),
    ]);
    return privateJson({
      items: [
        ...customers.map((item) => ({
          type: 'customer',
          id: item.id,
          label: item.name,
        })),
        ...quotes.map((item) => ({
          type: 'quote',
          id: item.id,
          label: item.title,
        })),
      ],
    });
  });
}
