import { prisma } from '@/lib/prisma';
import {
  chatMessageInclude,
  messageJson,
  requireChat,
} from '@/lib/chat-service';
import { profileApi, ProfileError } from '@/lib/profile-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return profileApi(request, async (session) => {
    const { id } = await params;
    await requireChat(id, session.userId);
    const cursor =
      request.headers.get('last-event-id') ||
      new URL(request.url).searchParams.get('after') ||
      '0';
    if (!/^\d{1,18}$/.test(cursor))
      throw new ProfileError('Posizione non valida.');
    let last = BigInt(cursor);
    let cancelled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (text: string) => {
          if (!cancelled && !request.signal.aborted)
            controller.enqueue(encoder.encode(text));
        };
        try {
          send('retry: 2000\n\n');
          const deadline = Date.now() + 28000;
          for (
            let turn = 0;
            turn < 15 &&
            Date.now() < deadline &&
            !cancelled &&
            !request.signal.aborted;
            turn++
          ) {
            const [member, activeSession] = await Promise.all([
              prisma.chatMember.findUnique({
                where: {
                  chatId_userId: { chatId: id, userId: session.userId },
                },
                select: { id: true },
              }),
              prisma.session.findFirst({
                where: {
                  id: session.sessionId,
                  userId: session.userId,
                  expiresAt: { gt: new Date() },
                },
                select: { id: true },
              }),
            ]);
            if (!member || !activeSession) {
              send('event: revoked\ndata: {}\n\n');
              break;
            }
            const messages = await prisma.chatMessage.findMany({
              where: {
                chatId: id,
                chat: { members: { some: { userId: session.userId } } },
                sequence: { gt: last },
              },
              orderBy: { sequence: 'asc' },
              take: 100,
              include: chatMessageInclude,
            });
            for (const message of messages) {
              last = message.sequence;
              send(
                `id: ${last}\ndata: ${JSON.stringify(messageJson(message))}\n\n`,
              );
            }
            send(': heartbeat\n\n');
            if (messages.length === 100) {
              turn--;
              continue;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch {
          send('event: retrying\ndata: {}\n\n');
        } finally {
          if (!cancelled && !request.signal.aborted) controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'private, no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  });
}
