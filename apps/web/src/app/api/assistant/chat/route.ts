import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { createAssistantChatResponse } from '@/lib/assistant-chat-response';
import {
  prepareAssistantPdfContext,
  prepareAssistantPdfContextFromExtraction,
  type AssistantPdfContext,
} from '@/lib/assistant-pdf-context';
import {
  extractQuoteDocument,
  interpretQuoteDocument,
  parseDeterministicQuoteDocument,
} from '@/lib/quote-document-pipeline';
import { QuoteAIError } from '@/lib/quote-ai';
import { prisma } from '@/lib/prisma';
import { getObjectStorage } from '@/lib/storage/object-storage';
import {
  formatWorkspaceDataAnswer,
  stripQuotedTextForIntent,
  workspaceFollowUpIntent,
  workspaceCalendarRange,
  workspaceSalesPeriod,
} from '@/lib/assistant-workspace-data';
import {
  generateWorkspaceAssistantReply,
  type WorkspaceAssistantMessage,
} from '@/lib/workspace-assistant-ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

const requestSchema = z.object({
  organizationId: z.string().min(1).max(128),
  content: z.string().trim().min(1).max(12_000),
  documentId: z.string().min(1).max(128).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['USER', 'ASSISTANT']),
        content: z.string().max(5_000),
      }),
    )
    .max(20),
});

function normalize(value: string) {
  return value
    .toLocaleLowerCase('it-IT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function asksAboutPdf(value: string) {
  return /\b(pdf|document\w*|fattur(?:a|e)\b|contratt\w*|manual\w*|scheda\w*|listin\w*|catalog\w*|file|scansion\w*|analizz\w*|interpret\w*|leggi|estrai\w*|riassum\w*)\b/i.test(
    value,
  );
}

function asksAboutBusinessData(value: string) {
  return /\b(preventiv\w*|bozz\w*|client\w*|fornitor\w*|listin\w*|catalog\w*|serrament\w*|infiss\w*|finestr\w*|port\w*|ordin\w*|fattur\w*|scont\w*|aliquot\w*|iva|spedizion\w*|pagament\w*|euro|€)\b/i.test(
    value,
  );
}

function asksAboutSales(value: string) {
  return /\b(vendit\w*|vendut\w*|fatturat\w*|incass\w*|ricav\w*|guadagn\w*|preventiv\w*\s+accettat\w*)\b/i.test(
    value,
  );
}

function asksAboutCalendar(value: string) {
  return /\b(calendari\w*|agenda|agend\w*|appuntament\w*|riunion\w*|eventi?|scadenz\w*|impegn\w*)\b/i.test(
    value,
  );
}

function asksForDocumentContents(value: string) {
  return /\b(riassum\w*|analizz\w*|leggi|estrai\w*|cerc\w*|trova|contenut\w*|dice|scritto|indica|importo|scadenz\w*|totale|parl\w*|spieg\w*|contien\w*|informazion\w*|riguard\w*|dat[aei])\b/i.test(
    value,
  );
}

function asksAboutCatalogItem(value: string) {
  return /\b(prezz\w*|cost\w*|prodott\w*|codic\w*|modell\w*|articol\w*|misur\w*|color\w*)\b/i.test(
    value,
  );
}

function textAnswerStream(content: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let offset = 0;
      while (offset < content.length) {
        let end = Math.min(offset + 4_000, content.length);
        if (
          end < content.length &&
          content.charCodeAt(end - 1) >= 0xd800 &&
          content.charCodeAt(end - 1) <= 0xdbff
        )
          end--;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'token',
              content: content.slice(offset, end),
            })}\n\n`,
          ),
        );
        offset = end;
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`),
      );
      controller.close();
    },
  });
}

function asksToRescan(value: string) {
  return /\b(ri.?analizz\w*|riscansion\w*|rifai\s+(?:la\s+)?(?:scansione|analisi)|nuova\s+scansione|da\s+capo)\b/i.test(
    value,
  );
}

function asksForVisualDetails(value: string) {
  return /\b(color[ei]|aspetto|visiv[oaie]?|immagin[ei]|foto|disegn[oi]|diagramm[ai]|raffigurat[oaie]?|mostr[ai]|ved[oi]|appare)\b/i.test(
    value,
  );
}

function validRate(value: string | null) {
  if (!value) return null;
  const normalizedRate = value.replace('%', '').replace(',', '.').trim();
  if (!/^\d{1,3}(?:\.\d{1,3})?$/.test(normalizedRate)) return null;
  const rate = Number(normalizedRate);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100
    ? normalizedRate
    : null;
}

