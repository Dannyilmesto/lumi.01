import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NewQuoteButton } from "./new-quote-button";
import { QuoteManagement } from "./quote-management";

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string; view?: string }>;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  const memberships = await prisma.membership.findMany({
    where: { userId: session.user.id },
    select: {
      role: true,
      organization: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) redirect("/dashboard");

  const { organizationId, view } = await searchParams;
  const trashMode = view === "cestino";
  const membership =
    memberships.find((item) => item.organization.id === organizationId) ??
    memberships[0];
  const organization = membership.organization;
  const quotes = await prisma.quote.findMany({
    where: {
      organizationId: organization.id,
      deletedAt: trashMode ? { not: null } : null,
      ...(!trashMode ? { savedBy: { some: {} } } : {}),
    },
    select: {
      id: true,
      title: true,
      createdByUserId: true,
      status: true,
      updatedAt: true,
      deletedAt: true,
      currency: true,
      total: true,
      customer: { select: { name: true, email: true, phone: true } },
      items: {
        select: {
          description: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
        },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { items: true, messages: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="mb-6 border-b border-slate-200 pb-5">
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
          {organization.name}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Preventivi
        </h1>
      </div>

      <nav aria-label="Archivio preventivi" className="flex gap-2">
        <Link
          href={
            "/dashboard/preventivi?organizationId=" +
            encodeURIComponent(organization.id)
          }
          aria-current={!trashMode ? "page" : undefined}
          className={
            "rounded-full px-4 py-2 text-sm font-medium " +
            (!trashMode
              ? "bg-slate-900 text-white"
              : "border border-slate-300 bg-white text-slate-700")
          }
        >
          Attivi
        </Link>
        <Link
          href={
            "/dashboard/preventivi?organizationId=" +
            encodeURIComponent(organization.id) +
            "&view=cestino"
          }
          aria-current={trashMode ? "page" : undefined}
          className={
            "rounded-full px-4 py-2 text-sm font-medium " +
            (trashMode
              ? "bg-slate-900 text-white"
              : "border border-slate-300 bg-white text-slate-700")
          }
        >
          Cestino
        </Link>
      </nav>

      {memberships.length > 1 && (
        <nav aria-label="Azienda" className="mt-6 flex flex-wrap gap-2">
          {memberships.map(({ organization: item }) => (
            <Link
              key={item.id}
              href={
                "/dashboard/preventivi?organizationId=" +
                encodeURIComponent(item.id)
              }
              aria-current={item.id === organization.id ? "page" : undefined}
              className={
                "rounded-full px-4 py-2 text-sm font-medium " +
                (item.id === organization.id
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
              }
            >
              {item.name}
            </Link>
          ))}
        </nav>
      )}

      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              {trashMode ? "Preventivi eliminati" : "Richieste e bozze"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {trashMode
                ? "Gli elementi qui restano recuperabili e possono essere ripristinati."
                : "Dettagli raccolti dall’assistente. Gli importi restano vuoti finché non provengono da un listino verificato."}
            </p>
          </div>
          {!trashMode && <NewQuoteButton organizationId={organization.id} />}
        </div>

        <div className="mt-6">
          <QuoteManagement
            organizationId={organization.id}
            trashMode={trashMode}
            canEmptyTrash={["admin", "owner"].includes(
              membership.role.toLowerCase(),
            )}
            quotes={quotes.map((quote) => ({
              id: quote.id,
              title: quote.title,
              status: quote.status,
              updatedAt: quote.updatedAt.toISOString(),
              deletedAt: quote.deletedAt?.toISOString() ?? null,
              customerName: quote.customer?.name ?? "Cliente da assegnare",
              customerEmail: quote.customer?.email ?? null,
              customerPhone: quote.customer?.phone ?? null,
              currency: quote.currency,
              total:
                quote.items.length > 0 &&
                quote.items.every(
                  (item) =>
                    item.unitPrice !== null && item.totalPrice !== null,
                )
                  ? quote.total.toString()
                  : null,
              items: quote.items.map((item) => ({
                description: item.description,
                quantity: item.quantity.toString(),
                totalPrice: item.totalPrice?.toString() ?? null,
              })),
              itemCount: quote._count.items,
              messageCount: quote._count.messages,
              canRename:
                quote.createdByUserId === session.user.id ||
                ["admin", "owner"].includes(membership.role.toLowerCase()),
            }))}
          />
        </div>
      </section>
    </main>
  );
}
