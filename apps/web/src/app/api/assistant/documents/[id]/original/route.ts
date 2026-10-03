import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStorage } from '@/lib/storage/object-storage';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: 'Accedi per aprire il PDF.' },
      { status: 401 },
    );
  const { id } = await context.params;
  const document = await prisma.assistantDocument.findFirst({
    where: {
      id,
      organization: { members: { some: { userId: session.user.id } } },
    },
    select: { originalPdfKey: true, fileName: true },
  });
  if (!document)
    return Response.json({ error: 'Documento non trovato.' }, { status: 404 });
  try {
    const contents = await getObjectStorage().get(document.originalPdfKey);
    const fileName = document.fileName.replace(/[\r\n\u0000-\u001f]/g, '-');
    return new Response(new Uint8Array(contents), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Length': String(contents.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
      },
    });
  } catch {
    return Response.json(
      { error: 'Il PDF originale non è disponibile.' },
      { status: 404 },
    );
  }
}
