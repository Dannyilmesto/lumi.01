import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { QuoteDocumentEditor } from "@/components/quote-document-editor";
import type { CatalogProduct } from "@/lib/product-calculator";
import {
  initialQuoteDocument,
  quoteItemsHtml,
  readDocumentSettings,
} from "@/lib/quote-document";

export default async function QuoteDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const { id } = await params;
  const quote = await prisma.quote.findFirst({
    where: {
      id,
      deletedAt: null,
      organization: { members: { some: { userId: session.user.id } } },
    },
    include: {
      organization: { select: { name: true } },
      customer: true,
      items: { orderBy: { createdAt: "asc" } },
      document: true,
      savedBy: { where: { userId: session.user.id }, select: { id: true } },
    },
  });
  if (!quote) notFound();
  const catalogProducts = await prisma.quoteCatalogProduct.findMany({
    where: { organizationId: quote.organizationId },
    select: {
      id: true,
      name: true,
      pricingMode: true,
      price: true,
      minimumBillableArea: true,
    },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });
  const template = initialQuoteDocument(quote);
  return (
    <main className="qe-page">
      <QuoteDocumentEditor
        key={quote.id}
        quoteId={quote.id}
        catalogProducts={catalogProducts.map((product): CatalogProduct => ({
          id: product.id,
          name: product.name,
          pricingMode: product.pricingMode,
          price: product.price.toString(),
          minimumBillableArea: product.minimumBillableArea?.toString() ?? null,
        }))}
        initiallySaved={quote.savedBy.length > 0}
        initial={{
          title: quote.title,
          status: quote.status,
          html: quote.document?.html ?? template.html,
          settings: quote.document
            ? readDocumentSettings(quote.document.settings)
            : template.settings,
          revision: quote.document?.revision ?? 0,
          updatedAt: quote.document?.updatedAt.toISOString() ?? null,
          templateHtml: template.html,
          itemsHtml: quoteItemsHtml(quote),
        }}
      />
    </main>
  );
}
