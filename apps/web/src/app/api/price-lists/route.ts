import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getObjectStorage } from '@/lib/storage/object-storage';

export const runtime = 'nodejs';

const maximumPdfBytes = 30 * 1024 * 1024;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function stringField(form: FormData, name: string, maximumLength: number) {
  const value = form.get(name);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximumLength) return null;
  return trimmed;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return jsonError('Devi accedere per consultare i listini.', 401);

  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      ...(requestedOrganizationId
        ? { organizationId: requestedOrganizationId }
        : {}),
    },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership)
    return jsonError('Azienda non disponibile per questo utente.', 404);

  const priceLists = await prisma.priceList.findMany({
    where: { supplier: { organizationId: membership.organizationId } },
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
      sha256: true,
      createdAt: true,
      supplier: { select: { name: true } },
      _count: { select: { candidates: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return Response.json({ priceLists });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return jsonError('Devi accedere per caricare un listino.', 401);

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maximumPdfBytes + 1024 * 1024) {
    return jsonError('Il file supera il limite di 30 MB.', 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError('Richiesta di caricamento non valida.', 400);
  }

  const organizationId = stringField(form, 'organizationId', 128);
  const supplierName = stringField(form, 'supplierName', 120);
  const name = stringField(form, 'name', 160);
  const version = stringField(form, 'version', 80);
  const uploadedFile = form.get('file');

  if (!organizationId || !supplierName || !name || !version) {
    return jsonError(
      'Completa azienda, fornitore, nome del listino e versione.',
      400,
    );
  }
  if (!(uploadedFile instanceof File) || uploadedFile.size === 0) {
    return jsonError('Seleziona un file PDF.', 400);
  }
  if (uploadedFile.size > maximumPdfBytes) {
    return jsonError('Il file supera il limite di 30 MB.', 413);
  }
  if (!uploadedFile.name.toLowerCase().endsWith('.pdf')) {
    return jsonError('Seleziona un file con estensione .pdf.', 415);
  }
  if (
    uploadedFile.type &&
    !['application/pdf', 'application/octet-stream'].includes(uploadedFile.type)
  ) {
    return jsonError('Il tipo del file selezionato non è PDF.', 415);
  }

  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: session.user.id },
    },
    select: { organizationId: true },
  });
  if (!membership)
    return jsonError('Azienda non disponibile per questo utente.', 404);

  const contents = Buffer.from(await uploadedFile.arrayBuffer());
  const pdfHeader = Buffer.from('%PDF-');
  if (contents.subarray(0, 1024).indexOf(pdfHeader) === -1) {
    return jsonError(
      'Il file selezionato non contiene un’intestazione PDF valida.',
      415,
    );
  }

  const sha256 = createHash('sha256').update(contents).digest('hex');
  const objectKey = `${randomUUID()}.pdf`;
  const storage = getObjectStorage();

  try {
    await storage.put(objectKey, contents);
    const priceList = await prisma.$transaction(async (transaction) => {
      const supplier = await transaction.supplier.upsert({
        where: { organizationId_name: { organizationId, name: supplierName } },
        create: { organizationId, name: supplierName },
        update: {},
        select: { id: true },
      });

      const priceList = await transaction.priceList.create({
        data: {
          name,
          version,
          originalPdfKey: objectKey,
          sha256,
          supplierId: supplier.id,
        },
        select: {
          id: true,
          name: true,
          version: true,
          status: true,
          createdAt: true,
          supplier: { select: { name: true } },
        },
      });
      await transaction.assistantDocument.create({
        data: {
          organizationId,
          uploadedByUserId: session.user.id,
          fileName:
            uploadedFile.name
              .replace(/[\\/\r\n\u0000-\u001f]/g, '-')
              .slice(0, 180) || `${name} - ${version}.pdf`,
          originalPdfKey: objectKey,
          sha256,
          sourceType: 'PRICE_LIST',
          sourceId: priceList.id,
        },
      });
      return priceList;
    });

    return Response.json({ priceList }, { status: 201 });
  } catch (error) {
    try {
      await storage.delete(objectKey);
    } catch (cleanupError) {
      console.error(
        'Impossibile rimuovere un PDF non associato a un listino.',
        cleanupError,
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return jsonError(
        'Esiste già una versione con questo nome per il fornitore scelto.',
        409,
      );
    }

    console.error('Errore durante il salvataggio del listino PDF.', error);
    return jsonError('Non è stato possibile salvare il listino. Riprova.', 500);
  }
}
