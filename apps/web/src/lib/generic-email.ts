import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import type { EmailAccount } from '@prisma/client';
import { decryptEmailToken } from '@/lib/email-crypto';
import { prisma } from '@/lib/prisma';
import type { MailMessage, MailMessageSummary } from '@/lib/email-service';

const serverSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1000),
});

export const genericEmailAccountSchema = z
  .object({
    email: z.string().trim().email().max(254),
    imap: serverSchema,
    smtp: serverSchema,
  })
  .superRefine((account, context) => {
    for (const [name, server] of [
      ['imap', account.imap],
      ['smtp', account.smtp],
    ] as const) {
      if (
        server.host.startsWith('[') ||
        server.host.includes('/') ||
        server.host.includes('@') ||
        server.host.includes(':') ||
        server.host.includes(' ') ||
        server.host.endsWith('.')
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Inserisci solo il nome host, senza schema o credenziali.',
          path: [name, 'host'],
        });
      }
    }
  });

export type GenericEmailConfig = z.infer<typeof genericEmailAccountSchema>;

function isBlockedIPv4(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => value < 0 || value > 255))
    return true;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isBlockedAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isBlockedIPv4(address);
  if (family === 6) {
    const normalized = address.toLowerCase().split('%')[0];
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:') ||
      /^::ffff:(?:0:)?(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(
        normalized,
      )
    );
  }
  return true;
}

export function isPublicEmailServerAddress(address: string) {
  return !isBlockedAddress(address);
}

async function resolvePublicHost(host: string) {
  if (isIP(host)) {
    if (isBlockedAddress(host))
      throw new Error('Per sicurezza non è possibile usare un server email privato.');
    return { address: host, servername: undefined as string | undefined };
  }
  let addresses: Awaited<ReturnType<typeof lookup>>[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('Il nome host del server email non è raggiungibile.');
  }
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address)))
    throw new Error('Per sicurezza non è possibile usare un server email privato.');
  return { address: addresses[0].address, servername: host };
}

export async function parseGenericEmailConfig(account: EmailAccount) {
  if (!account.configEncrypted)
    throw new Error('Configurazione account email mancante.');
  return genericEmailAccountSchema.parse(
    JSON.parse(decryptEmailToken(account.configEncrypted)),
  );
}

async function imapClient(config: GenericEmailConfig) {
  const server = await resolvePublicHost(config.imap.host);
  return new ImapFlow({
    host: server.address,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.password },
    ...(server.servername
      ? { tls: { servername: server.servername } }
      : {}),
    logger: false,
    socketTimeout: 15_000,
    greetingTimeout: 10_000,
    connectionTimeout: 10_000,
  });
}

async function smtpTransport(config: GenericEmailConfig) {
  const server = await resolvePublicHost(config.smtp.host);
  return nodemailer.createTransport({
    host: server.address,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.password },
    ...(server.servername ? { tls: { servername: server.servername } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

export async function verifyGenericEmailAccount(config: GenericEmailConfig) {
  const client = await imapClient(config);
  const transport = await smtpTransport(config);
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    await transport.verify();
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
    transport.close();
  }
}

function addressFrom(
  parsed: Awaited<ReturnType<typeof simpleParser>>['from'],
): string {
  if (!parsed) return '';
  return parsed.value
    .map(({ name, address }) =>
      name && address ? `${name} <${address}>` : (address ?? name ?? ''),
    )
    .filter(Boolean)
    .join(', ');
}

function dateToIso(value: Date | string | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listGenericMailMessages(
  account: EmailAccount,
): Promise<MailMessageSummary[]> {
  const config = await parseGenericEmailConfig(account);
  const client = await imapClient(config);
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
    if (!mailbox.exists) return [];
    const start = Math.max(1, mailbox.exists - 24);
    const messages: MailMessageSummary[] = [];
    for await (const message of client.fetch(`${start}:*`, {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      source: true,
    })) {
      if (!message.source) continue;
      const parsed = await simpleParser(message.source);
      messages.push({
        id: String(message.uid),
        subject: parsed.subject || '(senza oggetto)',
        from: addressFrom(parsed.from),
        receivedAt: dateToIso(message.internalDate),
        preview: (parsed.text || '').slice(0, 300),
        isRead: message.flags?.has('\\Seen') ?? true,
      });
    }
    return messages.reverse();
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
  }
}

export async function readGenericMailMessage(
  account: EmailAccount,
  messageId: string,
): Promise<MailMessage> {
  const uid = Number(messageId);
  if (!Number.isSafeInteger(uid) || uid < 1)
    throw new Error('Identificativo email non valido.');
  const config = await parseGenericEmailConfig(account);
  const client = await imapClient(config);
  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });
    const fetched = await client.fetchOne(String(uid), {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      source: true,
    }, { uid: true });
    if (!fetched || !fetched.source)
      throw new Error('Email non disponibile.');
    const parsed = await simpleParser(fetched.source);
    const to = parsed.to
      ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap(
          (address) => address.value,
        )
      : [];
    return {
      id: String(fetched.uid),
      subject: parsed.subject || '(senza oggetto)',
      from: addressFrom(parsed.from),
      to: to.map((item) => item.address ?? item.name ?? ''),
      receivedAt: dateToIso(fetched.internalDate),
      preview: (parsed.text || '').slice(0, 300),
      isRead: fetched.flags?.has('\\Seen') ?? true,
      body: parsed.text || 'Contenuto email non disponibile in formato testuale.',
    };
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
  }
}

