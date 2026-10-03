import type { EmailAccount } from '@prisma/client';
import { decryptEmailToken, encryptEmailToken } from '@/lib/email-crypto';
import {
  refreshEmailAccessToken,
  type EmailProviderId,
} from '@/lib/email-oauth';
import { prisma } from '@/lib/prisma';
import {
  listDemoMailMessages,
  listGenericMailMessages,
  readDemoMailMessage,
  readGenericMailMessage,
  sendDemoMail,
  sendGenericMail,
} from '@/lib/generic-email';

export type MailMessageSummary = {
  id: string;
  subject: string;
  from: string;
  receivedAt: string | null;
  preview: string;
  isRead: boolean;
};

export type MailMessage = MailMessageSummary & {
  to: string[];
  body: string;
};

async function accessToken(account: EmailAccount) {
  if (
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() > Date.now() + 60_000
  )
    return decryptEmailToken(account.accessTokenEncrypted);

  if (!account.refreshTokenEncrypted) {
    if (account.accessTokenExpiresAt)
      throw new Error('Autorizzazione scaduta. Ricollega l’account email.');
    return decryptEmailToken(account.accessTokenEncrypted);
  }

  const refreshToken = decryptEmailToken(account.refreshTokenEncrypted);
  const refreshed = await refreshEmailAccessToken(
    account.provider as EmailProviderId,
    refreshToken,
  );
  await prisma.emailAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptEmailToken(refreshed.accessToken),
      ...(refreshed.refreshToken
        ? { refreshTokenEncrypted: encryptEmailToken(refreshed.refreshToken) }
        : {}),
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
      scope: refreshed.scope ?? account.scope,
    },
  });
  return refreshed.accessToken;
}

async function providerRequest(
  account: EmailAccount,
  path: string,
  init: RequestInit = {},
) {
  const token = await accessToken(account);
  const base =
    account.provider === 'GOOGLE'
      ? 'https://gmail.googleapis.com/gmail/v1/users/me'
      : 'https://graph.microsoft.com/v1.0/me';
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const providerMessage = await response.text().catch(() => '');
    console.error('Email provider request failed.', {
      provider: account.provider,
      status: response.status,
      message: providerMessage.slice(0, 400),
    });
    if (response.status === 401 || response.status === 403)
      throw new Error('Accesso all’account email scaduto o non autorizzato. Ricollegalo.');
    throw new Error('Il provider email non ha completato la richiesta.');
  }
  return response;
}

