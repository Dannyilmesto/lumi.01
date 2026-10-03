import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  chatMessageInclude,
  messageJson,
  requireChat,
} from '@/lib/chat-service';
import {
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
  return profileApi(request, async ({ userId }) => {
    const { id } = await params;
    await requireChat(id, userId);
    const before = new URL(request.url).searchParams.get('before');
    if (before && !/^\d{1,18}$/.test(before))
      throw new ProfileError('Posizione non valida.');
    const messages = await prisma.chatMessage.findMany({
      where: {
        chatId: id,
        chat: { members: { some: { userId } } },
        ...(before ? { sequence: { lt: BigInt(before) } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: 51,
      include: chatMessageInclude,
    });
    const selected = messages.slice(0, 50).reverse();
    return privateJson({
      items: selected.map(messageJson),
      hasMore: messages.length > 50,
    });
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return profileApi(request, async ({ userId }) => {
    const { id } = await params;
    const input = z
      .object({
        text: z.string().trim().min(1).max(5000),
        clientId: z.string().uuid(),
      })
      .parse(await profileBody(request));
    const message = await prisma.$transaction(async (tx) => {
      const chat = await tx.chat.updateMany({
        where: { id, members: { some: { userId } } },
        data: { lastMessageAt: new Date() },
      });
      if (!chat.count)
        throw new ProfileError('Conversazione non disponibile.', 404);
      if (
        !(await tx.chatMember.findUnique({
          where: { chatId_userId: { chatId: id, userId } },
        }))
      )
        throw new ProfileError('Non fai più parte della conversazione.', 403);
      const existing = await tx.chatMessage.findUnique({
        where: { chatId_clientId: { chatId: id, clientId: input.clientId } },
        include: chatMessageInclude,
      });
      if (existing) {
        if (existing.senderId !== userId)
          throw new ProfileError('Identificatore messaggio non valido.');
        return existing;
      }
      return tx.chatMessage.create({
        data: { chatId: id, senderId: userId, ...input },
        include: chatMessageInclude,
      });
    });
    return privateJson(messageJson(message), 201);
  });
}
