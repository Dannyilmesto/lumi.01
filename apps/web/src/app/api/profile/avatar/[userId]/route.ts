import { prisma } from '@/lib/prisma';
import { profileApi } from '@/lib/profile-api';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  return profileApi(request, async () => {
    const { userId } = await params;
    const avatar = await prisma.userAvatar.findUnique({ where: { userId } });
    if (!avatar) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(avatar.data), {
      headers: {
        'Content-Type': avatar.mimeType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
