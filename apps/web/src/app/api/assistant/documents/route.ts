import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStorage } from '@/lib/storage/object-storage';
import {
  maximumAssistantPdfBytes,
  validateAssistantPdfUpload,
} from '@/lib/assistant-document-upload';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function authorizedOrganization(
  request: Request,
  organizationId: string,
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { error: jsonError('Accedi per continuare.', 401) };
  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: session.user.id },
    },
    select: { organizationId: true },
  });
  if (!membership)
    return {
      error: jsonError('Azienda non disponibile per questo utente.', 404),
    };
  return { session, organizationId: membership.organizationId };
}

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get(
    'organizationId',
  );
  if (!organizationId)
    return jsonError('Seleziona un’azienda per consultare i documenti.', 400);
  const authorized = await authorizedOrganization(request, organizationId);
  if ('error' in authorized) return authorized.error;

  const documents = await prisma.assistantDocument.findMany({
    where: { organizationId: authorized.organizationId },
    select: {
      id: true,
      fileName: true,
      sourceType: true,
      sourceId: true,
      pageCount: true,
      scannedAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { fileName: 'asc' }],
    take: 100,
  });

  return Response.json({
    documents: documents.map((document) => ({
      ...document,
      scannedAt: document.scannedAt?.toISOString() ?? null,
      createdAt: document.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maximumAssistantPdfBytes + 1024 * 1024)
    return jsonError('Il file supera il limite di 30 MB.', 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError('Carica un file PDF valido.', 400);
  }
  const organizationId = form.get('organizationId');
  const file = form.get('file');
  if (
    typeof organizationId !== 'string' ||
    !organizationId ||
    !(file instanceof File)
  )
    return jsonError('Seleziona azienda e file PDF.', 400);
  if (file.size === 0)
    return jsonError('Il PDF è vuoto. Seleziona un file con contenuto.', 415);
  if (file.size > maximumAssistantPdfBytes)
    return jsonError('Il PDF supera il limite di 30 MB.', 413);

  const authorized = await authorizedOrganization(request, organizationId);
  if ('error' in authorized) return authorized.error;
  const pdfBytes = Buffer.from(await file.arrayBuffer());
  const validationError = validateAssistantPdfUpload({
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    bytes: pdfBytes,
  });
  if (validationError)
    return jsonError(
      validationError,
      file.size > maximumAssistantPdfBytes ? 413 : 415,
    );

  const originalPdfKey = `${randomUUID()}.pdf`;
  const safeFileName =
    file.name.replace(/[\\/\r\n\u0000-\u001f]/g, '-').slice(0, 180) ||
    'documento.pdf';
  const sha256 = createHash('sha256').update(pdfBytes).digest('hex');
  const storage = getObjectStorage();
  try {
    await storage.put(originalPdfKey, pdfBytes);
    const document = await prisma.assistantDocument.create({
      data: {
        organizationId: authorized.organizationId,
        uploadedByUserId: authorized.session.user.id,
        fileName: safeFileName,
        originalPdfKey,
        sha256,
        sourceType: 'UPLOAD',
      },
      select: { id: true, fileName: true, createdAt: true },
    });
    return Response.json(
      {
        document: { ...document, createdAt: document.createdAt.toISOString() },
      },
      { status: 201 },
    );
  } catch (error) {
    await storage.delete(originalPdfKey).catch(() => undefined);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      return jsonError('Questo PDF è già archiviato.', 409);
    console.error('Salvataggio del PDF non riuscito.', error);
    return jsonError('Non è stato possibile archiviare il PDF.', 500);
  }
}
