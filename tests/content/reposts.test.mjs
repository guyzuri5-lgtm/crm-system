import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../src/lib/content/pure/reposts.ts";

const NOW = { date: "2026-11-14", time: "10:00" };

test("two months after the original, same day and hour", () => {
  assert.deepEqual(R.repostSlot("2026-10-22T18:00", NOW), { date: "2026-12-22", time: "18:00" });
  assert.deepEqual(R.repostSlot("2026-11-30T08:00", NOW), { date: "2027-01-30", time: "08:00" });
});

test("a day the target month doesn't have sticks to its last day", () => {
  assert.equal(R.addMonths("2026-12-31", 2), "2027-02-28");
  assert.equal(R.addMonths("2027-12-31", 2), "2028-02-29");
  assert.equal(R.addMonths("2026-08-31", 2), "2026-10-31");
});

test("a date that already came goes to tomorrow, never the past or today", () => {
  assert.deepEqual(R.repostSlot("2026-09-01T18:00", NOW), { date: "2026-11-15", time: "18:00" });
  assert.deepEqual(R.repostSlot("2026-09-14T18:00", NOW), { date: "2026-11-15", time: "18:00" });
  assert.equal(R.repostSlot("", NOW), null);
});

test("over 1000 for an original, over 2000 for a repost; exactly the threshold is not over", () => {
  assert.equal(R.qualifies(1001, 0), true);
  assert.equal(R.qualifies(1000, 0), false);
  assert.equal(R.qualifies(1500, 1), false);
  assert.equal(R.qualifies(2000, 1), false);
  assert.equal(R.qualifies(2001, 2), true);
  assert.equal(R.qualifies(null, 0), false);
});

test("the copy keeps the content and drops the old post's state", () => {
  const src = {
    id: "old", date: "2026-10-22", time: "18:00", title: "כובע", caption: "כיתוב", format: "reel", topic: "צ'אקרות",
    platforms: ["instagram", "youtube"], platformOptions: { youtube: { title: "יוטיוב" } }, note: "",
    autoplan: { at: "x" }, scheduled: true, ig: { id: 1 }, source: "ig", pieceNo: 26,
    intake: { source: "folder", sourceKey: "dir:26- כובע", file: "26.mp4", keyword: "כובע" }, createdAt: 1,
  };
  const d = R.repostData(src, {
    id: "new", date: "2026-12-22", time: "18:00", at: "2026-11-14T08:00:00.000Z", file: "26.mp4", views: 10231,
    generation: 1, rootId: "old", fromId: "old", publishedAt: "2026-10-22T18:00", cover: "https://media.zernio.com/media/c.jpg", automationChoice: "auto1",
  });
  assert.equal(d.id, "new");
  assert.equal(d.date, "2026-12-22");
  assert.equal(d.title, "כובע");
  assert.equal(d.caption, "כיתוב");
  assert.deepEqual(d.platforms, ["instagram", "youtube"]);
  assert.equal(d.platformOptions.youtube.title, "יוטיוב");
  assert.equal(d.automationChoice, "auto1");
  for (const k of ["autoplan", "ig", "source", "pieceNo", "scheduled"]) assert.equal(k in d, false, k);
  assert.deepEqual(d.intake, { source: "repost", sourceKey: "repost:old", file: "26.mp4", at: "2026-11-14T08:00:00.000Z", keyword: "כובע" });
  assert.equal(d.repost.generation, 1);
  assert.equal(d.repost.views, 10231);
});

test("the rules Guy sets: weeks, days, other thresholds", () => {
  const weeks = R.normalizeRepostRules({ threshold: 2500, after: 3, unit: "weeks", repeatThreshold: 5000 });
  assert.deepEqual(R.repostSlot("2026-11-10T17:00", NOW, weeks), { date: "2026-12-01", time: "17:00" });
  assert.equal(R.qualifies(2400, 0, weeks), false);
  assert.equal(R.qualifies(2600, 0, weeks), true);
  assert.equal(R.qualifies(4000, 1, weeks), false);
  const days = R.normalizeRepostRules({ threshold: 1000, after: 10, unit: "days", repeatThreshold: 1000 });
  assert.deepEqual(R.repostSlot("2026-11-10T17:00", NOW, days), { date: "2026-11-20", time: "17:00" });
});

test("saved rules are always sane", () => {
  assert.deepEqual(R.normalizeRepostRules(null), R.DEFAULT_REPOST_RULES);
  assert.deepEqual(R.normalizeRepostRules({ threshold: "abc", after: 0, unit: "years", repeatThreshold: 50 }),
    { threshold: 1000, after: 1, unit: "months", repeatThreshold: 1000 });
  assert.equal(R.normalizeRepostRules({ after: 40, unit: "months" }).after, 12);
  assert.equal(R.normalizeRepostRules({ threshold: 3000, repeatThreshold: 2000 }).repeatThreshold, 3000);
});

test("reposts keep two empty days between them: after the 10th, the next is the 13th at the earliest", () => {
  assert.equal(R.freeRepostDay("2026-12-11", ["2026-12-10"]), "2026-12-13");
  assert.equal(R.freeRepostDay("2026-12-13", ["2026-12-10"]), "2026-12-13");
  // never backwards, also when the close one is after it
  assert.equal(R.freeRepostDay("2026-12-09", ["2026-12-10"]), "2026-12-13");
  assert.equal(R.freeRepostDay("2026-12-31", ["2027-01-01"]), "2027-01-04");
});

test("a cluster of reposts spreads forward, in date order, around ones that can't move", () => {
  const moves = R.spaceReposts([{ date: "2026-12-16" }], [
    { id: "b", date: "2026-12-11", time: "18:00" },
    { id: "a", date: "2026-12-10", time: "18:00" },
    { id: "c", date: "2026-12-12", time: "18:00" },
    { id: "d", date: "2026-12-30", time: "18:00" },
  ]);
  // a stays on the 10th; b → 13th; the 16th is fixed, so c → 19th; d is far enough
  assert.deepEqual(moves, [
    { id: "b", from: "2026-12-11", to: "2026-12-13" },
    { id: "c", from: "2026-12-12", to: "2026-12-19" },
  ]);
  assert.deepEqual(R.spaceReposts([], [{ id: "x", date: "2026-12-10" }, { id: "y", date: "2026-12-14" }]), []);
});

test("a repost remembers the slot the system gave it", () => {
  const d = R.repostData({ title: "t" }, { id: "n", date: "2026-12-13", time: "18:00", at: "2026-11-22T10:00:00Z", file: "f.mp4", views: 1300,
    generation: 1, rootId: "o", fromId: "o", publishedAt: "2026-10-13T18:00", cover: null, automationChoice: null });
  assert.equal(d.repost.slot, "2026-12-13 18:00");
});
