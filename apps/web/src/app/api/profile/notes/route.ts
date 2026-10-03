import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  idSchema,
  pagination,
  profileApi,
  profileBody,
  ProfileError,
  privateJson,
} from '@/lib/profile-api';
export const runtime = 'nodejs';
const noteInput = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(20_000),
  link: z
    .object({ type: z.enum(['customer', 'quote']), id: idSchema })
    .nullable()
    .optional(),
});
type NoteLink = {
  id: string;
  linkedType: string | null;
  linkedId: string | null;
};

async function validateLink(
  userId: string,
  link: { type: 'customer' | 'quote'; id: string } | null | undefined,
) {
  if (!link) return;
  const available =
    link.type === 'customer'
      ? await prisma.customer.count({
          where: {
            id: link.id,
            organization: { members: { some: { userId } } },
          },
        })
      : await prisma.quote.count({
          where: {
            id: link.id,
            deletedAt: null,
            organization: { members: { some: { userId } } },
          },
        });
  if (!available)
    throw new ProfileError('Cliente o preventivo non disponibile.', 404);
}
export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const url = new URL(request.url);
    const page = pagination(url);
    const query = (url.searchParams.get('q') || '').slice(0, 100);
    const notes = await prisma.privateNote.findMany({
      where: {
        userId,
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { content: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
      include: { publication: { select: { id: true } } },
    });
    const rows = notes.length
      ? await prisma.$queryRaw<NoteLink[]>`
      SELECT "id", "linkedType", "linkedId" FROM "PrivateNote"
      WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(notes.map((note) => note.id))})
    `
      : [];
    const links = new Map(rows.map((row) => [row.id, row]));
    const customerIds = rows
      .filter((row) => row.linkedType === 'customer' && row.linkedId)
      .map((row) => row.linkedId!);
    const quoteIds = rows
      .filter((row) => row.linkedType === 'quote' && row.linkedId)
      .map((row) => row.linkedId!);
    const [customers, quotes] = await Promise.all([
      prisma.customer.findMany({
        where: {
          id: { in: customerIds },
          organization: { members: { some: { userId } } },
        },
        select: { id: true, name: true },
      }),
      prisma.quote.findMany({
        where: {
          id: { in: quoteIds },
          deletedAt: null,
          organization: { members: { some: { userId } } },
        },
        select: { id: true, title: true },
      }),
    ]);
    const labels = new Map<string, string>([
      ...customers.map((item) => [item.id, item.name] as const),
      ...quotes.map((item) => [item.id, item.title] as const),
    ]);
    return privateJson({
      items: notes.slice(0, page.size).map(({ publication, ...note }) => ({
        ...note,
        isPublic: Boolean(publication),
        link: links.get(note.id)?.linkedId
          ? {
              type: links.get(note.id)!.linkedType,
              id: links.get(note.id)!.linkedId,
              label:
                labels.get(links.get(note.id)!.linkedId!) || 'Non disponibile',
            }
          : null,
      })),
      nextOffset: notes.length > page.size ? page.offset + page.size : null,
    });
  });
}
export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { link, ...data } = noteInput.parse(await profileBody(request));
    await validateLink(userId, link);
    const note = await prisma.privateNote.create({ data: { ...data, userId } });
    if (link)
      await prisma.$executeRaw`UPDATE "PrivateNote" SET "linkedType" = ${link.type}, "linkedId" = ${link.id} WHERE "id" = ${note.id} AND "userId" = ${userId}`;
    return privateJson(note, 201);
  });
}
export async function PATCH(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const input = z
      .discriminatedUnion('action', [
        noteInput.extend({
          id: idSchema,
          action: z.literal('update'),
          version: z.number().int().positive(),
        }),
        z.object({
          id: idSchema,
          action: z.enum(['publish', 'unpublish']),
          confirmPublic: z.boolean().optional(),
          version: z.number().int().positive().optional(),
        }),
      ])
      .parse(await profileBody(request));
    const note = await prisma.privateNote.findFirst({
      where: { id: input.id, userId },
    });
    if (!note) throw new ProfileError('Nota non disponibile.', 404);
    if (input.action === 'update') {
      await validateLink(userId, input.link);
      const result = await prisma.privateNote.updateMany({
        where: { id: note.id, userId, version: input.version },
        data: {
          title: input.title,
          content: input.content,
          version: { increment: 1 },
        },
      });
      if (!result.count)
        throw new ProfileError(
          'La nota è stata modificata in un’altra finestra. Ricarica prima di salvare.',
          409,
        );
      if (input.link !== undefined) {
        const linkedType = input.link?.type ?? null;
        const linkedId = input.link?.id ?? null;
        await prisma.$executeRaw`UPDATE "PrivateNote" SET "linkedType" = ${linkedType}, "linkedId" = ${linkedId} WHERE "id" = ${note.id} AND "userId" = ${userId}`;
      }
    } else if (input.action === 'publish') {
      if (input.version !== note.version)
        throw new ProfileError(
          'La nota è cambiata. Ricaricala prima di pubblicare.',
          409,
        );
      if (!input.confirmPublic)
        throw new ProfileError(
          'Conferma la pubblicazione per tutti gli utenti.',
        );
      await prisma.publicBulletin.upsert({
        where: { noteId: note.id },
        create: {
          noteId: note.id,
          authorId: userId,
          title: note.title,
          content: note.content,
        },
        update: { title: note.title, content: note.content },
      });
    } else
      await prisma.publicBulletin.deleteMany({
        where: { noteId: note.id, authorId: userId },
      });
    return privateJson({ ok: true });
  });
}
export async function DELETE(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { id } = z.object({ id: idSchema }).parse(await profileBody(request));
    const result = await prisma.privateNote.deleteMany({
      where: { id, userId },
    });
    if (!result.count) throw new ProfileError('Nota non disponibile.', 404);
    return privateJson({ ok: true });
  });
}