async function storeParsingProfile(
  organizationId: string,
  semantic: Awaited<ReturnType<typeof interpretQuoteDocument>>,
) {
  const profileName =
    semantic.document_type === 'customer_quote'
      ? semantic.recipient_name
      : semantic.sender_name;
  if (!profileName) return;
  const senderKey = normalize(profileName).slice(0, 180);
  if (!senderKey) return;
  const supplier =
    semantic.document_type === 'customer_quote'
      ? null
      : await prisma.supplier.findFirst({
          where: {
            organizationId,
            name: { equals: profileName, mode: 'insensitive' },
          },
          select: { id: true },
        });
  const customer =
    semantic.document_type === 'customer_quote'
      ? await prisma.customer.findFirst({
          where: {
            organizationId,
            name: { equals: profileName, mode: 'insensitive' },
          },
          select: { id: true },
        })
      : null;
  const rate = validRate(semantic.settings.default_vat_rate);
  const currency = semantic.settings.currency ?? semantic.currency;
  await prisma.quoteParsingProfile.upsert({
    where: { organizationId_senderKey: { organizationId, senderKey } },
    create: {
      organizationId,
      senderKey,
      senderName: profileName,
      supplierId: supplier?.id,
      customerId: customer?.id,
      currency,
      defaultVatRate: rate,
      paymentTerms: semantic.settings.payment_terms,
      shippingMode: semantic.settings.shipping_mode,
      sourceLayout: semantic.settings.source_layout,
      rules: {
        rules: semantic.settings.rules,
        documentType: semantic.document_type,
      } as Prisma.InputJsonValue,
      sampleCount: 1,
    },
    update: {
      senderName: profileName,
      ...(supplier ? { supplierId: supplier.id } : {}),
      ...(customer ? { customerId: customer.id } : {}),
      ...(currency ? { currency } : {}),
      ...(rate ? { defaultVatRate: rate } : {}),
      ...(semantic.settings.payment_terms
        ? { paymentTerms: semantic.settings.payment_terms }
        : {}),
      ...(semantic.settings.shipping_mode
        ? { shippingMode: semantic.settings.shipping_mode }
        : {}),
      ...(semantic.settings.source_layout
        ? { sourceLayout: semantic.settings.source_layout }
        : {}),
      rules: {
        rules: semantic.settings.rules,
        documentType: semantic.document_type,
      } as Prisma.InputJsonValue,
      sampleCount: { increment: 1 },
      lastSeenAt: new Date(),
    },
  });
}

async function scanDocument(input: {
  id: string;
  organizationId: string;
  originalPdfKey: string;
  sha256: string;
  fileName: string;
  cachedExtraction: unknown;
  signal: AbortSignal;
  onProgress: (message: string) => void;
}) {
  input.signal.throwIfAborted();
  const pdfBytes = await getObjectStorage().get(input.originalPdfKey);
  const actualHash = createHash('sha256').update(pdfBytes).digest('hex');
  if (actualHash !== input.sha256)
    throw new QuoteAIError(
      'Il PDF archiviato non supera il controllo di integrità.',
      409,
    );

  const cached = parseDeterministicQuoteDocument(input.cachedExtraction);
  const deterministic =
    cached?.sha256.toLowerCase() === actualHash
      ? cached
      : await extractQuoteDocument(pdfBytes, input.fileName, {
          signal: input.signal,
          onProgress: input.onProgress,
        });
  input.signal.throwIfAborted();
  // Preserve Python's full output even when the following model call fails.
  await prisma.assistantDocument.update({
    where: { id: input.id },
    data: {
      pageCount: deterministic.page_count,
      documentKind: deterministic.document_kind,
      deterministicExtraction:
        deterministic as unknown as Prisma.InputJsonValue,
      semanticExtraction: Prisma.DbNull,
      scannedAt: null,
    },
  });
  const existingProfiles = await prisma.quoteParsingProfile.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { lastSeenAt: 'desc' },
    take: 20,
    select: {
      senderName: true,
      currency: true,
      defaultVatRate: true,
      paymentTerms: true,
      shippingMode: true,
      sourceLayout: true,
      rules: true,
    },
  });
  const documentText = normalize(
    deterministic.pages.map((page) => page.text).join('\n'),
  );
  const knownProfiles = existingProfiles
    .filter((profile) => {
      const sender = normalize(profile.senderName);
      return sender.length >= 4 && documentText.includes(sender);
    })
    .slice(0, 10)
    .map((profile) => ({
      senderName: profile.senderName,
      currency: profile.currency,
      defaultVatRate: profile.defaultVatRate?.toString() ?? null,
      paymentTerms: profile.paymentTerms,
      shippingMode: profile.shippingMode,
      sourceLayout: profile.sourceLayout,
      rules: profile.rules,
    }));
  const semantic = await interpretQuoteDocument({
    pdfBytes,
    extraction: deterministic,
    knownProfiles,
    signal: input.signal,
    onProgress: input.onProgress,
  });
  input.signal.throwIfAborted();
  await storeParsingProfile(input.organizationId, semantic);
  await prisma.assistantDocument.update({
    where: { id: input.id },
    data: {
      pageCount: deterministic.page_count,
      documentKind: deterministic.document_kind,
      deterministicExtraction:
        deterministic as unknown as Prisma.InputJsonValue,
      semanticExtraction: semantic as unknown as Prisma.InputJsonValue,
      scannedAt: new Date(),
    },
  });
  return { pdfBytes, deterministic, semantic };
}

