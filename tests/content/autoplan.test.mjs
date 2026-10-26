import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../../src/lib/content/pure/autoplan.ts";

const NOW = { date: "2026-10-14", time: "09:00" };
const day = (n) => A.addDays(NOW.date, n);
const full = (from, to, time = "18:00", topic = null) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ id: `p${from + i}-${time}`, date: day(from + i), time, topic }));
// שיבוץ מהשורה בלבד, בלי פוסטים שזזים
const plan = (placed, pool, now, rules) => A.planLayout(placed, [], pool, now, rules).place;
const at = (n, time = "18:00") => ({ date: day(n), time });

test("fills the earliest empty evening first", () => {
  const placed = [{ id: "a", date: day(0), time: "18:00" }, { id: "b", date: day(1), time: "18:00" }];
  const out = plan(placed, [{ id: "x", createdAt: 1 }, { id: "y", createdAt: 2 }], NOW);
  assert.deepEqual(out, [{ id: "x", date: day(2), time: "18:00" }, { id: "y", date: day(3), time: "18:00" }]);
});

test("today's evening is skipped once it is too close", () => {
  const out = plan([], [{ id: "x" }], { date: NOW.date, time: "17:45" });
  assert.equal(out[0].date, day(1));
  assert.equal(plan([], [{ id: "x" }], { date: NOW.date, time: "17:20" })[0].date, day(0));
});

test("mornings only after all 30 evenings are full", () => {
  const almost = full(0, 28);
  assert.deepEqual(plan(almost, [{ id: "x" }, { id: "y" }], NOW), [
    { id: "x", date: day(29), time: "18:00" },
    // הערב האחרון התמלא הרגע, ולכן הבא כבר הולך לבוקר הפנוי הקרוב
    { id: "y", date: day(1), time: "08:00" },
  ]);
});

test("today's 08:00 is in the past at 09:00, so the first morning is tomorrow", () => {
  const out = plan(full(0, 29), [{ id: "x" }], NOW);
  assert.deepEqual(out, [{ id: "x", date: day(1), time: "08:00" }]);
});

test("a day with two posts has no free morning", () => {
  const placed = [...full(0, 29), { id: "z", date: day(1), time: "20:00" }];
  assert.equal(plan(placed, [{ id: "x" }], NOW)[0].date, day(2));
});

test("an untimed post counts as the evening", () => {
  const placed = full(0, 29).filter((p) => p.date !== day(5)).concat({ id: "n", date: day(5), time: null });
  assert.deepEqual(A.slotOrder(placed, NOW, A.DEFAULT_RULES, 1), [{ id: "", ...at(1, "08:00") }]);
});

test("same topic goes as far as possible from its twin", () => {
  // מחר יש פוסט על הילה; בשורה: הילה (ותיק) ושמש. הערב הקרוב מקבל את השמש
  const placed = [{ id: "a", date: day(0), time: "18:00", topic: "הילה" }];
  const out = plan(placed, [{ id: "aura", topic: "הילה", createdAt: 1 }, { id: "sun", topic: "שמש", createdAt: 2 }], NOW);
  assert.deepEqual(out.map((o) => o.id), ["sun", "aura"]);
});

test("ties keep the oldest video first", () => {
  const out = plan([], [{ id: "new", topic: "א", createdAt: 5 }, { id: "old", topic: "ב", createdAt: 1 }], NOW);
  assert.equal(out[0].id, "old");
});

test("topics compare loosely (geresh, spaces, case)", () => {
  assert.equal(A.topicKey(" צ׳אקרות "), A.topicKey("צ'אקרות"));
});

test("pool spreads two pairs of topics", () => {
  const pool = [
    { id: "c1", topic: "צ'אקרות", createdAt: 1 }, { id: "c2", topic: "צ'אקרות", createdAt: 2 },
    { id: "m1", topic: "מדיטציה", createdAt: 3 }, { id: "m2", topic: "מדיטציה", createdAt: 4 },
  ];
  assert.deepEqual(plan([], pool, NOW).map((o) => o.id), ["c1", "m1", "c2", "m2"]);
});

