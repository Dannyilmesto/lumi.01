import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  idSchema,
  profileApi,
  profileBody,
  ProfileError,
  privateJson,
} from '@/lib/profile-api';
export const runtime = 'nodejs';
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  });
const eventInput = z.object({
  title: z.string().trim().min(1).max(160),
  date: day,
  assignedUserId: idSchema.optional(),
  time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .default(null),
  description: z.string().max(5000).default(''),
  kind: z.enum(['event', 'deadline', 'note']).default('event'),
  completed: z.boolean().default(false),
});

async function calendarContext(userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      organizationId: true,
      organization: {
        select: {
          members: {
            orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
            select: { user: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  const members = membership
    ? membership.organization.members.map(({ user }) => user)
    : await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true },
      }).then((user) => [user]);
  const colors = new Map(
    members.map((member, index) => [
      member.id,
      `hsl(${(index * 360) / members.length} 68% 52%)`,
    ]),
  );
  return { membership, members, colors };
}

function calendarScope(userId: string, organizationId: string | undefined) {
  return organizationId
    ? {
        OR: [
          { organizationId },
          { organizationId: null, userId },
        ],
      }
    : { userId };
}

async function validateAssignee(
  assignedUserId: string,
  userId: string,
  organizationId: string | undefined,
) {
  const member = organizationId
    ? await prisma.membership.findUnique({
        where: {
          organizationId_userId: { organizationId, userId: assignedUserId },
        },
        select: { userId: true },
      })
    : assignedUserId === userId
      ? { userId }
      : null;
  if (!member) throw new ProfileError('L’utente selezionato non appartiene alla tua azienda.', 403);
}

export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const url = new URL(request.url);
    const month = z
      .string()
      .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
      .parse(url.searchParams.get('month'));
    const { membership, members, colors } = await calendarContext(userId);
    const items = await prisma.calendarEvent.findMany({
      where: {
        ...calendarScope(userId, membership?.organizationId),
        date: { startsWith: month },
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
      take: 1001,
      include: {
        user: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
      },
    });
    return privateJson({
      items: items.slice(0, 1000).map((event) => {
        const assignedUser = event.assignedUser ?? event.user;
        return {
          ...event,
          assignedUserId: assignedUser.id,
          assignedUser: {
            ...assignedUser,
            color: colors.get(assignedUser.id) ?? 'hsl(210 68% 52%)',
          },
          canManage:
            event.userId === userId || event.assignedUserId === userId,
          user: undefined,
        };
      }),
      members: members.map((member) => ({
        ...member,
        color: colors.get(member.id) ?? 'hsl(210 68% 52%)',
      })),
      currentUserId: userId,
      shared: Boolean(membership),
      limited: items.length > 1000,
    });
  });
}
export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const data = eventInput.parse(await profileBody(request));
    const { membership } = await calendarContext(userId);
    const assignedUserId = data.assignedUserId ?? userId;
    await validateAssignee(assignedUserId, userId, membership?.organizationId);
    const event = await prisma.calendarEvent.create({
      data: {
        ...data,
        assignedUserId,
        organizationId: membership?.organizationId,
        userId,
      },
    });
    return privateJson(event, 201);
  });
}
export async function PATCH(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { id, ...data } = eventInput
      .extend({ id: idSchema })
      .parse(await profileBody(request));
    const { membership } = await calendarContext(userId);
    const existing = await prisma.calendarEvent.findFirst({
      where: {
        id,
        AND: [
          calendarScope(userId, membership?.organizationId),
          { OR: [{ userId }, { assignedUserId: userId }] },
        ],
      },
      select: { assignedUserId: true, userId: true },
    });
    if (!existing) throw new ProfileError('Evento non disponibile.', 404);
    const assignedUserId =
      data.assignedUserId ?? existing.assignedUserId ?? existing.userId;
    await validateAssignee(assignedUserId, userId, membership?.organizationId);
    const result = await prisma.calendarEvent.updateMany({
      where: { id, userId: existing.userId },
      data: { ...data, assignedUserId },
    });
    if (!result.count) throw new ProfileError('Evento non disponibile.', 404);
    return privateJson({ ok: true });
  });
}
export async function DELETE(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { id } = z.object({ id: idSchema }).parse(await profileBody(request));
    const { membership } = await calendarContext(userId);
    const existing = await prisma.calendarEvent.findFirst({
      where: {
        id,
        AND: [
          calendarScope(userId, membership?.organizationId),
          { OR: [{ userId }, { assignedUserId: userId }] },
        ],
      },
      select: { userId: true },
    });
    if (!existing) throw new ProfileError('Evento non disponibile.', 404);
    const result = await prisma.calendarEvent.deleteMany({
      where: { id, userId: existing.userId },
    });
    if (!result.count) throw new ProfileError('Evento non disponibile.', 404);
    return privateJson({ ok: true });
  });
}
