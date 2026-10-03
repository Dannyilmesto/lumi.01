import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type QuoteWithItems = Prisma.QuoteGetPayload<{ include: { items: true } }>;
/** Deliberate allowlist: never expose customer, editor HTML, uploads or messages. */
export function publicQuoteSnapshot(quote: QuoteWithItems) {
  return {
    title: quote.title,
    currency: quote.currency,
    amount:
      quote.items.length > 0 &&
      quote.items.every(
        (item) => item.unitPrice !== null && item.totalPrice !== null,
      )
        ? quote.total.toString()
        : null,
    details: quote.items.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice?.toString() ?? null,
      totalPrice: item.totalPrice?.toString() ?? null,
    })),
  };
}
export function publicQuoteVersion(
  snapshot: ReturnType<typeof publicQuoteSnapshot>,
) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
