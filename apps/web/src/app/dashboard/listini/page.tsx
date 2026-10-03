import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CreateOrganizationForm } from "../create-organization-form";
import { UploadPriceListForm } from "./upload-price-list-form";

const statusLabels = {
  UPLOADED: "Caricato",
  PROCESSING: "In analisi",
  NEEDS_REVIEW: "Da verificare",
  ACTIVE: "Attivo",
  ARCHIVED: "Archiviato",
  FAILED: "Analisi non riuscita",
} as const;

type PriceListStatus = keyof typeof statusLabels;

export default async function PriceListsPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  const { organizationId: requestedOrganizationId } = await searchParams;
  const memberships = await prisma.membership.findMany({
    where: { userId: session.user.id },
    select: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-5 py-10 sm:px-8">
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold">Prima crea la tua azienda</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            I listini sono privati e associati allo spazio di lavoro della tua
            azienda.
          </p>
          <div className="max-w-lg">
            <CreateOrganizationForm />
          </div>
        </section>
      </main>
    );
  }

  const selectedMembership =
    memberships.find(
      ({ organization }) => organization.id === requestedOrganizationId,
    ) ?? memberships[0];
  const organization = selectedMembership.organization;

  const priceLists = await prisma.priceList.findMany({
    where: { supplier: { organizationId: organization.id } },
    include: {
      supplier: { select: { name: true } },
      _count: { select: { candidates: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="border-b border-slate-200 pb-5">
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
          {organization.name}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Listini PDF
        </h1>
      </div>

      {memberships.length > 1 && (
        <nav aria-label="Azienda" className="mt-6 flex flex-wrap gap-2">
          {memberships.map(({ organization: item }) => (
            <Link
              key={item.id}
              href={`/dashboard/listini?organizationId=${encodeURIComponent(item.id)}`}
              aria-current={item.id === organization.id ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-sm font-medium ${item.id === organization.id ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
          <h2 className="text-xl font-semibold">Carica un nuovo listino</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Il PDF originale viene archiviato separatamente dai dati e resta
            accessibile solo ai membri della tua azienda. Massimo 30 MB. Il
            contenuto non viene scansionato al caricamento: chiedi a Lumi di
            leggerlo dalla chat quando ti serve.
          </p>
          <UploadPriceListForm organizationId={organization.id} />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Archivio</h2>
              <p className="mt-1 text-sm text-slate-500">
                {priceLists.length === 1
                  ? "1 listino salvato"
                  : `${priceLists.length} listini salvati`}
              </p>
            </div>
          </div>

          {priceLists.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center">
              <p className="font-medium text-slate-800">
                Il tuo archivio è vuoto
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Carica il primo PDF per conservarlo in questo spazio aziendale.
              </p>
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-slate-100 rounded-2xl border border-slate-200">
              {priceLists.map((priceList) => (
                <li
                  key={priceList.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {priceList.name}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {priceList.supplier.name} · versione {priceList.version}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Caricato il{" "}
                      {priceList.createdAt.toLocaleDateString("it-IT")} ·
                      SHA-256 {priceList.sha256.slice(0, 12)}…
                    </p>
                    {priceList._count.candidates > 0 && (
                      <p className="mt-1 text-xs font-medium text-slate-600">
                        {priceList._count.candidates} candidati estratti
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                      {statusLabels[priceList.status as PriceListStatus]}
                    </span>
                    {(priceList.status === "NEEDS_REVIEW" ||
                      priceList._count.candidates > 0) && (
                      <Link
                        href={`/dashboard/listini/${encodeURIComponent(priceList.id)}`}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Apri revisione
                      </Link>
                    )}
                    <a
                      href={`/api/price-lists/${encodeURIComponent(priceList.id)}/original`}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Scarica PDF
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
