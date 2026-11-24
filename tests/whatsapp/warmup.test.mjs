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

import { isQuietTime } from "../../src/lib/whatsapp-warmup.ts";

const quiet = { enabled: true, startHour: 21, endHour: 8, shabbat: true };
// Israel is UTC+2 in winter: 2026-11-24 is a Tuesday.
const il = (iso) => new Date(iso + "+02:00");

test("quiet hours wrap past midnight", () => {
  assert.equal(isQuietTime(quiet, il("2026-11-24T20:59:00")), false);
  assert.equal(isQuietTime(quiet, il("2026-11-24T21:00:00")), true);
  assert.equal(isQuietTime(quiet, il("2026-11-25T03:00:00")), true);
  assert.equal(isQuietTime(quiet, il("2026-11-25T08:00:00")), false);
});

test("shabbat: from Friday 14:00 to Saturday 20:00", () => {
  assert.equal(isQuietTime(quiet, il("2026-11-27T13:59:00")), false); // Friday
  assert.equal(isQuietTime(quiet, il("2026-11-27T14:00:00")), true);
  assert.equal(isQuietTime(quiet, il("2026-11-28T12:00:00")), true); // Saturday noon
  assert.equal(isQuietTime(quiet, il("2026-11-28T20:00:00")), false);
});

test("disabled means never quiet", () => {
  assert.equal(isQuietTime({ ...quiet, enabled: false }, il("2026-11-25T03:00:00")), false);
});
