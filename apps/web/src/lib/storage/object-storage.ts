import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/** Provider-neutral interface so local development storage can later be replaced by S3/R2. */
export interface ObjectStorage {
  put(key: string, contents: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const keyPattern = /^[0-9a-f-]{36}\.pdf$/i;

function localPath(key: string) {
  if (!keyPattern.test(key))
    throw new Error('Chiave di archiviazione non valida.');

  const root = resolve(
    process.cwd(),
    process.env.UPLOADS_DIR ?? '.data/uploads',
  );
  const path = resolve(root, key);
  if (!path.startsWith(`${root}${sep}`))
    throw new Error('Percorso di archiviazione non valido.');
  return { root, path };
}

const localStorage: ObjectStorage = {
  async put(key, contents) {
    const { root, path } = localPath(key);
    await mkdir(root, { recursive: true });
    await writeFile(path, contents, { flag: 'wx', mode: 0o600 });
  },

  async get(key) {
    const { path } = localPath(key);
    return readFile(path);
  },

  async delete(key) {
    const { path } = localPath(key);
    try {
      await unlink(path);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return;
      throw error;
    }
  },
};

export function getObjectStorage(): ObjectStorage {
  const provider = process.env.OBJECT_STORAGE_PROVIDER ?? 'local';
  if (provider !== 'local') {
    throw new Error(`Provider di archiviazione non supportato: ${provider}`);
  }
  return localStorage;
}
