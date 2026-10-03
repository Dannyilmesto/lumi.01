import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  avatarPresets,
  profileApi,
  profileBody,
  privateJson,
  publicUserSelect,
} from '@/lib/profile-api';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) =>
    privateJson(
      await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { ...publicUserSelect, email: true, createdAt: true },
      }),
    ),
  );
}
export async function PATCH(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(80),
        preset: z.enum(avatarPresets).optional(),
      })
      .parse(await profileBody(request));
    const user = await prisma.$transaction(async (tx) => {
      if (input.preset) await tx.userAvatar.deleteMany({ where: { userId } });
      return tx.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          ...(input.preset
            ? {
                image: `/avatars/${input.preset}.svg`,
                isPresetAvatar: true,
                avatarPreset: input.preset,
              }
            : {}),
        },
        select: { ...publicUserSelect, email: true, createdAt: true },
      });
    });
    return privateJson(user);
  });
}
