import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { fetchPublicText, publicWebUrl } from "./web-http";
import type { WebResult, WebSource } from "./web-types";

export type WebToolContext = { signal?: AbortSignal; allowedUrls?: string[] };
const shortText = z.string().trim().min(1).max(180);
const query = shortText.refine(
  (text) =>
    !/@|\b(?:sk-|Bearer\s)|(?:password|token|secret|api_key)\s*[:=]|\b\d{8,}\b|(?:\/Users\/|\/home\/)/i.test(
      text,
    ),
  "La ricerca contiene possibili dati privati: usa solo termini pubblici.",
);

export function plainText(value: string) {
  return sanitizeHtml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Math.min(Number(code), 0x10ffff)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function localDate(now = new Date(), timezone = "Europe/Rome") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function source(
  title: string,
  url: string,
  kind: WebSource["kind"],
  publisher?: string,
  publishedAt?: string,
): WebSource {
  const safeUrl = publicWebUrl(url).href;
  return {
    id: "",
    title: plainText(title).slice(0, 220),
    url: safeUrl,
    publisher: publisher || new URL(safeUrl).hostname,
    retrievedAt: new Date().toISOString(),
    kind,
    ...(publishedAt ? { publishedAt } : {}),
  };
}

async function json(
  url: string,
  context: WebToolContext,
  headers?: Record<string, string>,
): Promise<unknown> {
  const result = await fetchPublicText(url, {
    signal: context.signal,
    headers,
  });
  return JSON.parse(result.text);
}

export async function fetchPage(
  url: string,
  context: WebToolContext,
): Promise<WebResult> {
  const safe = publicWebUrl(url).href;
  if (!context.allowedUrls?.includes(safe))
    return {
      status: "unavailable",
      sources: [],
      message:
        "Puoi leggere solo URL forniti dall’utente o restituiti dalla ricerca corrente.",
    };
  const page = await fetchPublicText(safe, { signal: context.signal });
  const title =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.text)?.[1] ||
    new URL(page.url).hostname;
  return {
    status: "ok",
    sources: [source(title, page.url, "page")],
    data: { text: plainText(page.text).slice(0, 4500), excerpt: true },
  };
}

const searxngItem = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string().optional(),
  publishedDate: z.string().nullable().optional(),
  engine: z.string().optional(),
});

async function searchWeb(
  args: { query: string; freshness: "day" | "week" | "month" | "any" },
  context: WebToolContext,
): Promise<WebResult> {
  const url = new URL("http://127.0.0.1:8889/search");
  url.searchParams.set("q", args.query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "it-IT");
  if (args.freshness === "day" || args.freshness === "month")
    url.searchParams.set("time_range", args.freshness);
  const signal = AbortSignal.any([
    AbortSignal.timeout(12_000),
    ...(context.signal ? [context.signal] : []),
  ]);
  const response = await fetch(url, {
    signal,
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("json"))
    throw new Error(`SearXNG returned HTTP ${response.status}.`);
  if (Number(response.headers.get("content-length") ?? 0) > 700_000)
    throw new Error("SearXNG response exceeds the allowed size.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SearXNG returned an empty response.");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 700_000) {
        await reader.cancel();
        throw new Error("SearXNG response exceeds the allowed size.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const result = z
    .object({ results: z.array(searxngItem) })
    .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const sources: WebSource[] = [];
  const data: {
    source: number;
    snippet: string;
    text?: string;
    excerpt?: boolean;
  }[] = [];
  for (const item of result.results.slice(0, 5)) {
    try {
      sources.push(
        source(
          item.title,
          item.url,
          "search",
          item.engine,
          isoDate(item.publishedDate ?? undefined),
        ),
      );
      data.push({
        source: sources.length,
        snippet: plainText(item.content ?? "").slice(0, 1000),
      });
    } catch {
      /* Ignore unsafe result URLs. */
    }
  }
  // Read the first two pages; failure leaves explicitly labelled search snippets.
  for (let i = 0; i < Math.min(sources.length, 2); i++) {
    try {
      const page = await fetchPage(sources[i].url, {
        ...context,
        allowedUrls: [sources[i].url],
      });
      data[i] = {
        ...data[i],
        ...(page.data as { text: string; excerpt: boolean }),
      };
      if (page.sources[0])
        sources[i] = { ...sources[i], url: page.sources[0].url, kind: "page" };
    } catch {
      context.signal?.throwIfAborted();
    }
  }
  return sources.length
    ? { status: "ok", sources, data }
    : {
        status: "unavailable",
        sources: [],
        message: "Nessun risultato utilizzabile: non inventare fatti o fonti.",
      };
}

export function parseNewsFeed(
  xml: string,
  publisher: string,
  period: "today" | "week",
  now = new Date(),
) {
  const items: { source: WebSource; summary: string }[] = [];
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return items;
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const field = (name: string) =>
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(
        match[1],
      )?.[1] ?? "";
    const publishedAt = isoDate(plainText(field("pubDate")));
    if (
      !publishedAt ||
      Date.parse(publishedAt) > now.getTime() + 300_000 ||
      (period === "today"
        ? localDate(new Date(publishedAt)) !== localDate(now)
        : now.getTime() - Date.parse(publishedAt) > 7 * 86400_000)
    )
      continue;
    try {
      items.push({
        source: source(
          field("title"),
          plainText(field("link")),
          "news",
          publisher,
          publishedAt,
        ),
        summary: plainText(field("description")).slice(0, 1200),
      });
    } catch {
      /* Skip invalid or unsafe links. */
    }
  }
  return items;
}

async function news(
  args: { period: "today" | "week" },
  context: WebToolContext,
): Promise<WebResult> {
  const feeds = [
    { publisher: "ANSA", url: "https://www.ansa.it/sito/ansait_rss.xml" },
    {
      publisher: "BBC News",
      url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    },
  ];
  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const result = await fetchPublicText(feed.url, {
        signal: context.signal,
      });
      return parseNewsFeed(result.text, feed.publisher, args.period).slice(
        0,
        4,
      );
    }),
  );
  context.signal?.throwIfAborted();
  const items = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => b.source.publishedAt!.localeCompare(a.source.publishedAt!))
    .slice(0, 6);
  return items.length
    ? {
        status: "ok",
        sources: items.map((item) => item.source),
        data: {
          scope:
            "Selezione dei feed ANSA e BBC; titoli e sommari, non articoli integrali né copertura esaustiva.",
          period: args.period,
          date: localDate(),
          articles: items.map((item, i) => ({
            source: i + 1,
            summary: item.summary,
          })),
        },
      }
    : {
        status: "unavailable",
        sources: [],
        message:
          "Nessuna notizia con data verificabile nel periodo richiesto. Non presentare notizie vecchie come notizie di oggi.",
      };
}

