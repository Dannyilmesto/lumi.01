import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  fetchPublicText,
  isPublicAddress,
  publicWebUrl,
} from "../src/lib/web-http.ts";
import {
  executeWebTool,
  parseNewsFeed,
  plainText,
} from "../src/lib/web-tools.ts";
import {
  formatWebResultFallback,
  formatStockQuoteAnswer,
  hasWebAccessRefusal,
  isWorkspaceDataRequest,
  prepareWebContext,
  requestedWebPlan,
} from "../src/lib/assistant-web.ts";

test("rejects private, metadata, reserved, mapped and transition addresses", () => {
  for (const ip of [
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "198.18.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(isPublicAddress(ip), true, ip);
  for (const url of [
    "http://example.com",
    "file:///etc/passwd",
    "https://127.1",
    "https://2130706433",
    "https://[::1]",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://service.local",
  ])
    assert.throws(() => publicWebUrl(url), undefined, url);
});

function mockNetwork(
  t,
  handler,
  addresses = [{ address: "93.184.215.14", family: 4 }],
) {
  t.mock.method(dns, "lookup", async () => addresses);
  t.mock.method(https, "request", (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => handler(url, options, callback, req));
    return req;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}
function response(callback, body, status = 200, headers = {}) {
  const res = Readable.from([Buffer.from(body)]);
  res.statusCode = status;
  res.headers = { "content-type": "text/plain", ...headers };
  callback(res);
}
test("pins DNS to the checked address instead of resolving twice", async (t) => {
  mockNetwork(t, (_url, opts, cb) => {
    assert.equal(opts.family, 4);
    assert.equal(opts.agent, false);
    opts.lookup("example.com", {}, (err, addr, family) => {
      assert.equal(addr, "93.184.215.14");
      assert.equal(family, 4);
    });
    response(cb, "safe");
  });
  assert.equal((await fetchPublicText("https://example.com")).text, "safe");
});
test("blocks redirects to private resources", async (t) => {
  mockNetwork(t, (_url, _opts, cb) =>
    response(cb, "", 302, { location: "https://127.0.0.1/admin" }),
  );
  await assert.rejects(fetchPublicText("https://example.com"));
});
test("rejects DNS responses containing even one private address", async (t) => {
  let called = false;
  mockNetwork(t, () => {
    called = true;
  }, [
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await assert.rejects(fetchPublicText("https://example.com"));
  assert.equal(called, false);
});
test("enforces body size and content type", async (t) => {
  mockNetwork(t, (_url, _opts, cb) => response(cb, "x".repeat(100)));
  await assert.rejects(
    fetchPublicText("https://example.com", { maxBytes: 50 }),
  );
});
test("does not forward provider secrets on cross-origin redirects", async (t) => {
  let calls = 0;
  mockNetwork(t, (_url, opts, cb) => {
    calls++;
    if (calls === 1)
      response(cb, "", 302, { location: "https://other.example.org/path" });
    else {
      assert.equal(opts.headers["X-Subscription-Token"], undefined);
      response(cb, "ok");
    }
  });
  await fetchPublicText("https://example.com", {
    headers: { "X-Subscription-Token": "test-only" },
  });
});
test("network errors return a usable failure, never invented data", async (t) => {
  mockNetwork(t, (_url, _opts, _cb, req) =>
    req.emit("error", new Error("simulated offline")),
  );
  const result = await executeWebTool(
    "get_crypto_price",
    { symbol: "BTC", currency: "EUR" },
    {},
  );
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.sources, []);
  assert.equal(result.data, undefined);
});
test("missing local SearXNG and unknown tools are explicit failures", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("SearXNG is offline");
  });
  const result = await executeWebTool(
    "web_search",
    { query: "risultati sportivi", freshness: "day" },
    {},
  );
  assert.match(result.message, /SearXNG non risponde/);
  assert.match(result.message, /searxng:start/);
  assert.equal(
    (await executeWebTool("shell", { cmd: "whoami" }, {})).status,
    "unavailable",
  );
});
test("general search uses local SearXNG and returns sanitized cited results", async (t) => {
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, "http://127.0.0.1:8889");
    assert.equal(url.searchParams.get("format"), "json");
    assert.equal(url.searchParams.get("q"), "latest Next.js");
    assert.equal(url.searchParams.get("time_range"), "day");
    return Response.json({
      results: [
        {
          title: "Next.js update",
          url: "https://nextjs.org/blog/latest",
          content: "<b>Latest</b> framework release",
          publishedDate: "2026-10-02T00:00:00Z",
          engine: "duckduckgo",
        },
      ],
    });
  });
  mockNetwork(t, (_url, _options, callback) =>
    response(
      callback,
      "<html><title>Next.js Blog</title><p>Release details</p></html>",
      200,
      { "content-type": "text/html" },
    ),
  );

  const result = await executeWebTool(
    "web_search",
    { query: "latest Next.js", freshness: "day" },
    {},
  );
  assert.equal(result.status, "ok");
  assert.equal(result.sources[0].url, "https://nextjs.org/blog/latest");
  assert.equal(result.sources[0].id, "W1");
  assert.match(result.data[0].snippet, /Latest framework release/);
});
test("unapproved URLs are blocked", async (t) => {
  let called = false;
  mockNetwork(t, () => {
    called = true;
  });
  assert.equal(
    (await executeWebTool("web_fetch", { url: "https://example.com" }, {}))
      .status,
    "unavailable",
  );
  assert.equal(called, false);
});
test("news rejects stale/future/undated stories and preserves source metadata", () => {
  const item = (date, title = "Story") =>
    `<item><title>${title}</title><link>https://example.com/story</link><description>Real summary</description><pubDate>${date}</pubDate></item>`;
  const xml =
    "<rss>" +
    item("Thu, 01 Oct 2026 08:00:00 GMT") +
    item("Wed, 30 Sep 2026 10:00:00 GMT") +
    item("Fri, 02 Oct 2026 10:00:00 GMT") +
    item("") +
    "</rss>";
  const items = parseNewsFeed(
    xml,
    "Publisher",
    "today",
    new Date("2026-10-01T10:00:00Z"),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].source.publisher, "Publisher");
  assert.equal(items[0].source.publishedAt, "2026-10-01T08:00:00.000Z");
  assert.equal(
    parseNewsFeed("<!DOCTYPE rss>" + xml, "Publisher", "today").length,
    0,
  );
  assert.equal(plainText("<script>steal()</script><p>news</p>"), "news");
});
test("stable routing uses local model and no outbound search", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    calls++;
    assert.equal(
      new URL(url).href,
      "http://127.0.0.1:8888/v1/chat/completions",
    );
    const body = JSON.parse(opts.body);
    assert.equal(body.model, "unsloth/Qwen3.5-2B-GGUF");
    assert.equal(body.messages[0].role, "system");
    return Response.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({ mode: "local", tool: "", arguments: {} }),
          },
          finish_reason: "stop",
        },
      ],
    });
  });
  assert.equal(
    await prepareWebContext({ content: "Scrivi una poesia.", history: [] }),
    null,
  );
  assert.equal(calls, 1);
});
test("invalid router JSON falls back to deterministic web routing", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [
        {
          message: { role: "assistant", content: "invalid" },
          finish_reason: "stop",
        },
      ],
    }),
  );
  // Feed RSS simulati: il test non deve dipendere dalla rete reale.
  const pubDate = new Date(Date.now() - 60_000).toUTCString();
  mockNetwork(t, (_url, _opts, cb) =>
    response(
      cb,
      `<rss><item><title>Story</title><link>https://example.com/story</link><description>Real summary</description><pubDate>${pubDate}</pubDate></item></rss>`,
      200,
      { "content-type": "application/rss+xml" },
    ),
  );
  const result = await prepareWebContext({
    content: "ultime notizie",
    history: [],
  });
  assert.equal(result.status, "ok");
  assert.ok(result.sources.length);
});

