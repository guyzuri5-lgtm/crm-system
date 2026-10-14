/**
 * שיבוץ אוטומטי — החלק הטהור (בלי מסד ובלי רשת), כדי שאפשר לבדוק אותו.
 *
 * הכללים של גיא (14.10.2026):
 *  1. בכל אחד מ-30 הימים הקרובים יש פוסט ב-18:00.
 *  2. רק כשכל 30 הערבים מלאים — פוסט שני ב-08:00, מהיום הקרוב ביותר.
 *  3. שני פוסטים על אותו נושא כללי — כמה שיותר רחוק זה מזה.
 *  4. פוסט שצריך אוטומציה משובץ, אבל לא נשלח ל-Zernio עד שגיא בוחר לו אוטומציה.
 *     48 שעות לפני — התראה. 24 שעות לפני ועדיין אין — הוא חוזר לשורה ומשתבץ
 *     מחדש ליום רחוק יותר, ופוסט מוכן בלי אוטומציה נכנס במקומו.
 *  5. פוסטים עם אוטומציה מתפזרים זה מזה, כמו נושאים זהים.
 *
 * המשבצות מתמלאות לפי הסדר (ערבים ואז בקרים, כל אחד מהיום הקרוב), ולכל משבצת
 * נבחר מהשורה "מוכנים לתזמון" הסרטון שהנושא שלו הכי רחוק מפוסט באותו נושא.
 * תיקו → הסרטון שמחכה הכי הרבה זמן.
 */

export const HORIZON_DAYS = 30;
export const EVENING = "18:00";
export const MORNING = "08:00";
/** כמה דקות לפני המשבצת עוד מותר לשבץ בה (Zernio דורש 5 דקות קדימה, ועוד מרווח לעובד) */
export const MIN_LEAD_MINUTES = 30;
/** פוסט שחסרה לו אוטומציה: התראה מכאן, ומשבצת חדשה רק כזו שרחוקה לפחות כך */
export const AUTO_ALERT_HOURS = 48;
/** פוסט שחסרה לו אוטומציה ונשאר לו פחות מזה — חוזר לשורה ומשתבץ מחדש */
export const AUTO_SWAP_HOURS = 24;

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
export interface Assignment {
  id: string;
  date: string;
  time: string;
}

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

