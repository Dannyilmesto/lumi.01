import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const assistantPdfContextSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  page_count: z.number().int().positive(),
  document_kind: z.enum(['text', 'scanned', 'mixed', 'unreadable']),
  selected_page_numbers: z.array(z.number().int().positive()).max(6),
  pages: z.array(
    z.object({
      page_number: z.number().int().positive(),
      text: z.string().max(16_000),
      requires_ocr: z.boolean(),
      warnings: z.array(z.string()),
      image_base64: z.string().min(1).optional(),
    }),
  ),
});

export type AssistantPdfContext = z.infer<typeof assistantPdfContextSchema>;

const storedExtractionSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  page_count: z.number().int().positive(),
  document_kind: z.enum(['text', 'scanned', 'mixed', 'unreadable']),
  pages: z.array(
    z.object({
      page_number: z.number().int().positive(),
      text: z.string(),
      requires_ocr: z.boolean(),
      warnings: z.array(z.string()),
      tables: z.array(z.unknown()).default([]),
    }),
  ),
});

const stopWords = new Set([
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
  'il',
  'in',
  'la',
  'le',
  'lo',
  'ma',
  'mi',
  'nel',
  'nella',
  'nelle',
  'nello',
  'non',
  'per',
  'piu',
  'puo',
  'quale',
  'quali',
  'quando',
  'quanto',
  'questa',
  'queste',
  'questi',
  'questo',
  'qui',
  'sono',
  'sua',
  'sue',
  'sugli',
  'sui',
  'sul',
  'sulla',
  'sulle',
  'sullo',
  'tra',
  'una',
  'uno',
  'voi',
  'vuoi',
  'vorrei',
]);

function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase('it-IT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function pageTextWithTables(page: { text: string; tables: unknown[] }) {
  const rows: string[] = [];
  for (const table of page.tables) {
    if (!table || typeof table !== 'object' || !('rows' in table)) continue;
    const tableRows = (table as { rows?: unknown }).rows;
    if (!Array.isArray(tableRows)) continue;
    for (const row of tableRows) {
      if (!Array.isArray(row)) continue;
      const cells = row
        .map((cell) => String(cell ?? '').trim())
        .filter(Boolean);
      if (cells.length) rows.push(cells.join(' | '));
    }
  }
  return [...(page.text.trim() ? [page.text.trim()] : []), ...rows]
    .join('\n')
    .slice(0, 16_000);
}

