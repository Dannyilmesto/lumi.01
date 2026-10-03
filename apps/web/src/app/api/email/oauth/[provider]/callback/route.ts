import { NextResponse } from 'next/server';
import { encryptEmailToken } from '@/lib/email-crypto';
import {
  exchangeEmailAuthorizationCode,
  parseEmailProvider,
} from '@/lib/email-oauth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function emailPageUrl(error?: string) {
  const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';
  const url = new URL('/dashboard/email', baseUrl);
  if (error) url.searchParams.set('error', error);
  return url;
}

function redirectToEmail(error?: string) {
  return NextResponse.redirect(emailPageUrl(error));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: pathProvider } = await params;
  const provider =
    pathProvider === 'google'
      ? parseEmailProvider('GOOGLE')
      : pathProvider === 'microsoft'
        ? parseEmailProvider('MICROSOFT')
        : null;
  if (!provider) return redirectToEmail('provider');

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  if (!state || !/^[A-Za-z0-9_-]{40,60}$/.test(state))
    return redirectToEmail('state');
  const oauthState = await prisma.emailOAuthState.findFirst({
    where: { id: state, provider, expiresAt: { gt: new Date() } },
  });
  const consumed = await prisma.emailOAuthState.deleteMany({
    where: { id: state, provider, expiresAt: { gt: new Date() } },
  });
  if (!oauthState || consumed.count !== 1) return redirectToEmail('state');

  const authorizationError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (authorizationError || !code) return redirectToEmail('cancelled');

  try {
    const tokens = await exchangeEmailAuthorizationCode(provider, code);
    const identityUrl =
      provider === 'GOOGLE'
        ? 'https://www.googleapis.com/oauth2/v2/userinfo'
        : 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName';
    const identityResponse = await fetch(identityUrl, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!identityResponse.ok) {
      console.error('Email provider identity lookup failed.', {
        provider,
        status: identityResponse.status,
      });
      throw new Error('Non è stato possibile verificare l’indirizzo email.');
    }
    const identity = (await identityResponse.json()) as {
      id?: string;
      sub?: string;
      email?: string;
      mail?: string | null;
      userPrincipalName?: string;
      verified_email?: boolean;
      email_verified?: boolean;
    };
    const email =
      provider === 'GOOGLE'
        ? identity.email
        : (identity.mail ?? identity.userPrincipalName);
    const providerAccountId =
      provider === 'GOOGLE' ? identity.sub : identity.id;
    if (
      !email ||
      !providerAccountId ||
      (provider === 'GOOGLE' &&
        identity.verified_email !== true &&
        identity.email_verified !== true)
    )
      throw new Error('Il provider non ha restituito un indirizzo email verificato.');

    await prisma.emailAccount.upsert({
      where: {
        userId_provider_email: {
          userId: oauthState.userId,
          provider,
          email: email.toLowerCase(),
        },
      },
      create: {
        userId: oauthState.userId,
        provider,
        providerAccountId,
        email: email.toLowerCase(),
        accessTokenEncrypted: encryptEmailToken(tokens.accessToken),
        refreshTokenEncrypted: tokens.refreshToken
          ? encryptEmailToken(tokens.refreshToken)
          : null,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        scope: tokens.scope,
      },
      update: {
        providerAccountId,
        accessTokenEncrypted: encryptEmailToken(tokens.accessToken),
        ...(tokens.refreshToken
          ? { refreshTokenEncrypted: encryptEmailToken(tokens.refreshToken) }
          : {}),
        accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        scope: tokens.scope,
      },
    });
    return redirectToEmail();
  } catch (error) {
    console.error('Email account connection failed.', {
      provider,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return redirectToEmail('connection');
  }
}
