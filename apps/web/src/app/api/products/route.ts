import { CatalogProductPricingMode } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const productSchema = z
  .object({
    organizationId: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(160),
    pricingMode: z.nativeEnum(CatalogProductPricingMode),
    price: z.coerce.number().finite().min(0.01).max(9_999_999_999.99),
    minimumBillableArea: z
      .union([
        z.coerce.number().finite().positive().max(9_999_999.999),
        z.null(),
      ])
      .optional(),
  })
  .superRefine((product, context) => {
    if (
      product.pricingMode === "AREA" &&
      (product.minimumBillableArea === undefined ||
        product.minimumBillableArea === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Imposta il minimo fatturabile in metri quadrati.",
        path: ["minimumBillableArea"],
      });
    }
    if (
      product.pricingMode === "FIXED" &&
      product.minimumBillableArea !== undefined &&
      product.minimumBillableArea !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Il prezzo fisso non prevede una superficie minima.",
        path: ["minimumBillableArea"],
      });
    }
  });

function serializeProduct(product: {
  id: string;
  name: string;
  pricingMode: CatalogProductPricingMode;
  price: { toString(): string };
  minimumBillableArea: { toString(): string } | null;
}) {
  return {
    id: product.id,
    name: product.name,
    pricingMode: product.pricingMode,
    price: product.price.toString(),
    minimumBillableArea: product.minimumBillableArea?.toString() ?? null,
  };
}

async function organizationForUser(organizationId: string, userId: string) {
  return prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { organizationId: true },
  });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Accedi per consultare i prodotti." },
      { status: 401 },
    );

  const organizationId = new URL(request.url).searchParams.get(
    "organizationId",
  );
  if (!organizationId)
    return Response.json({ error: "Seleziona un’azienda." }, { status: 400 });

  const membership = await organizationForUser(organizationId, session.user.id);
  if (!membership)
    return Response.json(
      { error: "Azienda non disponibile." },
      { status: 404 },
    );

  const products = await prisma.quoteCatalogProduct.findMany({
    where: { organizationId },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });
  return Response.json({ products: products.map(serializeProduct) });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Accedi per salvare i prodotti." },
      { status: 401 },
    );

  const parsed = productSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Controlla nome, prezzo e modalità di calcolo del prodotto." },
      { status: 400 },
    );

  const { organizationId, ...data } = parsed.data;
  const membership = await organizationForUser(organizationId, session.user.id);
  if (!membership)
    return Response.json(
      { error: "Azienda non disponibile." },
      { status: 404 },
    );

  const product = await prisma.quoteCatalogProduct.create({
    data: {
      organizationId,
      name: data.name,
      pricingMode: data.pricingMode,
      price: data.price,
      minimumBillableArea:
        data.pricingMode === "AREA" ? (data.minimumBillableArea ?? null) : null,
    },
  });
  return Response.json({ product: serializeProduct(product) }, { status: 201 });
}