/** Reuses saved Python extraction for chat turns without rendering the PDF again. */
export function prepareAssistantPdfContextFromExtraction(input: {
  extraction: unknown;
  query: string;
  preferredPages: number[];
}): AssistantPdfContext {
  const parsed = storedExtractionSchema.safeParse(input.extraction);
  if (!parsed.success)
    throw new Error(
      'L’estrazione salvata del PDF non è valida. Ri-analizza il documento.',
    );

  const { data } = parsed;
  const terms = [
    ...new Set(normalizeSearchText(input.query).match(/[a-z0-9]{2,}/g) ?? []),
  ].filter((term) => !stopWords.has(term));
  const preferredRank = new Map(
    input.preferredPages.map((pageNumber, index) => [pageNumber, index]),
  );
  const ranked = data.pages
    .map((page) => {
      const content = normalizeSearchText(pageTextWithTables(page));
      const queryScore = terms.reduce(
        (total, term) => total + Math.min(content.split(term).length - 1, 4),
        0,
      );
      const rank = preferredRank.get(page.page_number);
      const preferredScore = rank === undefined ? 0 : Math.max(1, 12 - rank);
      return { page, score: queryScore + preferredScore };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.page.page_number - right.page.page_number,
    );

  const selected = ranked.length
    ? ranked.slice(0, 3).map(({ page }) => page)
    : data.pages.slice(0, 3);
  if (
    selected.length > 0 &&
    !selected.some((page) => page.page_number === 1) &&
    selected.length < 3
  ) {
    const cover = data.pages.find((page) => page.page_number === 1);
    if (cover) selected.push(cover);
  }
  selected.sort((left, right) => left.page_number - right.page_number);

  return assistantPdfContextSchema.parse({
    sha256: data.sha256,
    page_count: data.page_count,
    document_kind: data.document_kind,
    selected_page_numbers: selected.map((page) => page.page_number),
    pages: selected.map((page) => ({
      page_number: page.page_number,
      text: pageTextWithTables(page),
      requires_ocr: page.requires_ocr,
      warnings: page.warnings,
    })),
  });
}

async function findWorkerDirectory() {
  const roots = [
    resolve(process.cwd(), 'services/document-worker'),
    resolve(process.cwd(), '../../services/document-worker'),
  ];
  for (const root of roots) {
    try {
      await access(
        join(root, 'serramenti_document_worker', 'assistant_pdf_cli.py'),
      );
      return root;
    } catch {
      // Try the monorepo root relative to the other common Next.js working directory.
    }
  }
  throw new Error(
    'Worker PDF non trovato. Avvia l’app dalla cartella principale del progetto.',
  );
}

async function findPythonExecutable(workerDirectory: string) {
  const configured = process.env.SERRAMENTI_DOCUMENT_WORKER_PYTHON;
  const venvPython =
    process.platform === 'win32'
      ? join(workerDirectory, '.venv', 'Scripts', 'python.exe')
      : join(workerDirectory, '.venv', 'bin', 'python');
  const pythonPath = configured ? resolve(configured) : venvPython;
  try {
    await access(pythonPath);
    return pythonPath;
  } catch {
    throw new Error(
      'Python del worker non configurato. Esegui “uv sync” in services/document-worker.',
    );
  }
}

export async function prepareAssistantPdfContext(input: {
  pdfBytes: Buffer;
  query: string;
  preferredPages: number[];
  extraction?: unknown;
  pageLimit?: number;
  maxImageSide?: number;
  signal?: AbortSignal;
}): Promise<AssistantPdfContext> {
  input.signal?.throwIfAborted();
  const workerDirectory = await findWorkerDirectory();
  const pythonPath = await findPythonExecutable(workerDirectory);
  const pageLimit = Math.min(3, Math.max(1, input.pageLimit ?? 3));
  const cachedContext = input.extraction
    ? prepareAssistantPdfContextFromExtraction({
        extraction: input.extraction,
        query: input.query,
        preferredPages: input.preferredPages,
      })
    : undefined;
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'serramenti-assistant-'),
  );
  const pdfPath = join(temporaryDirectory, 'listino.pdf');
  const requestPath = join(temporaryDirectory, 'richiesta.json');

  try {
    await Promise.all([
      writeFile(pdfPath, input.pdfBytes, { flag: 'wx', mode: 0o600 }),
      writeFile(
        requestPath,
        JSON.stringify({
          query: input.query.slice(0, 12_000),
          preferred_pages: [...new Set(input.preferredPages)].slice(0, 20),
          page_limit: pageLimit,
          image_max_side: Math.min(
            1800,
            Math.max(512, input.maxImageSide ?? 1800),
          ),
          prepared_context: cachedContext,
        }),
        { flag: 'wx', mode: 0o600 },
      ),
    ]);

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        pythonPath,
        [
          '-m',
          'serramenti_document_worker.assistant_pdf_cli',
          pdfPath,
          requestPath,
        ],
        {
          cwd: workerDirectory,
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONPATH: [workerDirectory, process.env.PYTHONPATH]
              .filter(Boolean)
              .join(delimiter),
          },
          maxBuffer: 48 * 1024 * 1024,
          timeout: 240_000,
          signal: input.signal,
        },
      ));
    } catch (error) {
      input.signal?.throwIfAborted();
      if (
        error &&
        typeof error === 'object' &&
        'stderr' in error &&
        typeof error.stderr === 'string' &&
        error.stderr.includes('No module named')
      ) {
        throw new Error(
          'Librerie Python del worker non installate. Esegui “uv sync” in services/document-worker.',
        );
      }
      if (
        error &&
        typeof error === 'object' &&
        'killed' in error &&
        error.killed
      ) {
        throw new Error(
          'La preparazione locale del PDF ha superato il tempo previsto.',
        );
      }
      throw new Error(
        'Non è stato possibile leggere e preparare le pagine del PDF.',
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stdout);
    } catch {
      throw new Error('Il worker PDF ha restituito un risultato non valido.');
    }

    const result = assistantPdfContextSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new Error(
        'Il contesto estratto dal PDF non rispetta lo schema atteso.',
      );
    }
    return result.data;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
