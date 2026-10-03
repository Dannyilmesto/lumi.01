import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prepareAssistantPdfContext } from '@/lib/assistant-pdf-context';
import {
  generateQuoteAssistantResponse,
  QuoteAIError,
  type QuoteAssistantCandidate,
  type QuoteAssistantResult,
} from '@/lib/quote-ai';
import { prisma } from '@/lib/prisma';
import { getObjectStorage } from '@/lib/storage/object-storage';

export const runtime = 'nodejs';
export const maxDuration = 300;

const messageSchema = z.object({
  content: z.string().trim().min(1).max(3_000),
  priceListId: z.string().min(1),
});

function jsonRecord(value: Prisma.JsonValue): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function numberList(value: Prisma.JsonValue | null | undefined, key: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return [];
  const list = (value as Record<string, Prisma.JsonValue>)[key];
  return Array.isArray(list)
    ? list.filter((item): item is number => Number.isInteger(item))
    : [];
}

function pageCountFromSummary(value: Prisma.JsonValue | null | undefined) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return 0;
  const count = (value as Record<string, Prisma.JsonValue>).pageCount;
  return typeof count === 'number' && Number.isInteger(count) && count > 0
    ? count
    : 0;
}

function jsonStrings(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' || typeof item === 'number')
      return [String(item)];
    if (typeof item === 'object' && item !== null) {
      const fields = item as Record<string, Prisma.JsonValue>;
      return [fields.raw, fields.value]
        .filter(
          (field): field is string | number =>
            typeof field === 'string' || typeof field === 'number',
        )
        .map(String);
    }
    return [];
  });
}

function queryTerms(value: string) {
  const ignored = new Set([
    'alla',
    'alle',
    'allo',
    'anche',
    'avere',
    'che',
    'chi',
    'come',
    'con',
    'cosa',
    'della',
    'delle',
    'dello',
    'dentro',
    'dove',
    'due',
    'gli',
    'ha',
    'hai',
    'hanno',
    'ho',
    'per',
    'non',
    'questa',
    'queste',
    'questi',
    'questo',
    'sono',
    'sua',
    'sue',
    'tra',
    'una',
    'uno',
    'vorrei',
    'delle',
    'della',
  ]);
  const normalized = value
    .toLocaleLowerCase('it-IT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return [...new Set(normalized.match(/[a-z0-9]{2,}/g) ?? [])].filter(
    (term) => !ignored.has(term),
  );
}

function rankCandidates(
  candidates: Array<{
    pdfPageNumber: number;
    sectionLabel: string;
    sourceExcerpt: string;
    finishCodeCandidates: Prisma.JsonValue;
    modelCandidates: Prisma.JsonValue;
    dimensionCandidates: Prisma.JsonValue;
    amounts: Prisma.JsonValue;
    percentages: Prisma.JsonValue;
    warnings: Prisma.JsonValue;
  }>,
  query: string,
) {
  const terms = queryTerms(query);
  const ranked = candidates
    .map((candidate, index) => {
      const finishCodes = jsonStrings(candidate.finishCodeCandidates);
      const models = jsonStrings(candidate.modelCandidates);
      const dimensions = jsonStrings(candidate.dimensionCandidates);
      const amounts = jsonStrings(candidate.amounts);
      const percentages = jsonStrings(candidate.percentages);
      const haystack = [
        candidate.sectionLabel,
        candidate.sourceExcerpt,
        ...finishCodes,
        ...models,
        ...dimensions,
      ]
        .join(' ')
        .toLocaleLowerCase('it-IT');
      const score = terms.reduce(
        (total, term) =>
          total + (haystack.includes(term) ? (term.length >= 4 ? 2 : 1) : 0),
        0,
      );
      return {
        index,
        score,
        candidate: {
          pageNumber: candidate.pdfPageNumber,
          sectionLabel: candidate.sectionLabel.slice(0, 160),
          excerpt: candidate.sourceExcerpt.slice(0, 900),
          finishCodes: finishCodes.slice(0, 12),
          models: models.slice(0, 12),
          dimensions: dimensions.slice(0, 12),
          amounts: amounts.slice(0, 12),
          percentages: percentages.slice(0, 12),
          warnings: jsonStrings(candidate.warnings).slice(0, 6),
        } satisfies QuoteAssistantCandidate,
      };
    })
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );

  const matches = ranked.filter((entry) => entry.score > 0);
  const chosen = (matches.length ? matches : ranked).slice(0, 18);
  return {
    evidence: chosen.map((entry) => entry.candidate),
    preferredPages: [
      ...new Set(chosen.map((entry) => entry.candidate.pageNumber)),
    ].slice(0, 15),
  };
}