function sourcePages(semantic: unknown) {
  if (
    !semantic ||
    typeof semantic !== 'object' ||
    !('source_pages' in semantic)
  )
    return [];
  const pages = (semantic as { source_pages?: unknown }).source_pages;
  return Array.isArray(pages)
    ? pages.filter((page): page is number => Number.isInteger(page) && page > 0)
    : [];
}

async function listWorkspaceCalendarEvents(input: {
  organizationId: string;
  userId: string;
  range: ReturnType<typeof workspaceCalendarRange>;
}) {
  const events = [];
  let cursor: string | undefined;
  do {
    const page = await prisma.calendarEvent.findMany({
      where: {
        OR: [
          { organizationId: input.organizationId },
          { organizationId: null, userId: input.userId },
        ],
        ...(input.range
          ? { date: { gte: input.range.start, lte: input.range.end } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        date: true,
        time: true,
        description: true,
        kind: true,
        completed: true,
        assignedUser: { select: { name: true } },
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    events.push(...page);
    cursor = page.length === 500 ? page.at(-1)!.id : undefined;
  } while (cursor);
  return events;
}

async function extractWorkspaceDocumentEvidence(input: {
  documents: {
    id: string;
    fileName: string;
    originalPdfKey: string;
    sha256: string;
    deterministicExtraction: unknown;
  }[];
  query: string;
  signal: AbortSignal;
  onProgress: (message: string) => void;
}) {
  const tokens = [...new Set(normalize(input.query).split(" "))].filter(
    (token) =>
      token.length >= 3 &&
      !/^(?:che|cosa|come|dove|quale|quali|quando|quanto|quanti|sono|della|delle|degli|dello|nel|nella|nelle|negli|documento|documenti|pdf|per|con|una|uno|tutti|tutte|questo|questa|mese|anno)$/.test(
        token,
      ),
  );
  const matchingPages: {
    score: number;
    fileName: string;
    pageNumber: number;
    text: string;
  }[] = [];
  const firstPages: {
    score: number;
    fileName: string;
    pageNumber: number;
    text: string;
  }[] = [];

  for (const document of input.documents) {
    input.signal.throwIfAborted();
    input.onProgress(`Sto consultando ${document.fileName}…`);
    const pdfBytes = await getObjectStorage().get(document.originalPdfKey);
    const actualHash = createHash("sha256").update(pdfBytes).digest("hex");
    if (actualHash.toLowerCase() !== document.sha256.toLowerCase())
      throw new QuoteAIError(
        `Il PDF ${document.fileName} non supera il controllo di integrità.`,
        409,
      );
    const cached = parseDeterministicQuoteDocument(
      document.deterministicExtraction,
    );
    const extraction =
      cached?.sha256.toLowerCase() === actualHash
        ? cached
        : await extractQuoteDocument(pdfBytes, document.fileName, {
            signal: input.signal,
            onProgress: input.onProgress,
          });
    if (extraction.sha256.toLowerCase() !== actualHash)
      throw new QuoteAIError(
        `L’estrazione di ${document.fileName} non corrisponde al PDF verificato.`,
        409,
      );
    if (cached?.sha256.toLowerCase() !== actualHash) {
      await prisma.assistantDocument.update({
        where: { id: document.id },
        data: {
          pageCount: extraction.page_count,
          documentKind: extraction.document_kind,
          deterministicExtraction: extraction as unknown as Prisma.InputJsonValue,
        },
      });
    }
    for (const page of extraction.pages) {
      const text = page.text.trim();
      if (!text) continue;
      const searchable = normalize(`${document.fileName} ${text}`);
      const score = tokens.reduce(
        (total, token) => total + (searchable.includes(token) ? 1 : 0),
        0,
      );
      const candidate = {
        score,
        fileName: document.fileName,
        pageNumber: page.page_number,
        text: text.slice(0, 900),
      };
      if (page.page_number === 1) firstPages.push(candidate);
      if (score > 0) {
        matchingPages.push(candidate);
        matchingPages.sort((a, b) => b.score - a.score);
        matchingPages.splice(12);
      }
    }
  }

  const excerpts = (matchingPages.length ? matchingPages : firstPages)
    .slice(0, 8)
    .map(({ fileName, pageNumber, text }) => ({
      documento: fileName,
      pagina: pageNumber,
      testo: text,
    }));
  return {
    numeroDocumentiConsultati: input.documents.length,
    documentiDisponibili: input.documents
      .slice(0, 20)
      .map((document) => document.fileName),
    altriDocumentiOmissi: Math.max(0, input.documents.length - 20),
    estrattiRilevanti: excerpts,
    nota:
      "I PDF sono stati verificati localmente tramite SHA-256. Gli estratti mostrati sono una selezione delle pagine più pertinenti, non la totalità del testo.",
  };
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: 'Accedi per usare l’assistente.' },
      { status: 401 },
    );
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success)
    return Response.json({ error: 'Richiesta non valida.' }, { status: 400 });
  const { organizationId, content, documentId } = parsed.data;
  const intentContent = stripQuotedTextForIntent(content);
  const followUpIntent = workspaceFollowUpIntent(
    intentContent,
    parsed.data.history,
  );
  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: session.user.id },
    },
    select: { organization: { select: { id: true, name: true } } },
  });
  if (!membership)
    return Response.json(
      { error: 'Azienda non disponibile per questo utente.' },
      { status: 404 },
    );

  return createAssistantChatResponse(
    request.signal,
    async ({ signal, status, metadata, webSources }) => {
      status('Sto preparando la risposta…');
      const wantsPdf = asksAboutPdf(intentContent);
      const asksForCatalogItem = asksAboutCatalogItem(intentContent);
      const wantsSales =
        asksAboutSales(intentContent) || Boolean(followUpIntent?.sales);
      const wantsCalendar =
        asksAboutCalendar(intentContent) || Boolean(followUpIntent?.calendar);
      const wantsBusinessContext =
        (asksAboutBusinessData(intentContent) && !wantsSales) ||
        (Boolean(documentId) && asksForCatalogItem);
      const wantsDocument =
        wantsPdf ||
        (Boolean(documentId) && (wantsBusinessContext || asksForCatalogItem));
      const wantsDocumentText =
        wantsDocument && asksForDocumentContents(intentContent);
      const period = wantsSales ? workspaceSalesPeriod(intentContent) : null;
      const dates = wantsCalendar
        ? workspaceCalendarRange(intentContent)
        : null;
      const [documents, quotes, recentAnalyses, calendarEvents, sales] =
        await Promise.all([
        wantsDocument
          ? prisma.assistantDocument.findMany({
              where: {
                organizationId,
                ...(documentId ? { id: documentId } : {}),
              },
              select: {
                id: true,
                fileName: true,
                sourceType: true,
                originalPdfKey: true,
                sha256: true,
                pageCount: true,
                documentKind: true,
                scannedAt: true,
                deterministicExtraction: true,
              },
              orderBy: { createdAt: 'desc' },
              take: wantsDocumentText ? 101 : 100,
            })
          : Promise.resolve([]),
        wantsBusinessContext
          ? prisma.quote.findMany({
              where: { organizationId, deletedAt: null },
              select: {
                title: true,
                status: true,
                customer: { select: { name: true } },
                total: true,
                updatedAt: true,
              },
              orderBy: { updatedAt: 'desc' },
              take: 12,
            })
          : Promise.resolve([]),
        wantsBusinessContext
          ? prisma.priceList.findMany({
              where: { supplier: { organizationId } },
              select: {
                name: true,
                version: true,
                status: true,
                supplier: { select: { name: true } },
                products: {
                  select: { code: true, name: true, description: true },
                  take: 12,
                },
              },
              orderBy: { createdAt: 'desc' },
              take: 30,
            })
          : Promise.resolve([]),
        wantsCalendar && dates
          ? listWorkspaceCalendarEvents({
              organizationId,
              userId: session.user.id,
              range: dates,
            })
          : wantsCalendar
            ? listWorkspaceCalendarEvents({
                organizationId,
                userId: session.user.id,
                range: null,
              })
            : Promise.resolve([]),
        wantsSales && period
          ? prisma.quote.aggregate({
              where: {
                organizationId,
                deletedAt: null,
                status: { in: ['ACCEPTED', 'APPROVED'] },
                createdAt: { gte: period.start, lt: period.end },
                currency: 'EUR',
              },
              _sum: { total: true },
              _count: { _all: true },
            })
          : Promise.resolve(null),
      ]);

      const selectedCalendarEvents = calendarEvents;
      if (wantsDocumentText && documents.length > 100)
        throw new QuoteAIError(
          'Ci sono più di 100 documenti aziendali: per evitare una risposta incompleta, seleziona un PDF specifico oppure restringi la ricerca.',
          413,
        );

      const documentEvidence = wantsDocumentText
        ? await extractWorkspaceDocumentEvidence({
            documents,
            query: content,
            signal,
            onProgress: status,
          })
        : null;

      let document =
        wantsDocument && documentId
          ? documents.find((item) => item.id === documentId)
          : undefined;
      if (!document && wantsDocument) {
        const normalizedContent = normalize(content);
        const matching = documents.filter((item) => {
          const normalizedName = normalize(
            item.fileName.replace(/\.pdf$/i, ''),
          );
          return (
            normalizedName.length >= 5 &&
            (normalizedContent.includes(normalizedName) ||
              normalizedName
                .split(' ')
                .filter((word) => word.length >= 5)
                .some((word) => normalizedContent.includes(word)))
          );
        });
        if (matching.length === 1) document = matching[0];
        else if (documents.length === 1) document = documents[0];
      }
      if (wantsDocument && documentId && !document)
        throw new QuoteAIError('PDF non trovato in questa azienda.', 404);

      let scannedNow = false;
      let pdfContext: AssistantPdfContext | undefined;
      let documentForAi:
        | {
            name: string;
            deterministicExtraction: unknown;
            semanticExtraction: unknown;
            pdfContext: AssistantPdfContext;
          }
        | undefined;

      const asksAboutSelectedDocument =
        wantsPdf ||
        (Boolean(documentId) && (wantsBusinessContext || asksForCatalogItem));
      if (document && asksAboutSelectedDocument) {
        const saved = await prisma.assistantDocument.findFirst({
          where: { id: document.id, organizationId },
          select: { deterministicExtraction: true, semanticExtraction: true },
        });
        if (!saved)
          throw new QuoteAIError('PDF non trovato in questa azienda.', 404);
        const needsScan =
          (!document.scannedAt && asksAboutSelectedDocument) ||
          asksToRescan(content);
        let pdfBytes: Buffer | undefined;
        let deterministicExtraction: unknown = saved.deterministicExtraction;
        let semanticExtraction: unknown = saved.semanticExtraction;
        if (needsScan) {
          status('Sto leggendo il PDF con Python…');
          const result = await scanDocument({
            id: document.id,
            organizationId,
            originalPdfKey: document.originalPdfKey,
            sha256: document.sha256,
            fileName: document.fileName,
            cachedExtraction: asksToRescan(content)
              ? null
              : saved.deterministicExtraction,
            signal,
            onProgress: status,
          });
          pdfBytes = result.pdfBytes;
          deterministicExtraction = result.deterministic;
          semanticExtraction = result.semantic;
          scannedNow = true;
        }
        pdfContext = prepareAssistantPdfContextFromExtraction({
          extraction: deterministicExtraction,
          query: content,
          preferredPages: sourcePages(semanticExtraction),
        });
        if (asksForVisualDetails(content)) {
          status('Sto leggendo i dettagli visivi della pagina…');
          pdfBytes ??= await getObjectStorage().get(document.originalPdfKey);
          const actualHash = createHash('sha256')
            .update(pdfBytes)
            .digest('hex');
          if (actualHash !== document.sha256)
            throw new QuoteAIError(
              'Il PDF archiviato non supera il controllo di integrità.',
              409,
            );
          pdfContext = await prepareAssistantPdfContext({
            pdfBytes,
            query: content,
            preferredPages: sourcePages(semanticExtraction),
            signal,
            pageLimit: 1,
            maxImageSide: 960,
            extraction: deterministicExtraction,
          });
        }
        if (pdfContext.sha256.toLowerCase() !== document.sha256.toLowerCase())
          throw new QuoteAIError(
            'Il PDF non supera il controllo prima della risposta AI.',
            409,
          );
        documentForAi = {
          name: document.fileName,
          deterministicExtraction,
          semanticExtraction,
          pdfContext,
        };
      }

      const organizationContext =
        wantsBusinessContext || wantsDocument
          ? {
              organization: membership.organization.name,
              documentiPDF: documents.map((item) => ({
                nome: item.fileName,
                scansionato: Boolean(
                  item.scannedAt || (document?.id === item.id && documentForAi),
                ),
                origine: item.sourceType,
              })),
              preventiviRecenti: quotes.map((quote) => ({
                titolo: quote.title,
                stato: quote.status,
                cliente: quote.customer?.name ?? null,
                totale: quote.total?.toString() ?? null,
                aggiornatoIl: quote.updatedAt.toISOString(),
              })),
              listiniEAggregati: recentAnalyses.map((priceList) => ({
                fornitore: priceList.supplier.name,
                listino: priceList.name,
                versione: priceList.version,
                stato: priceList.status,
                prodotti: priceList.products,
              })),
              nota:
                document && !documentForAi
                  ? `Il PDF ${document.fileName} non è ancora stato scansionato. Scansionalo soltanto dopo una domanda dell'utente sul PDF.`
                  : 'Usa i dati aziendali forniti solo per rispondere alla richiesta; non inventare informazioni mancanti.',
            }
          : null;
      const workspaceDataContext = {
        ...(dates
          ? {
              calendario: {
                intervalloConsultato: dates
                  ? { dal: dates.start, al: dates.end }
                  : 'intero calendario',
                totaleEventiConsultati: calendarEvents.length,
                eventi: selectedCalendarEvents.map((event) => ({
                  titolo: event.title,
                  data: event.date,
                  ora: event.time,
                  descrizione: event.description,
                  tipo: event.kind,
                  completato: event.completed,
                  assegnatoA: event.assignedUser?.name ?? null,
                })),
              },
            }
          : {}),
        ...(sales && period
          ? {
              vendite: {
                periodo: period.label,
                numeroPreventiviAccettatiOApprovati: sales._count._all,
                totaleEUR: (sales._sum.total ?? 0).toString(),
                totaleFormattato: new Intl.NumberFormat('it-IT', {
                  style: 'currency',
                  currency: 'EUR',
                }).format(Number(sales._sum.total ?? 0)),
                definizione:
                  'Valore dei preventivi creati nel periodo con stato ACCEPTED o APPROVED, coerente con la dashboard. Non rappresenta incassi: l’app non registra qui i pagamenti ricevuti.',
              },
            }
          : {}),
        ...(wantsDocument
          ? {
              documenti: documentEvidence ?? {
                numeroDocumentiDisponibili: documents.length,
                nomi: documents.slice(0, 20).map((item) => item.fileName),
                nota: 'Sono disponibili solo i metadati dei documenti; non sono stati estratti contenuti perché la domanda non richiede di leggerli.',
              },
            }
          : {}),
      };
      signal.throwIfAborted();
      metadata({
        sourcePages:
          documentForAi && pdfContext ? pdfContext.selected_page_numbers : [],
        documentName: documentForAi?.name ?? null,
        scannedNow,
      });
      if ((wantsSales || wantsCalendar) && !wantsDocument) {
        const answer = formatWorkspaceDataAnswer({
          ...(wantsCalendar
            ? {
                calendar: {
                  range: dates,
                  events: selectedCalendarEvents,
                },
              }
            : {}),
          ...(wantsSales && period && sales
            ? {
                sales: {
                  period,
                  total: Number(sales._sum.total ?? 0),
                  count: sales._count._all,
                },
              }
            : {}),
        });
        if (answer) return textAnswerStream(answer);
      }
      status('Lumi sta formulando la risposta…');
      return generateWorkspaceAssistantReply({
        content,
        signal,
        onStatus: status,
        onWebResult: (result) => webSources(result.sources, result.message),
        history: parsed.data.history as WorkspaceAssistantMessage[],
        organizationContext,
        workspaceDataContext,
        ...(documentForAi ? { document: documentForAi } : {}),
      });
    },
  );
}
