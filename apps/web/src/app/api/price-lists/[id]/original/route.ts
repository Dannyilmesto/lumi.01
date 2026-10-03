import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStorage } from '@/lib/storage/object-storage';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return jsonError('Devi accedere per scaricare questo documento.', 401);

  const { id } = await context.params;
  const priceList = await prisma.priceList.findFirst({
    where: {
      id,
      supplier: {
        organization: { members: { some: { userId: session.user.id } } },
      },
    },
    select: { name: true, version: true, originalPdfKey: true },
  });
  if (!priceList) return jsonError('Listino non trovato.', 404);

  try {
    const contents = await getObjectStorage().get(priceList.originalPdfKey);
    const filename = `${priceList.name}-${priceList.version}.pdf`
      .replace(/[\\/\r\n\u0000-\u001f]/g, '-')
      .slice(0, 180);

    return new Response(new Uint8Array(contents), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(contents.byteLength),
        'Content-Disposition': `${new URL(request.url).searchParams.get('inline') === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Impossibile leggere il PDF originale del listino.', error);
    return jsonError(
      'Il PDF originale non è disponibile nello spazio di archiviazione.',
      404,
    );
  }
}
