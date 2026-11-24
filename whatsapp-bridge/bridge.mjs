// גשר וואטסאפ לא רשמי — מחבר מספר וואטסאפ ביזנס ל-CRM כ"מכשיר מקושר",
// בדיוק כמו וואטסאפ ווב. רץ על שרת קטן שדלוק כל הזמן (ורסל לא יכולה להחזיק
// חיבור פתוח), ומדבר עם ה-CRM בשני כיוונים:
//
//   CRM → גשר:  POST /send   — שליחת טקסט. מוגן ב-Bearer סוד משותף.
//   גשר → CRM:  POST <CRM_WEBHOOK_URL> — הודעות נכנסות ודיווחי מסירה,
//               **באותו מבנה בדיוק** של webhook של מטא, חתום ב-HMAC.
//
// למה לחקות את מטא: ה-CRM כבר יודע לקלוט את המבנה הזה — איתור איש קשר לפי
// מספר, דה-דופליקציה, אישורי מסירה וקריאה. גשר שמדבר באותה שפה לא מחייב
// מסלול קליטה שני שיצטרך לתחזק את כל הכללים האלה פעם נוספת.
//
// משתני סביבה:
//   BRIDGE_SECRET    — סוד משותף. משמש גם ל-Bearer וגם לחתימת ה-webhook.
//   CRM_WEBHOOK_URL  — https://<crm>/api/webhooks/whatsapp
//   PORT             — ברירת מחדל 3100
//   AUTH_DIR         — היכן נשמר החיבור (ברירת מחדל ./auth). למחוק = להתנתק.

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import pino from "pino";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  useMultiFileAuthState,
} from "baileys";

const SECRET = process.env.BRIDGE_SECRET;
const WEBHOOK_URL = process.env.CRM_WEBHOOK_URL;
const PORT = Number(process.env.PORT || 3100);
const AUTH_DIR = process.env.AUTH_DIR || new URL("./auth", import.meta.url).pathname;
// מחוץ לתיקיית החיבור בכוונה: ניתוק מהטלפון מוחק את AUTH_DIR, והתור צריך
// לשרוד את זה — ההודעות בו יישלחו אחרי שהמספר יחובר מחדש.
const QUEUE_FILE = process.env.QUEUE_FILE || `${AUTH_DIR.replace(/\/+$/, "")}-queue.json`;

if (!SECRET || SECRET.length < 24) {
  console.error("BRIDGE_SECRET חסר או קצר מדי (לפחות 24 תווים)");
  process.exit(1);
}

const logger = pino({ level: process.env.LOG_LEVEL || "warn" });

// ── מצב החיבור ─────────────────────────────────────────────────────────

