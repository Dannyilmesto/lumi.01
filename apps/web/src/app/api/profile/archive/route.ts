import { z } from 'zod';
import { profileApi, profileBody, privateJson } from '@/lib/profile-api';
import {
  createArchiveFolder,
  deleteArchiveEntry,
  downloadArchiveFile,
  listArchive,
  saveArchiveFile,
} from '@/lib/profile-archive';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const url = new URL(request.url);
    const relative = url.searchParams.get('path') || '';
    if (url.searchParams.get('download') === '1')
      return downloadArchiveFile(userId, relative);
    return privateJson({ entries: await listArchive(userId, relative) });
  });
}

export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { path } = z
      .object({ path: z.string().min(1).max(4096) })
      .parse(await profileBody(request));
    await createArchiveFolder(userId, path);
    return privateJson({ ok: true }, 201);
  });
}

export async function PUT(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const relative = new URL(request.url).searchParams.get('path') || '';
    await saveArchiveFile(userId, relative, request.body);
    return privateJson({ ok: true }, 201);
  });
}

export async function DELETE(request: Request) {
  return profileApi(request, async ({ userId }) => {
    const { path } = z
      .object({ path: z.string().min(1).max(4096) })
      .parse(await profileBody(request));
    await deleteArchiveEntry(userId, path);
    return privateJson({ ok: true });
  });
}
