import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; candidateId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return jsonError('Devi accedere per aggiornare la revisione.', 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Richiesta di revisione non valida.', 400);
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('reviewStatus' in body) ||
    (body.reviewStatus !== 'ACCEPTED' && body.reviewStatus !== 'REJECTED')
  ) {
    return jsonError('Seleziona se includere o escludere il candidato.', 400);
  }

  const { id, candidateId } = await context.params;
  const candidate = await prisma.extractionCandidate.findFirst({
    where: {
      id: candidateId,
      priceListId: id,
      priceList: {
        supplier: {
          organization: { members: { some: { userId: session.user.id } } },
        },
      },
    },
    select: { id: true, reviewStatus: true },
  });
  if (!candidate) return jsonError('Candidato non trovato.', 404);
  if (candidate.reviewStatus !== 'NEEDS_REVIEW') {
    return jsonError('Questo candidato è già stato revisionato.', 409);
  }

  const updated = await prisma.extractionCandidate.updateMany({
    where: { id: candidate.id, reviewStatus: 'NEEDS_REVIEW' },
    data: { reviewStatus: body.reviewStatus },
  });
  if (updated.count !== 1) {
    return jsonError('Il candidato è stato revisionato da un’altra richiesta.', 409);
  }

  return Response.json({ reviewStatus: body.reviewStatus });
}
