import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// Explicitly invoked integration check: local services and disposable fixtures only.
const origin = process.env.SMOKE_ORIGIN || "http://localhost:3001";
const localHosts = ["localhost", "127.0.0.1", "[::1]"];
assert.ok(localHosts.includes(new URL(origin).hostname));
assert.ok(localHosts.includes(new URL(process.env.DATABASE_URL).hostname));
assert.ok(localHosts.includes(process.env.SMTP_HOST || "127.0.0.1"));
assert.equal(Number(process.env.SMTP_PORT || 1025), 1025);
assert.notEqual(process.env.NODE_ENV, "production");
const db = new PrismaClient();
const runId = randomUUID();
const email = `lumi-smoke-${runId}@example.test`;
const password = `Smoke-${randomUUID()}!`;
const results = [];
const temporary = await mkdtemp(join(tmpdir(), "lumi-smoke-"));
const reportDir = resolve("../../work/verification");
let cookie = "";
let userId;
let organizationId;
let documentStorageKey;
async function http(
  path,
  {
    method = "GET",
    body,
    status = 200,
    raw = false,
    anonymous = false,
    headers = {},
  } = {},
) {
  const response = await fetch(new URL(path, origin), {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(300_000),
    headers: {
      Origin: origin,
      ...(!anonymous && cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined && !(body instanceof FormData) && !raw
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: raw || body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  assert.equal(
    response.status,
    status,
    `${method} ${path}: HTTP ${response.status}, expected ${status}. ${response.status !== status ? (await response.text()).slice(0, 500) : ""}`,
  );
  return response;
}
async function json(path, options) {
  return (await http(path, options)).json();
}
async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}
try {
  await check("Accesso protetto senza sessione", async () => {
    for (const path of ["/api/profile", "/api/profile/notes", "/api/chats"])
      await http(path, { anonymous: true, status: 401 });
  });
  await check("Registrazione locale, email di verifica e accesso", async () => {
    const signup = await json("/api/auth/sign-up/email", {
      method: "POST",
      anonymous: true,
      body: { name: "Test automatico Lumi", email, password },
    });
    userId = signup.user.id;
    const found = await (
      await fetch(
        `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      )
    ).json();
    assert.equal(
      found.messages.length,
      1,
      "Email di verifica non ricevuta da Mailpit",
    );
    const mail = await (
      await fetch(
        `http://localhost:8025/api/v1/message/${found.messages[0].ID}`,
      )
    ).json();
    const link = mail.Text.match(/https?:\/\/\S+/)?.[0];
    assert.ok(link);
    assert.equal(new URL(link).origin, origin);
    const verified = await http(link, { anonymous: true, status: 302 });
    assert.ok(verified.headers.get("location"));
    const response = await http("/api/auth/sign-in/email", {
      method: "POST",
      anonymous: true,
      body: { email, password },
    });
    cookie = response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    assert.ok(cookie.includes("session_token"));
    assert.equal((await json("/api/profile")).id, userId);
    await fetch(`http://localhost:8025/api/v1/messages`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: [found.messages[0].ID] }),
    });
  });
  let quoteId;
  await check("Creazione preventivo e spazio personale", async () => {
    quoteId = (
      await json("/api/quotes", { method: "POST", body: {}, status: 201 })
    ).quoteId;
    organizationId = (
      await db.quote.findUniqueOrThrow({ where: { id: quoteId } })
    ).organizationId;
    for (const path of [
      "/dashboard",
      "/dashboard/profilo",
      "/dashboard/preventivi",
      "/dashboard/listini",
      `/dashboard/preventivi/${quoteId}/documento`,
    ])
      await http(path);
  });
  await check("Profilo e campi personalizzati", async () => {
    await json("/api/profile", {
      method: "PATCH",
      body: { name: "Test automatico aggiornato", preset: "mint" },
    });
    const field = await json("/api/profile/fields", {
      method: "POST",
      body: { label: "Reparto test", value: "Collaudo" },
      status: 201,
    });
    await json("/api/profile/fields", {
      method: "PATCH",
      body: { id: field.id, label: "Reparto test", value: "Verificato" },
    });
    assert.equal(
      (await json("/api/profile/fields")).items[0].value,
      "Verificato",
    );
    await json("/api/profile/fields", {
      method: "DELETE",
      body: { id: field.id },
    });
  });
  await check("Note, collegamenti e conflitti di salvataggio", async () => {
    const note = await json("/api/profile/notes", {
      method: "POST",
      body: {
        title: "Nota test",
        content: "Test automatico",
        link: { type: "quote", id: quoteId },
      },
      status: 201,
    });
    const change = {
      id: note.id,
      action: "update",
      version: note.version,
      title: "Nota aggiornata",
      content: "Collaudo completato",
    };
    await json("/api/profile/notes", { method: "PATCH", body: change });
    await http("/api/profile/notes", {
      method: "PATCH",
      body: change,
      status: 409,
    });
    assert.equal((await json("/api/profile/notes")).items[0].link.id, quoteId);
    await json("/api/profile/notes", {
      method: "DELETE",
      body: { id: note.id },
    });
  });
  await check("Calendario e validazione date", async () => {
    const body = {
      title: "Evento test",
      date: "2026-10-02",
      time: "10:30",
      kind: "event",
    };
    const event = await json("/api/profile/calendar", {
      method: "POST",
      body,
      status: 201,
    });
    await json("/api/profile/calendar", {
      method: "PATCH",
      body: { ...body, id: event.id, completed: true },
    });
    assert.equal(
      (await json("/api/profile/calendar?month=2026-10")).items[0].completed,
      true,
    );
    await http("/api/profile/calendar", {
      method: "POST",
      body: { ...body, date: "2026-02-30" },
      status: 400,
    });
    await json("/api/profile/calendar", {
      method: "DELETE",
      body: { id: event.id },
    });
  });
  await check("Archivio: cartelle, file, download e duplicati", async () => {
    await json("/api/profile/archive", {
      method: "POST",
      body: { path: "Test/Cartella vuota" },
      status: 201,
    });
    await json("/api/profile/archive?path=Test/prova.txt", {
      method: "PUT",
      body: "Contenuto di verifica",
      raw: true,
      status: 201,
    });
    assert.equal(
      await (
        await http("/api/profile/archive?path=Test/prova.txt&download=1")
      ).text(),
      "Contenuto di verifica",
    );
    assert.equal(
      (await json("/api/profile/archive?path=Test")).entries.length,
      2,
    );
    await http("/api/profile/archive?path=Test/prova.txt", {
      method: "PUT",
      body: "Duplicato",
      raw: true,
      status: 409,
    });
    await http("/api/profile/archive?path=..%2Foutside", {
      method: "PUT",
      body: "Invalid",
      raw: true,
      status: 400,
    });
    await json("/api/profile/archive", {
      method: "DELETE",
      body: { path: "Test" },
    });
  });
  let pdf;
  await check(
    "Editor: salvataggio, revisioni, conflitti ed esportazione PDF",
    async () => {
      const path = `/api/quotes/${quoteId}/document`;
      const doc = await json(path);
      const body = {
        html: "<h1>Preventivo di collaudo</h1><p>PORTA-TEST Porta bianca, quantita 2, prezzo unitario EUR 245,00.</p><p>Totale EUR 490,00. Documento di prova senza valore commerciale.</p>",
        settings: doc.settings,
        revision: doc.revision,
      };
      const saved = await json(path, { method: "PUT", body });
      assert.equal(saved.revision, 1);
      await http(path, { method: "PUT", body, status: 409 });
      await http(`${path}/versions`);
      pdf = Buffer.from(
        await (await http(`${path}/pdf?revision=1`)).arrayBuffer(),
      );
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      await http(`${path}/pdf?revision=0`, { status: 409 });
      await writeFile(join(temporary, "test.pdf"), pdf);
    },
  );
  await check("Worker Python: testo, prezzi e PDF non valido", async () => {
    const cwd = resolve("../../services/document-worker");
    const python =
      process.platform === "win32"
        ? join(cwd, ".venv/Scripts/python.exe")
        : join(cwd, ".venv/bin/python");
    const result = JSON.parse(
      execFileSync(
        python,
        [
          "-m",
          "serramenti_document_worker.quote_document_cli",
          join(temporary, "test.pdf"),
        ],
        { cwd, encoding: "utf8", timeout: 120000 },
      ),
    );
    assert.equal(result.page_count, 1);
    assert.match(result.pages[0].text, /245,00/);
    await writeFile(join(temporary, "invalid.pdf"), "not a PDF");
    assert.throws(() =>
      execFileSync(
        python,
        [
          "-m",
          "serramenti_document_worker.cli",
          join(temporary, "invalid.pdf"),
        ],
        { cwd, encoding: "utf8", stdio: "pipe", timeout: 10000 },
      ),
    );
  });
  let documentId;
  await check("Upload PDF, originale e isolamento dei documenti", async () => {
    const form = new FormData();
    form.set("organizationId", organizationId);
    form.set(
      "file",
      new File([pdf], "test-automatico.pdf", { type: "application/pdf" }),
    );
    documentId = (
      await json("/api/assistant/documents", {
        method: "POST",
        body: form,
        status: 201,
      })
    ).document.id;
    documentStorageKey = (
      await db.assistantDocument.findUniqueOrThrow({
        where: { id: documentId },
      })
    ).originalPdfKey;
    assert.equal(
      (await json(`/api/assistant/documents?organizationId=${organizationId}`))
        .documents.length,
      1,
    );
    assert.deepEqual(
      Buffer.from(
        await (
          await http(`/api/assistant/documents/${documentId}/original`)
        ).arrayBuffer(),
      ),
      pdf,
    );
    await http(`/api/assistant/documents/${documentId}/original`, {
      anonymous: true,
      status: 401,
    });
    await http("/api/assistant/documents?organizationId=inesistente", {
      status: 404,
    });
  });
  await check("Esportazioni JSON, CSV ed Excel", async () => {
    for (const format of ["json", "csv", "xlsx"]) {
      const response = await http(
        `/api/quotes/export?organizationId=${organizationId}&id=${quoteId}&format=${format}`,
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length > 50);
      if (format === "json") assert.equal(JSON.parse(bytes).quotes.length, 1);
      if (format === "xlsx")
        assert.equal(bytes.subarray(0, 2).toString(), "PK");
    }
  });
  await check("Cestino e ripristino preventivi", async () => {
    const body = { organizationId, quoteIds: [quoteId] };
    assert.equal(
      (await json("/api/quotes", { method: "DELETE", body })).deletedCount,
      1,
    );
    await http(`/api/quotes/${quoteId}/document`, { status: 404 });
    assert.equal(
      (await json("/api/quotes", { method: "PATCH", body })).restoredCount,
      1,
    );
    await http(`/api/quotes/${quoteId}/document`);
  });
  await check(
    "Nome campo duplicato restituisce un errore gestibile",
    async () => {
      const body = { label: "Duplicato di test", value: "test" };
      await json("/api/profile/fields", { method: "POST", body, status: 201 });
      await http("/api/profile/fields", { method: "POST", body, status: 409 });
    },
  );
  if (process.env.SMOKE_AI === "1") {
    for (const [name, body] of [
      [
        "Chat AI in streaming",
        {
          organizationId,
          history: [],
          content: "Rispondi solo con: Ciao, sono Lumi.",
        },
      ],
      [
        "Lettura PDF con AI locale",
        {
          organizationId,
          history: [],
          documentId,
          content: "Leggi il PDF: qual è il prezzo unitario della porta?",
        },
      ],
    ])
      await check(name, async () => {
        const response = await http("/api/assistant/chat", {
          method: "POST",
          body,
        });
        const events = (await response.text())
          .split(/\n\n/)
          .filter((s) => s.startsWith("data: "))
          .map((s) => JSON.parse(s.slice(6)));
        const errors = events.filter((e) => e.type === "error");
        assert.deepEqual(errors, []);
        assert.ok(events.some((e) => e.type === "done"));
        const answer = events
          .filter((e) => e.type === "token")
          .map((e) => e.content)
          .join("");
        assert.ok(answer.trim());
        if (body.documentId) assert.match(answer, /245/);
      });
    await check("Azioni AI: ricerca preventivi", async () => {
      const data = await json("/api/assistant/actions", {
        method: "POST",
        body: { organizationId, content: "Cerca i miei preventivi esistenti." },
      });
      assert.ok(data.message);
      assert.ok(data.actions?.some((a) => a.name === "search_quotes"));
    });
  }
} catch {
  process.exitCode = 1;
} finally {
  if (organizationId)
    await db.organization.deleteMany({
      where: { id: organizationId, members: { some: { userId } } },
    });
  if (userId) {
    await db.user.deleteMany({ where: { id: userId, email } });
    await rm(
      resolve(
        process.env.PROFILE_ARCHIVE_DIR || ".data/profile-archive",
        userId,
      ),
      { recursive: true, force: true },
    );
  }
  if (documentStorageKey)
    await rm(
      resolve(process.env.UPLOADS_DIR || ".data/uploads", documentStorageKey),
      { force: true },
    );
  await rm(temporary, { recursive: true, force: true });
  await db.$disconnect();
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, "smoke-results.json"),
    JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
  );
  console.log(
    `${results.filter((r) => r.ok).length}/${results.length} verifiche riuscite. Dati di prova rimossi.`,
  );
}