test("routes common public requests to deterministic web tools", () => {
  assert.deepEqual(requestedWebPlan("Quali sono le ultime notizie?"), {
    mode: "tool",
    tool: "get_news",
    arguments: { period: "today" },
  });
  assert.deepEqual(requestedWebPlan("Quanto vale Bitcoin adesso in USD?"), {
    mode: "tool",
    tool: "get_crypto_price",
    arguments: { symbol: "BTC", currency: "USD" },
  });
  assert.deepEqual(requestedWebPlan("Quanto è quotata Apple in borsa oggi?"), {
    mode: "tool",
    tool: "get_stock_price",
    arguments: { symbol: "AAPL" },
  });
  assert.deepEqual(requestedWebPlan("Prezzo delle azioni NVIDIA"), {
    mode: "tool",
    tool: "get_stock_price",
    arguments: { symbol: "NVDA" },
  });
  assert.equal(requestedWebPlan("Riassumi il testo qui sotto"), null);
});

test("stock quote uses validated Yahoo market data and formats its timestamp", async (t) => {
  const quotedAt = 1790971201;
  let requestUrl;
  mockNetwork(t, (url, _options, callback) => {
    requestUrl = url;
    response(
      callback,
      JSON.stringify({
        chart: {
          result: [
            {
              meta: {
                currency: "USD",
                symbol: "AAPL",
                exchangeName: "NMS",
                fullExchangeName: "NasdaqGS",
                instrumentType: "EQUITY",
                regularMarketPrice: 333.69,
                regularMarketTime: quotedAt,
                longName: "Apple Inc.",
              },
            },
          ],
          error: null,
        },
      }),
      200,
      { "content-type": "application/json" },
    );
  });
  const result = await executeWebTool("get_stock_price", { symbol: "AAPL" }, {});
  assert.equal(result.status, "ok");
  assert.equal(requestUrl.hostname, "query1.finance.yahoo.com");
  assert.equal(requestUrl.pathname, "/v8/finance/chart/AAPL");
  assert.deepEqual(result.data, {
    kind: "stock_quote",
    name: "Apple Inc.",
    symbol: "AAPL",
    price: 333.69,
    currency: "USD",
    exchange: "NasdaqGS",
    quotedAt: new Date(quotedAt * 1000).toISOString(),
  });
  assert.equal(result.sources[0].publisher, "Yahoo Finance");
  const answer = formatStockQuoteAnswer(result);
  assert.match(answer, /Apple Inc\. \(AAPL\)/);
  assert.match(answer, /333,69 USD/);
  assert.match(answer, /NasdaqGS/);
  assert.match(answer, /\[W1\]/);
  assert.match(answer, /può essere ritardata/);
});

