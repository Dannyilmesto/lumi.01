import { chromium } from 'playwright';
import { prisma } from '@/lib/prisma';
import {
  authorizeDocument,
  cleanDocumentHtml,
  escapeDocumentText,
  imageIdFromSource,
  readDocumentSettings,
} from '@/lib/quote-document';
import { documentContentCss } from '@/lib/quote-document-format';

export const runtime = 'nodejs';
export const maxDuration = 90;
const pdfState = globalThis as unknown as { quotePdfJobs?: number };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorized = await authorizeDocument(request, id);
  if ('error' in authorized) return authorized.error;
  const doc = authorized.quote.document;
  if (!doc)
    return Response.json(
      { error: 'Salva il documento prima di esportarlo.' },
      { status: 409 },
    );
  const requestedRevision = new URL(request.url).searchParams.get('revision');
  if (requestedRevision !== null && requestedRevision !== String(doc.revision))
    return Response.json(
      {
        error:
          'Il documento è stato modificato. Ricarica la versione aggiornata prima di esportare.',
      },
      { status: 409 },
    );
  if ((pdfState.quotePdfJobs ?? 0) >= 2)
    return Response.json(
      {
        error:
          'Sono già in preparazione altri PDF. Riprova tra qualche secondo.',
      },
      { status: 429 },
    );
  pdfState.quotePdfJobs = (pdfState.quotePdfJobs ?? 0) + 1;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let html = cleanDocumentHtml(doc.html, id);
    const sources = [
      ...new Set(
        [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      ),
    ];
    const ids = sources.flatMap((source) => {
      const imageId = imageIdFromSource(source, id);
      return imageId ? [imageId] : [];
    });
    const images = await prisma.quoteDocumentImage.findMany({
      where: { quoteId: id, id: { in: ids } },
    });
    if (images.length !== ids.length)
      return Response.json(
        {
          error:
            'Un’immagine del documento non è disponibile. Ricaricala prima di esportare.',
        },
        { status: 409 },
      );
    for (const image of images) {
      const source = `/api/quotes/${encodeURIComponent(id)}/document/images/${image.id}`;
      html = html
        .split(`src="${source}"`)
        .join(
          `src="data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}"`,
        );
    }
    const settings = readDocumentSettings(doc.settings);
    const dimensions = settings.format === 'A4' ? [210, 297] : [216, 279];
    const imageMaxHeight =
      dimensions[settings.landscape ? 0 : 1] - 2 * settings.margin - 12;
    browser = await chromium.launch({ headless: true, timeout: 30_000 });
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
    });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.setContent(
      `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escapeDocumentText(authorized.quote.title)}</title><style>${documentContentCss}body{margin:0;background:white;--document-image-max-height:${imageMaxHeight}mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body><main class="document-content">${html}</main></body></html>`,
      { waitUntil: 'load' },
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((img) => img.decode()));
      document.querySelectorAll('table').forEach((table) => {
        const first = table.rows[0];
        if (
          first &&
          Array.from(first.cells).every((cell) => cell.tagName === 'TH')
        )
          table.createTHead().appendChild(first);
      });
    });
    const margin = `${settings.margin}mm`;
    const pdf = await page.pdf({
      format: settings.format,
      landscape: settings.landscape,
      printBackground: true,
      margin: { top: margin, right: margin, bottom: margin, left: margin },
      displayHeaderFooter: Boolean(
        settings.header || settings.footer || settings.pageNumbers,
      ),
      headerTemplate: `<div style="width:100%;font:8px Arial;color:#607887;margin:0 ${margin};overflow:hidden;white-space:nowrap">${escapeDocumentText(settings.header)}</div>`,
      footerTemplate: `<div style="width:100%;display:flex;justify-content:space-between;font:8px Arial;color:#607887;margin:0 ${margin}"><span>${escapeDocumentText(settings.footer)}</span>${settings.pageNumbers ? '<span>Pagina <span class="pageNumber"></span> di <span class="totalPages"></span></span>' : ''}</div>`,
    });
    const fileName = `${authorized.quote.title.replace(/[\x00-\x1f\x7f/\\]/g, '-').slice(0, 90) || 'preventivo'}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="preventivo.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error(
      'Esportazione PDF non riuscita.',
      error instanceof Error ? error.name : 'unknown',
    );
    return Response.json(
      {
        error:
          'Non è stato possibile generare il PDF. Controlla che il motore PDF sia installato e riprova. Il documento è salvato.',
      },
      { status: 500 },
    );
  } finally {
    await browser?.close().catch(() => undefined);
    pdfState.quotePdfJobs = Math.max(0, (pdfState.quotePdfJobs ?? 1) - 1);
  }
}
