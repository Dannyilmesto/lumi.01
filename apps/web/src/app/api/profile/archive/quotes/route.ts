import { z } from 'zod';
import {
  idSchema,
  privateJson,
  profileApi,
  profileBody,
} from '@/lib/profile-api';
import { saveQuotePdfToArchive } from '@/lib/archive-quote';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { quoteId } = z
      .object({ quoteId: idSchema })
      .parse(await profileBody(request));
    const path = await saveQuotePdfToArchive(request, userId, quoteId);
    return privateJson({ ok: true, path }, 201);
  });
}
