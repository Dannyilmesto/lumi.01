import { auth } from '@/lib/auth';
import {
  quoteExportCsv,
  quoteExportJson,
  quoteExportXlsx,
  type ExportQuote,
} from '@/lib/quote-export';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json(
      { error: 'Accedi per esportare i preventivi.' },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  const format = url.searchParams.get('format') ?? 'json';
  const quoteIds = [...new Set(url.searchParams.getAll('id'))];
  const includeDeleted = url.searchParams.get('includeDeleted') === '1';
  if (
    !organizationId ||
    quoteIds.length === 0 ||
    quoteIds.length > 100 ||
    quoteIds.some((id) => id.length > 128) ||
    !['json', 'csv', 'xlsx'].includes(format)
  ) {
    return Response.json(
      { error: 'Selezione o formato di esportazione non valido.' },
      { status: 400 },
    );
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id, organizationId },
    select: { organizationId: true },
  });
  if (!membership) {
    return Response.json(
      { error: 'Azienda non disponibile per questo utente.' },
      { status: 404 },
    );
  }

  const quotes = await prisma.quote.findMany({
    where: {
      id: { in: quoteIds },
      organizationId: membership.organizationId,
      deletedAt: includeDeleted ? { not: null } : null,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      organizationId: true,
      customerId: true,
      title: true,
      status: true,
      currency: true,
      subtotal: true,
      discount: true,
      tax: true,
      total: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      customer: {
        select: {
          name: true,
          email: true,
          phone: true,
          address: true,
          notes: true,
        },
      },
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          productId: true,
          category: true,
          code: true,
          description: true,
          quantity: true,
          widthMm: true,
          heightMm: true,
          unit: true,
          configuration: true,
          pricingStatus: true,
          unitPrice: true,
          totalPrice: true,
          calculationSnapshot: true,
          createdAt: true,
        },
      },
      messages: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          role: true,
          content: true,
          sources: true,
          createdAt: true,
        },
      },
    },
  });

  if (quotes.length !== quoteIds.length) {
    return Response.json(
      {
        error: 'Uno o più preventivi non sono disponibili per l’esportazione.',
      },
      { status: 404 },
    );
  }

  const records: ExportQuote[] = quotes.map((quote) => ({
    ...quote,
    subtotal: quote.subtotal.toString(),
    discount: quote.discount.toString(),
    tax: quote.tax.toString(),
    total: quote.total.toString(),
    items: quote.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice?.toString() ?? null,
      totalPrice: item.totalPrice?.toString() ?? null,
    })),
  }));

  const fileDate = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    return Response.json(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        quotes: records.map(quoteExportJson),
      },
      {
        headers: {
          'Content-Disposition': `attachment; filename="preventivi-${fileDate}.json"`,
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  if (format === 'csv') {
    return new Response(quoteExportCsv(records), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="preventivi-${fileDate}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response(new Uint8Array(quoteExportXlsx(records)), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="preventivi-${fileDate}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
