import test from "node:test";
import assert from "node:assert/strict";
import { isApprovedQuoteStatus } from "../src/lib/quote-status.ts";

test("treats legacy accepted and approved quotes as protected", () => {
  assert.equal(isApprovedQuoteStatus("ACCEPTED"), true);
  assert.equal(isApprovedQuoteStatus("APPROVED"), true);
  assert.equal(isApprovedQuoteStatus("DRAFT"), false);
  assert.equal(isApprovedQuoteStatus("CLOSED"), false);
});