function responseItem(item: {
  id: string;
  category: string;
  description: string;
  quantity: Prisma.Decimal;
  widthMm: number | null;
  heightMm: number | null;
  configuration: Prisma.JsonValue;
  pricingStatus: string;
  unitPrice: Prisma.Decimal | null;
  totalPrice: Prisma.Decimal | null;
}) {
  return {
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
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json(
      { error: 'Accedi per continuare il preventivo.' },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Scrivi una richiesta e seleziona un listino analizzato.' },
      { status: 400 },
    );
  }

  const quote = await prisma.quote.findFirst({
    where: {
      id,
      deletedAt: null,
      organization: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true, organizationId: true, title: true, status: true },
  });
  if (!quote) {
    return Response.json({ error: 'Preventivo non trovato.' }, { status: 404 });
  }
  if (quote.status !== 'DRAFT') {
    return Response.json(
      {
        error:
          'Questo preventivo non è più in bozza e non può essere modificato.',
      },
      { status: 409 },
    );
  }

  const priceList = await prisma.priceList.findFirst({
    where: {
      id: parsed.data.priceListId,
      supplier: { organizationId: quote.organizationId },
      status: { in: ['NEEDS_REVIEW', 'ACTIVE'] },
    },
    select: {
      id: true,
      name: true,
      version: true,
      sha256: true,
      originalPdfKey: true,
      extractionSummary: true,
    },
  });
  if (!priceList) {
    return Response.json(
      {
        error:
          'Il listino selezionato non è stato analizzato o non è accessibile alla tua azienda.',
      },
      { status: 404 },
    );
  }
  const pageCount = pageCountFromSummary(priceList.extractionSummary);
  if (pageCount === 0) {
    return Response.json(
      {
        error:
          'Questo listino non contiene ancora il riepilogo dell’analisi. Rianalizzalo dalla sezione Listini.',
      },
      { status: 409 },
    );
  }
  const uncertainOcrPages = [
    ...new Set([
      ...numberList(priceList.extractionSummary, 'pagesOcrNeedsReview'),
      ...numberList(priceList.extractionSummary, 'pagesOcrNotProcessed'),
    ]),
  ];

  let pdfBytes: Buffer;
  try {
    pdfBytes = await getObjectStorage().get(priceList.originalPdfKey);
  } catch (error) {
    console.error('Impossibile leggere il PDF per l’assistente AI.', error);
    return Response.json(
      { error: 'Il PDF originale del listino non è disponibile.' },
      { status: 404 },
    );
  }
  if (pdfBytes.byteLength > 30 * 1024 * 1024) {
    return Response.json(
      { error: 'Il PDF supera il limite di 30 MB previsto per l’analisi.' },
      { status: 413 },
    );
  }
  const actualHash = createHash('sha256').update(pdfBytes).digest('hex');
  if (actualHash !== priceList.sha256) {
    return Response.json(
      { error: 'Il PDF originale non supera il controllo di integrità.' },
      { status: 409 },
    );
  }

  const [history, quoteItems] = await Promise.all([
    prisma.quoteMessage
      .findMany({
        where: { quoteId: quote.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 24,
        select: { role: true, content: true },
      })
      .then((messages) => messages.reverse()),
    prisma.quoteItem.findMany({
      where: { quoteId: quote.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        description: true,
        quantity: true,
        widthMm: true,
        heightMm: true,
        configuration: true,
      },
    }),
  ]);

  const candidates = await prisma.extractionCandidate.findMany({
    where: { priceListId: priceList.id },
    orderBy: [{ pdfPageNumber: 'asc' }, { id: 'asc' }],
    take: 3_000,
    select: {
      pdfPageNumber: true,
      sectionLabel: true,
      sourceExcerpt: true,
      finishCodeCandidates: true,
      modelCandidates: true,
      dimensionCandidates: true,
      amounts: true,
      percentages: true,
      warnings: true,
    },
  });
  const searchQuery = [
    parsed.data.content,
    ...history
      .filter((message) => message.role === 'USER')
      .slice(-8)
      .map((message) => message.content),
    ...quoteItems.map((item) =>
      [
        item.category,
        item.description,
        item.widthMm,
        item.heightMm,
        JSON.stringify(jsonRecord(item.configuration)),
      ].join(' '),
    ),
  ].join('\n');
  const candidateContext = rankCandidates(candidates, searchQuery);

  let pdfContext;
  try {
    pdfContext = await prepareAssistantPdfContext({
      pdfBytes,
      query: searchQuery,
      preferredPages: candidateContext.preferredPages,
    });
    if (pdfContext.sha256.toLowerCase() !== actualHash.toLowerCase()) {
      return Response.json(
        {
          error:
            'La copia preparata del PDF non supera il controllo di integrità.',
        },
        { status: 409 },
      );
    }
    if (pdfContext.page_count !== pageCount) {
      return Response.json(
        {
          error:
            'Il numero di pagine non corrisponde all’analisi salvata. Rianalizza il listino.',
        },
        { status: 409 },
      );
    }
  } catch (error) {
    console.error('Errore durante la preparazione locale del PDF.', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Non è stato possibile preparare il PDF sul Mac.',
      },
      { status: 503 },
    );
  }

  let aiResult: QuoteAssistantResult;
  try {
    aiResult = await generateQuoteAssistantResponse({
      content: parsed.data.content,
      history,
      items: quoteItems.map((item) => ({
        id: item.id,
        category: item.category,
        description: item.description,
        quantity: item.quantity.toString(),
        widthMm: item.widthMm,
        heightMm: item.heightMm,
        configuration: jsonRecord(item.configuration),
      })),
      pdfContext,
      candidates: candidateContext.evidence,
    });
  } catch (error) {
    if (error instanceof QuoteAIError) {
      return Response.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }
    console.error('Errore inatteso durante la risposta AI.', error);
    return Response.json(
      { error: 'Non è stato possibile analizzare la richiesta. Riprova.' },
      { status: 500 },
    );
  }

  const allowedItemIds = new Set(quoteItems.map((item) => item.id));
  const validUpdates = aiResult.item_updates.filter((update) =>
    allowedItemIds.has(update.quote_item_id),
  );
  const visiblePdfPages = new Set(pdfContext.selected_page_numbers);
  const sources = [...new Set(aiResult.source_pages)]
    .filter((pageNumber) => visiblePdfPages.has(pageNumber))
    .map((pageNumber) => ({
      pageNumber,
      priceListName: priceList.name,
      version: priceList.version,
      uncertainOcr: uncertainOcrPages.includes(pageNumber),
    }));

  const result = await prisma.$transaction(async (transaction) => {
    await transaction.quoteMessage.create({
      data: { quoteId: quote.id, role: 'USER', content: parsed.data.content },
    });

    for (const item of aiResult.new_items) {
      const configuration = Object.fromEntries(
        item.attributes.map(({ name, value }) => [name, value]),
      );
      await transaction.quoteItem.create({
        data: {
          quoteId: quote.id,
          category: item.category,
          description: item.description,
          quantity: item.quantity,
          widthMm: item.width_mm,
          heightMm: item.height_mm,
          configuration: configuration as Prisma.InputJsonValue,
          pricingStatus: 'NEEDS_PRICING',
          unitPrice: null,
          totalPrice: null,
          calculationSnapshot: {
            source: 'ai_assistant_draft',
            pricingStatus: 'NEEDS_PRICING',
          } as Prisma.InputJsonValue,
        },
      });
    }

    for (const update of validUpdates) {
      const current = quoteItems.find(
        (item) => item.id === update.quote_item_id,
      );
      if (!current) continue;
      const attributeChanges = Object.fromEntries(
        update.attributes.map(({ name, value }) => [name, value]),
      );
      const currentConfiguration = jsonRecord(current.configuration);
      if (
        update.quantity === null &&
        update.width_mm === null &&
        update.height_mm === null &&
        Object.keys(attributeChanges).length === 0
      ) {
        continue;
      }
      await transaction.quoteItem.update({
        where: { id: current.id },
        data: {
          ...(update.quantity === null ? {} : { quantity: update.quantity }),
          ...(update.width_mm === null ? {} : { widthMm: update.width_mm }),
          ...(update.height_mm === null ? {} : { heightMm: update.height_mm }),
          ...(Object.keys(attributeChanges).length === 0
            ? {}
            : {
                configuration: {
                  ...currentConfiguration,
                  ...attributeChanges,
                } as Prisma.InputJsonValue,
              }),
        },
      });
    }

    await transaction.quoteMessage.create({
      data: {
        quoteId: quote.id,
        role: 'ASSISTANT',
        content: aiResult.reply,
        sources: sources as Prisma.InputJsonValue,
      },
    });
    await transaction.quote.update({
      where: { id: quote.id },
      data: {
        updatedAt: new Date(),
        ...(quote.title === 'Nuovo preventivo'
          ? {
              title: parsed.data.content.replace(/\s+/g, ' ').slice(0, 72),
            }
          : {}),
      },
    });

    const [messages, items] = await Promise.all([
      transaction.quoteMessage
        .findMany({
          where: { quoteId: quote.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
        })
        .then((messages) => messages.reverse()),
      transaction.quoteItem.findMany({
        where: { quoteId: quote.id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sources: Array.isArray(message.sources) ? message.sources : [],
        createdAt: message.createdAt.toISOString(),
      })),
      items: items.map(responseItem),
    };
  });

  return Response.json(result);
}
