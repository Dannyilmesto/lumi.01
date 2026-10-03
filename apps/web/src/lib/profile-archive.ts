import { createReadStream } from 'node:fs';
import {
  mkdir,
  lstat,
  open,
  opendir,
  link,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ProfileError } from '@/lib/profile-api';

const archiveRoot = path.resolve(
  process.env.PROFILE_ARCHIVE_DIR ||
    path.join(process.cwd(), '.data', 'profile-archive'),
);

function segments(relative: string) {
  if (!relative || relative.startsWith('/') || relative.includes('\\'))
    throw new ProfileError('Percorso archivio non valido.');
  const parts = relative.split('/');
  if (
    parts.some(
      (part) =>
        !part || part === '.' || part === '..' || /[\x00-\x1f\x7f]/.test(part),
    )
  )
    throw new ProfileError('Percorso archivio non valido.');
  return parts;
}

async function base(userId: string) {
  const root = path.join(archiveRoot, userId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

async function checkedPath(
  userId: string,
  relative: string,
  createParents = false,
) {
  const root = await base(userId);
  const parts = segments(relative);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (createParents)
      await mkdir(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
    const info = await lstat(current).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink())
      throw new ProfileError('Cartella archivio non valida.', 400);
  }
  return path.join(current, parts.at(-1)!);
}

export async function listArchive(userId: string, relative = '') {
  const target = relative
    ? await checkedPath(userId, relative)
    : await base(userId);
  const targetInfo = await lstat(target).catch(() => null);
  if (!targetInfo?.isDirectory() || targetInfo.isSymbolicLink())
    throw new ProfileError('Cartella non disponibile.', 404);
  const entries: { name: string; directory: boolean; size: number }[] = [];
  const directory = await opendir(target);
  for await (const entry of directory) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.lumi-upload-'))
      continue;
    const info = await lstat(path.join(target, entry.name));
    entries.push({
      name: entry.name,
      directory: info.isDirectory(),
      size: info.isFile() ? info.size : 0,
    });
  }
  const collator = new Intl.Collator('it', {
    numeric: true,
    sensitivity: 'base',
  });
  entries.sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      collator.compare(a.name, b.name) ||
      a.name.localeCompare(b.name),
  );
  return entries;
}

export async function createArchiveFolder(userId: string, relative: string) {
  const target = await checkedPath(userId, relative, true);
  const existing = await lstat(target).catch(() => null);
  if (existing && !existing.isDirectory())
    throw new ProfileError('Esiste già un file con questo nome.', 409);
  if (existing?.isSymbolicLink())
    throw new ProfileError('Collegamenti non consentiti.', 400);
  await mkdir(target, { recursive: false }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    },
  );
}

export async function saveArchiveFile(
  userId: string,
  relative: string,
  body: ReadableStream<Uint8Array> | null,
  options: { replace?: boolean } = {},
) {
  if (!body) throw new ProfileError('File mancante.');
  const target = await checkedPath(userId, relative, true);
  const existing = await lstat(target).catch(() => null);
  if (existing?.isDirectory() || existing?.isSymbolicLink())
    throw new ProfileError('Il percorso non può essere sostituito.', 409);
  if (existing && !options.replace)
    throw new ProfileError(
      'Il file esiste già. Rinominalo prima di importarlo.',
      409,
    );
  const temporary = path.join(
    path.dirname(target),
    `.lumi-upload-${randomUUID()}`,
  );
  const handle = await open(temporary, 'wx', 0o600);
  let complete = false;
  try {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let offset = 0;
        while (offset < value.length) {
          const { bytesWritten } = await handle.write(
            value,
            offset,
            value.length - offset,
          );
          if (!bytesWritten) throw new Error('Scrittura del file interrotta.');
          offset += bytesWritten;
        }
      }
    } finally {
      reader.releaseLock();
    }
    await handle.sync();
    await handle.close();
    if (options.replace) await rename(temporary, target);
    else
      // Linking is atomic and fails if a concurrent import created the target.
      await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST')
          throw new ProfileError('Il file esiste già.', 409);
        throw error;
      });
    complete = true;
    await rm(temporary, { force: true }).catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
    if (!complete) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function deleteArchiveEntry(userId: string, relative: string) {
  const target = await checkedPath(userId, relative);
  const info = await lstat(target).catch(() => null);
  if (!info || info.isSymbolicLink())
    throw new ProfileError('Elemento non disponibile.', 404);
  await rm(target, { recursive: info.isDirectory(), force: false });
}

export async function downloadArchiveFile(userId: string, relative: string) {
  const target = await checkedPath(userId, relative);
  const info = await lstat(target).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink())
    throw new ProfileError('File non disponibile.', 404);
  const stream = Readable.toWeb(
    createReadStream(target),
  ) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(info.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
