import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLLMProvider } from "@/lib/llm/llama-cpp-provider";
import { QuoteAssistant } from "../quote-assistant";

function jsonRecord(value: Prisma.JsonValue): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
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
      customer: { select: { name: true } },
      messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      items: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!quote) notFound();

  const priceLists = await prisma.priceList.findMany({
    where: {
      supplier: { organizationId: quote.organizationId },
      status: { in: ["NEEDS_REVIEW", "ACTIVE"] },
    },
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
      extractionSummary: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const messages = quote.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    sources: Array.isArray(message.sources)
      ? message.sources.flatMap((source) => {
          if (typeof source !== "object" || source === null) return [];
          const citation = source as Record<string, Prisma.JsonValue>;
          if (
            typeof citation.pageNumber !== "number" ||
            typeof citation.priceListName !== "string" ||
            typeof citation.version !== "string" ||
            typeof citation.uncertainOcr !== "boolean"
          ) {
            return [];
          }
          return [
            {
              pageNumber: citation.pageNumber,
              priceListName: citation.priceListName,
              version: citation.version,
              uncertainOcr: citation.uncertainOcr,
            },
          ];
        })
      : [],
    createdAt: message.createdAt.toISOString(),
  }));
  const items = quote.items.map((item) => ({
    id: item.id,
    category: item.category,
    description: item.description,
    quantity: item.quantity.toString(),
    widthMm: item.widthMm,
    heightMm: item.heightMm,
    configuration: jsonRecord(item.configuration),
    pricingStatus: item.pricingStatus,
    unitPrice: item.unitPrice?.toString() ?? null,
    totalPrice: item.totalPrice?.toString() ?? null,
  }));
  const assistantPriceLists = priceLists.map((priceList) => {
    const summary =
      typeof priceList.extractionSummary === "object" &&
      priceList.extractionSummary !== null &&
      !Array.isArray(priceList.extractionSummary)
        ? (priceList.extractionSummary as Record<string, Prisma.JsonValue>)
        : {};
    const pageCount = summary.pageCount;
    const uncertainOcrPages = [
      ...(Array.isArray(summary.pagesOcrNeedsReview)
        ? summary.pagesOcrNeedsReview
        : []),
      ...(Array.isArray(summary.pagesOcrNotProcessed)
        ? summary.pagesOcrNotProcessed
        : []),
    ];
    return {
      id: priceList.id,
      name: priceList.name,
      version: priceList.version,
      status: priceList.status,
      pageCount: typeof pageCount === "number" ? pageCount : 0,
      uncertainOcrPages: [...new Set(uncertainOcrPages)].filter(
        (page): page is number => typeof page === "number",
      ),
    };
  });

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
            {quote.organization.name} ·{" "}
            {quote.customer?.name ?? "Cliente da assegnare"}
          </p>
          <h1 className="mt-1 max-w-2xl truncate text-2xl font-semibold tracking-tight">
            {quote.title}
          </h1>
        </div>
        <Link
          href={`/dashboard/preventivi/${encodeURIComponent(quote.id)}/documento`}
          className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800"
        >
          Editor documento · PDF
        </Link>
      </header>

      <div className="mt-7">
        <QuoteAssistant
          quoteId={quote.id}
          initialMessages={messages}
          initialItems={items}
          priceLists={assistantPriceLists}
          llmModel={getLLMProvider().model}
        />
      </div>
    </main>
  );
}
