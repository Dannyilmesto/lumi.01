import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { authorizeQuoteAccess } from '@/lib/quote-document';
import { isApprovedQuoteStatus } from '@/lib/quote-status';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorized = await authorizeQuoteAccess(request, id);
  if ('error' in authorized) return authorized.error;
  if (Number(request.headers.get('content-length')) > 12 * 1024 * 1024)
    return Response.json(
      { error: 'Immagine troppo grande. Massimo 10 MB.' },
      { status: 413 },
    );
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)
    return Response.json(
      { error: 'Seleziona un’immagine PNG, JPEG o WebP fino a 10 MB.' },
      { status: 400 },
    );
  if (
    isApprovedQuoteStatus(authorized.quote.status) &&
    form?.get('confirmProtected') !== 'true'
  )
    return Response.json(
      { error: 'Abilita prima la modifica del preventivo approvato.' },
      { status: 409 },
    );
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const supported =
      input.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
      input
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (input.toString('ascii', 0, 4) === 'RIFF' &&
        input.toString('ascii', 8, 12) === 'WEBP');
    if (!supported)
      return Response.json(
        { error: 'Il file non è un’immagine PNG, JPEG o WebP valida.' },
        { status: 400 },
      );
    const metadata = await sharp(input, {
      limitInputPixels: 30_000_000,
    }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
      return Response.json(
        { error: 'Formato non supportato. Usa PNG, JPEG o WebP.' },
        { status: 400 },
      );
    const data = await sharp(input, { limitInputPixels: 30_000_000 })
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer();
    if (data.length > 4 * 1024 * 1024)
      return Response.json(
        { error: 'L’immagine resta troppo grande dopo l’ottimizzazione.' },
        { status: 413 },
      );
    const image = await prisma.$transaction(async (tx) => {
      // Lock the quote so parallel uploads cannot bypass the per-document limit.
      const changed = await tx.quote.updateMany({
        where: {
          id,
          deletedAt: null,
          ...(form?.get('confirmProtected') === 'true'
            ? {}
            : { status: { not: 'ACCEPTED' as const } }),
        },
        data: { updatedAt: new Date() },
      });
      if (!changed.count) throw new Error('UNAVAILABLE');
      if ((await tx.quoteDocumentImage.count({ where: { quoteId: id } })) >= 80)
        throw new Error('LIMIT');
      return tx.quoteDocumentImage.create({
        data: {
          quoteId: id,
          name: file.name.slice(0, 160),
          mimeType: 'image/webp',
          data,
        },
        select: { id: true, name: true },
      });
    });
    return Response.json(
      {
        src: `/api/quotes/${encodeURIComponent(id)}/document/images/${image.id}`,
        alt: image.name,
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message === 'LIMIT'
            ? 'Raggiunto il limite di 80 immagini per preventivo, incluse quelle conservate nella cronologia.'
            : 'Immagine illeggibile o preventivo non più modificabile.',
      },
      { status: 400 },
    );
  }
}