/** @type {import("baileys").WASocket | null} */
let sock = null;
let connection = "connecting"; // connecting · open · close · logged_out
let lastQr = null;
let me = null;
let reconnectDelay = 2000;
/** מתי החיבור הנוכחי נפתח (ISO). מוצג בדף הוואטסאפ: "מחובר מאז". */
let connectedSince = null;
/** מתי הגיעה ההודעה הנכנסת האחרונה (ISO). */
let lastInboundAt = null;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    // Chrome ולא "Desktop": חיבור עם קוד (ולא סריקת QR) נדחה בטלפון כשהמכשיר
    // המקושר מציג את עצמו כאפליקציית דסקטופ. נמצא ב-24.11.2026, שלושה קודים
    // שלא עבדו.
    browser: Browsers.macOS("Chrome"),
    // כל עוד המספר לא מחובר, וואטסאפ מחליפה QR כל 20 שניות וסוגרת את החיבור
    // כשהם נגמרים — וקוד חיבור שהופק על החיבור הקודם מת איתו. שלוש דקות
    // לכל QR נותנות זמן להגיע למסך בטלפון ולהקליד.
    qrTimeout: 180_000,
    // לא להופיע "מחובר" בכל פעם שהגשר עולה — אחרת הטלפון מפסיק לקבל
    // התראות על הודעות, כי וואטסאפ חושבת שהמשתמש יושב מול המחשב.
    markOnlineOnConnect: false,
    // לא מבקשים את כל ההיסטוריה. הסנכרון החלקי נשאר פעיל בכוונה: ממנו
    // Baileys לומדת את המיפוי בין מזהים אנונימיים (LID) למספרי טלפון, ובלעדיו
    // החיבור לא יציב. ההודעות הישנות עצמן מגיעות כ-"append" ולא נכנסות ל-CRM.
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    if (update.qr) lastQr = update.qr;

    if (update.connection === "open") {
      connection = "open";
      lastQr = null;
      reconnectDelay = 2000;
      me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
      connectedSince = new Date().toISOString();
      console.log(`[bridge] מחובר כ-${me}`);
      drainQueue();
    }

    if (update.connection === "close") {
      const code = update.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // המכשיר הוסר מהטלפון ("מכשירים מקושרים" ← התנתק). החיבור השמור
        // כבר לא תקף, ונסיון חוזר איתו רק ייכשל שוב ושוב — מוחקים ומתחילים
        // מחדש, כך שיופיע קוד חיבור חדש.
        connection = "logged_out";
        me = null;
        console.warn("[bridge] נותק מהטלפון — מוחק את החיבור השמור");
        rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(connect, 1000);
        return;
      }
      connection = "close";
      connectedSince = null;
      console.warn(`[bridge] החיבור נסגר (${code ?? "?"}) — מנסה שוב בעוד ${reconnectDelay / 1000} שניות`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // "append" היא היסטוריה שהגיעה בסנכרון; רק "notify" היא הודעה חדשה.
    if (type !== "notify") return;
    for (const message of messages) {
      handleIncoming(message).catch((error) =>
        console.error("[bridge] כשל בהודעה נכנסת:", error?.message ?? error)
      );
    }
  });

  sock.ev.on("messages.update", (updates) => {
    const statuses = [];
    for (const { key, update } of updates) {
      if (!key?.fromMe || !key.id || update?.status == null) continue;
      // 3 = הגיע למכשיר, 4 = נקרא, 5 = הודעה קולית נוגנה (גם היא "נקרא").
      const status = update.status === 3 ? "delivered" : update.status >= 4 ? "read" : null;
      if (!status) continue;
      statuses.push({
        id: key.id,
        status,
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: phoneDigits(key.remoteJidAlt ?? key.remoteJid),
      });
    }
    if (statuses.length) postToCrm({ statuses }).catch(() => {});
  });
}

// ── הודעות נכנסות ──────────────────────────────────────────────────────

/** "972501234567@s.whatsapp.net" → "972501234567" */
function phoneDigits(jid) {
  if (!jid) return null;
  return jidNormalizedUser(jid).split("@")[0].split(":")[0] || null;
}

/**
 * מספר הטלפון של השולח.
 *
 * וואטסאפ עוברת בהדרגה למזהים אנונימיים (LID) במקום מספרי טלפון, וחלק
 * מההודעות מגיעות כ-"123456@lid". ה-CRM מאתר אנשי קשר לפי מספר טלפון, ולכן
 * LID לבדו חסר ערך — מחפשים את המספר בשדה החלופי, ואם אין, במיפוי השמור.
 */
async function senderPhoneJid(key) {
  for (const candidate of [key.remoteJid, key.remoteJidAlt]) {
    if (candidate && isPnUser(candidate)) return candidate;
  }
  if (key.remoteJid && isLidUser(key.remoteJid)) {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(key.remoteJid).catch(() => null);
    if (pn) return pn;
  }
  return null;
}

/** תוכן ההודעה במבנה של מטא — כך שה-CRM יציג "[תמונה] כיתוב" כמו תמיד. */
function toMetaMessage(content) {
  if (!content) return null;
  // הודעה "חד-פעמית" והודעה שנערכה עטופות שכבה נוספת.
  const inner =
    content.ephemeralMessage?.message ??
    content.viewOnceMessage?.message ??
    content.viewOnceMessageV2?.message ??
    content.documentWithCaptionMessage?.message ??
    content;

  const text = inner.conversation ?? inner.extendedTextMessage?.text;
  if (text) return { type: "text", text: { body: text } };
  if (inner.imageMessage) return { type: "image", image: { caption: inner.imageMessage.caption ?? undefined } };
  if (inner.videoMessage) return { type: "video", video: { caption: inner.videoMessage.caption ?? undefined } };
  if (inner.documentMessage)
    return {
      type: "document",
      document: {
        caption: inner.documentMessage.caption ?? undefined,
        filename: inner.documentMessage.fileName ?? undefined,
      },
    };
  if (inner.audioMessage) return { type: "audio", audio: {} };
  if (inner.stickerMessage) return { type: "sticker", sticker: {} };
  if (inner.locationMessage)
    return {
      type: "location",
      location: { name: inner.locationMessage.name ?? undefined, address: inner.locationMessage.address ?? undefined },
    };
  if (inner.contactMessage || inner.contactsArrayMessage) return { type: "contacts" };
  if (inner.buttonsResponseMessage?.selectedDisplayText)
    return { type: "button", button: { text: inner.buttonsResponseMessage.selectedDisplayText } };
  if (inner.listResponseMessage?.title)
    return { type: "interactive", interactive: { list_reply: { title: inner.listResponseMessage.title } } };
  // תגובות (👍), מחיקות, עדכוני פרוטוקול — לא הודעה שאדם כתב.
  if (inner.reactionMessage || inner.protocolMessage || inner.senderKeyDistributionMessage) return null;
  return { type: "unsupported" };
}

