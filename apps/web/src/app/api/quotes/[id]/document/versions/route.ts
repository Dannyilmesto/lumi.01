import { prisma } from '@/lib/prisma';
import { authorizeQuoteAccess } from '@/lib/quote-document';
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorized = await authorizeQuoteAccess(request, id);
  if ('error' in authorized) return authorized.error;
  const revision = new URL(request.url).searchParams.get('revision');
  if (revision !== null && !/^[1-9]\d{0,9}$/.test(revision))
    return Response.json({ error: 'Versione non valida.' }, { status: 400 });
  const versions = await prisma.quoteDocumentRevision.findMany({
    where: {
      document: { quoteId: id },
      ...(revision ? { revision: Number(revision) } : {}),
    },
    orderBy: { revision: 'desc' },
    take: revision ? 1 : 100,
    select: {
      revision: true,
      createdAt: true,
      ...(revision ? { html: true, settings: true } : {}),
    },
  });
  return Response.json(
    { versions },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