function headerValue(
  headers: { name?: string; value?: string }[] | undefined,
  name: string,
) {
  return headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function emailAddress(value: unknown) {
  if (typeof value !== 'object' || value === null) return '';
  const address = value as {
    emailAddress?: { name?: string; address?: string };
    name?: string;
    address?: string;
  };
  const email = address.emailAddress ?? address;
  const name = email.name?.trim();
  const addressText = email.address?.trim() ?? '';
  return name && addressText ? `${name} <${addressText}>` : addressText;
}

function decodeHtmlAsText(html: string) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

function gmailPartBody(payload: {
  mimeType?: string;
  body?: { data?: string };
  parts?: unknown[];
}): { plain: string; html: string } {
  const result = { plain: '', html: '' };
  if (payload.body?.data) {
    const text = Buffer.from(payload.body.data, 'base64url').toString('utf8');
    if (payload.mimeType === 'text/plain') result.plain = text;
    if (payload.mimeType === 'text/html') result.html = text;
  }
  for (const nested of payload.parts ?? []) {
    if (typeof nested !== 'object' || nested === null) continue;
    const child = gmailPartBody(nested as Parameters<typeof gmailPartBody>[0]);
    result.plain ||= child.plain;
    result.html ||= child.html;
  }
  return result;
}

function gmailDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listMailMessages(account: EmailAccount) {
  if (account.provider === 'DEMO')
    return listDemoMailMessages(account.id);
  if (account.provider === 'IMAP_SMTP')
    return listGenericMailMessages(account);
  if (account.provider === 'GOOGLE') {
    const response = await providerRequest(
      account,
      '/messages?maxResults=25&q=in%3Ainbox',
    );
    const result = (await response.json()) as {
      messages?: { id: string }[];
    };
    return Promise.all(
      (result.messages ?? []).map(async ({ id }) => {
        const detailResponse = await providerRequest(
          account,
          `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        );
        const detail = (await detailResponse.json()) as {
          id: string;
          snippet?: string;
          internalDate?: string;
          labelIds?: string[];
          payload?: {
            headers?: { name?: string; value?: string }[];
          };
        };
        return {
          id: detail.id,
          subject: headerValue(detail.payload?.headers, 'Subject') || '(senza oggetto)',
          from: headerValue(detail.payload?.headers, 'From') || '',
          receivedAt: gmailDate(
            detail.internalDate ?? headerValue(detail.payload?.headers, 'Date'),
          ),
          preview: detail.snippet ?? '',
          isRead: !detail.labelIds?.includes('UNREAD'),
        } satisfies MailMessageSummary;
      }),
    );
  }

  const response = await providerRequest(
    account,
    '/mailFolders/inbox/messages?$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,isRead&$orderby=receivedDateTime%20desc',
  );
  const result = (await response.json()) as {
    value?: {
      id: string;
      subject?: string;
      from?: unknown;
      receivedDateTime?: string;
      bodyPreview?: string;
      isRead?: boolean;
    }[];
  };
  return (result.value ?? []).map(
    (message): MailMessageSummary => ({
      id: message.id,
      subject: message.subject || '(senza oggetto)',
      from: emailAddress(message.from),
      receivedAt: message.receivedDateTime ?? null,
      preview: message.bodyPreview ?? '',
      isRead: message.isRead ?? true,
    }),
  );
}

export async function readMailMessage(
  account: EmailAccount,
  messageId: string,
): Promise<MailMessage> {
  if (account.provider === 'DEMO')
    return readDemoMailMessage(account.id, messageId);
  if (account.provider === 'IMAP_SMTP')
    return readGenericMailMessage(account, messageId);
  if (account.provider === 'GOOGLE') {
    const response = await providerRequest(
      account,
      `/messages/${encodeURIComponent(messageId)}?format=full`,
    );
    const result = (await response.json()) as {
      id: string;
      snippet?: string;
      internalDate?: string;
      labelIds?: string[];
      payload?: {
        mimeType?: string;
        headers?: { name?: string; value?: string }[];
        body?: { data?: string };
        parts?: unknown[];
      };
    };
    const body = gmailPartBody(result.payload ?? {});
    return {
      id: result.id,
      subject:
        headerValue(result.payload?.headers, 'Subject') || '(senza oggetto)',
      from: headerValue(result.payload?.headers, 'From') || '',
      to: (headerValue(result.payload?.headers, 'To') ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      receivedAt: gmailDate(
        result.internalDate ?? headerValue(result.payload?.headers, 'Date'),
      ),
      preview: result.snippet ?? '',
      isRead: !result.labelIds?.includes('UNREAD'),
      body: body.plain || decodeHtmlAsText(body.html) || result.snippet || '',
    };
  }

  const response = await providerRequest(
    account,
    `/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview,isRead`,
  );
  const result = (await response.json()) as {
    id: string;
    subject?: string;
    from?: unknown;
    toRecipients?: unknown[];
    receivedDateTime?: string;
    body?: { contentType?: string; content?: string };
    bodyPreview?: string;
    isRead?: boolean;
  };
  const content = result.body?.content ?? '';
  return {
    id: result.id,
    subject: result.subject || '(senza oggetto)',
    from: emailAddress(result.from),
    to: (result.toRecipients ?? []).map(emailAddress).filter(Boolean),
    receivedAt: result.receivedDateTime ?? null,
    preview: result.bodyPreview ?? '',
    isRead: result.isRead ?? true,
    body:
      result.body?.contentType?.toLowerCase() === 'html'
        ? decodeHtmlAsText(content)
        : content,
  };
}

export async function sendMail(
  account: EmailAccount,
  input: { to: string; subject: string; body: string },
) {
  if (account.provider === 'DEMO')
    return sendDemoMail(account, input);
  if (account.provider === 'IMAP_SMTP')
    return sendGenericMail(account, input);
  if (account.provider === 'GOOGLE') {
    const subject = `=?UTF-8?B?${Buffer.from(input.subject, 'utf8').toString('base64')}?=`;
    const mime = [
      `To: ${input.to}`,
      `From: ${account.email}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(input.body, 'utf8').toString('base64'),
    ].join('\r\n');
    await providerRequest(account, '/messages/send', {
      method: 'POST',
      body: JSON.stringify({
        raw: Buffer.from(mime, 'utf8').toString('base64url'),
      }),
    });
    return;
  }

  await providerRequest(account, '/sendMail', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: 'Text', content: input.body },
        toRecipients: [{ emailAddress: { address: input.to } }],
      },
      saveToSentItems: true,
    }),
  });
}
