import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { documentSettingsSchema } from '@/lib/quote-document-schema';
import {
  authorizeDocument,
  authorizeQuoteAccess,
  cleanDocumentHtml,
  imageIdFromSource,
  initialQuoteDocument,
  quoteItemsHtml,
  readDocumentBody,
  readDocumentSettings,
} from '@/lib/quote-document';
import { isApprovedQuoteStatus } from '@/lib/quote-status';

export const runtime = 'nodejs';
const saveSchema = z.object({
  html: z.string().max(1_000_000),
  settings: documentSettingsSchema,
  revision: z.number().int().nonnegative(),
  confirmProtected: z.boolean().default(false),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorized = await authorizeDocument(request, id);
  if ('error' in authorized) return authorized.error;
  const { quote } = authorized;
  const snapshot = quote.document;
  const template = initialQuoteDocument(quote);
  return Response.json(
    {
      html: cleanDocumentHtml(snapshot?.html ?? template.html, id),
      settings: snapshot
        ? readDocumentSettings(snapshot.settings)
        : template.settings,
      revision: snapshot?.revision ?? 0,
      updatedAt: snapshot?.updatedAt.toISOString() ?? null,
      title: quote.title,
      status: quote.status,
      templateHtml: template.html,
      itemsHtml: quoteItemsHtml(quote),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorized = await authorizeQuoteAccess(request, id);
  if ('error' in authorized) return authorized.error;
  const parsed = saveSchema.safeParse(await readDocumentBody(request));
  if (!parsed.success)
    return Response.json(
      {
        error: 'Documento non valido o troppo grande (massimo 1 MB di testo).',
      },
      { status: 400 },
    );
  const { html: input, settings, revision, confirmProtected } = parsed.data;
  if (isApprovedQuoteStatus(authorized.quote.status) && !confirmProtected)
    return Response.json(
      {
        error: 'Conferma la modifica del documento di un preventivo approvato.',
        requiresConfirmation: true,
      },
      { status: 409 },
    );
  const html = cleanDocumentHtml(input, id);
  const imageIds = [
    ...new Set(
      [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].flatMap((match) => {
        const imageId = imageIdFromSource(match[1], id);
        return imageId ? [imageId] : [];
      }),
    ),
  ];
  if (
    imageIds.length &&
    (await prisma.quoteDocumentImage.count({
      where: { quoteId: id, id: { in: imageIds } },
    })) !== imageIds.length
  )
    return Response.json(
      {
        error:
          'Una delle immagini non è più disponibile. Rimuovila o caricala di nuovo.',
      },
      { status: 400 },
    );
  try {
    const saved = await prisma.$transaction(async (tx) => {
      const available = await tx.quote.updateMany({
        where: {
          id,
          deletedAt: null,
          ...(confirmProtected ? {} : { status: { not: 'ACCEPTED' as const } }),
        },
        data: { updatedAt: new Date() },
      });
      if (!available.count) throw new Error('CONFLICT');
      let document;
      if (revision === 0) {
        document = await tx.quoteDocument.create({
          data: { quoteId: id, html, settings },
        });
      } else {
        const changed = await tx.quoteDocument.updateMany({
          where: { quoteId: id, revision },
          data: { html, settings, revision: { increment: 1 } },
        });
        if (!changed.count) throw new Error('CONFLICT');
        document = await tx.quoteDocument.findUniqueOrThrow({
          where: { quoteId: id },
        });
      }
      await tx.quoteDocumentRevision.create({
        data: {
          documentId: document.id,
          revision: document.revision,
          html,
          settings,
        },
      });
      await tx.quoteDocumentRevision.deleteMany({
        where: {
          documentId: document.id,
          revision: { lt: document.revision - 99 },
        },
      });
      return document;
    });
    return Response.json({
      revision: saved.revision,
      updatedAt: saved.updatedAt.toISOString(),
    });
  } catch (error) {
    if (
      (error instanceof Error && error.message === 'CONFLICT') ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code))
    ) {
      return Response.json(
        {
          error:
            'Il documento è stato aggiornato in un’altra finestra o il preventivo non è più modificabile. Salva una copia locale e ricarica la versione aggiornata.',
          conflict: true,
        },
        { status: 409 },
      );
    }
    console.error(
      'Salvataggio documento preventivo non riuscito.',
      error instanceof Error ? error.name : 'unknown',
    );
    return Response.json(
      {
        error: 'Salvataggio non riuscito. Il testo resta nell’editor: riprova.',
      },
      { status: 500 },
    );
  }
}
