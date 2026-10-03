import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptEmailToken,
  encryptEmailToken,
} from "../src/lib/email-crypto.ts";
import {
  emailAuthorizationUrl,
  emailRedirectUri,
  isEmailProviderConfigured,
  parseEmailProvider,
} from "../src/lib/email-oauth.ts";
import {
  genericEmailAccountSchema,
  isPublicEmailServerAddress,
} from "../src/lib/generic-email.ts";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

test("encrypts email tokens with authenticated encryption", () => {
  const encrypted = encryptEmailToken("refresh-token-secret", encryptionKey);
  assert.notEqual(encrypted, "refresh-token-secret");
  assert.equal(decryptEmailToken(encrypted, encryptionKey), "refresh-token-secret");
  assert.throws(() =>
    decryptEmailToken(encrypted, Buffer.alloc(32, 8).toString("base64")),
  );
});

test("rejects malformed or incorrectly sized email encryption keys", () => {
  assert.throws(() => encryptEmailToken("token", "not-base64"));
  assert.throws(() =>
    encryptEmailToken("token", Buffer.alloc(16).toString("base64")),
  );
});

test("accepts only the supported mailbox providers", () => {
  assert.equal(parseEmailProvider("GOOGLE"), "GOOGLE");
  assert.equal(parseEmailProvider("MICROSOFT"), "MICROSOFT");
  assert.equal(parseEmailProvider("OTHER"), null);
});

test("reports OAuth readiness only when a provider has both credentials", () => {
  const previousId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const previousSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  try {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    assert.equal(isEmailProviderConfigured("GOOGLE"), false);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    assert.equal(isEmailProviderConfigured("GOOGLE"), true);
  } finally {
    if (previousId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = previousId;
    if (previousSecret === undefined)
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = previousSecret;
  }
});

test("builds provider authorization URLs with fixed callback URLs and state", () => {
  const previousId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const previousSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const previousBaseUrl = process.env.BETTER_AUTH_URL;
  try {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    process.env.BETTER_AUTH_URL = "http://localhost:3001";
    const url = emailAuthorizationUrl("GOOGLE", "random-state");
    assert.equal(url.hostname, "accounts.google.com");
    assert.equal(url.searchParams.get("state"), "random-state");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://localhost:3001/api/email/oauth/google/callback",
    );
    assert.equal(
      emailRedirectUri("MICROSOFT"),
      "http://localhost:3001/api/email/oauth/microsoft/callback",
    );
  } finally {
    if (previousId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = previousId;
    if (previousSecret === undefined)
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = previousSecret;
    if (previousBaseUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousBaseUrl;
  }
});

test("validates IMAP/SMTP account settings and blocks private server addresses", () => {
  const config = {
    email: "person@example.com",
    imap: {
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: "person@example.com",
      password: "test-password",
    },
    smtp: {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "person@example.com",
      password: "test-password",
    },
  };
  assert.equal(genericEmailAccountSchema.safeParse(config).success, true);
  assert.equal(
    genericEmailAccountSchema.safeParse({
      ...config,
      imap: { ...config.imap, host: "https://example.com" },
    }).success,
    false,
  );
  assert.equal(isPublicEmailServerAddress("8.8.8.8"), true);
  assert.equal(isPublicEmailServerAddress("127.0.0.1"), false);
  assert.equal(isPublicEmailServerAddress("192.168.1.20"), false);
  assert.equal(isPublicEmailServerAddress("::1"), false);
  assert.equal(isPublicEmailServerAddress("fd00::1"), false);
});
