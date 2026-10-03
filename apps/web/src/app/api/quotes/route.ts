import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isApprovedQuoteStatus } from "@/lib/quote-status";

export const runtime = "nodejs";

const createQuoteSchema = z.object({
  organizationId: z.string().min(1).max(128).optional(),
  customerId: z.string().min(1).max(128).optional(),
  saveToProfile: z.boolean().default(true),
});

const changeQuotesSchema = z.object({
  organizationId: z.string().min(1).max(128),
  quoteIds: z.array(z.string().min(1).max(128)).min(1).max(100).optional(),
  emptyTrash: z.boolean().optional(),
  permanent: z.boolean().optional(),
  confirmPermanent: z.boolean().optional(),
  confirmProtected: z.boolean().optional(),
  adminOverride: z.boolean().optional(),
});

async function authorizeQuoteChange(request: Request, body: unknown) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return {
      response: Response.json(
        { error: "Accedi per continuare." },
        { status: 401 },
      ),
    };
  }
  const parsed = changeQuotesSchema.safeParse(body);
  if (!parsed.success) {
    return {
      response: Response.json(
        { error: "Selezione preventivi non valida." },
        { status: 400 },
      ),
    };
  }
  if (!parsed.data.quoteIds?.length && !parsed.data.emptyTrash) {
    return {
      response: Response.json(
        { error: "Seleziona almeno un preventivo." },
        { status: 400 },
      ),
    };
  }
  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      organizationId: parsed.data.organizationId,
    },
    select: { organizationId: true, role: true },
  });
  if (!membership) {
    return {
      response: Response.json(
        { error: "Azienda non disponibile per questo utente." },
        { status: 404 },
      ),
    };
  }
  if (
    parsed.data.adminOverride &&
    !["admin", "owner"].includes(membership.role.toLowerCase())
  ) {
    return {
      response: Response.json(
        { error: "Solo un amministratore può usare l’override." },
        { status: 403 },
      ),
    };
  }
  return { session, membership, data: parsed.data };
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const authorized = await authorizeQuoteChange(request, body);
  if ("response" in authorized) return authorized.response;
  const { membership, session, data } = authorized;
  const quoteIds = [...new Set(data.quoteIds ?? [])];
  if (data.permanent && !data.confirmPermanent) {
    return Response.json(
      { error: "Conferma esplicitamente l’eliminazione definitiva." },
      { status: 400 },
    );
  }
  if (data.emptyTrash) {
    const isAdmin = ["admin", "owner"].includes(membership.role.toLowerCase());
    if (!isAdmin)
      return Response.json(
        { error: "Solo un amministratore può svuotare il cestino aziendale." },
        { status: 403 },
      );
    if (!data.permanent)
      return Response.json(
        {
          error: "Lo svuotamento del cestino richiede eliminazione definitiva.",
        },
        { status: 400 },
      );
    const trashedQuotes = await prisma.quote.findMany({
      where: {
        organizationId: membership.organizationId,
        deletedAt: { not: null },
      },
      select: { id: true, status: true },
    });
    if (
      trashedQuotes.some((quote) => isApprovedQuoteStatus(quote.status)) &&
      !data.confirmProtected
    )
      return Response.json(
        {
          error:
            "Il cestino contiene preventivi approvati. Conferma la loro eliminazione.",
          requiresConfirmation: true,
        },
        { status: 409 },
      );
    const result = await prisma.quote.deleteMany({
      where: {
        organizationId: membership.organizationId,
        deletedAt: { not: null },
      },
    });
    return Response.json({ permanentlyDeletedCount: result.count });
  }
  const quotes = await prisma.quote.findMany({
    where: {
      id: { in: quoteIds },
      organizationId: membership.organizationId,
      deletedAt: data.permanent ? { not: null } : null,
    },
    select: { id: true, status: true, createdByUserId: true },
  });
  if (quotes.length !== quoteIds.length) {
    return Response.json(
      { error: "Uno o più preventivi non sono disponibili." },
      { status: 404 },
    );
  }

  const protectedIds = quotes
    .filter((quote) => isApprovedQuoteStatus(quote.status))
    .map((quote) => quote.id);
  const hasAdminOverride =
    data.adminOverride &&
    ["admin", "owner"].includes(membership.role.toLowerCase());
  const isAdmin = ["admin", "owner"].includes(membership.role.toLowerCase());
  if (
    data.permanent &&
    quotes.some(
      (quote) => quote.createdByUserId !== session.user.id && !isAdmin,
    )
  ) {
    return Response.json(
      {
        error:
          "Puoi eliminare definitivamente solo i preventivi creati da te, salvo che tu sia amministratore dell’azienda.",
      },
      { status: 403 },
    );
  }
  if (protectedIds.length && !data.confirmProtected && !hasAdminOverride) {
    return Response.json(
      {
        error:
          "La selezione contiene preventivi approvati. Conferma esplicitamente l’eliminazione o usa l’override amministrativo.",
        requiresConfirmation: true,
        protectedQuoteIds: protectedIds,
      },
      { status: 409 },
    );
  }

  if (data.permanent) {
    const result = await prisma.quote.deleteMany({
      where: {
        id: { in: quoteIds },
        organizationId: membership.organizationId,
        deletedAt: { not: null },
      },
    });
    return Response.json({ permanentlyDeletedCount: result.count });
  }

  const result = await prisma.quote.updateMany({
    where: {
      id: { in: quoteIds },
      organizationId: membership.organizationId,
      deletedAt: null,
    },
    data: { deletedAt: new Date(), deletedByUserId: session.user.id },
  });
  return Response.json({ deletedCount: result.count });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const authorized = await authorizeQuoteChange(request, body);
  if ("response" in authorized) return authorized.response;
  const { membership, data } = authorized;
  const quoteIds = [...new Set(data.quoteIds)];
  const available = await prisma.quote.count({
    where: {
      id: { in: quoteIds },
      organizationId: membership.organizationId,
      deletedAt: { not: null },
    },
  });
  if (available !== quoteIds.length) {
    return Response.json(
      { error: "Uno o più preventivi eliminati non sono disponibili." },
      { status: 404 },
    );
  }
  const result = await prisma.quote.updateMany({
    where: {
      id: { in: quoteIds },
      organizationId: membership.organizationId,
      deletedAt: { not: null },
    },
    data: { deletedAt: null, deletedByUserId: null },
  });
  return Response.json({ restoredCount: result.count });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json(
      { error: "Accedi per creare un preventivo." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Azienda non valida." }, { status: 400 });
  }

  let membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      ...(parsed.data.organizationId
        ? { organizationId: parsed.data.organizationId }
        : {}),
    },
    select: { organizationId: true },
    orderBy: { createdAt: "asc" },
  });
  if (parsed.data.organizationId && !membership) {
    return Response.json(
      { error: "Azienda non disponibile per questo utente." },
      { status: 404 },
    );
  }

  if (!membership) {
    membership = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.membership.findFirst({
        where: { userId: session.user.id },
        select: { organizationId: true },
        orderBy: { createdAt: "asc" },
      });
      if (existing) return existing;
      const organization = await transaction.organization.create({
        data: {
          name: "Spazio personale",
          slug: `spazio-personale-${randomUUID().slice(0, 12)}`,
        },
        select: { id: true },
      });
      return transaction.membership.create({
        data: {
          userId: session.user.id,
          organizationId: organization.id,
          role: "owner",
        },
        select: { organizationId: true },
      });
    });
  }

  let customerId: string | undefined;
  if (parsed.data.customerId) {
    const customer = await prisma.customer.findFirst({
      where: {
        id: parsed.data.customerId,
        organizationId: membership.organizationId,
      },
      select: { id: true },
    });
    if (!customer) {
      return Response.json(
        { error: "Contatto non disponibile per questa azienda." },
        { status: 404 },
      );
    }
    customerId = customer.id;
  }

  const quote = await prisma.quote.create({
    data: {
      organizationId: membership.organizationId,
      ...(customerId ? { customerId } : {}),
      createdByUserId: session.user.id,
      ...(parsed.data.saveToProfile
        ? { savedBy: { create: { userId: session.user.id } } }
        : {}),
      messages: {
        create: {
          role: "ASSISTANT",
          content:
            "Ciao, descrivimi il preventivo. Puoi dettare oppure scrivere quantità, prodotti, misure e finiture.",
        },
      },
    },
    select: { id: true },
  });

  return Response.json({ quoteId: quote.id }, { status: 201 });
}
