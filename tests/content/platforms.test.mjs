// node --test tests/content   (Node 22.18+/24 runs the .ts imports directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../../src/lib/content/pure/platforms.ts";

const TZ = "Asia/Jerusalem";
const accts = (...on) => ({ platforms: Object.fromEntries(P.PLATFORMS.map((p) => [p, {
  connected: on.includes(p), healthy: on.includes(p), account: on.includes(p) ? { id: `acc-${p}`, username: p } : null }])) });
const media = (kind = "video", size = 5e6, duration = 20, n = 1) => Array.from({ length: n }, (_, i) => ({
  id: `m${i}`, filename: `f${i}`, content_type: kind === "video" ? "video/mp4" : "image/jpeg", size,
  public_url: `https://x/m${i}`, meta: kind === "video" ? { duration } : {} }));
const future = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
const item = (kw = {}) => ({ id: "it1", date: future, time: "18:00", title: "כותרת", caption: "כיתוב", format: "reel", platforms: ["instagram"], platformOptions: {}, ...kw });

test("clean reel passes", () => {
  const v = P.validateLocal(item(), media(), accts("instagram"), TZ);
  assert.deepEqual(v._item.errors, []);
  assert.deepEqual(v.instagram.errors, []);
});
test("disconnected network blocked, others fine", () => {
  const v = P.validateLocal(item({ platforms: ["instagram", "tiktok"] }), media(), accts("instagram"), TZ);
  assert.ok(v.tiktok.errors.includes("לא מחובר ב-Zernio."));
  assert.deepEqual(v.instagram.errors, []);
});
test("past time blocked", () => {
  assert.ok(P.validateLocal(item({ date: "2020-01-01" }), media(), accts("instagram"), TZ)._item.errors.length);
});
test("story only on IG/FB", () => {
  const it = item({ format: "story", platforms: [...P.PLATFORMS], platformOptions: { tiktok: { privacyLevel: "SELF_ONLY" }, youtube: { title: "t", visibility: "private" } } });
  const v = P.validateLocal(it, media("video", 5e6, 10), accts(...P.PLATFORMS), TZ);
  assert.deepEqual(v.instagram.errors, []);
  assert.deepEqual(v.facebook.errors, []);
  assert.ok(v.tiktok.errors.includes("בטיקטוק אין סטורי."));
  assert.ok(v.youtube.errors.includes("ביוטיוב אין סטורי."));
});
test("youtube needs title and one video", () => {
  const v = P.validateLocal(item({ platforms: ["youtube"], platformOptions: { youtube: { visibility: "private" } } }), media("image"), accts("youtube"), TZ);
  assert.ok(v.youtube.errors.includes("ביוטיוב חובה כותרת."));
  assert.ok(v.youtube.errors.includes("ביוטיוב צריך וידאו אחד בדיוק."));
});
test("youtube is shorts only: vertical and up to 3 minutes", () => {
  const yt = (duration, width, height) => {
    const m = media("video", 5e6, duration); m[0].meta = { duration, width, height };
    return P.validateLocal(item({ platforms: ["youtube"], platformOptions: { youtube: { title: "t", visibility: "private" } } }), m, accts("youtube"), TZ).youtube;
  };
  assert.deepEqual(yt(60, 1080, 1920).errors, []);
  assert.ok(yt(200, 1080, 1920).errors.some((e) => e.includes("3 דקות")));
  assert.ok(yt(60, 1920, 1080).errors.some((e) => e.includes("אנכי")));
});
test("tiktok privacy required", () => {
  assert.ok(P.validateLocal(item({ platforms: ["tiktok"] }), media(), accts("tiktok"), TZ).tiktok.errors.includes("צריך לבחור פרטיות לטיקטוק."));
});
test("reel duration and caption limits per network", () => {
  assert.ok(P.validateLocal(item(), media("video", 5e6, 120), accts("instagram"), TZ).instagram.errors.some((e) => e.includes("3–90")));
  const v = P.validateLocal(item({ caption: "א".repeat(2500), platforms: ["instagram", "facebook"] }), media(), accts("instagram", "facebook"), TZ);
  assert.ok(v.instagram.errors.length);
  assert.ok(!v.facebook.errors.some((e) => e.includes("ארוך")));
});
test("media still uploading or about to expire blocks", () => {
  const m = media();
  m[0].status = "uploading";
  assert.ok(P.validateLocal(item(), m, accts("instagram"), TZ)._item.errors.some((e) => e.includes("לעלות")));
  m[0].status = "ready";
  m[0].uploaded_at = new Date(Date.now() - 7 * 864e5).toISOString();
  assert.ok(P.validateLocal(item(), m, accts("instagram"), TZ)._item.errors.some((e) => e.includes("6 ימים")));
  m[0].used_in_post_at = new Date().toISOString();
  assert.deepEqual(P.validateLocal(item(), m, accts("instagram"), TZ)._item.errors, []);
});
test("zonedToUtc handles Israel DST", () => {
  assert.equal(P.zonedToUtc("2026-07-01T12:00", TZ).toISOString(), "2026-07-01T09:00:00.000Z");
  assert.equal(P.zonedToUtc("2026-12-01T12:00", TZ).toISOString(), "2026-12-01T10:00:00.000Z");
});
test("body for all four networks", () => {
  const it = item({ platforms: [...P.PLATFORMS], platformOptions: {
    tiktok: { privacyLevel: "SELF_ONLY" }, youtube: { title: "יוטיוב", visibility: "unlisted", tags: "#a, b", categoryId: "27" },
    facebook: { useCustomCaption: true, caption: "אחר" } } });
  const b = P.buildBody(it, media(), accts(...P.PLATFORMS), TZ);
  assert.equal(b.scheduledFor, `${future}T18:00:00`);
  assert.deepEqual(b.mediaItems, [{ type: "video", url: "https://x/m0" }]);
  const by = Object.fromEntries(b.platforms.map((e) => [e.platform, e]));
  assert.equal(by.instagram.platformSpecificData, undefined);
  assert.equal(by.facebook.platformSpecificData.contentType, "reel");
  assert.equal(by.facebook.customContent, "אחר");
  const ts = by.tiktok.platformSpecificData.tiktokSettings;
  assert.equal(ts.privacyLevel, "SELF_ONLY");
  assert.ok(ts.contentPreviewConfirmed && ts.expressConsentGiven && "allowDuet" in ts);
  assert.deepEqual(by.youtube.platformSpecificData, { title: "יוטיוב", visibility: "unlisted", madeForKids: false, categoryId: "27" });
  assert.deepEqual(b.tags, ["a", "b"]);
});
test("readPost maps per-network results", () => {
  const r = P.readPost({ status: "partial", platforms: [
    { platform: "instagram", accountId: { _id: "a1" }, status: "published", platformPostId: "1789", platformPostUrl: "https://ig/x" },
    { platform: "tiktok", accountId: "a2", status: "failed", errorMessage: "Video too short", errorCategory: "user_content" },
    { platform: "youtube", accountId: "a3", status: "processing" }] });
  assert.equal(r.status, "partial");
  const t = Object.fromEntries(r.targets.map((x) => [x.platform, x]));
  assert.equal(t.instagram.accountId, "a1");
  assert.equal(t.instagram.permalink, "https://ig/x");
  assert.ok(t.tiktok.error.startsWith("בעיה בתוכן"));
  assert.equal(t.youtube.status, "publishing");
});
