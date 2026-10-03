export type EmailProviderId = 'GOOGLE' | 'MICROSOFT';

export function parseEmailProvider(value: string): EmailProviderId | null {
  return value === 'GOOGLE' || value === 'MICROSOFT' ? value : null;
}

function configuredValue(name: string) {
  return process.env[name]?.trim() ?? '';
}

export function isEmailProviderConfigured(provider: EmailProviderId) {
  if (provider === 'GOOGLE')
    return Boolean(
      configuredValue('GOOGLE_OAUTH_CLIENT_ID') &&
        configuredValue('GOOGLE_OAUTH_CLIENT_SECRET'),
    );
  return Boolean(
    configuredValue('MICROSOFT_OAUTH_CLIENT_ID') &&
      configuredValue('MICROSOFT_OAUTH_CLIENT_SECRET'),
  );
}

function providerCredentials(provider: EmailProviderId) {
  const clientId = configuredValue(
    provider === 'GOOGLE'
      ? 'GOOGLE_OAUTH_CLIENT_ID'
      : 'MICROSOFT_OAUTH_CLIENT_ID',
  );
  const clientSecret = configuredValue(
    provider === 'GOOGLE'
      ? 'GOOGLE_OAUTH_CLIENT_SECRET'
      : 'MICROSOFT_OAUTH_CLIENT_SECRET',
  );
  if (!clientId || !clientSecret)
    throw new Error(`${provider} OAuth credentials are not configured.`);
  return { clientId, clientSecret };
}

export function emailRedirectUri(
  provider: EmailProviderId,
  baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
) {
  const callback = provider === 'GOOGLE' ? 'google' : 'microsoft';
  return new URL(`/api/email/oauth/${callback}/callback`, baseUrl).toString();
}

export function emailAuthorizationUrl(
  provider: EmailProviderId,
  state: string,
) {
  const { clientId } = providerCredentials(provider);
  const redirectUri = emailRedirectUri(provider);
  const url =
    provider === 'GOOGLE'
      ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
      : new URL(
          `https://login.microsoftonline.com/${encodeURIComponent(process.env.MICROSOFT_OAUTH_TENANT_ID?.trim() || 'common')}/oauth2/v2.0/authorize`,
        );
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('state', state);
  if (provider === 'GOOGLE') {
    url.searchParams.set('scope', 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent select_account');
  } else {
    url.searchParams.set('scope', 'openid profile email offline_access User.Read Mail.Read Mail.Send');
    url.searchParams.set('prompt', 'select_account');
  }
  return url;
}

export async function exchangeEmailAuthorizationCode(
  provider: EmailProviderId,
  code: string,
) {
  const { clientId, clientSecret } = providerCredentials(provider);
  const tokenUrl =
    provider === 'GOOGLE'
      ? 'https://oauth2.googleapis.com/token'
      : `https://login.microsoftonline.com/${encodeURIComponent(process.env.MICROSOFT_OAUTH_TENANT_ID?.trim() || 'common')}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: emailRedirectUri(provider),
  });
  if (provider === 'MICROSOFT')
    body.set(
      'scope',
      'openid profile email offline_access User.Read Mail.Read Mail.Send',
    );
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        error?: string;
      }
    | null;
  if (
    !response.ok ||
    !result?.access_token ||
    !Number.isFinite(result.expires_in)
  ) {
    console.error('Email OAuth code exchange failed.', {
      provider,
      status: response.status,
      error: result?.error ?? 'invalid_response',
    });
    throw new Error('Non è stato possibile collegare questo account email.');
  }
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? null,
    expiresIn: result.expires_in as number,
    scope: result.scope ?? null,
  };
}

export async function refreshEmailAccessToken(
  provider: EmailProviderId,
  refreshToken: string,
) {
  const { clientId, clientSecret } = providerCredentials(provider);
  const tokenUrl =
    provider === 'GOOGLE'
      ? 'https://oauth2.googleapis.com/token'
      : `https://login.microsoftonline.com/${encodeURIComponent(process.env.MICROSOFT_OAUTH_TENANT_ID?.trim() || 'common')}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (provider === 'MICROSOFT')
    body.set(
      'scope',
      'openid profile email offline_access User.Read Mail.Read Mail.Send',
    );
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      }
    | null;
  if (
    !response.ok ||
    !result?.access_token ||
    !Number.isFinite(result.expires_in)
  ) {
    console.error('Email OAuth token refresh failed.', {
      provider,
      status: response.status,
    });
    throw new Error('Autorizzazione scaduta. Ricollega l’account email.');
  }
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? null,
    expiresIn: result.expires_in as number,
    scope: result.scope ?? null,
  };
}
