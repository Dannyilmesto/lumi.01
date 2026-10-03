import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  const { id, imageId } = await params;
  const image = await prisma.quoteDocumentImage.findFirst({
    where: {
      id: imageId,
      quoteId: id,
      quote: {
        deletedAt: null,
        organization: { members: { some: { userId: session.user.id } } },
      },
    },
  });
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