test("general search is explicit and uses the local SearXNG tool", () => {
  assert.equal(requestedWebPlan("Spiegami come funziona la fotosintesi"), null);
  const plan = requestedWebPlan("Cerca sul web per favore le ultime versioni di Next.js");
  assert.equal(plan.tool, "web_search");
  assert.deepEqual(plan.arguments, {
    query: "le ultime versioni di Next.js",
    freshness: "any",
  });
});

test("a successful web result cannot be answered with a false access refusal", () => {
  const refusal =
    "Non posso cercare informazioni sul web perché non ho accesso a strumenti esterni o internet.";
  assert.equal(hasWebAccessRefusal(refusal), true);
  assert.equal(
    hasWebAccessRefusal("Treccani indica che entrambe le forme sono attestate."),
    false,
  );
  const fallback = formatWebResultFallback({
    status: "ok",
    sources: [
      {
        id: "W1",
        title: "Treccani",
        publisher: "Treccani",
        url: "https://www.treccani.it/",
        retrievedAt: "2026-10-03T02:26:56.000Z",
        kind: "page",
      },
    ],
    data: [{ source: 1, snippet: "Si dice comunemente su Internet." }],
  });
  assert.match(fallback, /Ho cercato sul web/);
  assert.match(fallback, /Si dice comunemente su Internet/);
  assert.match(fallback, /\[W1\]/);
  assert.equal(hasWebAccessRefusal(fallback), false);
});

test("workspace calendar, sales and document questions stay local", () => {
  for (const question of [
    "Quanto ho venduto questo mese?",
    "Quali appuntamenti ho in calendario?",
    "Cosa dice il documento del cliente?",
  ])
    assert.equal(isWorkspaceDataRequest(question), true, question);
  assert.equal(requestedWebPlan("Cerca sul web i documenti dei clienti"), null);
  assert.equal(isWorkspaceDataRequest("Come funziona la fotosintesi?"), false);
});
