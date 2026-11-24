import { test } from "node:test";
import assert from "node:assert/strict";
import { warmupState, randomGapSeconds } from "../../src/lib/whatsapp-warmup.ts";

const START = "2026-11-24T08:00:00.000Z";
const at = (days, hours = 0) => new Date(Date.parse(START) + (days * 24 + hours) * 3600_000);
const base = { dailyLimit: 40, warmupEnabled: true, warmupStartedAt: START };

test("day 1 starts at 15", () => {
  assert.deepEqual(warmupState(base, at(0, 1)), { effectiveLimit: 15, day: 1 });
});

test("climbs in a straight line and reaches the limit on day 7", () => {
  const limits = [0, 1, 2, 3, 4, 5, 6].map((d) => warmupState(base, at(d, 1)).effectiveLimit);
  assert.deepEqual(limits, [15, 19, 23, 28, 32, 36, 40]);
});

test("after a week the full limit applies and there is no day", () => {
  assert.deepEqual(warmupState(base, at(7, 1)), { effectiveLimit: 40, day: null });
});

test("disabled or never started means no warm-up", () => {
  assert.equal(warmupState({ ...base, warmupEnabled: false }, at(0, 1)).effectiveLimit, 40);
  assert.equal(warmupState({ ...base, warmupStartedAt: null }, at(0, 1)).effectiveLimit, 40);
});

test("a limit already at or below 15 is not raised", () => {
  assert.deepEqual(warmupState({ ...base, dailyLimit: 10 }, at(2)), { effectiveLimit: 10, day: 3 });
});

test("random gap stays inside the range, both ends included", () => {
  assert.equal(randomGapSeconds(20, 60, () => 0), 20);
  assert.equal(randomGapSeconds(20, 60, () => 0.9999), 60);
  assert.equal(randomGapSeconds(60, 20, () => 0), 20);
});
