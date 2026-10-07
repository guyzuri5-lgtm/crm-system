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
