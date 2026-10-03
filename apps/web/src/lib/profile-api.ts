import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';

export class ProfileError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type ProfileSession = {
  userId: string;
  sessionId: string;
  expiresAt: Date;
};
export const publicUserSelect = {
  id: true,
  name: true,
  image: true,
  isPresetAvatar: true,
  avatarPreset: true,
} as const;
export const idSchema = z.string().min(1).max(128);
export const avatarPresets = [
  'sky',
  'mint',
  'lilac',
  'sun',
  'rose',
  'ocean',
] as const;

export async function profileApi(
  request: Request,
  run: (session: ProfileSession) => Promise<Response>,
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new ProfileError('Accedi per continuare.', 401);
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin)
        throw new ProfileError('Origine della richiesta non consentita.', 403);
    }
    return await run({
      userId: session.user.id,
      sessionId: session.session.id,
      expiresAt: new Date(session.session.expiresAt),
    });
  } catch (error) {
    if (error instanceof ProfileError)
      return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: 'Controlla i campi inseriti.',
          fields: error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Le query raw (P2010) riportano il codice PostgreSQL in meta.code.
      const rawCode =
        error.code === 'P2010'
          ? (error.meta as { code?: unknown } | undefined)?.code
          : undefined;
      if (['P2025', 'P2003'].includes(error.code) || rawCode === '23503')
        return Response.json(
          { error: 'Il contenuto non è più disponibile.' },
          { status: 404 },
        );
      if (['P2002', 'P2034'].includes(error.code) || rawCode === '23505')
        return Response.json(
          { error: 'Il contenuto è stato aggiornato. Ricarica e riprova.' },
          { status: 409 },
        );
    }
    console.error(
      'Operazione profilo non completata.',
      error instanceof Error ? error.name : 'unknown',
    );
    return Response.json(
      { error: 'Operazione non completata. Riprova tra poco.' },
      { status: 500 },
    );
  }
}

export async function limitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new ProfileError('Contenuto mancante.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new ProfileError('Richiesta troppo grande.', 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}
export async function profileBody(request: Request) {
  const bytes = await limitedBody(request, 80_000);
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new ProfileError('Contenuto JSON non valido.');
  }
}

export function privateJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
export function pagination(url: URL, size = 30) {
  const offset = Math.max(
    0,
    Math.min(
      100_000,
      Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0,
    ),
  );
  return { skip: offset, take: size + 1, offset, size };
}
