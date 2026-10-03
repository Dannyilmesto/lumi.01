export type CatalogProduct = {
  id: string;
  name: string;
  pricingMode: "AREA" | "FIXED";
  price: string;
  minimumBillableArea: string | null;
};

export type ProductCalculation = {
  areaSqm: number | null;
  billableAreaSqm: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateCatalogProduct(
  product: CatalogProduct,
  quantity: number,
  widthMm: number | null,
  heightMm: number | null,
): ProductCalculation {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000)
    return {
      areaSqm: null,
      billableAreaSqm: null,
      unitPrice: null,
      totalPrice: null,
    };

  const price = Number(product.price);
  if (!Number.isFinite(price) || price < 0)
    return {
      areaSqm: null,
      billableAreaSqm: null,
      unitPrice: null,
      totalPrice: null,
    };

  let areaSqm: number | null = null;
  let billableAreaSqm: number | null = null;
  let unitPrice = price;
  if (product.pricingMode === "AREA") {
    const width = widthMm ?? 0;
    const height = heightMm ?? 0;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return {
        areaSqm: null,
        billableAreaSqm: null,
        unitPrice: null,
        totalPrice: null,
      };
    }
    areaSqm = (width * height) / 1_000_000;
    const minimum = Number(product.minimumBillableArea ?? 0);
    if (!Number.isFinite(minimum) || minimum <= 0)
      return {
        areaSqm: null,
        billableAreaSqm: null,
        unitPrice: null,
        totalPrice: null,
      };
    billableAreaSqm = Math.max(areaSqm, minimum);
    unitPrice = roundMoney(price * billableAreaSqm);
  }

  return {
    areaSqm,
    billableAreaSqm,
    unitPrice,
    totalPrice: roundMoney(unitPrice * quantity),
  };
}

const euroFormat = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
});
export function formatEuro(value: number) {
  return euroFormat.format(value);
}

export function buildProductEstimateText(
  lines: Array<{
    product: CatalogProduct;
    quantity: number;
    widthMm: number | null;
    heightMm: number | null;
    calculation: ProductCalculation;
  }>,
) {
  const details = lines.map(
    ({ product, quantity, widthMm, heightMm, calculation }, index) => {
      const dimensions =
        product.pricingMode === "AREA" && widthMm && heightMm
          ? ` · ${widthMm} × ${heightMm} mm · ${calculation.areaSqm?.toLocaleString("it-IT", { maximumFractionDigits: 3 })} m²` +
            (calculation.billableAreaSqm !== calculation.areaSqm
              ? ` (fatturati ${calculation.billableAreaSqm?.toLocaleString("it-IT", { maximumFractionDigits: 3 })} m²)`
              : "")
          : "";
      return `${index + 1}. ${product.name}${dimensions}\n   Quantità: ${quantity} · Prezzo unitario: ${formatEuro(calculation.unitPrice ?? 0)} · Totale: ${formatEuro(calculation.totalPrice ?? 0)}`;
    },
  );
  const total = lines.reduce(
    (sum, line) => sum + (line.calculation.totalPrice ?? 0),
    0,
  );
  return `CALCOLO PRODOTTI\n\n${details.join("\n\n")}\n\nTOTALE: ${formatEuro(roundMoney(total))}`;
}