test("wantsAutomation: keyword or a comment call, only on Meta", () => {
  assert.equal(A.wantsAutomation({ intake: { keyword: "לב" }, platforms: ["instagram"] }), true);
  assert.equal(A.wantsAutomation({ intake: { keyword: "לב" }, platforms: ["tiktok"] }), false);
  assert.equal(A.wantsAutomation({ caption: 'תגיבו "שיר" ואשלח לכם', platforms: ["facebook"] }), true);
  assert.equal(A.wantsAutomation({ caption: "תכתבו לי את המילה \"מדריך\" ואשלח", platforms: ["instagram"] }), true);
  assert.equal(A.wantsAutomation({ caption: "תכתבו לי בתגובות מה הרגשתם", platforms: ["instagram"] }), false);
  assert.equal(A.wantsAutomation({ caption: "הלב שלכם הוא לא רק משאבה", platforms: ["instagram"] }), false);
});

test("the leftovers don't bunch up at the end", () => {
  // הילה עלתה אתמול; שתי הילות בשורה עם חמישה אחרים. בלי השלב השני הן נוחתות בשני הימים האחרונים
  const placed = [{ id: "old", date: day(-1), time: "18:00", topic: "הילה" }];
  const pool = ["א", "ב", "ג", "ד", "ה"].map((t, i) => ({ id: t, topic: t, createdAt: i }))
    .concat([{ id: "aura1", topic: "הילה", createdAt: 10 }, { id: "aura2", topic: "הילה", createdAt: 11 }]);
  const out = plan(placed, pool, NOW);
  const d = (id) => out.find((o) => o.id === id).date;
  const gap = Math.abs(A.dayDiff(d("aura1"), d("aura2")));
  assert.ok(gap >= 3, `aura posts ${gap} days apart`);
  assert.ok(A.dayDiff(d("aura1"), day(-1)) >= 3 && A.dayDiff(d("aura2"), day(-1)) >= 3);
});

test("a post still missing its automation only goes to a slot 48h+ away", () => {
  // עכשיו 09:00 ב-14; 18:00 ב-15 הוא 33 שעות, 18:00 ב-16 הוא 57 שעות
  const out = plan(full(0, 0), [{ id: "kw", needsAuto: true, auto: true, createdAt: 1 }, { id: "plain", createdAt: 2 }], NOW);
  assert.deepEqual(out, [{ id: "plain", date: day(1), time: "18:00" }, { id: "kw", date: day(2), time: "18:00" }]);
});

test("a too-close slot stays empty rather than take a post missing its automation", () => {
  const out = plan(full(0, 0), [{ id: "kw", needsAuto: true, auto: true }], NOW);
  assert.deepEqual(out, [{ id: "kw", date: day(2), time: "18:00" }]);
});

test("posts with automations spread apart", () => {
  const pool = [{ id: "a1", auto: true, createdAt: 1 }, { id: "a2", auto: true, createdAt: 2 },
    { id: "p1", createdAt: 3 }, { id: "p2", createdAt: 4 }];
  const out = plan([], pool, NOW);
  const d = (id) => out.find((o) => o.id === id).date;
  assert.ok(Math.abs(A.dayDiff(d("a1"), d("a2"))) >= 2, out.map((o) => o.id).join());
});

// ── שכבות, שעות והזזה (26.10.2026) ──

test("layers: one post a day for X days, then a second one from the nearest day", () => {
  const pool = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, createdAt: i }));
  // היום ב-08:00 כבר עבר, ולכן השני הראשון הוא מחר בבוקר
  assert.deepEqual(plan([], pool, NOW, { days: 3, times: ["18:00", "08:00"] }).map((o) => `${o.date} ${o.time}`),
    [at(0), at(1), at(2), at(1, "08:00"), at(2, "08:00")].map((s) => `${s.date} ${s.time}`));
});

test("Guy's hours: first, second, third — and past the list, the farthest hour", () => {
  const rules = { days: 1, times: ["12:00", "19:00", "09:00"] };
  // עכשיו 09:00: המשבצת של 09:00 עברה. הרביעי הולך לשעה הכי רחוקה מ-09, 12 ו-19
  assert.deepEqual(plan([], ["a", "b", "c"].map((id, i) => ({ id, createdAt: i })), NOW, rules).map((o) => o.time), ["12:00", "19:00", "15:30"]);
});

