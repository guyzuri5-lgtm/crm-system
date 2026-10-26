/**
 * שיבוץ אוטומטי — החלק הטהור (בלי מסד ובלי רשת), כדי שאפשר לבדוק אותו.
 *
 * הכללים של גיא (14.10.2026; שכבות, שעות והזזה מ-26.10.2026):
 *  1. שכבות: קודם פוסט אחד בכל אחד מ-X הימים הקרובים. רק כשכולם מלאים — פוסט
 *     שני בכל יום, מהיום הקרוב, ואז שלישי, וכן הלאה. בלי תקרה. את X גיא קובע בגאנט.
 *  2. הפוסט הראשון ביום עולה בשעה הראשונה ברשימה שגיא קבע בגאנט, השני בשנייה,
 *     וכן הלאה. מעבר לרשימה — השעה שהכי רחוקה מהפוסטים שכבר יש באותו יום.
 *  3. פוסט שהמערכת שיבצה זז כשהתוכנית משתנה (X השתנה, נכנס סרטון, השעות
 *     השתנו), חוץ מב-24 השעות שלפני הפרסום. פוסט שגיא גרר בעצמו לא זז לעולם.
 *  4. שני פוסטים על אותו נושא כללי — כמה שיותר רחוק זה מזה.
 *  5. פוסט שצריך אוטומציה משובץ, אבל לא נשלח ל-Zernio עד שגיא בוחר לו אוטומציה.
 *     48 שעות לפני — התראה. 24 שעות לפני ועדיין אין — הוא חוזר לשורה ומשתבץ
 *     מחדש ליום רחוק יותר, ופוסט מוכן בלי אוטומציה נכנס במקומו.
 *  6. פוסטים עם אוטומציה מתפזרים זה מזה, כמו נושאים זהים.
 *
 * המשבצות מתמלאות לפי הסדר, ולכל משבצת נבחר הסרטון שהנושא שלו הכי רחוק מפוסט
 * באותו נושא. תיקו → הסרטון שמחכה הכי הרבה זמן. פוסט שכבר יושב במשבצת שנשארת
 * בתוכנית לא זז, כדי שריצה כל 5 דקות לא תערבב את הלוח מחדש.
 */

/** ברירת המחדל ל-X, ולמרחק בין נושאים לאחור */
export const HORIZON_DAYS = 30;
export const MAX_DAYS = 90;
/** השעות של הפוסט הראשון, השני... ביום, עד שגיא קובע אחרות */
export const DEFAULT_TIMES = ["18:00", "08:00"];
/** פוסט בלי שעה עולה בשעה הזו (ברירת המחדל של הלוח) */
export const DEFAULT_TIME = "18:00";
/** כמה דקות לפני המשבצת עוד מותר לשבץ בה (Zernio דורש 5 דקות קדימה, ועוד מרווח לעובד) */
export const MIN_LEAD_MINUTES = 30;
/** פוסט שהמערכת שיבצה לא זז ב-24 השעות שלפני הפרסום, ולא נכנס למשבצת כזו */
export const LOCK_HOURS = 24;
/** פוסט שחסרה לו אוטומציה: התראה מכאן, ומשבצת חדשה רק כזו שרחוקה לפחות כך */
export const AUTO_ALERT_HOURS = 48;
/** פוסט שחסרה לו אוטומציה ונשאר לו פחות מזה — חוזר לשורה ומשתבץ מחדש */
export const AUTO_SWAP_HOURS = 24;
/** שעה מהרשימה שקרובה פחות מזה לפוסט שכבר באותו יום — מדלגים עליה */
const MIN_GAP_MINUTES = 60;
/** שעות שהמערכת בוחרת לבד (מעבר לרשימה) — בטווח הזה, בקפיצות של חצי שעה */
const PICK_FROM = 8 * 60;
const PICK_TO = 22 * 60;

export interface Placed {
  id: string;
  date: string;
  time?: string | null;
  topic?: string | null;
  /** פוסט עם אוטומציה (או שמבקש אחת) — אלה מתפזרים זה מזה */
  auto?: boolean;
}
export interface PoolItem {
  id: string;
  topic?: string | null;
  createdAt?: number | null;
  auto?: boolean;
  /** מבקש אוטומציה ועוד לא נבחרה: נכנס רק למשבצת שרחוקה AUTO_ALERT_HOURS לפחות */
  needsAuto?: boolean;
}
/** פוסט שהמערכת שיבצה ומותר לה להזיז */
export interface Movable extends PoolItem {
  date: string;
  time?: string | null;
}
export interface Assignment {
  id: string;
  date: string;
  time: string;
}
export interface Move extends Assignment {
  from: { date: string; time: string };
}
export interface Rules {
  /** X: כמה ימים קדימה השכבות מתמלאות */
  days: number;
  /** השעה של הפוסט הראשון ביום, השני, ... */
  times: string[];
}
export const DEFAULT_RULES: Rules = { days: HORIZON_DAYS, times: DEFAULT_TIMES };

