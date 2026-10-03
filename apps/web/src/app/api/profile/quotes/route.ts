import { z } from "zod";
import { publicQuoteSnapshot, publicQuoteVersion } from "@/lib/public-quote";
import { prisma } from "@/lib/prisma";
import { isApprovedQuoteStatus } from "@/lib/quote-status";
import {
  idSchema,
  pagination,
  profileApi,
  profileBody,
  ProfileError,
  privateJson,
} from "@/lib/profile-api";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const url = new URL(request.url);
    const page = pagination(url);
    const available = url.searchParams.get("available") === "1";
    const archived = url.searchParams.get("archived") === "1";
    const trash = url.searchParams.get("trash") === "1";
    const preview = url.searchParams.get("preview");
    if (preview) {
      const quote = await prisma.quote.findFirst({
        where: {
          id: preview,
          deletedAt: null,
          organization: { members: { some: { userId } } },
        },
        include: {
          items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          organization: {
            select: { members: { where: { userId }, select: { role: true } } },
          },
        },
      });
      if (!quote) throw new ProfileError("Preventivo non disponibile.", 404);
      if (
        quote.createdByUserId !== userId &&
        !quote.organization.members.some((member) =>
          ["owner", "admin"].includes(member.role.toLowerCase()),
        )
      )
        throw new ProfileError("Non puoi pubblicare questo preventivo.", 403);
      const snapshot = publicQuoteSnapshot(quote);
      return privateJson({
        ...snapshot,
        id: quote.id,
        version: publicQuoteVersion(snapshot),
      });
    }
    const q = (url.searchParams.get("q") || "").slice(0, 100);
    const quotes = await prisma.quote.findMany({
      where: {
        deletedAt: trash ? { not: null } : null,
        organization: { members: { some: { userId } } },
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                {
                  customer: {
                    name: { contains: q, mode: "insensitive" as const },
                  },
                },
              ],
            }
          : {}),
        ...(trash
          ? {}
          : available
            ? { savedBy: { some: {} } }
            : {
                savedBy: {
                  some: {
                    userId,
                    archivedAt: archived ? { not: null } : null,
                  },
                },
              }),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: page.take,
      skip: page.skip,
      include: {
        organization: {
          select: {
            name: true,
            members: { where: { userId }, select: { role: true } },
          },
        },
        customer: { select: { name: true, email: true, phone: true } },
        items: {
          select: {
            description: true,
            quantity: true,
            unit: true,
            unitPrice: true,
            totalPrice: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
        savedBy: { where: { userId } },
        publications: { where: { authorId: userId }, select: { id: true } },
      },
    });
    return privateJson({
      items: quotes.slice(0, page.size).map((quote) => ({
        id: quote.id,
        title: quote.title,
        customerName: quote.customer?.name ?? null,
        customerEmail: quote.customer?.email ?? null,
        customerPhone: quote.customer?.phone ?? null,
        status: quote.status,
        amount: quote.total.toString(),
        shareAmount:
          quote.items.length > 0 &&
          quote.items.every(
            (item) => item.unitPrice !== null && item.totalPrice !== null,
          )
            ? quote.total.toString()
            : null,
        shareItems: quote.items.map((item) => ({
          description: item.description,
          quantity: item.quantity.toString(),
          unit: item.unit,
          totalPrice: item.totalPrice?.toString() ?? null,
        })),
        currency: quote.currency,
        organizationName: quote.organization.name,
        archivedAt: quote.savedBy[0]?.archivedAt ?? null,
        deletedAt: quote.deletedAt?.toISOString() ?? null,
        isPublic: quote.publications.length > 0,
        canShare:
          quote.createdByUserId === userId ||
          quote.organization.members.some((member) =>
            ["owner", "admin"].includes(member.role.toLowerCase()),
          ),
        updatedAt: quote.updatedAt,
      })),
      nextOffset: quotes.length > page.size ? page.offset + page.size : null,
    });
  });
}