async function handleIncoming(message) {
  const key = message.key;
  if (!key?.id || key.fromMe) return;

  const remote = key.remoteJid ?? "";
  // קבוצות, סטטוסים וערוצים — לא שיחה עם לקוח.
  if (remote.endsWith("@g.us") || remote === "status@broadcast" || remote.endsWith("@newsletter")) return;

  const meta = toMetaMessage(message.message);
  if (!meta) return;

  const jid = await senderPhoneJid(key);
  const from = phoneDigits(jid);
  if (!from) {
    console.warn(`[bridge] הודעה ${key.id} בלי מספר טלפון מזוהה (${remote}) — דילוג`);
    return;
  }

  const timestamp = Number(message.messageTimestamp ?? Math.floor(Date.now() / 1000));
  lastInboundAt = new Date(timestamp * 1000).toISOString();

  await postToCrm({
    contacts: [{ wa_id: from, profile: { name: message.pushName ?? undefined } }],
    messages: [{ from, id: key.id, timestamp: String(timestamp), ...meta }],
  });
}

// ── שליחה ל-CRM ────────────────────────────────────────────────────────

function sign(body) {
  return "sha256=" + createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

/**
 * POST ל-CRM במבנה webhook של מטא.
 *
 * עד חמישה ניסיונות עם המתנה גדלה: פריסה בוורסל או תקלת רשת קצרה לא אמורות
 * לאבד הודעה של לקוח. ה-CRM עושה דה-דופליקציה לפי מזהה ההודעה, אז ניסיון
 * חוזר על משהו שכבר נקלט לא יוצר כפילות.
 */
async function postToCrm(value) {
  if (!WEBHOOK_URL) return;
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "bridge", changes: [{ field: "messages", value: { messaging_product: "whatsapp", ...value } }] }],
  });

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Signature-256": sign(body) },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return;
      console.warn(`[bridge] ה-CRM החזיר ${response.status} (ניסיון ${attempt})`);
      // 4xx הוא בעיה אצלנו (חתימה, פורמט), לא תקלה רגעית — אין טעם לחזור.
      if (response.status >= 400 && response.status < 500) return;
    } catch (error) {
      console.warn(`[bridge] שליחה ל-CRM נכשלה (ניסיון ${attempt}): ${error?.message ?? error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
  console.error("[bridge] ויתרתי על שליחה ל-CRM אחרי 5 ניסיונות");
}

// ── תור השליחה האוטומטית ──────────────────────────────────────────────
//
// הודעות ממסעות, מכללים ומתזכורות לא יוצאות בבת אחת אלא מכאן, אחת אחת,
// עם רווח אקראי בטווח שה-CRM שולח (בלמי שליחה בדף הוואטסאפ). רצף הודעות
// במרווחים זהים או צפופים הוא בדיוק מה שוואטסאפ מזהה כאוטומציה.
//
// התור נשמר לקובץ אחרי כל שינוי, כדי שהפעלה מחדש של השרת לא תעלים הודעות
// שה-CRM כבר רשם ביומן כ"נשלחו".

/** @type {{id: string, jid: string, text: string, min: number, max: number}[]} */
let queue = [];
try {
  queue = JSON.parse(readFileSync(QUEUE_FILE, "utf8"));
  if (!Array.isArray(queue)) queue = [];
} catch {
  queue = [];
}

function saveQueue() {
  const tmp = `${QUEUE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(queue));
  renameSync(tmp, QUEUE_FILE);
}

function randomGapMs(min, max) {
  const low = Math.max(0, Math.min(min, max));
  const high = Math.max(low, max);
  return (low + Math.floor(Math.random() * (high - low + 1))) * 1000;
}

let draining = false;
/** לא לפני הרגע הזה תצא ההודעה הבאה מהתור — גם אם היא הגיעה לתור ריק. */
let nextAllowedAt = 0;

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length && connection === "open") {
      const item = queue[0];
      const wait = nextAllowedAt - Date.now();
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        if (connection !== "open") break;
      }
      try {
        await sock.sendMessage(item.jid, { text: item.text }, { messageId: item.id });
      } catch (error) {
        console.error(`[bridge] שליחה מהתור נכשלה (${item.id}):`, error?.message ?? error);
        postToCrm({
          statuses: [
            {
              id: item.id,
              status: "failed",
              timestamp: String(Math.floor(Date.now() / 1000)),
              recipient_id: phoneDigits(item.jid),
              errors: [{ message: `הגשר לא הצליח לשלוח: ${error?.message ?? error}` }],
            },
          ],
        }).catch(() => {});
      }
      queue.shift();
      saveQueue();
      nextAllowedAt = Date.now() + randomGapMs(item.min, item.max);
    }
  } finally {
    draining = false;
  }
}