const DAY = 864e5;
const keyMs = (key: string) => Date.parse(`${key}T00:00:00Z`);
export const addDays = (key: string, n: number) => new Date(keyMs(key) + n * DAY).toISOString().slice(0, 10);
export const dayDiff = (a: string, b: string) => Math.round((keyMs(a) - keyMs(b)) / DAY);

/** התאריך והשעה עכשיו באזור הזמן של הלוח: {date: "2026-10-14", time: "17:05"} */
export function localNow(timeZone: string, at = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** ההגדרות מהגאנט, מנוקות: X בין 1 ל-90, שעות תקינות בלי כפילויות. רשימה ריקה → ברירת המחדל. */
export function normalizeRules(r: { days?: unknown; times?: unknown } | null | undefined): Rules {
  const n = Math.round(Number(r?.days));
  const days = Number.isFinite(n) ? Math.min(MAX_DAYS, Math.max(1, n)) : HORIZON_DAYS;
  const times: string[] = [];
  for (const t of Array.isArray(r?.times) ? r.times : []) {
    const m = minutes(String(t));
    if (Number.isNaN(m) || m >= 24 * 60 || !/^\d{1,2}:\d{2}$/.test(String(t).trim())) continue;
    const v = hhmm(m);
    if (!times.includes(v)) times.push(v);
  }
  return { days, times: times.length ? times.slice(0, 12) : DEFAULT_TIMES.slice() };
}

/** נושא מנורמל להשוואה: "צ'אקרות" ו"צ׳אקרות " הם אותו נושא */
export function topicKey(t: unknown): string {
  return typeof t === "string" ? t.trim().replace(/[׳’`]/g, "'").replace(/\s+/g, " ").toLowerCase() : "";
}

/** כמה שעות מעכשיו עד יום ושעה מקומיים (שלילי = עבר) */
export function hoursUntil(date: string, time: string | null | undefined, now: { date: string; time: string }) {
  return dayDiff(date, now.date) * 24 + (minutes(time || DEFAULT_TIME) - minutes(now.time)) / 60;
}

/**
 * השעה לפוסט הבא ביום שכבר יש בו פוסטים בשעות used (בדקות): השעה הראשונה ברשימה
 * שלא צמודה לאחד מהם. נגמרה הרשימה — השעה בין 08:00 ל-22:00 שהכי רחוקה מכולם.
 */
export function pickTime(used: number[], times: string[]): string {
  const far = (m: number) => used.reduce((d, u) => Math.min(d, Math.abs(m - u)), Infinity);
  for (const t of times) if (far(minutes(t)) >= MIN_GAP_MINUTES) return t;
  let best = PICK_FROM, bestD = -1;
  for (let m = PICK_FROM; m <= PICK_TO; m += 30) {
    const d = far(m);
    if (d > bestD) { bestD = d; best = m; }
  }
  return hhmm(best);
}

/**
 * המשבצות לפי סדר המילוי: שכבה 1 (פוסט ראשון בכל יום מהקרוב), שכבה 2, וכן הלאה.
 * יום שכבר יש בו k פוסטים קבועים מדלג על k השכבות הראשונות. משבצת שעברה (או
 * קרובה מ-30 דקות) לא נכנסת, אבל תופסת את מקומה ביום — השעה הבאה ברשימה היא
 * של הפוסט הבא.
 */
export function slotOrder(fixed: Placed[], now: { date: string; time: string }, rules: Rules, limit: number): Assignment[] {
  const used = new Map<string, number[]>();
  const last = addDays(now.date, rules.days - 1);
  for (const p of fixed) {
    if (p.date < now.date || p.date > last) continue;
    (used.get(p.date) || used.set(p.date, []).get(p.date)!).push(minutes(p.time || DEFAULT_TIME));
  }
  const out: Assignment[] = [];
  // תקרה רק כדי שלולאה לא תרוץ לנצח; 48 פוסטים ביום זה כבר יותר מכל לוח
  for (let level = 1; level <= 48 && out.length < limit; level++) {
    for (let i = 0; i < rules.days && out.length < limit; i++) {
      const day = addDays(now.date, i);
      const list = used.get(day) || used.set(day, []).get(day)!;
      if (list.length >= level) continue;
      const time = pickTime(list, rules.times);
      list.push(minutes(time));
      if (hoursUntil(day, time, now) * 60 >= MIN_LEAD_MINUTES) out.push({ id: "", date: day, time });
    }
  }
  return out;
}

/**
 * המרחק בימים מהפוסט הקרוב ביותר שדומה לו: אותו נושא, או — אם שניהם עם
 * אוטומציה — כל פוסט עם אוטומציה. אין כזה → אינסוף.
 */
function distance(it: { topic?: string | null; auto?: boolean }, day: string, placed: Placed[]) {
  const topic = topicKey(it.topic);
  let best = Infinity;
  for (const p of placed) {
    if ((topic && topicKey(p.topic) === topic) || (it.auto && p.auto)) best = Math.min(best, Math.abs(dayDiff(day, p.date)));
  }
  return best;
}

type Cand = PoolItem & { from?: { date: string; time: string } };

/** הכי קרוב שמותר לשים את הסרטון: מחכה לאוטומציה 48 שעות, מוזז 24, חדש חצי שעה */
const fits = (it: Cand, s: { date: string; time: string }, now: { date: string; time: string }) =>
  hoursUntil(s.date, s.time, now) >= (it.needsAuto ? AUTO_ALERT_HOURS : it.from ? LOCK_HOURS : MIN_LEAD_MINUTES / 60);

/**
 * התוכנית לריצה הזו.
 *  fixed   — כל מה שתופס יום ולא זז: מה שגיא גרר, מה שעולה ב-24 השעות הקרובות,
 *            ופוסטים מ-30 הימים האחרונים (בשביל המרחק בין נושאים);
 *  movable — מה שהמערכת שיבצה ומותר לה להזיז;
 *  pool    — הסרטונים שמחכים בלי תאריך.
 * place = שיבוצים חדשים מהשורה; move = פוסטים שעוברים משבצת.
 */
export function planLayout(fixed: Placed[], movable: Movable[], pool: PoolItem[], now: { date: string; time: string }, rules: Rules = DEFAULT_RULES): { place: Assignment[]; move: Move[] } {
  const n = movable.length + pool.length;
  if (!n) return { place: [], move: [] };
  const seq = slotOrder(fixed, now, rules, n * 3 + rules.days);
  const key = (date: string, time?: string | null) => `${date} ${time || DEFAULT_TIME}`;
  // המשבצות שהתוכנית צריכה: n הראשונות. פוסט שכבר יושב באחת מהן — נשאר
  const target = new Set(seq.slice(0, n).map((s) => key(s.date, s.time)));
  const taken = new Set<string>();
  const context = fixed.slice();
  const left: Cand[] = [];
  for (const m of movable.slice().sort((a, b) => key(a.date, a.time).localeCompare(key(b.date, b.time)))) {
    const k = key(m.date, m.time);
    if (target.has(k) && !taken.has(k)) {
      taken.add(k);
      context.push({ id: m.id, date: m.date, time: m.time, topic: m.topic, auto: m.auto });
    } else left.push({ ...m, from: { date: m.date, time: m.time || DEFAULT_TIME } });
  }
  for (const p of pool) left.push(p);
  left.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const cands = left.slice();

  const all = context.slice();
  const out: Assignment[] = [];
  for (const s of seq) {
    if (!left.length) break;
    if (taken.has(key(s.date, s.time))) continue;
    let pick = -1;
    let best = -1;
    left.forEach((it, i) => {
      if (!fits(it, s, now)) return;
      const d = distance(it, s.date, all);
      if (d > best) { best = d; pick = i; }   // > ולא >=: בתיקו נשאר הוותיק
    });
    // אף סרטון לא יכול להיכנס למשבצת הקרובה הזו — נשארת ריקה
    if (pick < 0) continue;
    const [it] = left.splice(pick, 1);
    out.push({ id: it.id, date: s.date, time: s.time });
    all.push({ id: it.id, date: s.date, time: s.time, topic: it.topic, auto: it.auto });
  }
  // פוסט מוזז שלא נמצאה לו משבצת (למשל X קטן מדי) נשאר איפה שהוא
  const byId = new Map(cands.map((c) => [c.id, c]));
  const place: Assignment[] = [];
  const move: Move[] = [];
  for (const a of spread(out, context, cands, now)) {
    const from = byId.get(a.id)?.from;
    if (!from) place.push(a);
    else if (from.date !== a.date || from.time !== a.time) move.push({ ...a, from });
  }
  return { place, move };
}

/**
 * הבחירה לפי הסדר דוחה את הסרטונים ה"בעייתיים" לסוף, ושם הם נדחסים יחד (שתי
 * הילות ביומיים האחרונים). לכן אחריה מחליפים משבצות בין השיבוצים החדשים, כל
 * עוד ההחלפה מרחיקה נושאים זהים. הקנס לכל סרטון: 1/(מרחק)² מהפוסט הקרוב באותו
 * נושא — שני ימים צמודים יקרים בהרבה משבוע. בלי שיפור — הסדר (הוותיק קודם) נשאר.
 */
function spread(out: Assignment[], placed: Placed[], pool: Cand[], now: { date: string; time: string }): Assignment[] {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const topic = (id: string) => topicKey(byId.get(id)?.topic);
  const auto = (id: string) => Boolean(byId.get(id)?.auto);
  if (out.length < 2 || !out.some((a) => topic(a.id) || auto(a.id))) return out;
  const fixed = placed.map((p) => ({ date: p.date, topic: topicKey(p.topic), auto: Boolean(p.auto) })).filter((p) => p.topic || p.auto);
  // קנס על קרבה: לנושא זהה, ובנפרד לשני פוסטים עם אוטומציה
  const near = (d: number) => (d === Infinity ? 0 : 1 / (d + 0.5) ** 2);   // אותו יום = 0 ימים
  const cost = (list: Assignment[]) => {
    let sum = 0;
    list.forEach((a, i) => {
      const t = topic(a.id), au = auto(a.id);
      if (!t && !au) return;
      let dt = Infinity, da = Infinity;
      const see = (date: string, t2: string, au2: boolean) => {
        const d = Math.abs(dayDiff(a.date, date));
        if (t && t2 === t) dt = Math.min(dt, d);
        if (au && au2) da = Math.min(da, d);
      };
      for (const p of fixed) see(p.date, p.topic, p.auto);
      list.forEach((b, j) => { if (j !== i) see(b.date, topic(b.id), auto(b.id)); });
      sum += near(dt) + near(da);
    });
    return sum;
  };
  const cur = out.map((a) => ({ ...a }));
  let best = cost(cur);
  for (let pass = 0, improved = true; improved && pass < 20; pass++) {
    improved = false;
    for (let i = 0; i < cur.length; i++) {
      for (let j = i + 1; j < cur.length; j++) {
        if (topic(cur[i].id) === topic(cur[j].id) && auto(cur[i].id) === auto(cur[j].id)) continue;
        // פוסט שמחכה לאוטומציה, או פוסט מוזז, לא עובר למשבצת קרובה מדי
        if (!fits(byId.get(cur[i].id)!, cur[j], now) || !fits(byId.get(cur[j].id)!, cur[i], now)) continue;
        [cur[i].id, cur[j].id] = [cur[j].id, cur[i].id];
        const c = cost(cur);
        if (c < best - 1e-9) { best = c; improved = true; }
        else [cur[i].id, cur[j].id] = [cur[j].id, cur[i].id];
      }
    }
  }
  return cur;
}

// ── אוטומציה ──

/** 'תגיבו "שיר"' — להגיב במילה מסוימת. "כתבו בתגובות מה הרגשתם" הוא שיח, לא אוטומציה. */
const CTA = /(תגיבו|הגיבו|תכתבו|כתבו)\s+(לי\s+)?(את\s+המילה\s+)?["“”״]/;

/**
 * הפוסט מבקש מהצופים להגיב במילה כדי לקבל משהו (המילה שהסקיל זיהה מהסרטון,
 * או 'תגיבו "X"' בתיאור), והוא עולה לאינסטגרם או לפייסבוק — שם האוטומציה עובדת.
 */
export function wantsAutomation(item: { intake?: { keyword?: string } | null; caption?: string | null; platforms?: string[] | null }) {
  const meta = (item.platforms || []).some((p) => p === "instagram" || p === "facebook");
  if (!meta) return false;
  if (item.intake?.keyword && String(item.intake.keyword).trim()) return true;
  return CTA.test(String(item.caption || ""));
}

// ── השומר ──

/** כמה זמן פוסט מתוזמן יכול להיות בלי קישור — מסך הקישור הידני נפתח מיד אחרי "אשר ותזמן" */
export const LINK_GRACE_MS = 15 * 60_000;
/** האוטומציה נוצרת כמה דקות לפני הפרסום. אם עד כאן היא לא קיימת — מבטלים את הפוסט */
export const CREATE_DEADLINE_MS = 90_000;

/**
 * האם לבטל פוסט מתוזמן כדי שלא יעלה בלי אוטומציה. null = להשאיר.
 * created: האוטומציה קיימת ב-Zernio. pending: קישור שממתין שהעובד ייצור אותה.
 */
export function guardVerdict(p: { wants: boolean; created: boolean; pending: boolean; sentAt: number; publishAt: number; now: number }) {
  if (!p.wants || p.created) return null;
  if (p.publishAt <= p.now) return null;   // כבר עלה או עולה עכשיו — אין מה לבטל
  if (!p.pending && p.now - p.sentAt > LINK_GRACE_MS) return "אין לו אוטומציה מחוברת";
  if (p.publishAt - p.now < CREATE_DEADLINE_MS) return "האוטומציה לא נוצרה ב-Zernio עד דקה וחצי לפני הפרסום";
  return null;
}
