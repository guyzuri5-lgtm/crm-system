import { test } from "node:test";
import assert from "node:assert/strict";
import { splitVariants, pickVariant, isOptOutMessage } from "../../src/lib/message-variants.ts";

test("a body without a separator is a single variant", () => {
  assert.deepEqual(splitVariants("היי {{first_name}}"), ["היי {{first_name}}"]);
});

test("three dashes on their own line split the variants", () => {
  const body = "היי דנה\nמה שלומך?\n---\nשלום דנה!\n  ---  \nדנה, רציתי לשאול";
  assert.deepEqual(splitVariants(body), ["היי דנה\nמה שלומך?", "שלום דנה!", "דנה, רציתי לשאול"]);
});

test("dashes inside a line do not split", () => {
  assert.equal(splitVariants("מחיר 100---200 ₪").length, 1);
});

test("pickVariant covers every variant", () => {
  const body = "א\n---\nב\n---\nג";
  assert.equal(pickVariant(body, () => 0), "א");
  assert.equal(pickVariant(body, () => 0.5), "ב");
  assert.equal(pickVariant(body, () => 0.9999), "ג");
});

test("opt-out words match only as the whole message", () => {
  assert.ok(isOptOutMessage("הסר"));
  assert.ok(isOptOutMessage("  הסר אותי!! "));
  assert.ok(isOptOutMessage("STOP"));
  assert.ok(!isOptOutMessage("אל תסיר אותי"));
  assert.ok(!isOptOutMessage("הסרתי את זה מהרשימה"));
});
