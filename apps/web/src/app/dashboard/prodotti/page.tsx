import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CreateOrganizationForm } from "../create-organization-form";
import { ProductManagement } from "./product-management";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  const memberships = await prisma.membership.findMany({
    where: { userId: session.user.id },
    select: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const { organizationId: requestedOrganizationId } = await searchParams;

  if (memberships.length === 0) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-5 py-10 sm:px-8">
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold">Prima crea la tua azienda</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Il catalogo prodotti è condiviso con i membri dello spazio aziendale
            e viene usato per calcolare i preventivi.
          </p>
          <div className="max-w-lg">
            <CreateOrganizationForm />
          </div>
        </section>
      </main>
    );
  }

  const membership =
    memberships.find(
      ({ organization }) => organization.id === requestedOrganizationId,
    ) ?? memberships[0];
  const organization = membership.organization;
  const products = await prisma.quoteCatalogProduct.findMany({
    where: { organizationId: organization.id },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="border-b border-slate-200 pb-5">
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
          {organization.name}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Prodotti</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Crea un catalogo aziendale con prodotti a prezzo al metro quadrato o a
          prezzo fisso. Sarà disponibile nel calcolatore dei preventivi.
        </p>
      </header>

      {memberships.length > 1 && (
        <nav aria-label="Azienda" className="mt-6 flex flex-wrap gap-2">
          {memberships.map(({ organization: item }) => (
            <Link
              key={item.id}
              href={`/dashboard/prodotti?organizationId=${encodeURIComponent(item.id)}`}
              aria-current={item.id === organization.id ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-sm font-medium ${item.id === organization.id ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-8">
        <ProductManagement
          organizationId={organization.id}
          initialProducts={products.map((product) => ({
            id: product.id,
            name: product.name,
            pricingMode: product.pricingMode,
            price: product.price.toString(),
            minimumBillableArea:
              product.minimumBillableArea?.toString() ?? null,
          }))}
        />
      </div>
    </main>
  );
}
