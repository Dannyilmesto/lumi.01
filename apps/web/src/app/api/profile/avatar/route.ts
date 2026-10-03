import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import {
  profileApi,
  ProfileError,
  privateJson,
  publicUserSelect,
  limitedBody,
} from '@/lib/profile-api';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return profileApi(request, async ({ userId }) => {
    if (Number(request.headers.get('content-length')) > 6 * 1024 * 1024)
      throw new ProfileError('La foto deve essere inferiore a 5 MB.', 413);
    const raw = await limitedBody(request, 6 * 1024 * 1024);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(raw), {
        headers: { 'Content-Type': request.headers.get('content-type') || '' },
      }).formData();
    } catch {
      throw new ProfileError('Caricamento immagine non valido.');
    }
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
      throw new ProfileError('Scegli una foto PNG, JPEG o WebP fino a 5 MB.');
    const bytes = Buffer.from(await file.arrayBuffer());
    const valid =
      bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP');
    if (!valid) throw new ProfileError('Formato immagine non supportato.');
    let data: Buffer;
    try {
      data = await sharp(bytes, { limitInputPixels: 20_000_000 })
        .rotate()
        .resize(384, 384, { fit: 'cover' })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new ProfileError('La foto è illeggibile o troppo grande.');
    }
    const user = await prisma.$transaction(async (tx) => {
      await tx.userAvatar.upsert({
        where: { userId },
        create: { userId, data: new Uint8Array(data), mimeType: 'image/webp' },
        update: { data: new Uint8Array(data), mimeType: 'image/webp' },
      });
      return tx.user.update({
        where: { id: userId },
        data: {
          image: `/api/profile/avatar/${encodeURIComponent(userId)}?v=${Date.now()}`,
          isPresetAvatar: false,
        },
        select: { ...publicUserSelect, email: true, createdAt: true },
      });
    });
    return privateJson(user);
  });
}
