import test from "node:test";
import assert from "node:assert/strict";
import {
  maximumAssistantPdfBytes,
  validateAssistantPdfUpload,
} from "../src/lib/assistant-document-upload.ts";

const pdf = Buffer.from("%PDF-1.7\ncontenuto");

function validate(overrides = {}) {
  return validateAssistantPdfUpload({
    fileName: "documento.pdf",
    mimeType: "application/pdf",
    size: pdf.length,
    bytes: pdf,
    ...overrides,
  });
}

test("accepts a valid PDF and generic browser MIME", () => {
  assert.equal(validate(), null);
  assert.equal(validate({ mimeType: "application/octet-stream" }), null);
  assert.equal(validate({ mimeType: "" }), null);
});

test("rejects unsupported extension, MIME, size, and invalid PDF bytes", () => {
  assert.match(validate({ fileName: "documento.docx" }), /solo documenti PDF/);
  assert.match(validate({ mimeType: "text/plain" }), /non corrisponde/);
  assert.match(
    validate({ size: maximumAssistantPdfBytes + 1 }),
    /supera il limite/,
  );
  assert.match(validate({ size: 0 }), /vuoto/);
  assert.match(validate({ bytes: Buffer.from("non è un PDF") }), /intestazione PDF/);
});
