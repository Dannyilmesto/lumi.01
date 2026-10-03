import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const titleSchema = z.object({
  title: z.string().trim().min(1).max(160),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "Accedi per continuare." }, { status: 401 });

  const parsed = titleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Inserisci un nome da 1 a 160 caratteri." },
      { status: 400 },
    );

  const { id } = await params;
  const quote = await prisma.quote.findFirst({
    where: {
      id,
      deletedAt: null,
      organization: { members: { some: { userId: session.user.id } } },
    },
    select: {
      id: true,
      createdByUserId: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id },
            select: { role: true },
          },
        },
      },
    },
  });
  if (!quote)
    return Response.json(
      { error: "Preventivo non disponibile." },
      { status: 404 },
    );

  const canRename =
    quote.createdByUserId === session.user.id ||
    quote.organization.members.some((member) =>
      ["admin", "owner"].includes(member.role.toLowerCase()),
    );
  if (!canRename)
    return Response.json(
      { error: "Non hai i permessi per rinominare questo preventivo." },
      { status: 403 },
    );

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: { title: parsed.data.title },
    select: { title: true },
  });
  return Response.json({ title: updated.title });
}
