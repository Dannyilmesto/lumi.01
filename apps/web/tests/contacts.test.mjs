import assert from "node:assert/strict";
import test from "node:test";
import { contactFields } from "../src/lib/contacts.ts";

test("requires a name and phone while accepting optional contact details", () => {
  const contact = contactFields.parse({ name: "  Mario Rossi ", phone: " 123 " });
  assert.equal(contact.name, "Mario Rossi");
  assert.equal(contact.phone, "123");
  assert.equal(contact.address, null);
  assert.equal(contact.email, null);
});

test("rejects missing required fields and invalid optional email addresses", () => {
  assert.equal(contactFields.safeParse({ name: "Mario" }).success, false);
  assert.equal(
    contactFields.safeParse({ name: "Mario", phone: "123", email: "invalid" })
      .success,
    false,
  );
});
