import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ProfileError, publicUserSelect } from '@/lib/profile-api';
export const chatMessageInclude = {
  sender: { select: publicUserSelect },
} as const;
export function messageJson(
  message: Prisma.ChatMessageGetPayload<{ include: typeof chatMessageInclude }>,
) {
  return { ...message, sequence: message.sequence.toString() };
}
export async function requireChat(chatId: string, userId: string) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, members: { some: { userId } } },
    include: {
      members: { select: { userId: true, user: { select: publicUserSelect } } },
    },
  });
  if (!chat) throw new ProfileError('Conversazione non disponibile.', 404);
  return chat;
}
