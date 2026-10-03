import { CatalogProductPricingMode } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const productSchema = z
  .object({
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

async function accessibleProduct(id: string, userId: string) {
  return prisma.quoteCatalogProduct.findFirst({
    where: {
      id,
      organization: { members: { some: { userId } } },
    },
    select: { id: true, organizationId: true },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Accedi per modificare i prodotti." },
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

  const { id } = await params;
  const product = await accessibleProduct(id, session.user.id);
  if (!product)
    return Response.json(
      { error: "Prodotto non disponibile." },
      { status: 404 },
    );

  const updated = await prisma.quoteCatalogProduct.update({
    where: { id },
    data: {
      name: parsed.data.name,
      pricingMode: parsed.data.pricingMode,
      price: parsed.data.price,
      minimumBillableArea:
        parsed.data.pricingMode === "AREA"
          ? (parsed.data.minimumBillableArea ?? null)
          : null,
    },
  });
  return Response.json({
    product: {
      id: updated.id,
      name: updated.name,
      pricingMode: updated.pricingMode,
      price: updated.price.toString(),
      minimumBillableArea: updated.minimumBillableArea?.toString() ?? null,
    },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Accedi per eliminare i prodotti." },
      { status: 401 },
    );

  const { id } = await params;
  const product = await accessibleProduct(id, session.user.id);
  if (!product)
    return Response.json(
      { error: "Prodotto non disponibile." },
      { status: 404 },
    );

  await prisma.quoteCatalogProduct.delete({ where: { id } });
  return Response.json({ deleted: true });
}
