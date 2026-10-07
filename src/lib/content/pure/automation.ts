/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */
/**
 * בנק האוטומציות: "תגובה ← הודעה פרטית" באינסטגרם — הכללים, הגרף והגוף.
 * בלי מסד ובלי רשת, כדי שאפשר יהיה לבדוק ישירות.
 *
 * זה הסקיל comment-to-dm (scripts/keyword_dm.py) מתורגם, עם שלושה שינויים
 * שהתבקשו:
 *  1. בקשת העוקב באה *לפני* ההודעה, ובודקת באמת. היא לא צומת ב-workflow כמו
 *     בסקיל (שם כל מי שלוחץ "עקבתי" עובר), אלא האפשרות המובנית של Zernio
 *     באוטומציית התגובה: audience.followerStatus=follower + whenUnknown=verify.
 *     אינסטגרם חושף "עוקב/לא" רק למי שכבר שלח הודעה, ולכן מגיב חדש מקבל
 *     קודם הודעת אימות עם כפתור; הלחיצה היא הודעה, והבדיקה רצה עליה.
 *  2. "כל תגובה": keywords ריק.
 *  3. איסוף מייל בצ'אט (wait_for_reply + בדיקת תבנית), לפני הלינק.
 *
 * מה שנשאר מהסקיל כמו שהוא: האוטומציה עונה בהודעה עם כפתור postback, ולחיצה
 * על הכפתור מגיעה כהודעה רגילה שמפעילה workflow לפי הטקסט שלו. הודעות עם
 * כפתורים יוצאות דרך צומת webhook שקורא ל-/inbox/conversations/{id}/messages,
 * ו-bodyTemplate הוא מחרוזת JSON ולא אובייקט.
 */

export const ZERNIO_BASE = "https://zernio.com/api/v1";
/** במסד ובמסכים נשמר רק זה. המפתח עצמו מוזרק לכותרת ברגע השליחה (injectKey). */
export const KEY_PLACEHOLDER = "__ZERNIO_API_KEY__";
export const EMAIL_PATTERN = "^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}\\s*$";
const EMAIL_RE = new RegExp(EMAIL_PATTERN);

export interface Automation {
  id: string;
  name: string;
  trigger_mode: "keyword" | "any";
  keyword: string | null;
  match_mode: "exact" | "word" | "contains";
  gate_enabled: boolean;
  verify_text: string | null;
  verify_button: string | null;
  gate_text: string | null;
  dm1_text: string | null;
  button_title: string | null;
  email_enabled: boolean;
  email_ask_text: string | null;
  email_invalid_text: string | null;
  email_thanks_text: string | null;
  link_enabled: boolean;
  link: string | null;
  link_text: string | null;
  link_card_title: string | null;
  link_button_title: string | null;
  closing_text: string | null;
  comment_reply: string | null;
  zernio_workflow_id?: string | null;
  status?: string;
}

export const CONTENT_FIELDS = [
  "name", "trigger_mode", "keyword", "match_mode", "gate_enabled", "verify_text", "verify_button", "gate_text",
  "dm1_text", "button_title", "email_enabled", "email_ask_text", "email_invalid_text", "email_thanks_text",
  "link_enabled", "link", "link_text", "link_card_title", "link_button_title", "closing_text", "comment_reply",
] as const;

export interface Account {
  id: string;
  profileId: string;
  username?: string;
  profileUrl?: string;
}

// ── נרמול טקסט, כמו normalize() בסקיל ──
const NIQQUD = /[֑-ׇ]/g;
const PUNCT = /[^\p{L}\p{N}_֐-׿]+/gu;
export function norm(text: string | null | undefined): string {
  let t = (text || "").normalize("NFKC").toLowerCase();
  t = t.replace(NIQQUD, "").replace(PUNCT, " ");
  return t.split(/\s+/).filter(Boolean).join(" ");
}

/** אימוג'י = 2. מחרוזות JS הן UTF-16 ממילא. */
export function utf16Len(s: string | null | undefined): number {
  return (s || "").length;
}