export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const {
      quoteIds,
      action,
      confirmPublic,
      confirmDelete,
      confirmProtected,
      versions,
    } = z
      .object({
        quoteIds: z.array(idSchema).min(1).max(20).optional(),
        action: z.enum([
          "save",
          "archive",
          "restore",
          "publish",
          "unpublish",
          "trash",
          "restore-trash",
          "delete",
          "empty-trash",
        ]),
        confirmPublic: z.boolean().optional(),
        confirmDelete: z.boolean().optional(),
        confirmProtected: z.boolean().optional(),
        versions: z.record(z.string(), z.string().length(64)).optional(),
      })
      .parse(await profileBody(request));
    const ids = [...new Set(quoteIds ?? [])];
    if (action !== "empty-trash" && !ids.length)
      throw new ProfileError("Seleziona almeno un preventivo.");
    if ((action === "delete" || action === "empty-trash") && !confirmDelete)
      throw new ProfileError(
        "Conferma esplicitamente l’eliminazione definitiva.",
      );
    // An author may always withdraw their own publication, even after losing workspace access.
    if (action === "unpublish") {
      await prisma.publicQuote.deleteMany({
        where: { authorId: userId, quoteId: { in: ids } },
      });
      return privateJson({ ok: true });
    }
    let permanentlyDeletedCount = 0;
    await prisma.$transaction(
      async (tx) => {
        if (action === "empty-trash") {
          const deletedQuotes = await tx.quote.findMany({
            where: {
              deletedAt: { not: null },
              organization: { members: { some: { userId } } },
            },
            select: {
              id: true,
              status: true,
              createdByUserId: true,
              organization: {
                select: {
                  members: {
                    where: { userId },
                    select: { role: true },
                  },
                },
              },
            },
          });
          const allowedQuotes = deletedQuotes.filter(
            (quote) =>
              quote.createdByUserId === userId ||
              quote.organization.members.some((member) =>
                ["owner", "admin"].includes(member.role.toLowerCase()),
              ),
          );
          if (
            allowedQuotes.some((quote) =>
              isApprovedQuoteStatus(quote.status),
            ) &&
            !confirmProtected
          )
            throw new ProfileError(
              "Il cestino contiene preventivi approvati. Conferma esplicitamente l’eliminazione definitiva.",
              409,
            );
          permanentlyDeletedCount = (
            await tx.quote.deleteMany({
              where: {
                id: { in: allowedQuotes.map((quote) => quote.id) },
                deletedAt: { not: null },
              },
            })
          ).count;
          return;
        }
        const quotes = await tx.quote.findMany({
          where: {
            id: { in: ids },
            deletedAt:
              action === "delete" || action === "restore-trash"
                ? { not: null }
                : null,
            organization: { members: { some: { userId } } },
          },
          include: {
            organization: {
              select: {
                members: { where: { userId }, select: { role: true } },
              },
            },
            items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          },
        });
        if (quotes.length !== ids.length)
          throw new ProfileError(
            "Uno o più preventivi non sono disponibili.",
            404,
          );
        if (
          action === "trash" ||
          action === "restore-trash" ||
          action === "delete"
        ) {
          if (
            quotes.some(
              (quote) =>
                quote.createdByUserId !== userId &&
                !quote.organization.members.some((member) =>
                  ["owner", "admin"].includes(member.role.toLowerCase()),
                ),
            )
          )
            throw new ProfileError(
              "Puoi eliminare definitivamente solo i preventivi creati da te, salvo che tu sia amministratore dell’azienda.",
              403,
            );
          if (
            action === "delete" &&
            quotes.some((quote) => isApprovedQuoteStatus(quote.status)) &&
            !confirmProtected
          )
            throw new ProfileError(
              "La selezione contiene preventivi approvati. Conferma esplicitamente l’eliminazione definitiva.",
              409,
            );
          if (action === "trash") {
            await tx.quote.updateMany({
              where: { id: { in: ids }, deletedAt: null },
              data: { deletedAt: new Date(), deletedByUserId: userId },
            });
            return;
          }
          if (action === "restore-trash") {
            await tx.quote.updateMany({
              where: { id: { in: ids }, deletedAt: { not: null } },
              data: { deletedAt: null, deletedByUserId: null },
            });
            return;
          }
          permanentlyDeletedCount = (
            await tx.quote.deleteMany({
              where: {
                id: { in: ids },
                deletedAt: { not: null },
                organization: { members: { some: { userId } } },
              },
            })
          ).count;
          return;
        }
        if (action === "publish") {
          if (!confirmPublic)
            throw new ProfileError(
              "Conferma la pubblicazione per tutti gli utenti.",
            );
          if (
            quotes.some(
              (quote) =>
                quote.createdByUserId !== userId &&
                !quote.organization.members.some((member) =>
                  ["admin", "owner"].includes(member.role.toLowerCase()),
                ),
            )
          )
            throw new ProfileError(
              "Puoi pubblicare i preventivi creati da te o quelli di un’azienda che amministri.",
              403,
            );
          if (
            quotes.some(
              (quote) =>
                versions?.[quote.id] !==
                publicQuoteVersion(publicQuoteSnapshot(quote)),
            )
          )
            throw new ProfileError(
              "Un preventivo è cambiato. Riapri l’anteprima prima di pubblicare.",
              409,
            );
          if (quotes.some((quote) => quote.items.length > 100))
            throw new ProfileError(
              "La bacheca supporta fino a 100 voci per preventivo.",
            );
        }
        for (const quote of quotes) {
          await tx.savedQuote.upsert({
            where: { userId_quoteId: { userId, quoteId: quote.id } },
            create: {
              userId,
              quoteId: quote.id,
              archivedAt: action === "archive" ? new Date() : null,
            },
            update:
              action === "archive"
                ? { archivedAt: new Date() }
                : action === "restore" || action === "save"
                  ? { archivedAt: null }
                  : {},
          });
          if (action === "publish") {
            const data = publicQuoteSnapshot(quote);
            await tx.publicQuote.upsert({
              where: {
                quoteId_authorId: { quoteId: quote.id, authorId: userId },
              },
              create: { quoteId: quote.id, authorId: userId, ...data },
              update: data,
            });
          }
        }
      },
      { isolationLevel: "Serializable" },
    );
    return privateJson(
      action === "delete" || action === "empty-trash"
        ? { permanentlyDeletedCount }
        : { ok: true },
    );
  });
}
