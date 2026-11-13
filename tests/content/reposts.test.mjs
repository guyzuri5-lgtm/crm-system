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
    platforms: ["instagram", "youtube"], platformOptions: { youtube: { title: "יוטיוב" } }, typeId: "edu", note: "",
    autoplan: { at: "x" }, statusFlags: { scheduled: true }, scheduled: true, ig: { id: 1 }, source: "ig", pieceNo: 26,
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
  assert.equal(d.scheduled, false);
  assert.equal(d.statusFlags.scheduled, false);
  for (const k of ["autoplan", "ig", "source", "pieceNo"]) assert.equal(k in d, false, k);
  assert.deepEqual(d.intake, { source: "repost", sourceKey: "repost:old", file: "26.mp4", at: "2026-11-14T08:00:00.000Z", keyword: "כובע" });
  assert.equal(d.repost.generation, 1);
  assert.equal(d.repost.views, 10231);
});
