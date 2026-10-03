import { prisma } from '@/lib/prisma';
import { ProfileError } from '@/lib/profile-api';
import {
  createArchiveFolder,
  saveArchiveFile,
} from '@/lib/profile-archive';
import { GET as exportQuotePdf } from '@/app/api/quotes/[id]/document/pdf/route';

function safeName(value: string) {
  return (
    value
      .replace(/[\\/\x00-\x1f\x7f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Preventivo'
  );
}

export async function saveQuotePdfToArchive(
  request: Request,
  userId: string,
  quoteId: string,
) {
  const quote = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      deletedAt: null,
      organization: { members: { some: { userId } } },
    },
    select: { id: true, title: true, document: { select: { id: true } } },
  });
  if (!quote) throw new ProfileError('Preventivo non disponibile.', 404);
  if (!quote.document)
    throw new ProfileError('Salva il documento prima di archiviarlo.', 409);

  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('content-type');
  const pdfRequest = new Request(
    new URL(
      `/api/quotes/${encodeURIComponent(quoteId)}/document/pdf`,
      request.url,
    ),
    { headers },
  );
  const pdf = await exportQuotePdf(pdfRequest, {
    params: Promise.resolve({ id: quoteId }),
  });
  if (!pdf)
    throw new ProfileError('Non è stato possibile preparare il PDF.', 500);
  if (!pdf.ok) {
    const data = (await pdf.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ProfileError(
      data?.error || 'Non è stato possibile preparare il PDF.',
      pdf.status,
    );
  }

  await createArchiveFolder(userId, 'Preventivi');
  const suffix = quote.id.slice(-8);
  const relative = `Preventivi/${safeName(quote.title)} [${suffix}].pdf`;
  await saveArchiveFile(userId, relative, pdf.body, { replace: true });
  return relative;
}
