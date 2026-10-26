/* Zernio panel: connections, the write switch, the action log, worker health, audit. */
(function () {
  "use strict";
  var X = window.GanttExt, el = X.el, api = X.api, NET = X.NET, ORDER = X.ORDER;

  function ago(ts) {
    if (!ts) return "אף פעם";
    var s = Math.round(Date.now() / 1000 - ts);
    if (s < 90) return "לפני " + s + " שניות";
    if (s < 5400) return "לפני " + Math.round(s / 60) + " דקות";
    if (s < 172800) return "לפני " + Math.round(s / 3600) + " שעות";
    return new Date(ts * 1000).toLocaleString("he-IL");
  }

  function openPanel() {
    var m = X.modal("חיבור ל-Zernio", { wide: true });
    var b = m.body;

    // connections
    b.appendChild(el("label", "field-label", "רשתות מחוברות"));
    var conn = el("div", "admin-conn"); b.appendChild(conn);
    function renderConn() {
      conn.innerHTML = "";
      ORDER.forEach(function (p) {
        var info = X.accounts && X.accounts.platforms[p];
        var row = el("div", "admin-row");
        var ic = el("span", "net-ico"); ic.innerHTML = NET[p].icon; row.appendChild(ic);
        row.appendChild(el("strong", null, NET[p].name));
        if (info && info.connected) {
          var a = info.account;
          row.appendChild(el("span", null, "@" + a.username + (a.displayName ? " · " + a.displayName : "")));
          row.appendChild(el("span", "admin-tag " + (info.healthy ? "is-ok" : "is-bad"), info.healthy ? "מחובר" : "דורש חיבור מחדש"));
        } else {
          row.appendChild(el("span", "admin-tag", "לא מחובר ב-Zernio — מחברים באתר של Zernio"));
        }
        conn.appendChild(row);
      });
      if (X.accounts && X.accounts.error) conn.appendChild(el("p", "val-block is-error", X.accounts.error));
    }
    renderConn();
    b.appendChild(X.btn("רענון חיבורים", "btn-ghost btn-small", function () { X.loadAccounts(true).then(renderConn); }));

    // write switch
    b.appendChild(el("div", "ext-sep"));
    b.appendChild(el("label", "field-label", "כתיבה ל-Zernio"));
    var sw = el("div"); b.appendChild(sw);
    function renderSwitch(s) {
      sw.innerHTML = "";
      var on = !!s.writesEnabled;
      sw.appendChild(el("p", "settings-intro", on
        ? "פעילה. כל פעולה עדיין עוברת דרך מסך אישור. עובד הרקע מבצע רק מה שכבר אישרתם (הצמדת אוטומציה, עדכון סטטוסים)."
        : "כבויה (מצב בדיקה). מסכי האישור מראים בדיוק מה היה נשלח, ושום דבר לא נשלח. כך המערכת נמסרה — מדליקים רק כשמוכנים לפעולה אמיתית."));
      var btn = X.btn(on ? "כיבוי כתיבה" : "הפעלת כתיבה ל-Zernio", on ? "btn-ghost btn-small" : "btn-danger-ghost btn-small", function () {
        if (!on && !btn.classList.contains("confirm")) { btn.classList.add("confirm"); btn.textContent = "לאשר: מעכשיו אישור במסך = פעולה אמיתית"; return; }
        api("PATCH", "/api/settings", { writesEnabled: !on }).then(renderSwitch);
      });
      sw.appendChild(btn);
    }
    api("GET", "/api/settings").then(renderSwitch);

    // worker
    b.appendChild(el("div", "ext-sep"));
    b.appendChild(el("label", "field-label", "עובד רקע"));
    var w = X.worker || {};
    b.appendChild(el("p", "settings-intro", w.lastRun
      ? ("ריצה אחרונה " + ago(w.lastRun) + (w.stale ? " — לא רץ בדקות האחרונות! אוטומציות מתוזמנות לא יוצמדו." : " — תקין.") + (w.summary ? " (" + w.summary + ")" : ""))
      : "עוד לא רץ. העובד רץ בענן כל דקה (pg_cron ב-Supabase → /api/cron/content-worker). אם הוא לא רץ — המשימה content-worker לא הוגדרה (0046)."));

    // audit hook (stage 4)
    if (X.renderAuditButton) { b.appendChild(el("div", "ext-sep")); X.renderAuditButton(b); }

    // log
    b.appendChild(el("div", "ext-sep"));
    b.appendChild(el("label", "field-label", "יומן פעולות מול Zernio"));
    var logHost = el("div", "admin-log"); b.appendChild(logHost);
    api("GET", "/api/audit-log?limit=60").then(function (rows) {
      if (!rows.length) { logHost.appendChild(el("p", "settings-intro", "עוד לא בוצעה אף פעולה.")); return; }
      rows.forEach(function (r) {
        var row = el("div", "admin-log-row" + (r.ok ? "" : " is-bad"));
        row.appendChild(el("span", "admin-log-time", new Date(r.at * 1000).toLocaleString("he-IL")));
        row.appendChild(el("span", null, (r.actor === "worker" ? "עובד: " : "") + (r.action || "")));
        if (r.method) { var code = el("code", null, r.method + " " + (r.path || "") + (r.status_code > 0 ? " → " + r.status_code : "")); code.dir = "ltr"; row.appendChild(code); }
        logHost.appendChild(row);
      });
    });
  }

  X.hooks.push(function () {
    X.headerButton("חיבור ל-Zernio ויומן", '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4"/></svg>', openPanel);
    // a banner when writes are off, so a dry run is never mistaken for the real thing
    api("GET", "/api/settings").then(function (s) {
      if (s.writesEnabled) return;
      var hint = document.getElementById("hintText");
      var ban = el("p", "writes-off-banner", "מצב בדיקה: כתיבה ל-Zernio כבויה — מסכי האישור מראים מה היה נשלח, ושום דבר לא נשלח. ההפעלה במסך 'חיבור ל-Zernio'.");
      hint.parentNode.insertBefore(ban, hint);
    });
  });
  X.openAdmin = openPanel;

  // ---------- תזמון אוטומטי: המתג בשורה "מוכנים לתזמון" ----------
  // השרת (src/lib/content/autoplan.ts) ממלא שכבות: סרטון אחד בכל אחד מ-X הימים הקרובים,
  // אחר כך שני, וכן הלאה, בשעות שגיא קבע כאן. מרחיק נושאים זהים, מזיז את מה שהוא
  // שיבץ כשהתוכנית משתנה, ומתזמן ב-Zernio. פוסט שחסרה לו אוטומציה מחכה.
  function fmtDay(key) {
    var d = new Date(key + "T12:00:00");
    return d.toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" });
  }
  X.decorateTray = function (head) {
    var box = el("span", "autoplan-ctl");
    var on = !!X.autoplanOn;
    var btn = X.btn(on ? "תזמון אוטומטי: פעיל" : "תזמון אוטומטי: כבוי", "btn-small autoplan-btn" + (on ? " is-on" : " btn-ghost"), function () {
      if (!on && !btn.classList.contains("confirm")) {
        btn.classList.add("confirm");
        btn.textContent = "להדליק? המערכת תשבץ ותתזמן לבד";
        return;
      }
      btn.disabled = true;
      api("PATCH", "/api/settings", { autoSchedule: !on }).then(function (st) {
        X.autoplanOn = !!st.autoSchedule;
        if (X.autoplan) X.autoplan.on = X.autoplanOn;
        X.G.rerenderCalendar();
        X.G.showToast(X.autoplanOn ? "התזמון האוטומטי פעיל. הריצה הראשונה בתוך 5 דקות." : "התזמון האוטומטי כבוי. מה שכבר תוזמן נשאר מתוזמן.");
      }, function (e) { btn.disabled = false; X.G.showToast(e.message, true); });
    });
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    box.appendChild(btn);
    var last = X.autoplan && X.autoplan.last;
    if (on && last && last.at) {
      var bits = [];
      if (last.placed && last.placed.length) bits.push("שובצו " + last.placed.length);
      if (last.shifted && last.shifted.length) bits.push("הוזזו " + last.shifted.length);
      if (last.scheduled && last.scheduled.length) bits.push("תוזמנו " + last.scheduled.length);
      if (last.linked && last.linked.length) bits.push("קושרו " + last.linked.length + " אוטומציות");
      var txt = "ריצה אחרונה " + ago(last.at) + (bits.length ? ": " + bits.join(", ") : ", אין שינוי");
      var info = el("span", "autoplan-last", txt);
      info.title = (last.placed || []).map(function (p) { return fmtDay(p.date) + " " + p.time + " · " + p.title; })
        .concat((last.shifted || []).map(function (m) { return "הוזז: " + m.title + " · " + m.from + " ← " + m.to; })).join("\n");
      box.appendChild(info);
    }
    head.appendChild(box);
    head.appendChild(rulesRow());
  };

  // ימים קדימה ושעות הפרסום (גיא, 26.10.2026). השרת מנקה את הערכים (normalizeRules
  // ב-pure/autoplan.ts), והעובד מסדר את הלוח מחדש בריצה הבאה, בתוך 5 דקות.
  var ORDINAL = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שביעי", "שמיני", "תשיעי", "עשירי", "11", "12"];
  function rulesRow() {
    var r = (X.autoplan && X.autoplan.rules) || { days: 30, times: ["18:00", "08:00"] };
    var row = el("div", "autoplan-rules");
    function save(patch) {
      row.classList.add("is-saving");
      api("PATCH", "/api/settings", patch).then(function (st) {
        X.autoplan = X.autoplan || { on: X.autoplanOn };
        X.autoplan.rules = { days: st.autoplanDays, times: st.autoplanTimes };
        X.G.rerenderCalendar();
        X.G.showToast(X.autoplanOn ? "נשמר. הלוח יסודר לפי זה בתוך 5 דקות." : "נשמר. ייכנס לתוקף כשתדליק את התזמון האוטומטי.");
      }, function (e) { row.classList.remove("is-saving"); X.G.showToast(e.message, true); });
    }

    var days = el("label", "autoplan-field");
    days.appendChild(el("span", "autoplan-label", "ימים קדימה"));
    var din = el("input", "text-input autoplan-days");
    din.type = "number"; din.min = "1"; din.max = "90"; din.value = r.days; din.inputMode = "numeric";
    // החצים של השדה יורים שינוי בכל לחיצה: שומרים רק כשהמספר נח לרגע
    var timer = null;
    din.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var v = Math.round(Number(din.value));
        if (v >= 1 && v <= 90 && v !== r.days) save({ autoplanDays: v });
      }, 800);
    });
    din.addEventListener("blur", function () { var v = Math.round(Number(din.value)); if (!(v >= 1 && v <= 90)) din.value = r.days; });
    days.appendChild(din);
    row.appendChild(days);

    var times = el("div", "autoplan-times");
    times.appendChild(el("span", "autoplan-label", "שעות"));
    r.times.forEach(function (t, i) {
      var chip = el("span", "autoplan-time");
      chip.appendChild(el("span", "autoplan-ord", ORDINAL[i] || String(i + 1)));
      var tin = el("input", "text-input");
      tin.type = "time"; tin.value = t;
      tin.setAttribute("aria-label", "השעה של הסרטון ה" + (ORDINAL[i] || i + 1) + " ביום");
      tin.addEventListener("change", function () {
        if (!tin.value || tin.value === t) return;
        var next = r.times.slice(); next[i] = tin.value;
        save({ autoplanTimes: next });
      });
      chip.appendChild(tin);
      if (r.times.length > 1) {
        var rm = X.btn("×", "btn-small btn-ghost autoplan-rm", function () {
          save({ autoplanTimes: r.times.filter(function (_, j) { return j !== i; }) });
        });
        rm.setAttribute("aria-label", "הסרת השעה " + t);
        chip.appendChild(rm);
      }
      times.appendChild(chip);
    });
    if (r.times.length < 12) {
      times.appendChild(X.btn("+ שעה", "btn-small btn-ghost", function () {
        // השעה העגולה הפנויה הראשונה מ-13:00, כדי שלא תיפול על שעה שכבר ברשימה
        var cand = ["13:00", "20:00", "10:00", "15:00", "21:00", "11:00", "16:00", "19:00", "09:00", "12:00", "14:00", "17:00"];
        var add = cand.filter(function (c) { return r.times.indexOf(c) < 0; })[0];
        if (add) save({ autoplanTimes: r.times.concat(add) });
      }));
    }
    row.appendChild(times);
    row.appendChild(el("p", "autoplan-explain",
      "קודם סרטון אחד בכל יום ל-" + r.days + " הימים הקרובים, ואז שני בכל יום, וכן הלאה. " +
      "אחרי השעה האחרונה ברשימה המערכת בוחרת שעה פנויה. מה שגררת בעצמך לא זז, ומה שהמערכת שיבצה לא זז ב-24 השעות שלפני הפרסום."));
    return row;
  }

  // alerts from the worker, and a loud warning when it is not running but something depends on it
  var lastAlerts = null;
  X.afterRender = function () { if (lastAlerts && X.G) X.onAlerts.apply(null, lastAlerts); };
  X.onAlerts = function (alerts, worker, armedCount) {
    lastAlerts = [alerts, worker, armedCount];
    var host = document.getElementById("ganttAlerts");
    if (!host) {
      host = el("div", "gantt-alerts"); host.id = "ganttAlerts";
      var hint = document.getElementById("hintText");
      hint.parentNode.insertBefore(host, hint);
    }
    host.innerHTML = "";
    var list = alerts.slice();
    if (armedCount && (!worker.lastRun || worker.stale)) {
      list.unshift({ level: "error", text: "יש " + armedCount + " קישורים שממתינים לעובד הרקע, והוא " + (worker.lastRun ? "לא רץ בדקות האחרונות" : "עוד לא רץ") + ". בלעדיו האוטומציות לא ייווצרו ולא יוצמדו לפוסט. בדקו את משימת content-worker ב-Supabase." });
    }
    X.G.state.items.forEach(function (it) {
      var p = it.pub;
      if (p && p.status === "scheduled" && p.scheduledFor && (it.date + "T" + (it.time || "")) !== p.scheduledFor) {
        list.push({ level: "warn", itemId: it.id, text: "'" + it.title + "' הוזז בלוח, אבל ב-Zernio הוא עדיין מתוזמן ל-" + p.scheduledFor.replace("T", " ") + ". פתחו ולחצו 'עדכון הפוסט ב-Zernio'." });
      }
    });
    // תזמון אוטומטי: מה שלא הצליח, ופוסטים שמחכים לאוטומציה (קרוב = אדום)
    var ap = X.autoplan;
    if (ap && ap.on) {
      if (ap.last && ap.last.note) list.push({ level: "error", text: ap.last.note });
      Object.keys((ap.last && ap.last.failures) || {}).forEach(function (k) {
        var id = k.replace(/^link:/, "");
        list.push({ level: "error", itemId: id, text: ap.last.failures[k].text + " (ננסה שוב בעוד שעה)" });
      });
    }
    // פוסט שחסרה לו אוטומציה: התראה מ-48 שעות לפני. ב-24 שעות לפני השרת מזיז אותו (autoplan.ts)
    // גם כשהמתג כבוי: השומר מבטל גם פוסט שתוזמן ידנית בלי אוטומציה
    ((ap && ap.last && ap.last.moved) || []).forEach(function (m) {
      if (Date.now() / 1000 - m.at > 86400 || !X.G.findItem(m.id)) return;
      list.push(m.reason
        ? { level: "error", itemId: m.id, text: "'" + m.title + "'" + (m.from ? " (" + m.from + ")" : "") + " בוטל ב-Zernio ולא יעלה: " + m.reason + ". בחר לו אוטומציה, והוא ישובץ מחדש." }
        : { level: "warn", itemId: m.id, text: "'" + m.title + "' הוזז מ-" + m.from + " כי לא חוברה לו אוטומציה בזמן. הוא שובץ מחדש ליום אחר." });
    });
    X.G.state.items.forEach(function (it) {
      if (!ap || !ap.on || !it.date || !X.needsAutomation || !X.needsAutomation(it)) return;
      var at = new Date(it.date + "T" + (it.time || "18:00") + ":00").getTime();
      if (at - Date.now() > 48 * 3600e3) return;
      var deadline = new Date(at - 24 * 3600e3);
      var when = deadline.toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" }) + " " +
        deadline.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
      list.push({ level: "error", itemId: it.id,
        text: "'" + it.title + "' (" + fmtDay(it.date) + " " + (it.time || "") + ") מחכה לאוטומציה. אם לא תבחר עד " + when + ", הוא יוזז ליום אחר. לחץ ובחר אוטומציה בחלון הפריט." });
    });
    list.forEach(function (a) {
      var row = el("div", "gantt-alert is-" + (a.level || "warn"), a.text);
      if (a.itemId && X.G.findItem(a.itemId)) {
        row.classList.add("is-link");
        row.addEventListener("click", function () { var it = X.G.findItem(a.itemId); X.G.openDayModal(it.date, it.id); });
      }
      host.appendChild(row);
    });
  };
})();