/** נושא מנורמל להשוואה: "צ'אקרות" ו"צ׳אקרות " הם אותו נושא */
export function topicKey(t: unknown): string {
  return typeof t === "string" ? t.trim().replace(/[׳’`]/g, "'").replace(/\s+/g, " ").toLowerCase() : "";
}

/** כמה שעות מעכשיו עד יום ושעה מקומיים (שלילי = עבר) */
export function hoursUntil(date: string, time: string | null | undefined, now: { date: string; time: string }) {
  return dayDiff(date, now.date) * 24 + (minutes(time || EVENING) - minutes(now.time)) / 60;
}

/** פוסט בבוקר = לפני 12:00. פוסט בלי שעה נחשב ערב (ברירת המחדל של הלוח). */
const isMorning = (time?: string | null) => Boolean(time) && minutes(String(time)) < 12 * 60;

/**
 * המשבצות הפנויות ב-30 הימים הקרובים.
 * ערב פנוי = אין באותו יום פוסט אחרי הצהריים. בוקר פנוי = יש ביום פחות משני
 * פוסטים ואין בו פוסט בבוקר. בקרים נפתחים רק כשאין אף ערב פנוי.
 */
export function freeSlots(placed: Placed[], now: { date: string; time: string }, horizon = HORIZON_DAYS) {
  const byDay = new Map<string, Placed[]>();
  for (const p of placed) (byDay.get(p.date) || byDay.set(p.date, []).get(p.date)!).push(p);
  const open = (time: string, day: string) => day !== now.date || minutes(time) - minutes(now.time) >= MIN_LEAD_MINUTES;

  const evenings: Assignment[] = [];
  const mornings: Assignment[] = [];
  for (let i = 0; i < horizon; i++) {
    const day = addDays(now.date, i);
    const list = byDay.get(day) || [];
    const hasEvening = list.some((p) => !isMorning(p.time));
    const hasMorning = list.some((p) => isMorning(p.time));
    if (!hasEvening && open(EVENING, day)) evenings.push({ id: "", date: day, time: EVENING });
    if (list.length < 2 && !hasMorning && open(MORNING, day)) mornings.push({ id: "", date: day, time: MORNING });
  }
  return { evenings, mornings };
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

const fits = (it: PoolItem, s: { date: string; time: string }, now: { date: string; time: string }) =>
  !it.needsAuto || hoursUntil(s.date, s.time, now) >= AUTO_ALERT_HOURS;

/**
 * מחזיר את השיבוצים החדשים. placed = כל מה שכבר תופס יום (כולל 30 הימים
 * האחרונים, בשביל המרחק בין נושאים); pool = הסרטונים שמחכים בלי תאריך.
 */
export function planSlots(placed: Placed[], pool: PoolItem[], now: { date: string; time: string }, horizon = HORIZON_DAYS): Assignment[] {
  const all = placed.slice();
  const left = pool.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const out: Assignment[] = [];

  const fill = (slots: Assignment[]) => {
    for (const s of slots) {
      if (!left.length) return;
      let pick = -1;
      let best = -1;
      left.forEach((it, i) => {
        if (!fits(it, s, now)) return;
        const d = distance(it, s.date, all);
        if (d > best) { best = d; pick = i; }   // > ולא >=: בתיקו נשאר הוותיק
      });
      // רק פוסטים שמחכים לאוטומציה, והמשבצת קרובה מדי בשבילם — נשארת ריקה
      if (pick < 0) continue;
      const [it] = left.splice(pick, 1);
      const a = { id: it.id, date: s.date, time: s.time };
      out.push(a);
      all.push({ id: it.id, date: s.date, time: s.time, topic: it.topic, auto: it.auto });
    }
  };

  const { evenings } = freeSlots(all, now, horizon);
  fill(evenings);
  // הבקרים נפתחים רק אחרי שכל הערבים מלאים — כולל מה ששובץ הרגע
  if (left.length && !freeSlots(all, now, horizon).evenings.length) fill(freeSlots(all, now, horizon).mornings);
  return spread(out, placed, pool, now);
}

/**
 * הבחירה לפי הסדר דוחה את הסרטונים ה"בעייתיים" לסוף, ושם הם נדחסים יחד (שתי
 * הילות ביומיים האחרונים). לכן אחריה מחליפים משבצות בין השיבוצים החדשים, כל
 * עוד ההחלפה מרחיקה נושאים זהים. הקנס לכל סרטון: 1/(מרחק)² מהפוסט הקרוב באותו
 * נושא — שני ימים צמודים יקרים בהרבה משבוע. בלי שיפור — הסדר (הוותיק קודם) נשאר.
 */
function spread(out: Assignment[], placed: Placed[], pool: PoolItem[], now: { date: string; time: string }): Assignment[] {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const topic = (id: string) => topicKey(byId.get(id)?.topic);
  const auto = (id: string) => Boolean(byId.get(id)?.auto);
  if (out.length < 2 || !out.some((a) => topic(a.id) || auto(a.id))) return out;
  const fixed = placed.map((p) => ({ date: p.date, topic: topicKey(p.topic), auto: Boolean(p.auto) })).filter((p) => p.topic || p.auto);
  // קנס על קרבה: לנושא זהה, ובנפרד לשני פוסטים עם אוטומציה
  const near = (d: number) => (d === Infinity ? 0 : 1 / (d + 0.5) ** 2);   // אותו יום (בוקר וערב) = 0 ימים
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
        // פוסט שמחכה לאוטומציה לא עובר למשבצת קרובה מדי
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