/** התשובות הציבוריות, אחת בכל שורה. Zernio מגריל ביניהן לכל מגיב. */
export function commentReplies(a: Pick<Automation, "comment_reply">): string[] {
  return dedupe((a.comment_reply || "").split("\n").map((r) => r.trim()));
}

export function keywordsOf(a: Pick<Automation, "keyword" | "trigger_mode">): string[] {
  if (a.trigger_mode === "any") return [];
  return (a.keyword || "")
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

const HEB_PREFIX = /^(?:[ובלהמשכ]|וה|וב|ול|ומ|וש|שה|שב|של|כש|מה|לה|בה|כה|וכ)?$/;
/** האם המילה היא מילה מהטקסט של הפוסט עצמו — כולל תחיליות (הומור ← בהומור). */
export function inTopic(nk: string, topic: string): boolean {
  for (const w of topic.split(" ")) {
    if (!w) continue;
    if (w === nk) return true;
    if (w.endsWith(nk) && HEB_PREFIX.test(w.slice(0, w.length - nk.length))) return true;
  }
  return nk.includes(" ") && ` ${topic} `.includes(` ${nk} `);
}

const COMMON_WORDS = new Set([
  "תודה", "מדהים", "וואו", "יפה", "אהבתי", "כן", "לא", "אני", "רוצה", "איך", "מה", "למה", "הכי",
  "טוב", "מושלם", "חזק", "אש", "לינק", "קישור", "פרטים", "מחיר", "עוד", "שלי", "שלך", "אתה", "את",
]);

export interface OtherActive {
  label: string;
  automationId?: string;
  keywords: string[];
  matchMode?: string;
  buttons: string[];
}

export interface RuleResult {
  errors: string[];
  warnings: string[];
  alternatives: { keyword: string; matchMode: string; why: string }[];
}

/**
 * הכללים מהסקיל, כחסימות ולא כהמלצות.
 * topics: הטקסט של הפוסטים שהאוטומציה מקושרת אליהם (כותרת+כיתוב+הערות).
 * others: כל מה שפעיל — אוטומציות אחרות בבנק, ומה שחי ב-Zernio ולא שלנו.
 */
export function validateAutomation(a: Automation, topics: string[], others: OtherActive[]): RuleResult {
  const E: string[] = [];
  const W: string[] = [];
  const alts: RuleResult["alternatives"] = [];
  const kws = keywordsOf(a);

  for (const f of CONTENT_FIELDS) {
    if (String((a as any)[f] ?? "").includes(KEY_PLACEHOLDER)) E.push("אחד הטקסטים מכיל מחרוזת שמורה של המערכת.");
  }
  if (!String(a.name || "").trim()) E.push("חסר שם לאוטומציה.");

  if (a.trigger_mode === "any") {
    W.push("'כל תגובה': כל מי שמגיב על הפוסטים המקושרים יקבל הודעה פרטית — גם מי שכתב 'וואו' או שאלה. אנשים שלא ביקשו כלום ומקבלים הודעה הם מה שמוביל לדיווחי ספאם.");
  } else {
    if (!kws.length) E.push("חסרה מילת מפתח.");
    const topicNorm = norm(topics.join(" "));
    for (const kw of kws) {
      const nk = norm(kw);
      if (a.match_mode === "contains" && nk.length <= 4)
        E.push(`'${kw}' קצרה מדי ל'מופיעה בכל מקום' (${nk.length} תווים) — היא תופעל בתוך מילים אחרות. בחרו 'מילה שלמה' או 'בדיוק'.`);
      if (nk && (inTopic(nk, topicNorm) || COMMON_WORDS.has(nk))) {
        W.push(`'${kw}' היא מילה רגילה בנושא הפוסט — תגובות רגילות יפעילו אותה, ואנשים שלא ביקשו יקבלו הודעה. זה בדיוק מה שמוביל לדיווחי ספאם.`);
        alts.push(
          { keyword: kw, matchMode: "exact", why: "אותה מילה, אבל רק כשהתגובה היא המילה לבדה ולא משפט שמכיל אותה" },
          { keyword: `שלחו ${kw}`, matchMode: "word", why: "צירוף שכותבים רק כשמבקשים — אמרו אותו בסרטון ובכיתוב" },
        );
      }
    }
  }

  if (a.gate_enabled) {
    if (!String(a.verify_text || "").trim()) E.push("חסרה הודעת האימות (למי שלא ידוע אם עוקב).");
    else if (utf16Len(a.verify_text) > 640) E.push("הודעת האימות ארוכה מ-640 תווים.");
    const vb = String(a.verify_button || "").trim();
    if (!vb) E.push("חסר טקסט לכפתור האימות.");
    else if (utf16Len(vb) > 20) E.push(`כפתור האימות ארוך מדי (${utf16Len(vb)}/20, אימוג'י = 2).`);
    if (!String(a.gate_text || "").trim()) E.push("חסר נוסח לבקשת העוקב (למי שלא עוקב).");
    else if (utf16Len(a.gate_text) > 640) E.push("בקשת העוקב ארוכה מ-640 תווים (מעבר לזה היא יוצאת בלי הכפתור).");
  }

  const dm = a.dm1_text || "";
  if (!dm.trim()) E.push("חסרה ההודעה הראשונה.");
  else if (utf16Len(dm) > 640) E.push(`ההודעה הראשונה ארוכה מדי (${utf16Len(dm)}/640 כשיש כפתור).`);
  const bt = String(a.button_title || "").trim();
  if (!bt) E.push("חסר טקסט לכפתור.");
  else if (utf16Len(bt) > 20) E.push(`טקסט הכפתור ארוך מדי: ${utf16Len(bt)} יחידות מתוך 20 (אימוג'י = 2).`);
  if (a.gate_enabled && bt && a.verify_button) {
    const nb = norm(bt), nv = norm(a.verify_button);
    if (nb && nv && (nb.includes(nv) || nv.includes(nb)))
      E.push("כפתור האימות והכפתור של ההודעה דומים מדי — לחיצה על אחד תפעיל את השני.");
  }

  if (!a.email_enabled && !a.link_enabled) E.push("צריך להדליק לפחות אחד: איסוף מייל או שליחת לינק. אחרת הכפתור לא מוביל לשום מקום.");
  if (a.email_enabled) {
    if (!String(a.email_ask_text || "").trim()) E.push("חסרה ההודעה שמבקשת את המייל.");
    if (!String(a.email_invalid_text || "").trim()) E.push("חסרה ההודעה למקרה שהמייל לא תקין.");
    if (!String(a.email_thanks_text || "").trim()) E.push("חסרה הודעת התודה אחרי המייל.");
  }
  if (a.link_enabled) {
    if (!String(a.link || "").trim()) E.push("חסר לינק.");
    else if (!/^https?:\/\//.test(String(a.link).trim())) E.push("הלינק צריך להתחיל ב-https://");
    if (utf16Len(a.link_button_title || "פתיחה") > 20) E.push("טקסט כפתור הלינק ארוך מ-20.");
    if (utf16Len(a.link_card_title || "") > 80) E.push("כותרת כרטיס הלינק ארוכה מ-80.");
  }

  // התנגשויות. מילות מפתח: כל אוטומציה מקושרת לפוסטים אחרים (פוסט = אוטומציה אחת),
  // ולכן זו אזהרה. כפתורים: ה-workflow מופעל לפי טקסט הכפתור בכל החשבון,
  // ולכן התנגשות היא חסימה — לחיצה אחת הייתה מפעילה שני משפכים.
  for (const o of others) {
    for (const kw of kws) {
      const nk = norm(kw);
      for (const ok of o.keywords.map(norm)) {
        if (ok && (nk === ok || ((a.match_mode === "contains" || o.matchMode === "contains") && (nk.includes(ok) || ok.includes(nk)))))
          W.push(`מילת המפתח '${kw}' משמשת גם ב${o.label}. זה בסדר כל עוד הן על פוסטים שונים.`);
      }
    }
    const mine = [bt, a.gate_enabled ? String(a.verify_button || "").trim() : ""].filter(Boolean);
    for (const t of mine) {
      for (const ob of o.buttons) {
        const n1 = norm(t), n2 = norm(ob);
        if (n1 && n2 && (n1.includes(n2) || n2.includes(n1)))
          E.push(`הכפתור '${t}' מתנגש עם '${ob}' (${o.label}) — לחיצה אחת תפעיל שני משפכים.`);
      }
    }
  }
  return { errors: dedupe(E), warnings: dedupe(W), alternatives: alts };
}

function dedupe(xs: string[]) {
  return Array.from(new Set(xs.filter(Boolean)));
}

// ── ה-workflow: לחיצה על הכפתור → [מייל] → [לינק] ──

function sendNode(id: string, accountId: string, message: string, extra: Record<string, unknown> | null, x: number, y: number) {
  const payload: Record<string, unknown> = { accountId, message, ...(extra || {}) };
  return {
    id,
    type: "webhook",
    config: {
      url: `${ZERNIO_BASE}/inbox/conversations/{{conversationId}}/messages`,
      method: "POST",
      headers: { Authorization: `Bearer ${KEY_PLACEHOLDER}`, "Content-Type": "application/json" },
      // מחרוזת ולא אובייקט: ה-executor מכניס {{vars}} ושולח כמו שהיא
      bodyTemplate: JSON.stringify(payload),
      saveAs: `sent_${id}`,
    },
    position: { x, y },
  };
}

export function linkMessage(a: Automation): string {
  return [a.link_text, a.closing_text].map((x) => String(x || "").trim()).filter(Boolean).join("\n") || " ";
}

export function buildGraph(a: Automation, acct: Account) {
  const nodes: any[] = [];
  const edges: any[] = [];
  let e = 0;
  const edge = (source: string, target: string, sourceHandle?: string) =>
    edges.push({ id: `e${++e}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

  nodes.push({
    id: "t1",
    type: "trigger",
    config: { triggerType: "inbound_message", keywords: [String(a.button_title || "").trim()], matchType: "contains" },
    position: { x: 0, y: 0 },
  });
  nodes.push({ id: "end_ok", type: "end", config: {}, position: { x: 1600, y: 0 } });
  nodes.push({ id: "end_out", type: "end", config: {}, position: { x: 1600, y: 200 } });

  const linkTarget = a.link_enabled ? "w_link" : "end_ok";
  if (a.link_enabled) {
    nodes.push(
      sendNode("w_link", acct.id, linkMessage(a), {
        template: {
          type: "generic",
          elements: [{
            title: String(a.link_card_title || "הקישור שלך").slice(0, 80),
            buttons: [{ type: "url", title: String(a.link_button_title || "פתיחה").slice(0, 20), url: String(a.link || "").trim() }],
          }],
        },
      }, 1320, 0),
    );
    edge("w_link", "end_ok", "success");
    edge("w_link", "end_out", "error");
  }

  if (a.email_enabled) {
    nodes.push(sendNode("w_ask", acct.id, String(a.email_ask_text || ""), null, 220, 0));
    nodes.push({ id: "wait_e1", type: "wait_for_reply", config: { timeoutMinutes: 1440, saveAs: "email_reply" }, position: { x: 440, y: 0 } });
    nodes.push({ id: "c_e1", type: "condition", config: { rules: [{ id: "valid", variable: "email_reply", operator: "matches", value: EMAIL_PATTERN }] }, position: { x: 660, y: 0 } });
    nodes.push(sendNode("w_retry", acct.id, String(a.email_invalid_text || ""), null, 660, 200));
    nodes.push({ id: "wait_e2", type: "wait_for_reply", config: { timeoutMinutes: 1440, saveAs: "email_reply2" }, position: { x: 880, y: 200 } });
    nodes.push({ id: "c_e2", type: "condition", config: { rules: [{ id: "valid", variable: "email_reply2", operator: "matches", value: EMAIL_PATTERN }] }, position: { x: 1100, y: 200 } });
    nodes.push(sendNode("w_thanks", acct.id, String(a.email_thanks_text || ""), null, 1100, 0));
    edge("t1", "w_ask");
    edge("w_ask", "wait_e1", "success");
    edge("w_ask", "end_out", "error");
    edge("wait_e1", "c_e1", "reply");
    edge("wait_e1", "end_out", "timeout");
    edge("c_e1", "w_thanks", "valid");
    edge("c_e1", "w_retry", "default");
    edge("w_retry", "wait_e2", "success");
    edge("w_retry", "end_out", "error");
    edge("wait_e2", "c_e2", "reply");
    edge("wait_e2", "end_out", "timeout");
    edge("c_e2", "w_thanks", "valid");
    edge("c_e2", "end_out", "default");
    edge("w_thanks", linkTarget, "success");
    edge("w_thanks", "end_out", "error");
  } else {
    edge("t1", linkTarget);
  }
  return { nodes, edges };
}

export function workflowBody(a: Automation, acct: Account) {
  const { nodes, edges } = buildGraph(a, acct);
  return {
    profileId: acct.profileId,
    accountId: acct.id,
    platform: "instagram",
    name: `gantt · ${a.name} (${a.id.slice(0, 8)})`,
    description: `From the content gantt, automation ${a.id}`,
    nodes,
    edges,
    entryNodeId: "t1",
  };
}

/** המפתח נכנס רק לכותרת Authorization של צמתי ה-webhook, בזיכרון, ברגע השליחה. */
export function injectKey<T>(body: T, key: string): T {
  const out = JSON.parse(JSON.stringify(body));
  for (const n of out?.nodes || []) {
    const h = n?.config?.headers;
    if (h && h.Authorization === `Bearer ${KEY_PLACEHOLDER}`) h.Authorization = `Bearer ${key}`;
  }
  return out;
}

export function automationName(a: Automation, itemId: string) {
  return `gantt-${a.id.slice(0, 8)}-${itemId.slice(0, 24)}`;
}

/** גוף אוטומציית התגובה לפוסט אחד. linkTracking כבוי תמיד. */
export function commentAutomationBody(a: Automation, acct: Account, itemId: string, platformPostId?: string | null) {
  const body: Record<string, unknown> = {
    profileId: acct.profileId,
    accountId: acct.id,
    name: automationName(a, itemId),
    trigger: "comment",
    keywords: keywordsOf(a),
    matchMode: a.match_mode || "word",
    dmMessage: a.dm1_text || "",
    buttons: [{ type: "postback", title: String(a.button_title || "").trim(), payload: `gantt_${a.id.slice(0, 8)}` }],
    linkTracking: false,
  };
  const replies = commentReplies(a);
  if (replies.length) body.commentReply = replies[0];
  if (replies.length > 1) body.commentReplyVariations = replies.slice(1);
  if (a.gate_enabled) {
    body.audience = { followerStatus: "follower", whenUnknown: "verify" };
    body.followGate = {
      message: String(a.verify_text || "").trim(),
      buttonLabel: String(a.verify_button || "").trim(),
      notFollowingMessage: String(a.gate_text || "").trim(),
    };
  }
  if (platformPostId) body.platformPostId = platformPostId;
  return body;
}

/** השדות שמשתנים באוטומציה קיימת בעריכה (PATCH). */
export function commentAutomationPatch(a: Automation) {
  const b = commentAutomationBody(a, { id: "", profileId: "" }, "x");
  const patch: Record<string, unknown> = {
    keywords: b.keywords,
    matchMode: b.matchMode,
    dmMessage: b.dmMessage,
    buttons: b.buttons,
    commentReply: b.commentReply ?? "",
    commentReplyVariations: b.commentReplyVariations ?? [],
    linkTracking: false,
  };
  // PATCH ששולח audience בלי tapToUnlock מנקה אותו — שולחים במפורש את המצב הרצוי
  patch.audience = a.gate_enabled ? b.audience : { followerStatus: "any", whenUnknown: "send" };
  if (a.gate_enabled) patch.followGate = b.followGate;
  return patch;
}

/** טביעה של מה שנשלח ל-Zernio, כדי לזהות "יש שינויים שלא נשלחו". */
export function contentHash(a: Automation): string {
  const s = JSON.stringify(CONTENT_FIELDS.filter((f) => f !== "name").map((f) => (a as any)[f] ?? null));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// ── תצוגה מקדימה: מה המגיב רואה ──

export function preview(a: Automation, username?: string) {
  const msgs: any[] = [];
  msgs.push({ from: "them", kind: "comment", text: a.trigger_mode === "any" ? "(כל תגובה)" : keywordsOf(a)[0] || "?" });
  const replies = commentReplies(a);
  if (replies.length)
    msgs.push({ from: "me", kind: "public-reply", text: replies[0], note: replies.length > 1 ? `אחת מ-${replies.length} תשובות, בהגרלה` : undefined });
  if (a.gate_enabled) {
    msgs.push({ from: "me", kind: "dm", text: a.verify_text || "", buttons: [a.verify_button || ""], note: "רק למי שלא ידוע אם עוקב" });
    msgs.push({ from: "them", kind: "tap", text: a.verify_button || "" });
    msgs.push({ from: "me", kind: "dm", text: a.gate_text || "", buttons: [a.verify_button || ""], note: "רק אם הבדיקה מצאה שלא עוקב" });
  }
  msgs.push({ from: "me", kind: "dm", text: a.dm1_text || "", buttons: [a.button_title || ""] });
  msgs.push({ from: "them", kind: "tap", text: a.button_title || "" });
  if (a.email_enabled) {
    msgs.push({ from: "me", kind: "dm", text: a.email_ask_text || "" });
    msgs.push({ from: "them", kind: "reply", text: "name@example.com" });
    msgs.push({ from: "me", kind: "dm", text: a.email_thanks_text || "" });
  }
  if (a.link_enabled) {
    const t = linkMessage(a).trim();
    if (t) msgs.push({ from: "me", kind: "dm", text: t });
    msgs.push({ from: "me", kind: "card", title: a.link_card_title || "הקישור שלך", buttons: [a.link_button_title || "פתיחה"], url: a.link });
  }
  return { account: username, messages: msgs };
}

// ── מעקב: לוגים וריצות → מספרים ──

export function sentOk(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === "") return false;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("ok" in o) return Boolean(o.ok);          // webhook: { status, ok, body }
    if (o.error || o.success === false) return false;
    return Object.keys(o).length > 0;
  }
  return true;
}

export function emailFromVars(vars: Record<string, unknown>): string | null {
  for (const k of ["email_reply2", "email_reply"]) {
    const raw = vars?.[k];
    const s = typeof raw === "string" ? raw : raw && typeof raw === "object" ? String((raw as any).text ?? (raw as any).message ?? "") : "";
    const m = s.match(/[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[^\s@<>()"',;]{2,}/);
    if (m && EMAIL_RE.test(m[0])) return m[0].toLowerCase();
  }
  return null;
}

export function executionStats(execs: any[]) {
  const seen = new Set<string>();
  let taps = 0, emails = 0, links = 0;
  for (const e of execs) {
    if (!e?.id || seen.has(e.id)) continue;       // הדפדוף של executions לא אמין: dedupe לפי id
    seen.add(e.id);
    taps++;
    const v = e.variables || {};
    if (emailFromVars(v)) emails++;
    if (sentOk(v.sent_w_link)) links++;           // המשתנים, לא הצומת שהריצה עומדת עליו
  }
  return { taps, emails, links };
}