test("an hour already taken on that day is skipped", () => {
  const out = plan([{ id: "g", date: day(1), time: "17:30" }, ...full(0, 0), ...full(2, 29)], [{ id: "x" }], NOW);
  // ביום 1 יש פוסט ב-17:30, וזה כבר הראשון שלו. 18:00 צמוד אליו, ולכן השני הוא 08:00
  assert.deepEqual(out, [{ id: "x", ...at(1, "08:00") }]);
});

test("normalizeRules cleans what comes from the screen", () => {
  assert.deepEqual(A.normalizeRules({ days: "7", times: ["8:00", "18:00", "08:00", "25:00", "x"] }), { days: 7, times: ["08:00", "18:00"] });
  assert.deepEqual(A.normalizeRules({ days: 0, times: [] }), { days: 1, times: ["18:00", "08:00"] });
  assert.deepEqual(A.normalizeRules(null), A.DEFAULT_RULES);
  assert.equal(A.normalizeRules({ days: 500 }).days, A.MAX_DAYS);
});

test("a post the system placed moves up to fill an empty day", () => {
  const movable = [{ id: "m1", ...at(1), createdAt: 1 }, { id: "m2", ...at(2), createdAt: 2 }, { id: "m4", ...at(4), createdAt: 3 }];
  const { place, move } = A.planLayout([], movable, [], NOW);
  // יום 3 ריק: הרחוק ביותר עובר אליו, והשאר נשארים. היום (9 שעות) קרוב מדי להזזה
  assert.deepEqual(place, []);
  assert.deepEqual(move, [{ id: "m4", ...at(3), from: at(4) }]);
});

test("a full plan doesn't move anything (no churn every 5 minutes)", () => {
  const movable = [1, 2, 3].map((n) => ({ id: `m${n}`, ...at(n), createdAt: n }));
  const { place, move } = A.planLayout(full(0, 0), movable, [{ id: "new", createdAt: 9 }], NOW);
  assert.deepEqual(move, []);
  assert.deepEqual(place, [{ id: "new", ...at(4) }]);
});

test("fewer days pull posts into a second slot, never inside the next 24 hours", () => {
  const now = { date: NOW.date, time: "07:00" };
  const movable = [1, 2, 3, 4].map((n) => ({ id: `m${n}`, ...at(n), createdAt: n }));
  const { move } = A.planLayout([], movable, [], now, { days: 3, times: ["18:00", "08:00"] });
  // היום ב-08:00 וב-18:00 פחות מ-24 שעות — שם לא מזיזים. מחר ב-08:00 זה 25 שעות
  assert.deepEqual(move, [{ id: "m3", ...at(1, "08:00"), from: at(3) }, { id: "m4", ...at(2, "08:00"), from: at(4) }]);
});

test("a moved post with no room stays where it is", () => {
  // X = יום אחד, והיום קרוב מדי להזזה
  const { move } = A.planLayout([], [{ id: "m", ...at(5) }], [], NOW, { days: 1, times: ["18:00"] });
  assert.deepEqual(move, []);
});

test("hoursUntil", () => {
  assert.equal(A.hoursUntil(day(1), "18:00", NOW), 33);
  assert.equal(A.hoursUntil(day(0), "08:00", NOW), -1);
});

test("guard: never lets a post that wants an automation go up without one", () => {
  const T = Date.parse("2026-10-16T15:00:00Z");
  const g = (o) => A.guardVerdict({ wants: true, created: false, pending: false, sentAt: T - 3600e3, publishAt: T + 86400e3, now: T, ...o });
  assert.match(g({}), /אין לו אוטומציה/);                                       // no link at all
  assert.equal(g({ sentAt: T - 5 * 60e3 }), null);                              // just scheduled, the link screen is open
  assert.equal(g({ pending: true }), null);                                     // armed, the worker will create it
  assert.match(g({ pending: true, publishAt: T + 60e3 }), /לא נוצרה/);          // armed but not created 1 min before
  assert.equal(g({ created: true, publishAt: T + 60e3 }), null);                // created — fine
  assert.equal(g({ wants: false }), null);                                      // doesn't want one
  assert.equal(g({ publishAt: T - 1 }), null);                                  // already published
  assert.match(g({ sentAt: 0 }), /אין לו אוטומציה/);                            // scheduled before the guard existed
});
