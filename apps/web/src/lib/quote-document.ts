import sanitizeHtml from 'sanitize-html';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  defaultDocumentSettings,
} from '@/lib/quote-document-format';
import { documentSettingsSchema } from '@/lib/quote-document-schema';

export function escapeDocumentText(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
}

export function imageIdFromSource(source: string, quoteId: string) {
  const prefix = `/api/quotes/${encodeURIComponent(quoteId)}/document/images/`;
  if (!source.startsWith(prefix)) return null;
  const id = source.slice(prefix.length);
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : null;
}

export function cleanDocumentHtml(html: string, quoteId: string) {
  const color = /^(?:#[a-f\d]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]{1,20})$/i;
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'h1',
      'h2',
      'h3',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'strike',
      'span',
      'mark',
      'sub',
      'sup',
      'br',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'colgroup',
      'col',
      'img',
      'a',
      'div',
    ],
    allowedAttributes: {
      '*': ['style'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'data-align'],
      div: ['data-page-break'],
      th: ['colspan', 'rowspan', 'colwidth'],
      td: ['colspan', 'rowspan', 'colwidth'],
      col: ['width'],
      ol: ['start'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedStyles: {
      '*': {
        color: [color],
        'background-color': [color],
        'text-align': [/^(left|center|right|justify)$/],
        'font-family': [
          /^(Arial|Georgia|Verdana|['"]?Times New Roman['"]?|['"]?Courier New['"]?)(,\s*(sans-serif|serif|monospace))?$/i,
        ],
        'font-size': [/^(?:[8-9]|[1-6]\d|7[0-2])(?:px|pt)$/],
        'line-height': [/^(?:1(?:\.\d{1,2})?|2(?:\.\d{1,2})?|3)$/],
        'margin-left': [/^(?:0|[1-9]\d?|1[0-5]\d|160)px$/],
        width: [/^(?:[1-9]\d?|100)%$/, /^\d{1,4}px$/],
        'min-width': [/^\d{1,4}px$/],
      },
    },
    transformTags: {
      a: (tagName, attrs) => ({
        tagName,
        attribs: { ...attrs, target: '_blank', rel: 'noopener noreferrer' },
      }),
      img: (tagName, attrs) => ({
        tagName,
        attribs: {
          ...attrs,
          src: imageIdFromSource(attrs.src ?? '', quoteId) ? attrs.src : '',
          width: String(
            Math.min(
              1000,
              Math.max(40, Number.parseInt(attrs.width || '480', 10) || 480),
            ),
          ),
          'data-align': ['left', 'center', 'right'].includes(
            attrs['data-align'],
          )
            ? attrs['data-align']
            : 'left',
        },
      }),
      div: (tagName, attrs) => {
        const attribs: Record<string, string> = {};
        if (attrs['data-page-break'] !== undefined)
          attribs['data-page-break'] = 'true';
        return { tagName, attribs };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  });
}

async function authorizeQuote<T>(
  request: Request,
  quoteId: string,
  load: (where: Prisma.QuoteWhereInput) => PromiseLike<T | null>,
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return {
      error: Response.json(
        { error: 'Accedi per aprire il documento.' },
        { status: 401 },
      ),
    };
  const quote = await load({
    id: quoteId,
    deletedAt: null,
    organization: { members: { some: { userId: session.user.id } } },
  });
  if (!quote)
    return {
      error: Response.json(
        { error: 'Preventivo non disponibile.' },
        { status: 404 },
      ),
    };
  return { quote, userId: session.user.id };
}

export function authorizeDocument(request: Request, quoteId: string) {
  return authorizeQuote(request, quoteId, (where) =>
    prisma.quote.findFirst({
      where,
      include: {
        organization: { select: { name: true } },
        customer: true,
        items: { orderBy: { createdAt: 'asc' } },
        document: true,
      },
    }),
  );
}

/**
 * Stessa autorizzazione di authorizeDocument, ma senza testo del documento,
 * cliente e righe: per le richieste che usano solo stato e azienda (es. autosalvataggio).
 */
export function authorizeQuoteAccess(request: Request, quoteId: string) {
  return authorizeQuote(request, quoteId, (where) =>
    prisma.quote.findFirst({
      where,
      select: { id: true, organizationId: true, status: true },
    }),
  );
}

type DocumentQuote = Prisma.QuoteGetPayload<{
  include: { organization: true; customer: true; items: true };
}>;

export async function readDocumentBody(request: Request, maxBytes = 1_100_000) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function quoteItemsHtml(
  quote: Pick<
    DocumentQuote,
    'items' | 'subtotal' | 'discount' | 'tax' | 'total' | 'currency'
  >,
) {
  const e = escapeDocumentText;
  const money = (value: { toString(): string } | null) =>
    value === null
      ? 'Da definire'
      : `${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value.toString()))} ${e(quote.currency)}`;
  const rows = quote.items
    .map(
      (item) =>
        `<tr><td><p>${e(item.code ?? '')}</p></td><td><p>${e(item.description)}</p></td><td><p>${e(item.quantity.toString())} ${e(item.unit)}</p></td><td><p>${money(item.unitPrice)}</p></td><td><p>${money(item.totalPrice)}</p></td></tr>`,
    )
    .join('');
  const missing =
    quote.items.length === 0 ||
    quote.items.some(
      (item) => item.unitPrice === null || item.totalPrice === null,
    );
  return `<h2>Dettaglio della fornitura</h2><table><tbody><tr><th><p>Codice</p></th><th><p>Descrizione</p></th><th><p>Quantità</p></th><th><p>Prezzo unitario</p></th><th><p>Importo</p></th></tr>${rows || '<tr><td><p></p></td><td><p>Descrizione del prodotto o servizio</p></td><td><p></p></td><td><p>Da definire</p></td><td><p>Da definire</p></td></tr>'}</tbody></table>${missing ? '<p><em>Importi da completare: il totale non è ancora definitivo.</em></p>' : `<p style="text-align:right">Subtotale: ${money(quote.subtotal)}<br>Sconto: ${money(quote.discount)}<br>Imposte: ${money(quote.tax)}<br><strong>Totale: ${money(quote.total)}</strong></p>`}`;
}

export function initialQuoteDocument(
  quote: Parameters<typeof quoteItemsHtml>[0] & {
    id: string;
    title: string;
    createdAt: Date;
    status: string;
    organization: { name: string };
    customer: {
      name: string;
      company: string | null;
      address: string | null;
      postalCode: string | null;
      city: string | null;
      province: string | null;
      country: string | null;
      email: string | null;
      phone: string | null;
      fiscalCode: string | null;
      vatNumber: string | null;
    } | null;
  },
) {
  const e = escapeDocumentText;
  const customer = quote.customer;
  const customerAddress = customer
    ? [
        customer.address,
        [customer.postalCode, customer.city].filter(Boolean).join(' '),
        customer.province,
        customer.country,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const customerDetails = customer
    ? [
        customer.company,
        customerAddress,
        customer.email,
        customer.phone,
        customer.fiscalCode ? `Codice fiscale: ${customer.fiscalCode}` : null,
        customer.vatNumber ? `Partita IVA: ${customer.vatNumber}` : null,
      ]
        .filter(Boolean)
        .map((detail) => e(detail))
        .join('<br>')
    : '[Indirizzo cliente]<br>[Email]';
  const html = `<h1>${e(quote.organization.name)}</h1><p>PREVENTIVO · ${e(quote.id.slice(-8).toUpperCase())}<br>Data: ${e(quote.createdAt.toLocaleDateString('it-IT'))}${quote.status === 'DRAFT' ? '<br><strong>BOZZA</strong>' : ''}</p><hr><h2>${e(quote.title)}</h2><p><strong>Spett.le ${e(customer?.name ?? '[Nome cliente]')}</strong>${customerDetails ? `<br>${customerDetails}` : ''}</p><p>Gentile Cliente, di seguito la nostra proposta per la fornitura richiesta.</p>${quoteItemsHtml(quote)}<h2>Condizioni della proposta</h2><p><strong>Validità:</strong> [indicare scadenza]<br><strong>Pagamento:</strong> [indicare modalità e termini]<br><strong>Consegna e posa:</strong> [indicare tempi e prestazioni incluse]<br><strong>Esclusioni:</strong> [indicare eventuali prestazioni escluse]</p><h2>Note</h2><p>[Inserire eventuali specifiche, finiture e precisazioni.]</p><hr><p>Per accettazione<br>Luogo e data: ____________________<br>Firma del cliente: ____________________</p>`;
  return {
    html,
    settings: {
      ...defaultDocumentSettings,
      header: quote.organization.name.slice(0, 160),
    },
  };
}

export function readDocumentSettings(value: unknown) {
  const parsed = documentSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultDocumentSettings;
}
