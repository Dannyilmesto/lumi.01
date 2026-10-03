import test from "node:test";
import assert from "node:assert/strict";
import { defaultDocumentSettings } from "../src/lib/quote-document-format.ts";
import { documentSettingsSchema } from "../src/lib/quote-document-schema.ts";

test("server schema keeps the same defaults as the zod-free client module", () => {
  const parsed = documentSettingsSchema.parse({
    footer: defaultDocumentSettings.footer,
  });
  assert.deepEqual(parsed, defaultDocumentSettings);
});

test("document settings reject out-of-range margins and unknown formats", () => {
  assert.equal(documentSettingsSchema.safeParse({ margin: 11 }).success, false);
  assert.equal(documentSettingsSchema.safeParse({ margin: 36 }).success, false);
  assert.equal(documentSettingsSchema.safeParse({ format: "A3" }).success, false);
  assert.equal(documentSettingsSchema.safeParse({ margin: 12 }).success, true);
});