async function releases(
  args: { repository: string },
  context: WebToolContext,
): Promise<WebResult> {
  const url = `https://api.github.com/repos/${args.repository}/releases?per_page=3`;
  const result = z
    .array(
      z.object({
        name: z.string().nullable(),
        tag_name: z.string(),
        html_url: z.string(),
        published_at: z.string().nullable(),
        body: z.string().nullable(),
        prerelease: z.boolean(),
        draft: z.boolean(),
      }),
    )
    .parse(await json(url, context));
  const items = result.filter((r) => !r.draft && !r.prerelease);
  if (!items.length)
    return {
      status: "unavailable",
      sources: [],
      message: "Nessuna release stabile pubblicata trovata.",
    };
  return {
    status: "ok",
    sources: items.map((r) =>
      source(
        r.name || r.tag_name,
        r.html_url,
        "api",
        `GitHub · ${args.repository}`,
        isoDate(r.published_at),
      ),
    ),
    data: items.map((r, i) => ({
      source: i + 1,
      version: r.tag_name,
      notes: plainText(r.body ?? "").slice(0, 2500),
    })),
  };
}

async function crypto(
  args: { symbol: string; currency: string },
  context: WebToolContext,
): Promise<WebResult> {
  const url = `https://api.coinbase.com/v2/prices/${args.symbol}-${args.currency}/spot`;
  const result = z
    .object({
      data: z.object({
        amount: z.string().regex(/^\d+(\.\d+)?$/),
        currency: z.string(),
        base: z.string(),
      }),
    })
    .parse(await json(url, context));
  return {
    status: "ok",
    sources: [
      source(`${args.symbol}/${args.currency} spot`, url, "api", "Coinbase"),
    ],
    data: {
      ...result.data,
      retrievedAt: new Date().toISOString(),
      note: "Prezzo spot Coinbase al momento del recupero, non una quotazione universale.",
    },
  };
}

