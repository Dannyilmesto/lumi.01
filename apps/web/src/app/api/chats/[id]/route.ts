import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireChat } from '@/lib/chat-service';
import {
  idSchema,
  profileApi,
  profileBody,
  ProfileError,
  privateJson,
} from '@/lib/profile-api';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return profileApi(request, async ({ userId }) =>
    privateJson(await requireChat((await params).id, userId)),
  );
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return profileApi(request, async ({ userId }) => {
    const { id } = await params;
    const input = z
      .discriminatedUnion('action', [
        z.object({
          action: z.literal('rename'),
          name: z.string().trim().min(1).max(80),
        }),
        z.object({
          action: z.literal('add'),
          memberIds: z.array(idSchema).min(1).max(19),
        }),
        z.object({ action: z.literal('remove'), userId: idSchema }),
        z.object({ action: z.literal('leave') }),
      ])
      .parse(await profileBody(request));
    await prisma.$transaction(
      async (tx) => {
        const chat = await tx.chat.findFirst({
          where: { id, members: { some: { userId } } },
          include: { members: { orderBy: { joinedAt: 'asc' } } },
        });
        if (!chat || chat.type !== 'group')
          throw new ProfileError('Gruppo non disponibile.', 404);
        if (input.action !== 'leave' && chat.createdById !== userId)
          throw new ProfileError(
            'Solo il responsabile del gruppo può gestire i partecipanti.',
            403,
          );
        // Serialize membership changes and message sends against the same chat row.
        await tx.chat.update({
          where: { id },
          data: { lastMessageAt: chat.lastMessageAt },
        });
        if (input.action === 'rename')
          await tx.chat.update({ where: { id }, data: { name: input.name } });
        if (input.action === 'add') {
          const ids = [...new Set(input.memberIds)].filter(
            (id) => !chat.members.some((member) => member.userId === id),
          );
          if (chat.members.length + ids.length > 20)
            throw new ProfileError(
              'Un gruppo può contenere fino a 20 partecipanti.',
            );
          if (
            (await tx.user.count({
              where: { id: { in: ids }, emailVerified: true },
            })) !== ids.length
          )
            throw new ProfileError('Utenti non disponibili.', 404);
          await tx.chatMember.createMany({
            data: ids.map((userId) => ({ chatId: id, userId })),
            skipDuplicates: true,
          });
        }
        if (input.action === 'remove') {
          if (input.userId === userId)
            throw new ProfileError(
              'Usa “Esci dal gruppo” per lasciare la conversazione.',
            );
          await tx.chatMember.deleteMany({
            where: { chatId: id, userId: input.userId },
          });
        }
        if (input.action === 'leave') {
          await tx.chatMember.deleteMany({ where: { chatId: id, userId } });
          const remaining = chat.members.filter(
            (member) => member.userId !== userId,
          );
          if (!remaining.length) await tx.chat.delete({ where: { id } });
          else if (chat.createdById === userId)
            await tx.chat.update({
              where: { id },
              data: { createdById: remaining[0].userId },
            });
        }
      },
      { isolationLevel: 'Serializable' },
    );
    return privateJson({ ok: true });
  });
}
