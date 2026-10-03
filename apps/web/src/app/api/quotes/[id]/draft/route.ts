import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "Accedi per continuare." }, { status: 401 });

  const { id } = await params;
  const draft = await prisma.quote.findFirst({
    where: {
      id,
      createdByUserId: session.user.id,
      deletedAt: null,
      status: "DRAFT",
      savedBy: { none: {} },
      publications: { none: {} },
      organization: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true },
  });
  if (!draft) return Response.json({ deleted: false });

  await prisma.quote.delete({ where: { id: draft.id } });
  return Response.json({ deleted: true });
}
