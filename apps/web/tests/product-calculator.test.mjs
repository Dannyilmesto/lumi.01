import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductEstimateText,
  calculateCatalogProduct,
} from "../src/lib/product-calculator.ts";

test("calculates area products using the minimum billable surface and quantity", () => {
  const product = {
    id: "screen",
    name: "Zanzariera",
    pricingMode: "AREA",
    price: "40.00",
    minimumBillableArea: "0.500",
  };
  const result = calculateCatalogProduct(product, 2, 600, 800);
  assert.deepEqual(result, {
    areaSqm: 0.48,
    billableAreaSqm: 0.5,
    unitPrice: 20,
    totalPrice: 40,
  });
});

test("calculates fixed-price products without dimensions and rounds money", () => {
  const product = {
    id: "handle",
    name: "Maniglia",
    pricingMode: "FIXED",
    price: "17.35",
    minimumBillableArea: null,
  };
  assert.deepEqual(calculateCatalogProduct(product, 3, null, null), {
    areaSqm: null,
    billableAreaSqm: null,
    unitPrice: 17.35,
    totalPrice: 52.05,
  });
});

test("requires positive dimensions and valid integer quantities", () => {
  const product = {
    id: "glass",
    name: "Vetro",
    pricingMode: "AREA",
    price: "90",
    minimumBillableArea: null,
  };
  assert.equal(calculateCatalogProduct(product, 1, null, 1000).unitPrice, null);
  assert.equal(calculateCatalogProduct(product, 1, 1000, 1000).unitPrice, null);
  assert.equal(
    calculateCatalogProduct(product, 0, 1000, 1000).totalPrice,
    null,
  );
  assert.equal(
    calculateCatalogProduct(product, 1.5, 1000, 1000).totalPrice,
    null,
  );
});

test("builds an ordered copyable summary with area, minimum and fixed products", () => {
  const areaProduct = {
    id: "window",
    name: "Finestra",
    pricingMode: "AREA",
    price: "100",
    minimumBillableArea: "1",
  };
  const fixedProduct = {
    id: "handle",
    name: "Maniglia",
    pricingMode: "FIXED",
    price: "15",
    minimumBillableArea: null,
  };
  const area = calculateCatalogProduct(areaProduct, 1, 500, 1000);
  const fixed = calculateCatalogProduct(fixedProduct, 2, null, null);
  const summary = buildProductEstimateText([
    {
      product: areaProduct,
      quantity: 1,
      widthMm: 500,
      heightMm: 1000,
      calculation: area,
    },
    {
      product: fixedProduct,
      quantity: 2,
      widthMm: null,
      heightMm: null,
      calculation: fixed,
    },
  ]);
  assert.ok(summary.indexOf("1. Finestra") < summary.indexOf("2. Maniglia"));
  assert.match(summary, /fatturati 1 m²/);
  assert.ok(summary.includes("Totale: 30,00\u00a0€"));
  assert.ok(summary.includes("TOTALE: 130,00\u00a0€"));
});