async function stockPrice(
  args: { symbol: string },
  context: WebToolContext,
): Promise<WebResult> {
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(args.symbol)}`,
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", "5d");
  const response = z
    .object({
      chart: z.object({
        result: z
          .array(
            z.object({
              meta: z
                .object({
                  currency: z.string().regex(/^[A-Z]{3}$/),
                  symbol: z.string(),
                  exchangeName: z.string().optional(),
                  fullExchangeName: z.string().optional(),
                  instrumentType: z.string().optional(),
                  regularMarketPrice: z.number().finite().nonnegative().optional(),
                  regularMarketTime: z.number().finite().positive().optional(),
                  longName: z.string().optional(),
                  shortName: z.string().optional(),
                })
                .passthrough(),
            }),
          )
          .nullable()
          .optional(),
        error: z.unknown().nullable().optional(),
      }),
    })
    .parse(await json(url.href, context));
  const quote = response.chart.result?.[0]?.meta;
  if (
    !quote ||
    quote.instrumentType !== "EQUITY" ||
    quote.regularMarketPrice === undefined ||
    quote.regularMarketTime === undefined
  )
    return {
      status: "unavailable",
      sources: [],
      message: `Yahoo Finance non ha restituito una quotazione azionaria verificabile per ${args.symbol}.`,
    };

  const name = quote.longName || quote.shortName || quote.symbol;
  const exchange = quote.fullExchangeName || quote.exchangeName || "non specificato";
  return {
    status: "ok",
    sources: [
      source(
        `${name} (${quote.symbol})`,
        url.href,
        "api",
        "Yahoo Finance",
        new Date(quote.regularMarketTime * 1000).toISOString(),
      ),
    ],
    data: {
      kind: "stock_quote",
      name,
      symbol: quote.symbol,
      price: quote.regularMarketPrice,
      currency: quote.currency,
      exchange,
      quotedAt: new Date(quote.regularMarketTime * 1000).toISOString(),
    },
  };
}

function define<T extends z.ZodType>(
  name: string,
  description: string,
  schema: T,
  execute: (args: z.output<T>, context: WebToolContext) => Promise<WebResult>,
) {
  return {
    definition: {
      type: "function" as const,
      function: { name, description, parameters: z.toJSONSchema(schema) },
    },
    execute: (args: unknown, context: WebToolContext) =>
      execute(schema.parse(args), context),
  };
}

/** Shared with the existing application tool catalog and dispatcher. */
export const webToolRegistry = [
  define(
    "web_search",
    "Ricerca web generale, documentazione corrente, sport o notizie specifiche. Solo query pubblica minima; freshness day per oggi. Richiede Brave Search API.",
    z
      .object({ query, freshness: z.enum(["day", "week", "month", "any"]) })
      .strict(),
    searchWeb,
  ),
  define(
    "web_fetch",
    "Legge un URL HTTPS presente nel messaggio dell’utente o nei risultati reali della ricerca corrente.",
    z.object({ url: z.string().url().max(2048) }).strict(),
    (args, context) => fetchPage(args.url, context),
  ),
  define(
    "get_news",
    "Principali notizie generali di oggi (today) o della settimana (week), dai feed primari ANSA e BBC. Per ricerche su un argomento specifico usa web_search.",
    z.object({ period: z.enum(["today", "week"]) }).strict(),
    news,
  ),
  define(
    "software_releases",
    "Ultime release stabili e novità ufficiali di un progetto GitHub pubblico. Per llama.cpp il repository ufficiale è ggml-org/llama.cpp. Non inventare un repository sconosciuto.",
    z
      .object({
        repository: z
          .string()
          .regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/)
          .max(120),
      })
      .strict(),
    releases,
  ),
  define(
    "get_crypto_price",
    "Quotazione spot attuale crypto Coinbase. Usa BTC per Bitcoin. Se la valuta non è specificata usa EUR e dichiarala.",
    z
      .object({
        symbol: z.string().regex(/^[A-Z0-9]{2,10}$/),
        currency: z.enum(["EUR", "USD", "GBP"]),
      })
      .strict(),
    crypto,
  ),
  define(
    "get_stock_price",
    "Ultimo prezzo di mercato verificato di un'azione quotata. Richiede il ticker, per esempio AAPL, MSFT o NVDA. Riporta valuta, borsa e orario del dato.",
    z
      .object({
        symbol: z.string().regex(/^[A-Z0-9.^=-]{1,20}$/),
      })
      .strict(),
    stockPrice,
  ),
];

export const webTools = webToolRegistry.map((tool) => tool.definition);
export const isWebTool = (name: string) =>
  webToolRegistry.some((tool) => tool.definition.function.name === name);

export async function executeWebTool(
  name: string,
  args: unknown,
  context: WebToolContext,
): Promise<WebResult> {
  const tool = webToolRegistry.find(
    (entry) => entry.definition.function.name === name,
  );
  if (!tool)
    return {
      status: "unavailable",
      sources: [],
      message: "Strumento web non riconosciuto.",
    };
  if (process.env.WEB_ACCESS_ENABLED === "false")
    return {
      status: "unavailable",
      sources: [],
      message:
        "Accesso web disattivato: non posso verificare informazioni aggiornate.",
    };
  try {
    const result = await tool.execute(args, context);
    return {
      ...result,
      sources: result.sources.map((s, i) => ({ ...s, id: `W${i + 1}` })),
    };
  } catch {
    context.signal?.throwIfAborted();
    return {
      status: "unavailable",
      sources: [],
      message:
        name === "web_search"
          ? "Ricerca web locale non disponibile: SearXNG non risponde su 127.0.0.1:8889. Avvia il servizio con `pnpm --filter @lumi-01/web searxng:start`."
          : "Non è stato possibile recuperare informazioni aggiornate: servizio non disponibile, richiesta non valida o limite di rete. Non inventare dati recenti.",
    };
  }
}
