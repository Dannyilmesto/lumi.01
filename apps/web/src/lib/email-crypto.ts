import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

function encryptionKey(encoded = process.env.EMAIL_TOKEN_ENCRYPTION_KEY) {
  if (encoded) {
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32)
      throw new Error('EMAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes in base64.');
    return key;
  }
  const authSecret = process.env.BETTER_AUTH_SECRET;
  if (!authSecret)
    throw new Error('Email token encryption is not configured.');
  return createHmac('sha256', authSecret)
    .update('lumi-email-account-token-encryption-v1')
    .digest();
}

export function isEmailTokenEncryptionConfigured(
  encoded = process.env.EMAIL_TOKEN_ENCRYPTION_KEY,
) {
  try {
    encryptionKey(encoded);
    return true;
  } catch {
    return false;
  }
}

export function encryptEmailToken(
  value: string,
  encodedKey?: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptEmailToken(
  value: string,
  encodedKey?: string,
): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...extra] =
    value.split('.');
  if (
    version !== 'v1' ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extra.length
  )
    throw new Error('Stored email token has an unsupported format.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(encodedKey),
    Buffer.from(encodedIv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