export async function sendGenericMail(
  account: EmailAccount,
  input: { to: string; subject: string; body: string },
) {
  const config = await parseGenericEmailConfig(account);
  const transport = await smtpTransport(config);
  try {
    await transport.sendMail({
      from: { name: config.email, address: config.email },
      to: input.to,
      subject: input.subject,
      text: input.body,
    });
  } finally {
    transport.close();
  }
}

export async function createDemoMailbox(
  userId: string,
  displayName: string,
) {
  const accountId = `demo-${randomUUID()}`;
  const email = `${accountId}@lumi.test`;
  const account = await prisma.emailAccount.create({
    data: {
      userId,
      provider: 'DEMO',
      providerAccountId: accountId,
      email,
      accessTokenEncrypted: 'demo-mailbox',
    },
    select: { id: true, email: true, provider: true },
  });
  const now = new Date();
  await prisma.emailDemoMessage.createMany({
    data: [
      {
        accountId: account.id,
        from: 'Lumi <assistenza@lumi.test>',
        to: email,
        subject: 'La tua casella demo è pronta',
        body: `Ciao ${displayName}, questa casella di prova ti permette di esplorare la posta senza collegare server esterni. Puoi inviare un messaggio demo all’indirizzo ${email}: resterà all’interno di questa casella.`,
        createdAt: new Date(now.getTime() - 60_000),
      },
      {
        accountId: account.id,
        from: 'Demo Ordini <ordini@esempio.test>',
        to: email,
        subject: 'Conferma ordine di prova',
        body: 'Questo è un messaggio di esempio. Non corrisponde a un ordine o a una email realmente spedita.',
        createdAt: new Date(now.getTime() - 3 * 60_000),
      },
      {
        accountId: account.id,
        from: 'Demo Calendario <calendario@esempio.test>',
        to: email,
        subject: 'Promemoria appuntamento demo',
        body: 'La casella demo contiene messaggi simulati per provare elenco, ricerca e apertura.',
        createdAt: new Date(now.getTime() - 8 * 60_000),
      },
    ],
  });
  return account;
}

export async function listDemoMailMessages(accountId: string) {
  const messages = await prisma.emailDemoMessage.findMany({
    where: { accountId, folder: 'INBOX' },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return messages.map(
    (message): MailMessageSummary => ({
      id: message.id,
      subject: message.subject,
      from: message.from,
      receivedAt: message.createdAt.toISOString(),
      preview: message.body.slice(0, 300),
      isRead: message.isRead,
    }),
  );
}

export async function readDemoMailMessage(accountId: string, id: string) {
  const message = await prisma.emailDemoMessage.findFirst({
    where: { id, accountId, folder: 'INBOX' },
  });
  if (!message) throw new Error('Email non disponibile.');
  if (!message.isRead)
    await prisma.emailDemoMessage.update({
      where: { id: message.id },
      data: { isRead: true },
    });
  return {
    id: message.id,
    subject: message.subject,
    from: message.from,
    to: [message.to],
    receivedAt: message.createdAt.toISOString(),
    preview: message.body.slice(0, 300),
    isRead: true,
    body: message.body,
  } satisfies MailMessage;
}

export async function sendDemoMail(
  account: EmailAccount,
  input: { to: string; subject: string; body: string },
) {
  const email = account.email.toLowerCase();
  const recipient = input.to.toLowerCase();
  if (!recipient.endsWith('@lumi.test'))
    throw new Error('La casella demo può inviare solo ad account @lumi.test.');
  const recipientAccount = await prisma.emailAccount.findFirst({
    where: { userId: account.userId, provider: 'DEMO', email: recipient },
    select: { id: true, email: true },
  });
  if (!recipientAccount)
    throw new Error('Destinatario demo inesistente. Usa l’indirizzo della casella di prova.');
  await prisma.emailDemoMessage.create({
    data: {
      accountId: recipientAccount.id,
      folder: 'INBOX',
      from: email,
      to: recipient,
      subject: input.subject,
      body: input.body,
    },
  });
}
