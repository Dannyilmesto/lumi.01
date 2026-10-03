import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  profileApi,
  profileBody,
  privateJson,
  ProfileError,
} from '@/lib/profile-api';

export const runtime = 'nodejs';
type Field = { id: string; label: string; value: string };
const input = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().max(2000),
});

export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) =>
    privateJson({
      items: await prisma.$queryRaw<Field[]>`
    SELECT "id", "label", "value" FROM "UserProfileField" WHERE "userId" = ${userId} ORDER BY "label" ASC
  `,
    }),
  );
}

export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { label, value } = input.parse(await profileBody(request));
    const count = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*)::bigint AS count FROM "UserProfileField" WHERE "userId" = ${userId}`;
    if (count[0].count >= 50n)
      throw new ProfileError('Il profilo può contenere fino a 50 campi.', 400);
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO "UserProfileField" ("id", "userId", "label", "value", "updatedAt") VALUES (${id}, ${userId}, ${label}, ${value}, NOW())`;
    return privateJson({ id, label, value }, 201);
  });
}

export async function PATCH(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { id, label, value } = input
      .extend({ id: z.string().min(1).max(128) })
      .parse(await profileBody(request));
    const changed =
      await prisma.$executeRaw`UPDATE "UserProfileField" SET "label" = ${label}, "value" = ${value}, "updatedAt" = NOW() WHERE "id" = ${id} AND "userId" = ${userId}`;
    if (!changed) throw new ProfileError('Campo non disponibile.', 404);
    return privateJson({ ok: true });
  });
}

export async function DELETE(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { id } = z
      .object({ id: z.string().min(1).max(128) })
      .parse(await profileBody(request));
    const changed =
      await prisma.$executeRaw`DELETE FROM "UserProfileField" WHERE "id" = ${id} AND "userId" = ${userId}`;
    if (!changed) throw new ProfileError('Campo non disponibile.', 404);
    return privateJson({ ok: true });
  });
}
