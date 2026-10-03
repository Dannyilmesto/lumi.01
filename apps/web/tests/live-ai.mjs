import "./register.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { generateWorkspaceAssistantReply } from "../src/lib/workspace-assistant-ai.ts";
import { createAssistantChatResponse } from "../src/lib/assistant-chat-response.ts";
import { planWebAccess } from "../src/lib/assistant-web.ts";
const directory = new URL("../../../work/ai-verification/", import.meta.url);
mkdirSync(directory, { recursive: true });
const originalRequest = https.request;
const originalFetch = globalThis.fetch;
let network = [];
let models = [];
let offline = false;
https.request = function (url, ...args) {
  if (offline) throw new Error("Simulated web provider outage");
  network.push(new URL(url).origin + new URL(url).pathname);
  return originalRequest.call(this, url, ...args);
};
syncBuiltinESMExports();
globalThis.fetch = async function (url, options) {
  if (new URL(url).hostname === "127.0.0.1")
    models.push(JSON.parse(options.body).model);
  return originalFetch(url, options);
};
const cases = [
  ["A", "Scrivi una breve poesia sulla luna."],
  ["B", "Che tempo fa oggi a Roma?"],
  ["C", "Quali sono le principali notizie di oggi?"],
  ["D", "Cerca le ultime informazioni disponibili su llama.cpp."],
  ["E", "Che tempo fa oggi a Roma?", true],
];
const report = [];
try {
  for (const [id, content, fail] of cases) {
    offline = !!fail;
    network = [];
    models = [];
    const events = [];
    let web = null;
    const started = Date.now();
    console.log(`START ${id}: ${content}`);
    const response = createAssistantChatResponse(
      AbortSignal.timeout(300_000),
      async ({ signal, status, webSources }) =>
        generateWorkspaceAssistantReply({
          content,
          history: [],
          organizationContext: null,
          signal,
          onStatus: status,
          onWebResult(result) {
            web = result;
            webSources(result.sources, result.message);
          },
        }),
    );
    const text = await response.text();
    for (const block of text.split("\n\n"))
      if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
    const answer = events
      .filter((e) => e.type === "token")
      .map((e) => e.content)
      .join("");
    const row = {
      id,
      content,
      seconds: Math.round((Date.now() - started) / 1000),
      models,
      network,
      web,
      answer,
      completed: events.some((e) => e.type === "done"),
      errors: events.filter((e) => e.type === "error"),
      statuses: events.filter((e) => e.type === "status"),
    };
    report.push(row);
    writeFileSync(
      new URL("live-tests.json", directory),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        id,
        seconds: row.seconds,
        network,
        webStatus: web?.status,
        sources: web?.sources.length,
        answer,
        completed: row.completed,
        errors: row.errors,
      }),
    );
  }
  offline = false;
  for (const content of [
    "Che tempo farà domani?",
    "Traduci in inglese: Quali sono le notizie di oggi?",
    "Quanto vale Bitcoin adesso?",
    "Qual è il risultato della partita?",
  ]) {
    const plan = await planWebAccess(content, []);
    console.log(JSON.stringify({ routing: content, plan }));
    writeFileSync(
      new URL(`routing-${report.length}.json`, directory),
      JSON.stringify({ content, plan }, null, 2),
    );
    report.push({ routing: content, plan });
  }
  writeFileSync(
    new URL("live-tests.json", directory),
    JSON.stringify(report, null, 2),
  );
} finally {
  https.request = originalRequest;
  syncBuiltinESMExports();
  globalThis.fetch = originalFetch;
}
