import { authorizeQuoteAccess } from '@/lib/quote-document';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorized = await authorizeQuoteAccess(request, id);
  if ('error' in authorized) return authorized.error;

  const query = (new URL(request.url).searchParams.get('q') || '')
    .trim()
    .slice(0, 100);
  const priceLists = await prisma.priceList.findMany({
    where: {
      supplier: { organizationId: authorized.quote.organizationId },
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { version: { contains: query, mode: 'insensitive' as const } },
              {
                supplier: {
                  name: { contains: query, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
      supplier: { select: { name: true } },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 50,
  });

  return Response.json(
    { priceLists },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