// ── שרת HTTP ───────────────────────────────────────────────────────────

function authorized(request) {
  const header = request.headers.authorization ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(SECRET);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("גוף הבקשה גדול מדי");
  }
  return raw ? JSON.parse(raw) : {};
}

function reply(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  // בדיקת חיים בלי סוד — לניטור. לא חושפת שום פרט.
  if (url.pathname === "/health") return reply(response, 200, { ok: true });

  if (!authorized(request)) return reply(response, 401, { error: "unauthorized" });

  try {
    if (request.method === "GET" && url.pathname === "/status") {
      return reply(response, 200, {
        connection,
        me: phoneDigits(me),
        registered: Boolean(sock?.authState?.creds?.registered),
        since: connectedSince,
        lastInboundAt,
        queued: queue.length,
        qr: lastQr,
      });
    }

    // חיבור עם קוד בן 8 תווים במקום סריקת QR: בטלפון ← מכשירים מקושרים ←
    // "קשר עם מספר טלפון במקום". נוח כשהשרת בענן ואין מסך לסרוק ממנו.
    if (request.method === "POST" && url.pathname === "/pair") {
      const { phone } = await readJson(request);
      const digits = String(phone ?? "").replace(/\D/g, "");
      if (digits.length < 11) return reply(response, 400, { error: "מספר בפורמט בינלאומי, למשל 972501234567" });
      if (sock?.authState?.creds?.registered) return reply(response, 409, { error: "כבר מחובר" });
      const code = await sock.requestPairingCode(digits);
      return reply(response, 200, { code });
    }

    if (request.method === "POST" && url.pathname === "/send") {
      if (connection !== "open") return reply(response, 503, { error: `הגשר לא מחובר לוואטסאפ (${connection})` });
      const { to, text, queue: gap } = await readJson(request);
      // "me" = המספר המחובר עצמו: הודעת בדיקה מדף הוואטסאפ ("שלח לעצמי").
      const digits = to === "me" ? phoneDigits(me) : String(to ?? "").replace(/\D/g, "");
      if (!digits || !text) return reply(response, 400, { error: "חסר to או text" });

      // בדיקה שהמספר בכלל בוואטסאפ — אחרת השליחה "מצליחה" ואף אחד לא מקבל.
      const [check] = (await sock.onWhatsApp(digits)) ?? [];
      if (!check?.exists) return reply(response, 422, { error: "המספר הזה לא רשום בוואטסאפ" });

      // אוטומטי: למזהה מראש ולתור. ה-CRM רושם את המזהה ביומן מיד, ודיווחי
      // המסירה שיגיעו אחר כך יתחברו אליו.
      if (gap && typeof gap === "object") {
        const id = generateMessageIDV2(sock.user?.id);
        const min = Math.max(0, Number(gap.min) || 0);
        const max = Math.max(min, Number(gap.max) || min);
        queue.push({ id, jid: check.jid, text, min, max });
        saveQueue();
        drainQueue();
        return reply(response, 200, { id, queued: queue.length });
      }

      const sent = await sock.sendMessage(check.jid, { text });
      return reply(response, 200, { id: sent?.key?.id ?? null });
    }

    return reply(response, 404, { error: "not found" });
  } catch (error) {
    console.error("[bridge] שגיאה:", error?.message ?? error);
    return reply(response, 500, { error: error?.message ?? String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[bridge] מאזין על 127.0.0.1:${PORT}`));
connect();
