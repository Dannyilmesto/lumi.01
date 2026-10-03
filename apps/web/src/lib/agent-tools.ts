import { z } from "zod";
import { webTools, isWebTool, executeWebTool } from "@/lib/web-tools";
import { prisma } from "@/lib/prisma";
import {
  listArchive,
  createArchiveFolder,
  deleteArchiveEntry,
} from "@/lib/profile-archive";
import { saveQuotePdfToArchive } from "@/lib/archive-quote";
import * as calendar from "@/app/api/profile/calendar/route";
import * as notes from "@/app/api/profile/notes/route";
import * as quotes from "@/app/api/quotes/route";
import * as fields from "@/app/api/profile/fields/route";

type Properties = Record<
  string,
  { type: string; description?: string; enum?: string[] }
>;
function define(
  name: string,
  description: string,
  properties: Properties,
  required: string[] = [],
) {
  return {
    type: "function" as const,
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}
const string = (description: string) => ({ type: "string", description });
const id = z.string().min(1).max(128);
const text = z.string().trim().min(1);

// Single catalog for LLM function schemas and the server-side dispatcher.
export const agentTools = [
  ...webTools,
  define(
    "search_quotes",
    "Cerca preventivi per titolo o nome cliente.",
    { query: string("Testo da cercare, anche vuoto") },
    ["query"],
  ),
  define(
    "create_quote",
    "Crea un nuovo preventivo nello spazio aziendale corrente.",
    {},
  ),
  define(
    "open_quote",
    "Apri il documento di un preventivo verificato.",
    { quote_id: string("ID del preventivo") },
    ["quote_id"],
  ),
  define(
    "rename_quote",
    "Modifica il titolo di un preventivo.",
    { quote_id: string("ID"), title: string("Nuovo titolo") },
    ["quote_id", "title"],
  ),
  define(
    "delete_quote",
    "Sposta un preventivo nel cestino.",
    { quote_id: string("ID") },
    ["quote_id"],
  ),
  define(
    "export_quote_pdf",
    "Scarica il documento PDF di un preventivo salvato.",
    { quote_id: string("ID") },
    ["quote_id"],
  ),
  define(
    "list_events",
    "Consulta gli appuntamenti del mese.",
    { month: string("Mese YYYY-MM") },
    ["month"],
  ),
  define(
    "create_event",
    "Fissa un appuntamento o promemoria.",
    {
      title: string("Titolo"),
      date: string("Data YYYY-MM-DD"),
      time: string("Ora HH:mm"),
      description: string("Dettagli, incluso cliente"),
    },
    ["title", "date", "time"],
  ),
  define(
    "update_event",
    "Modifica un appuntamento esistente.",
    {
      event_id: string("ID"),
      title: string("Titolo"),
      date: string("Data YYYY-MM-DD"),
      time: string("Ora HH:mm"),
      description: string("Dettagli"),
    },
    ["event_id"],
  ),
  define(
    "delete_event",
    "Cancella un appuntamento.",
    { event_id: string("ID") },
    ["event_id"],
  ),
  define(
    "list_notes",
    "Cerca note private.",
    { query: string("Testo da cercare") },
    ["query"],
  ),
  define(
    "create_note",
    "Scrive una nota privata, eventualmente collegata a cliente o preventivo.",
    {
      title: string("Titolo"),
      content: string("Testo"),
      link_type: { type: "string", enum: ["customer", "quote"] },
      link_id: string("ID cliente o preventivo"),
    },
    ["title", "content"],
  ),
  define(
    "update_note",
    "Modifica una nota privata.",
    {
      note_id: string("ID"),
      title: string("Titolo"),
      content: string("Testo"),
      link_type: { type: "string", enum: ["customer", "quote"] },
      link_id: string("ID cliente o preventivo"),
    },
    ["note_id", "title", "content"],
  ),
  define(
    "publish_note",
    "Pubblica una nota nella bacheca.",
    { note_id: string("ID") },
    ["note_id"],
  ),
  define(
    "delete_note",
    "Elimina una nota privata.",
    { note_id: string("ID") },
    ["note_id"],
  ),
  define(
    "list_customers",
    "Cerca schede cliente nell’azienda corrente.",
    { query: string("Nome o email") },
    ["query"],
  ),
  define(
    "create_customer",
    "Crea una scheda cliente.",
    {
      name: string("Nome"),
      email: string("Email"),
      phone: string("Telefono"),
      address: string("Indirizzo"),
      notes: string("Note"),
    },
    ["name"],
  ),
  define(
    "update_customer",
    "Modifica una scheda cliente.",
    {
      customer_id: string("ID"),
      name: string("Nome"),
      email: string("Email"),
      phone: string("Telefono"),
      address: string("Indirizzo"),
      notes: string("Note"),
    },
    ["customer_id"],
  ),
  define(
    "delete_customer",
    "Elimina una scheda cliente.",
    { customer_id: string("ID") },
    ["customer_id"],
  ),
  define(
    "open_section",
    "Apri una sezione nell’interfaccia.",
    {
      section: {
        type: "string",
        enum: [
          "dashboard",
          "notes",
          "calendar",
          "quotes",
          "archive",
          "community",
          "messages",
        ],
      },
    },
    ["section"],
  ),
  define(
    "list_archive",
    "Mostra i contenuti di una cartella dell’archivio personale.",
    { path: string("Percorso relativo, vuoto per la radice") },
    ["path"],
  ),
  define(
    "create_archive_folder",
    "Crea una cartella nell’archivio personale.",
    { path: string("Percorso relativo completo") },
    ["path"],
  ),
  define(
    "delete_archive_entry",
    "Elimina un file o una cartella, incluso il suo contenuto, dall’archivio personale.",
    { path: string("Percorso relativo completo") },
    ["path"],
  ),
  define(
    "save_quote_to_archive",
    "Genera il PDF di un preventivo e lo salva nella cartella Preventivi dell’archivio personale.",
    { quote_id: string("ID del preventivo") },
    ["quote_id"],
  ),
  define(
    "list_profile_fields",
    "Mostra i campi personalizzati del profilo.",
    {},
  ),
  define(
    "add_profile_field",
    "Aggiunge un campo personalizzato al profilo.",
    { label: string("Nome del campo"), value: string("Valore") },
    ["label", "value"],
  ),
  define(
    "update_profile_field",
    "Modifica un campo personalizzato.",
    { field_id: string("ID"), label: string("Nome"), value: string("Valore") },
    ["field_id", "label", "value"],
  ),
  define(
    "delete_profile_field",
    "Elimina un campo personalizzato.",
    { field_id: string("ID") },
    ["field_id"],
  ),
];

export const confirmationTools = new Set([
  "delete_quote",
  "delete_event",
  "delete_note",
  "publish_note",
  "delete_customer",
  "delete_profile_field",
  "delete_archive_entry",
]);

async function route(
  request: Request,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: object,
) {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  if (body) headers.set("content-type", "application/json");
  const synthetic = new Request(new URL(path, request.url), {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const url = new URL(path, request.url);
  let response: Response | undefined;
  if (url.pathname === "/api/profile/calendar")
    response = await calendar[method](synthetic);
  else if (url.pathname === "/api/profile/notes")
    response = await notes[method](synthetic);
  else if (
    url.pathname === "/api/quotes" &&
    (method === "POST" || method === "DELETE")
  )
    response = await quotes[method](synthetic);
  else if (url.pathname === "/api/profile/fields")
    response = await fields[method](synthetic);
  else throw new Error("Azione non disponibile.");
  if (!response) throw new Error("Operazione non riuscita.");
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(
      typeof data.error === "string" ? data.error : "Operazione non riuscita.",
    );
  return data;
}

export async function executeAgentTool(
  name: string,
  raw: unknown,
  context: {
    request: Request;
    userId: string;
    organizationId: string;
    allowedWebUrls?: string[];
  },
) {
  const args = z.record(z.string(), z.unknown()).parse(raw);
  const { request, userId, organizationId } = context;
  if (isWebTool(name))
    return executeWebTool(name, args, {
      signal: request.signal,
      allowedUrls: context.allowedWebUrls,
    });
  const ownQuote = async (quoteId: string) => {
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, organizationId, deletedAt: null },
      select: { id: true, title: true, document: { select: { id: true } } },
    });
    if (!quote) throw new Error("Preventivo non disponibile.");
    return quote;
  };
  switch (name) {
    case "search_quotes": {
      const { query } = z.object({ query: z.string().max(100) }).parse(args);
      return await prisma.quote.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(query
            ? {
                OR: [
                  { title: { contains: query, mode: "insensitive" } },
                  {
                    customer: {
                      name: { contains: query, mode: "insensitive" },
                    },
                  },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          title: true,
          customer: { select: { name: true } },
          status: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 30,
      });
    }
    case "create_quote":
      return route(request, "POST", "/api/quotes", { organizationId });
    case "open_quote": {
      const quoteId = id.parse(args.quote_id);
      await ownQuote(quoteId);
      return {
        href: `/dashboard/preventivi/${encodeURIComponent(quoteId)}/documento`,
      };
    }
    case "rename_quote": {
      const quoteId = id.parse(args.quote_id);
      const title = text.max(200).parse(args.title);
      await ownQuote(quoteId);
      await prisma.quote.update({ where: { id: quoteId }, data: { title } });
      return { ok: true, title };
    }
    case "delete_quote": {
      const quoteId = id.parse(args.quote_id);
      await ownQuote(quoteId);
      return route(request, "DELETE", "/api/quotes", {
        organizationId,
        quoteIds: [quoteId],
        confirmProtected: true,
      });
    }
    case "export_quote_pdf": {
      const quoteId = id.parse(args.quote_id);
      const quote = await ownQuote(quoteId);
      if (!quote.document)
        throw new Error("Salva il documento prima di esportarlo.");
      return {
        download: `/api/quotes/${encodeURIComponent(quoteId)}/document/pdf`,
      };
    }
    case "list_events": {
      const month = z
        .string()
        .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
        .parse(args.month);
      return route(request, "GET", `/api/profile/calendar?month=${month}`);
    }
    case "create_event": {
      const data = z
        .object({
          title: text.max(160),
          date: z.string(),
          time: z.string(),
          description: z.string().max(5000).optional(),
        })
        .parse(args);
      return route(request, "POST", "/api/profile/calendar", {
        ...data,
        description: data.description || "",
      });
    }
    case "update_event": {
      const eventId = id.parse(args.event_id);
      const event = await prisma.calendarEvent.findFirst({
        where: { id: eventId, userId },
      });
      if (!event) throw new Error("Appuntamento non disponibile.");
      return route(request, "PATCH", "/api/profile/calendar", {
        id: eventId,
        title: args.title ?? event.title,
        date: args.date ?? event.date,
        time: args.time ?? event.time,
        description: args.description ?? event.description,
        kind: event.kind,
        completed: event.completed,
      });
    }
    case "delete_event":
      return route(request, "DELETE", "/api/profile/calendar", {
        id: id.parse(args.event_id),
      });
    case "list_notes":
      return route(
        request,
        "GET",
        `/api/profile/notes?q=${encodeURIComponent(z.string().max(100).parse(args.query))}`,
      );
    case "create_note": {
      const data = z
        .object({
          title: text.max(160),
          content: text.max(20_000),
          link_type: z.enum(["customer", "quote"]).optional(),
          link_id: id.optional(),
        })
        .parse(args);
      return route(request, "POST", "/api/profile/notes", {
        title: data.title,
        content: data.content,
        ...(data.link_type && data.link_id
          ? { link: { type: data.link_type, id: data.link_id } }
          : {}),
      });
    }
    case "update_note": {
      const noteId = id.parse(args.note_id);
      const note = await prisma.privateNote.findFirst({
        where: { id: noteId, userId },
      });
      if (!note) throw new Error("Nota non disponibile.");
      return route(request, "PATCH", "/api/profile/notes", {
        id: noteId,
        action: "update",
        title: args.title ?? note.title,
        content: args.content ?? note.content,
        version: note.version,
        ...(args.link_type && args.link_id
          ? { link: { type: args.link_type, id: args.link_id } }
          : {}),
      });
    }
    case "publish_note": {
      const noteId = id.parse(args.note_id);
      const note = await prisma.privateNote.findFirst({
        where: { id: noteId, userId },
      });
      if (!note) throw new Error("Nota non disponibile.");
      return route(request, "PATCH", "/api/profile/notes", {
        id: noteId,
        action: "publish",
        confirmPublic: true,
        version: note.version,
      });
    }
    case "delete_note":
      return route(request, "DELETE", "/api/profile/notes", {
        id: id.parse(args.note_id),
      });
    case "list_customers": {
      const query = z.string().max(100).parse(args.query);
      return prisma.customer.findMany({
        where: {
          organizationId,
          ...(query
            ? {
                OR: [
                  { name: { contains: query, mode: "insensitive" } },
                  { email: { contains: query, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          notes: true,
        },
        orderBy: { name: "asc" },
        take: 30,
      });
    }
    case "create_customer": {
      const data = z
        .object({
          name: text.max(180),
          email: z.string().email().optional(),
          phone: z.string().max(80).optional(),
          address: z.string().max(500).optional(),
          notes: z.string().max(5000).optional(),
        })
        .parse(
          Object.fromEntries(
            Object.entries(args).filter(([, value]) => value !== ""),
          ),
        );
      return prisma.customer.create({
        data: { organizationId, ...data },
        select: { id: true, name: true },
      });
    }
    case "update_customer": {
      const customerId = id.parse(args.customer_id);
      const existing = await prisma.customer.findFirst({
        where: { id: customerId, organizationId },
      });
      if (!existing) throw new Error("Cliente non disponibile.");
      const data = z
        .object({
          name: text.max(180).optional(),
          email: z.string().email().nullable().optional(),
          phone: z.string().max(80).nullable().optional(),
          address: z.string().max(500).nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
        })
        .parse(
          Object.fromEntries(
            Object.entries(args).filter(([key]) => key !== "customer_id"),
          ),
        );
      return prisma.customer.update({
        where: { id: customerId },
        data,
        select: { id: true, name: true },
      });
    }
    case "delete_customer": {
      const customerId = id.parse(args.customer_id);
      const deleted = await prisma.customer.deleteMany({
        where: { id: customerId, organizationId },
      });
      if (!deleted.count) throw new Error("Cliente non disponibile.");
      return { ok: true };
    }
    case "open_section": {
      const section = z
        .enum([
          "dashboard",
          "notes",
          "calendar",
          "quotes",
          "archive",
          "community",
          "messages",
        ])
        .parse(args.section);
      return {
        href:
          section === "dashboard"
            ? "/dashboard"
            : `/dashboard/profilo?tab=${section}`,
      };
    }
    case "list_archive":
      return {
        entries: await listArchive(
          userId,
          z.string().max(4096).parse(args.path),
        ),
      };
    case "create_archive_folder": {
      await createArchiveFolder(userId, text.max(4096).parse(args.path));
      return { ok: true };
    }
    case "delete_archive_entry": {
      await deleteArchiveEntry(userId, text.max(4096).parse(args.path));
      return { ok: true };
    }
    case "save_quote_to_archive": {
      const path = await saveQuotePdfToArchive(
        request,
        userId,
        id.parse(args.quote_id),
      );
      return { ok: true, path, href: "/dashboard/profilo?tab=archive" };
    }
    case "list_profile_fields":
      return route(request, "GET", "/api/profile/fields");
    case "add_profile_field":
      return route(request, "POST", "/api/profile/fields", {
        label: text.max(80).parse(args.label),
        value: z.string().max(2000).parse(args.value),
      });
    case "update_profile_field":
      return route(request, "PATCH", "/api/profile/fields", {
        id: id.parse(args.field_id),
        label: text.max(80).parse(args.label),
        value: z.string().max(2000).parse(args.value),
      });
    case "delete_profile_field":
      return route(request, "DELETE", "/api/profile/fields", {
        id: id.parse(args.field_id),
      });
    default:
      throw new Error("Funzione non disponibile.");
  }
}
