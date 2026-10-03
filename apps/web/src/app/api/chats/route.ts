import { createHash } from 'node:crypto';
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
  publicUserSelect,
} from '@/lib/profile-api';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const page = pagination(new URL(request.url), 30);
    const chats = await prisma.chat.findMany({
      where: { members: { some: { userId } } },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
      include: {
        members: { select: { user: { select: publicUserSelect } } },
        messages: {
          orderBy: { sequence: 'desc' },
          take: 1,
          select: { text: true },
        },
      },
    });
    return privateJson({
      items: chats
        .slice(0, page.size)
        .map(({ messages, ...chat }) => ({
          ...chat,
          preview: messages[0]?.text.slice(0, 100) || 'Nessun messaggio',
        })),
      nextOffset: chats.length > page.size ? page.offset + page.size : null,
    });
  });
}
export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const input = z
      .object({
        type: z.enum(['direct', 'group']),
        name: z.string().trim().min(1).max(80).optional(),
        memberIds: z.array(idSchema).min(1).max(19),
      })
      .parse(await profileBody(request));
    const memberIds = [...new Set([userId, ...input.memberIds])];
    if (
      (input.type === 'direct' && memberIds.length !== 2) ||
      (input.type === 'group' && (memberIds.length < 2 || !input.name))
    )
      throw new ProfileError(
        'Seleziona i partecipanti e assegna un nome al gruppo.',
      );
    if (
      (await prisma.user.count({
        where: { id: { in: memberIds }, emailVerified: true },
      })) !== memberIds.length
    )
      throw new ProfileError('Uno o più utenti non sono disponibili.', 404);
    const directKey =
      input.type === 'direct'
        ? createHash('sha256')
            .update(JSON.stringify([...memberIds].sort()))
            .digest('hex')
        : null;
    if (directKey) {
      const existing = await prisma.chat.findUnique({
        where: { directKey },
        select: { id: true },
      });
      if (existing) return privateJson(existing);
    }
    try {
      return privateJson(
        await prisma.chat.create({
          data: {
            type: input.type,
            name: input.type === 'group' ? input.name : null,
            directKey,
            createdById: userId,
            members: { create: memberIds.map((id) => ({ userId: id })) },
          },
          select: { id: true },
        }),
        201,
      );
    } catch (error) {
      if (
        directKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await prisma.chat.findUnique({
          where: { directKey },
          select: { id: true },
        });
        if (existing) return privateJson(existing);
      }
      throw error;
    }
  });
}
