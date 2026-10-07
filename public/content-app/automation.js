/* בנק האוטומציות: תגובה ← הודעה פרטית באינסטגרם. אוטומציה אחת, הרבה פוסטים.
   הכפתור ⚡ בראש הגאנט פותח את הבנק. בחלון של פוסט מוצגת רק שורת סטטוס. */
(function () {
  "use strict";
  var X = window.GanttExt, el = X.el, api = X.api;

  var BOLT = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M11 2.5 4.5 11h5l-1 6.5L15.5 9h-5l.5-6.5Z"/></svg>';
  var COLOR = { live: "#0ca30c", armed: "#fab219", paused: "#9b9a8f", error: "#d03b3b", active: "#0ca30c", draft: "#9b9a8f" };
  var MATCH = [["word", "מילה שלמה (מומלץ)"], ["exact", "התגובה היא בדיוק המילה"], ["contains", "בכל מקום, גם בתוך מילה"]];
  var STATUS_HE = { draft: "טיוטה", active: "פעילה", paused: "מושהית" };

  function fmtDate(d) { return d ? d.slice(8, 10) + "/" + d.slice(5, 7) : ""; }

  // ---------- צ'יפ בלוח ----------
  X.decorateAutomation = function (w, item) {
    var a = item.automation;
    if (!a) return;
    var b = el("span", "net-badge auto-badge"); b.innerHTML = BOLT;
    b.style.color = a.overdue ? COLOR.error : (COLOR[a.status] || "var(--ink-400)");
    b.title = "אוטומציה: " + (a.name || "") + " · " + (a.statusHe || a.status) + (a.overdue ? " — העובד פספס את שעת הפרסום!" : "");
    w().appendChild(b);
  };

  // ---------- בחלון של פוסט: רק סטטוס, הקישור עצמו נעשה בבנק ----------
  X.renderAutomationSlot = function (host, ctx) {
    host.innerHTML = "";
    var it = ctx.editing && X.G.findItem(ctx.editing.id);
    var a = it && it.automation;
    if (!a) return;
    var row = el("button", "auto-line"); row.type = "button";
    var ic = el("span", "net-ico"); ic.innerHTML = BOLT; ic.style.color = a.overdue ? COLOR.error : (COLOR[a.status] || "inherit");
    row.appendChild(ic);
    row.appendChild(el("span", null, "אוטומציה: " + (a.name || "") + " · " + (a.statusHe || a.status) + (a.overdue ? " — העובד פספס!" : "")));
    row.addEventListener("click", function () { openBank(a.automationId); });
    host.appendChild(row);
  };

  X.buildIgAutomation = function (wrap, item) {
    var host = el("div", "auto-host");
    X.renderAutomationSlot(host, { editing: item });
    wrap.appendChild(host);
  };

  // ---------- תצוגת צ'אט ----------
  function renderPreview(host, pv) {
    host.innerHTML = "";
    if (!pv) return;
    var phone = el("div", "chat-preview");
    phone.appendChild(el("div", "chat-head", "כך זה ייראה אצל מי שמגיב · @" + (pv.account || "")));
    pv.messages.forEach(function (m) {
      var row = el("div", "chat-row " + (m.from === "me" ? "is-me" : "is-them"));
      var bub;
      if (m.kind === "comment") { bub = el("div", "chat-comment"); bub.appendChild(el("small", null, "תגובה מתחת לפוסט")); bub.appendChild(el("div", null, m.text)); }
      else if (m.kind === "public-reply") { bub = el("div", "chat-comment is-reply"); bub.appendChild(el("small", null, "תשובה ציבורית לתגובה" + (m.note ? " · " + m.note : ""))); bub.appendChild(el("div", null, m.text)); }
      else if (m.kind === "tap") bub = el("div", "chat-tap", "לוחץ/ת: " + m.text);
      else if (m.kind === "reply") bub = el("div", "chat-tap", m.text);
      else if (m.kind === "card") {
        bub = el("div", "chat-card");
        bub.appendChild(el("strong", null, m.title));
        if (m.url) { var u = el("div", "chat-url", m.url); u.dir = "ltr"; bub.appendChild(u); }
        (m.buttons || []).forEach(function (t) { bub.appendChild(el("div", "chat-btn", t)); });
      } else {
        bub = el("div", "chat-bubble");
        if (m.note) bub.appendChild(el("small", "chat-note", m.note));
        bub.appendChild(el("div", "chat-text", m.text || "—"));
        (m.buttons || []).forEach(function (t) { if (t) bub.appendChild(el("div", "chat-btn", t)); });
      }
      row.appendChild(bub);
      phone.appendChild(row);
    });
    host.appendChild(phone);
  }

  function renderChecks(host, v, onAlt) {
    host.innerHTML = "";
    if (v.errors && v.errors.length) {
      var b = el("div", "val-block is-error"); b.appendChild(el("strong", null, "חוסם הפעלה:"));
      var ul = el("ul"); v.errors.forEach(function (e) { ul.appendChild(el("li", null, e)); }); b.appendChild(ul); host.appendChild(b);
    }
    if (v.warnings && v.warnings.length) {
      var w = el("div", "val-block is-warn auto-warn-big"); w.appendChild(el("strong", null, "אזהרה:"));
      var ul2 = el("ul"); v.warnings.forEach(function (e) { ul2.appendChild(el("li", null, e)); }); w.appendChild(ul2);
      if (v.alternatives && v.alternatives.length && onAlt) {
        w.appendChild(el("div", "auto-alt-title", "שתי חלופות (טיוטה — ערכו כרצונכם):"));
        v.alternatives.slice(0, 2).forEach(function (alt) {
          var bt = X.btn("'" + alt.keyword + "' · " + (alt.matchMode === "exact" ? "בדיוק" : "מילה שלמה"), "btn-ghost btn-small", function () { onAlt(alt); });
          var r = el("div", "auto-alt"); r.appendChild(bt); r.appendChild(el("span", null, alt.why)); w.appendChild(r);
        });
      }
      host.appendChild(w);
    }
    if (!(v.errors && v.errors.length) && !(v.warnings && v.warnings.length)) host.appendChild(el("p", "val-ok", "✓ עובר את כל כללי הבטיחות · הלינק נטען · link tracking כבוי"));
  }

  function renderAudit(host, r) {
    host.innerHTML = "";
    if (!r || !r.at) return;
    var box = el("div", "val-block " + (r.pass ? "audit-pass" : "is-error"));
    box.appendChild(el("strong", null, r.pass ? "✓ בדיקת תקינות עברה" : "✗ בדיקת תקינות נכשלה"));
    var ul = el("ul");
    (r.fails || []).forEach(function (f) { ul.appendChild(el("li", "audit-fail", f)); });
    (r.warns || []).forEach(function (f) { ul.appendChild(el("li", "audit-warn", f)); });
    (r.oks || []).forEach(function (f) { ul.appendChild(el("li", "audit-ok", f)); });
    box.appendChild(ul);
    box.appendChild(el("small", null, "נבדק " + new Date(r.at * 1000).toLocaleString("he-IL")));
    host.appendChild(box);
  }
  X.renderAuditButton = function (host) {
    host.appendChild(el("label", "field-label", "בדיקת תקינות אוטומציות"));
    host.appendChild(el("p", "settings-intro", "משווה בין מה ששמור כאן למה שחי ב-Zernio: אוטומציות שלא צמודות לפוסט, מילים קצרות ב-contains, התנגשויות כפתורים, link tracking, workflow חסר. קריאה בלבד."));
    var out = el("div");
    host.appendChild(X.btn("הרצת בדיקה", "btn-ghost btn-small", function (e) {
      var b = e.currentTarget; b.disabled = true; b.textContent = "בודק…";
      api("POST", "/api/health", {}).then(function (r) { renderAudit(out, r); b.disabled = false; b.textContent = "הרצה שוב"; })
        .catch(function (er) { out.textContent = er.message; b.disabled = false; });
    }));
    host.appendChild(out);
    api("GET", "/api/health").then(function (r) { renderAudit(out, r); });
  };

  // ---------- מסך אישור משותף ----------
  function confirmScreen(title, url, body, extra) {
    var m = X.modal(title, { wide: true, sticky: true });
    var wait = el("p", "settings-intro", "בודק…"); m.body.appendChild(wait);
    api("POST", url, body || {}).then(function (r) {
      wait.remove();
      if (r.blocked) {
        renderChecks(m.body, r.validation);
        m.body.appendChild(X.btn("סגירה", "btn-ghost", function () { m.close(); }));
        return;
      }
      m.body.appendChild(el("p", "settings-intro", r.summary.text));
      if (r.validation) { var vh = el("div"); renderChecks(vh, r.validation); m.body.appendChild(vh); }
      if (r.summary.preview) { var p = el("div"); renderPreview(p, r.summary.preview); m.body.appendChild(p); }
      if (r.requests && r.requests.length) {
        var det = el("details", "req-details"); det.appendChild(el("summary", null, "הבקשות המדויקות שיישלחו ל-Zernio"));
        var pre = el("pre", "dry-run"); pre.dir = "ltr"; pre.textContent = JSON.stringify(r.requests, null, 2); det.appendChild(pre);
        det.appendChild(el("p", "field-hint-start", "__ZERNIO_API_KEY__ מוחלף במפתח רק ברגע השליחה, ורק בכותרת של צמתי ה-webhook (ככה הסקיל שולח כפתורים באינסטגרם). המפתח לא נשמר בשום מקום."));
        m.body.appendChild(det);
      }
      X.runConfirm(m, r.actionId, { confirmText: (extra && extra.confirmText) || "אשר", onDone: function (res) {
        if (res && res.audit) { var ah = el("div"); renderAudit(ah, res.audit); m.body.appendChild(ah); }
        X.refreshServerView();
        if (extra && extra.onDone) extra.onDone(res);
      } });
    }).catch(function (e) { wait.remove(); m.body.appendChild(el("p", "val-block is-error", e.message)); });
  }

  // ---------- הבנק ----------
  var bankModal = null;
  function openBank(focusId) {
    // בתוך ה-CRM לבנק יש עמוד משלו בתפריט
    if (X.inCrm && X.view !== "automations") {
      X.navigate("/content/automations" + (focusId ? "?id=" + encodeURIComponent(focusId) : ""));
      return;
    }
    if (X.view === "automations") {
      if (!bankModal) {
        var host = document.getElementById("bankPage");
        var title = el("h2", "bank-page-title", "בנק אוטומציות");
        var body = el("div");
        host.appendChild(title); host.appendChild(body);
        bankModal = { body: body, title: title, close: function () {} };
      }
    } else {
      if (bankModal) bankModal.close();
      bankModal = X.modal("בנק אוטומציות", { wide: true, onClose: function () { bankModal = null; } });
    }
    if (focusId) openEditor(focusId); else renderList();
  }
  X.openBank = openBank;

  function renderList() {
    var b = bankModal.body; b.innerHTML = "";
    bankModal.title.textContent = "בנק אוטומציות";
    var head = el("div", "bank-head");
    head.appendChild(el("p", "settings-intro", "יוצרים אוטומציה פעם אחת ומקשרים אותה לכמה פוסטים. לכל פוסט אפשר לקשר אוטומציה אחת."));
    head.appendChild(X.btn("+ אוטומציה חדשה", "btn-primary btn-small", function () {
      api("POST", "/api/bank", {}).then(function (a) { openEditor(a.id); });
    }));
    b.appendChild(head);
    var list = el("div", "bank-list"); b.appendChild(list);
    list.appendChild(el("p", "settings-intro", "טוען…"));
    api("GET", "/api/bank").then(function (rows) {
      list.innerHTML = "";
      if (!rows.length) { list.appendChild(el("p", "settings-intro", "עוד אין אוטומציות. צרו את הראשונה.")); return; }
      rows.forEach(function (a) {
        var row = el("button", "bank-row"); row.type = "button";
        var ic = el("span", "net-ico"); ic.innerHTML = BOLT; ic.style.color = COLOR[a.status] || "inherit"; row.appendChild(ic);
        var txt = el("div", "bank-row-text");
        txt.appendChild(el("strong", null, a.name));
        var desc = (a.trigger_mode === "any" ? "כל תגובה" : "מילה: " + (a.keyword || "—")) + " · כפתור: " + (a.button_title || "—") +
          (a.gate_enabled ? " · בקשת עוקב" : "") + (a.email_enabled ? " · איסוף מייל" : "") + (a.link_enabled ? " · לינק" : "");
        txt.appendChild(el("span", "mu", desc));
        row.appendChild(txt);
        var live = a.links.filter(function (l) { return l.status === "live"; }).length;
        var armed = a.links.filter(function (l) { return l.status === "armed"; }).length;
        var pill = el("span", "bank-pill", a.links.length ? (a.links.length + " פוסטים" + (live ? " · " + live + " פעילים" : "") + (armed ? " · " + armed + " ממתינים" : "")) : (STATUS_HE[a.status] || a.status));
        row.appendChild(pill);
        if (a.dirty) row.appendChild(el("span", "bank-pill is-warn", "שינויים שלא נשלחו"));
        row.addEventListener("click", function () { openEditor(a.id); });
        list.appendChild(row);
      });
    }).catch(function (e) { list.innerHTML = ""; list.appendChild(el("p", "val-block is-error", e.message)); });
  }

  function openEditor(id) {
    var b = bankModal.body; b.innerHTML = "";
    b.appendChild(el("p", "settings-intro", "טוען…"));
    api("GET", "/api/bank").then(function (rows) {
      var a = rows.filter(function (r) { return r.id === id; })[0];
      if (!a) { renderList(); return; }
      buildEditor(a);
    });
  }

  function buildEditor(a) {
    var b = bankModal.body; b.innerHTML = "";
    bankModal.title.textContent = a.name;
    var hasLinks = a.links.length > 0;
    var back = X.btn("→ כל האוטומציות", "btn-ghost btn-small", function () { renderList(); });
    b.appendChild(back);

    var d = {};
    ["name", "trigger_mode", "keyword", "match_mode", "gate_enabled", "verify_text", "verify_button", "gate_text", "dm1_text", "button_title",
      "email_enabled", "email_ask_text", "email_invalid_text", "email_thanks_text", "link_enabled", "link", "link_text", "link_card_title",
      "link_button_title", "closing_text", "comment_reply"].forEach(function (k) { d[k] = a[k]; });
    var saveT = null, saving = null;
    function dirty() { clearTimeout(saveT); saveT = setTimeout(save, 500); }
    function save() {
      clearTimeout(saveT);
      saving = api("PUT", "/api/bank/" + a.id, d).then(function (r) { a = Object.assign(a, r); statusLine(); return r; });
      return saving;
    }

    var top = el("div", "bank-top");
    var nameIn = el("input", "text-input bank-name"); nameIn.value = d.name || "";
    nameIn.addEventListener("input", function () { d.name = nameIn.value; bankModal.title.textContent = nameIn.value; dirty(); });
    top.appendChild(nameIn);
    var st = el("span", "bank-pill"); top.appendChild(st);
    b.appendChild(top);
    function statusLine() {
      var live = a.links.filter(function (l) { return l.status === "live"; }).length;
      st.textContent = (STATUS_HE[a.status] || a.status) + (live ? " ב-" + live + " פוסטים" : "");
      st.style.color = COLOR[a.status] || "";
    }
    statusLine();

    function sec(t) { var s = el("div", "bank-sec", t); b.appendChild(s); }
    function field(lab, input, hint) {
      var w = el("div", "auto-field"); w.appendChild(el("label", "field-label", lab)); w.appendChild(input);
      if (hint) w.appendChild(el("p", "field-hint-start", hint));
      return w;
    }
    function txt(key, opts) {
      opts = opts || {};
      var i = el(opts.area ? "textarea" : "input", "text-input" + (opts.area ? " textarea" : ""));
      if (opts.area) i.rows = opts.rows || 3;
      i.value = d[key] || ""; if (opts.placeholder) i.placeholder = opts.placeholder; if (opts.dir) i.dir = opts.dir;
      i.addEventListener("input", function () { d[key] = i.value; dirty(); if (opts.max) cnt(); });
      if (!opts.max) return i;
      var wrap = el("div"); wrap.appendChild(i);
      var c = el("p", "field-hint");
      function cnt() { var n = i.value.length; c.textContent = n + " / " + opts.max + (opts.max === 20 ? " (אימוג'י = 2)" : ""); c.style.color = n > opts.max ? "var(--danger)" : ""; }
      cnt(); wrap.appendChild(c);
      return wrap;
    }
    function toggle(key, label, onChange) {
      var t = el("label", "sw-row");
      var i = el("input"); i.type = "checkbox"; i.className = "sw-input"; i.checked = !!d[key];
      var knob = el("span", "sw"); t.appendChild(i); t.appendChild(knob); t.appendChild(el("span", null, label));
      i.addEventListener("change", function () { d[key] = i.checked; dirty(); onChange(i.checked); });
      return t;
    }
    function stepBox(n, title, previewFn) {
      var row = el("div", "step");
      row.appendChild(el("div", "step-n", String(n)));
      var mid = el("div", "step-body"); mid.appendChild(el("div", "step-title", title));
      row.appendChild(mid);
      var pv = el("div", "step-pv"); row.appendChild(pv);
      b.appendChild(row);
      return { body: mid, pv: pv };
    }

    sec("מה קורה, שלב אחרי שלב");

    // 1 — טריגר
    var s1 = stepBox(1, "מישהו מגיב מתחת לפוסט");
    var seg = el("div", "segmented seg-small");
    var kwWrap = el("div");
    [["keyword", "מילת מפתח"], ["any", "כל תגובה"]].forEach(function (o) {
      var bt = el("button", "seg-btn", o[1]); bt.type = "button";
      bt.classList.toggle("is-active", (d.trigger_mode || "keyword") === o[0]);
      bt.addEventListener("click", function () {
        d.trigger_mode = o[0]; dirty();
        seg.querySelectorAll(".seg-btn").forEach(function (x) { x.classList.remove("is-active"); }); bt.classList.add("is-active");
        kwWrap.style.display = o[0] === "any" ? "none" : "";
        anyNote.style.display = o[0] === "any" ? "" : "none";
      });
      seg.appendChild(bt);
    });
    s1.body.appendChild(seg);
    var kwIn = txt("keyword", { placeholder: "למשל: מדריך" });
    kwWrap.appendChild(field("מילת מפתח (אפשר כמה, מופרדות בפסיק)", kwIn));
    var mm = el("select", "text-input"); MATCH.forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; mm.appendChild(op); });
    mm.value = d.match_mode || "word"; mm.addEventListener("change", function () { d.match_mode = mm.value; dirty(); });
    kwWrap.appendChild(field("סוג התאמה", mm, "'בכל מקום' מותר רק למילה של 5 תווים ומעלה."));
    s1.body.appendChild(kwWrap);
    var anyNote = el("p", "val-block is-warn", "כל מי שמגיב על הפוסטים המקושרים ייכנס לאוטומציה — גם מי שכתב 'וואו' או שאלה.");
    s1.body.appendChild(anyNote);
    kwWrap.style.display = d.trigger_mode === "any" ? "none" : "";
    anyNote.style.display = d.trigger_mode === "any" ? "" : "none";
    s1.body.appendChild(field("תשובות ציבוריות לתגובה (לא חובה)", replyList(),
      "כל מגיב מקבל אחת מהן בהגרלה, כך שהתגובות מתחת לפוסט לא נראות כמו העתק-הדבק."));

    // התשובות נשמרות בשדה אחד, אחת בכל שורה
    function replyList() {
      var host = el("div", "reply-list");
      var rows = String(d.comment_reply || "").split("\n").filter(function (r) { return r.trim(); });
      if (!rows.length) rows = [""];
      function sync() { d.comment_reply = rows.map(function (r) { return r.replace(/\n/g, " ").trim(); }).filter(Boolean).join("\n"); dirty(); }
      function draw() {
        host.innerHTML = "";
        rows.forEach(function (r, i) {
          var row = el("div", "reply-row");
          var inp = el("input", "text-input"); inp.value = r;
          inp.placeholder = ["למשל: שלחתי לך בפרטי 📩", "אצלך ב-DM 👀", "שלחתי, תבדוק בהודעות 🙌"][i] || "עוד נוסח";
          inp.addEventListener("input", function () { rows[i] = inp.value; sync(); });
          row.appendChild(inp);
          if (rows.length > 1) row.appendChild(X.btn("✕", "btn-ghost btn-small", function () { rows.splice(i, 1); sync(); draw(); }));
          host.appendChild(row);
        });
        if (rows.length < 10) host.appendChild(X.btn("+ תשובה נוספת", "btn-ghost btn-small", function () {
          rows.push(""); draw(); var ins = host.querySelectorAll("input"); ins[ins.length - 1].focus();
        }));
      }
      draw();
      return host;
    }

    // 2 — בקשת עוקב
    var s2 = stepBox(2, "בקשת עוקב — רק למי שלא עוקב");
    var gateBody = el("div");
    s2.body.appendChild(toggle("gate_enabled", "פעיל", function (on) { gateBody.style.display = on ? "" : "none"; }));
    gateBody.appendChild(el("p", "field-hint-start", "אינסטגרם מגלה אם מישהו עוקב רק אחרי שהוא שלח לך הודעה. עוקב שכבר כתב לך מדלג ישר לשלב 3. מגיב חדש מקבל קודם הודעת אימות עם כפתור — הלחיצה שלו מאפשרת את הבדיקה."));
    gateBody.appendChild(field("הודעת אימות (למי שלא ידוע אם עוקב)", txt("verify_text", { area: true, placeholder: "שנייה, מוודא שזה מגיע אליך 🙌 לחץ למטה" })));
    gateBody.appendChild(field("כפתור האימות", txt("verify_button", { placeholder: "שלח לי", max: 20 })));
    gateBody.appendChild(field("בקשת עוקב (למי שהבדיקה מצאה שלא עוקב)", txt("gate_text", { area: true, placeholder: "רק לעוקבים… עקוב ולחץ שוב. ואם זה לא יעזור לך — תוריד עוקב בכיף 🙂" }),
      "הכפתור של האימות מצורף אליה, כדי שיוכל לבדוק שוב אחרי שעקב."));
    gateBody.style.display = d.gate_enabled ? "" : "none";
    s2.body.appendChild(gateBody);

    // 3 — הודעה וכפתור
    var s3 = stepBox(3, "הודעה פרטית עם כפתור");
    s3.body.appendChild(field("הודעה ראשונה", txt("dm1_text", { area: true, placeholder: "ההודעה נותנת, לא מבקשת. למשל: הנה זה, כמו שהבטחתי 🙌", max: 640 })));
    s3.body.appendChild(field("טקסט הכפתור", txt("button_title", { placeholder: "👈 לתרגיל המלא", max: 20 })));

    // 4 — מייל ולינק
    var s4 = stepBox(4, "אחרי הלחיצה: מייל ו/או לינק");
    var emailBody = el("div");
    s4.body.appendChild(toggle("email_enabled", "לבקש מייל (נאסף לרשימה ולאנשי הקשר ב-CRM)", function (on) { emailBody.style.display = on ? "" : "none"; }));
    emailBody.appendChild(field("הודעה שמבקשת את המייל", txt("email_ask_text", { area: true, rows: 2, placeholder: "לאיזה מייל לשלוח לך את השיעור?" })));
    emailBody.appendChild(field("אם זה לא נראה כמו מייל", txt("email_invalid_text", { area: true, rows: 2, placeholder: "נראה שזה לא מייל — אפשר לשלוח שוב?" })));
    emailBody.appendChild(field("תודה אחרי המייל", txt("email_thanks_text", { area: true, rows: 2, placeholder: "קיבלתי! השיעור בדרך למייל שלך 💌" })));
    emailBody.style.display = d.email_enabled ? "" : "none";
    s4.body.appendChild(emailBody);
    var linkBody = el("div");
    s4.body.appendChild(toggle("link_enabled", "לשלוח לינק", function (on) { linkBody.style.display = on ? "" : "none"; }));
    linkBody.appendChild(field("לינק", txt("link", { placeholder: "https://…", dir: "ltr" })));
    linkBody.appendChild(field("הודעה עם הלינק", txt("link_text", { area: true, rows: 2, placeholder: "יאללה, זה שלך 👇" })));
    linkBody.appendChild(field("כותרת כרטיס הלינק", txt("link_card_title", { placeholder: "שם המדריך", max: 80 })));
    linkBody.appendChild(field("כפתור הלינק", txt("link_button_title", { placeholder: "פתיחה", max: 20 })));
    linkBody.appendChild(field("הודעת סיום", txt("closing_text", { area: true, rows: 2, placeholder: "נתקעת או שיש שאלה? כתבו לי כאן ❤️" }), "ההודעה האחרונה פותחת שיחה, לא רק מוסרת לינק."));
    linkBody.style.display = d.link_enabled ? "" : "none";
    s4.body.appendChild(linkBody);

    // בדיקה + תצוגה
    var checks = el("div", "auto-checks"); var pv = el("div");
    var acts = el("div", "schedule-helper-actions bank-actions");
    function applyAlt(alt) { d.keyword = alt.keyword; d.match_mode = alt.matchMode; kwIn.value = alt.keyword; mm.value = alt.matchMode; dirty(); }
    acts.appendChild(X.btn("בדיקה ותצוגה מקדימה", "btn-ghost btn-small", function () {
      save().then(function () { return api("POST", "/api/bank/" + a.id + "/validate", {}); })
        .then(function (v) { renderChecks(checks, v, applyAlt); renderPreview(pv, v.preview); })
        .catch(function (e) { checks.textContent = e.message; });
    }));
    if (a.zernio_workflow_id) acts.appendChild(X.btn("שליחת השינויים לכל הפוסטים", "btn-primary btn-small", function () {
      save().then(function () { confirmScreen("עדכון האוטומציה בכל הפוסטים", "/api/bank/" + a.id + "/update/plan", {}, { confirmText: "אשר ועדכן", onDone: function () { openEditor(a.id); } }); });
    }));
    if (a.status === "active") acts.appendChild(X.btn("השהיה בכל הפוסטים", "btn-ghost btn-small", function () {
      confirmScreen("השהיית האוטומציה", "/api/bank/" + a.id + "/pause/plan", {}, { onDone: function () { openEditor(a.id); } });
    }));
    if (a.status === "paused") acts.appendChild(X.btn("חידוש", "btn-ghost btn-small", function () {
      confirmScreen("חידוש האוטומציה", "/api/bank/" + a.id + "/resume/plan", {}, { onDone: function () { openEditor(a.id); } });
    }));
    if (!hasLinks) acts.appendChild(X.btn("מחיקה", "btn-danger-ghost btn-small", function () {
      confirmScreen("מחיקת האוטומציה", "/api/bank/" + a.id + "/delete/plan", {}, { confirmText: "אשר מחיקה", onDone: function () { renderList(); } });
    }));
    b.appendChild(acts);
    if (a.dirty) b.appendChild(el("p", "val-block is-warn", "יש שינויים שעוד לא נשלחו ל-Zernio — הפוסטים המקושרים עדיין עובדים לפי הנוסח הקודם."));
    b.appendChild(checks); b.appendChild(pv);

    // פוסטים מקושרים
    sec("פוסטים שהאוטומציה מקושרת אליהם");
    var linksHost = el("div"); b.appendChild(linksHost);
    a.links.forEach(function (l) {
      var row = el("div", "bank-link");
      var dot = el("span", "pub-dot"); dot.style.background = COLOR[l.status] || "var(--ink-400)"; row.appendChild(dot);
      var it = l.item || {};
      var t = el("button", "bank-link-title", fmtDate(it.date) + " · " + (it.title || l.itemId)); t.type = "button";
      t.addEventListener("click", function () {
        if (X.view === "automations") { X.navigate("/content?item=" + encodeURIComponent(l.itemId)); return; }
        bankModal.close(); if (it.date) X.G.openDayModal(it.date, l.itemId);
      });
      row.appendChild(t);
      var s = l.stats || {};
      row.appendChild(el("span", "mu", l.stats ? ("הגיבו " + (s.comments || 0) + " · קיבלו הודעה " + (s.dmsSent || 0)) : (l.status === "armed" ? "תיווצר בזמן הפרסום" : "")));
      row.appendChild(el("span", "bank-pill", l.statusHe));
      row.appendChild(X.btn("ניתוק", "btn-ghost btn-small", function () {
        confirmScreen("ניתוק האוטומציה מהפוסט", "/api/links/" + l.id + "/unlink/plan", {}, { confirmText: "אשר ניתוק", onDone: function () { openEditor(a.id); } });
      }));
      linksHost.appendChild(row);
      if (l.lastError) linksHost.appendChild(el("div", "pub-error", l.lastError));
    });
    var picker = el("div", "bank-picker");
    linksHost.appendChild(X.btn("+ קישור לפוסט", "btn-ghost btn-small", function () {
      picker.innerHTML = ""; picker.appendChild(el("p", "settings-intro", "טוען פוסטים…"));
      api("GET", "/api/bank/candidates").then(function (rows) {
        picker.innerHTML = "";
        var free = rows.filter(function (r) { return !r.linkedTo; });
        if (!free.length) { picker.appendChild(el("p", "settings-intro", "אין פוסט אינסטגרם פנוי: צריך פוסט שכבר עלה, או שתוזמן לאינסטגרם מהגאנט, ושאין לו אוטומציה.")); return; }
        free.slice(0, 60).forEach(function (r) {
          var bt = el("button", "bank-cand"); bt.type = "button";
          bt.appendChild(el("span", null, fmtDate(r.date) + (r.time ? " " + r.time : "") + " · " + (r.title || r.itemId)));
          bt.appendChild(el("span", "bank-pill", r.state === "scheduled" ? "מתוזמן" : "עלה"));
          bt.addEventListener("click", function () {
            save().then(function () {
              confirmScreen("קישור האוטומציה לפוסט", "/api/bank/" + a.id + "/link/plan", { itemId: r.itemId }, { confirmText: r.state === "scheduled" ? "אשר — שמור כממתין" : "אשר והפעל", onDone: function () { openEditor(a.id); } });
            });
          });
          picker.appendChild(bt);
        });
      }).catch(function (e) { picker.innerHTML = ""; picker.appendChild(el("p", "val-block is-error", e.message)); });
    }));
    linksHost.appendChild(picker);

    // מספרים ומיילים
    sec("מה עבד");
    var statsHost = el("div"); b.appendChild(statsHost);
    function renderStats(s) {
      statsHost.innerHTML = "";
      if (!s) { statsHost.appendChild(el("p", "field-hint-start", "עוד אין מספרים. העובד מעדכן כל 15 דקות.")); return; }
      var grid = el("div", "ig-stats-grid");
      [["הגיבו", s.comments], ["קיבלו הודעה", s.dmsSent], ["לחצו על הכפתור", s.taps], ["נתנו מייל", s.emails], ["קיבלו לינק", s.linksSent]].forEach(function (t) {
        var tile = el("div", "ig-stat-tile");
        tile.appendChild(el("span", "ig-stat-value", t[1] == null ? "—" : String(t[1])));
        tile.appendChild(el("span", "ig-stat-label", t[0]));
        grid.appendChild(tile);
      });
      statsHost.appendChild(grid);
    }
    renderStats(a.stats);
    if (a.zernio_workflow_id) statsHost.appendChild(X.btn("רענון מספרים", "btn-ghost btn-small", function (e) {
      var bt = e.currentTarget; bt.disabled = true;
      api("POST", "/api/bank/" + a.id + "/stats", {}).then(function (r) { renderStats(r.stats); loadEmails(); }).catch(function (er) { X.G.showToast(er.message); bt.disabled = false; });
    }));
    var emailsHost = el("div", "bank-emails"); b.appendChild(emailsHost);
    function loadEmails() {
      if (!d.email_enabled && !a.email_enabled) { emailsHost.innerHTML = ""; return; }
      api("GET", "/api/bank/" + a.id + "/emails").then(function (rows) {
        emailsHost.innerHTML = "";
        var h = el("div", "bank-emails-head");
        h.appendChild(el("strong", null, "מיילים שנאספו (" + rows.length + ")"));
        if (rows.length) { var dl = el("a", "btn btn-ghost btn-small", "הורדה כקובץ CSV"); dl.href = "/api/content/bank/" + a.id + "/emails?format=csv"; h.appendChild(dl); }
        emailsHost.appendChild(h);
        emailsHost.appendChild(el("p", "field-hint-start", "כל מייל נכנס גם לאנשי הקשר ב-CRM, עם התגיות 'אינסטגרם' ו'אוטומציה: " + a.name + "'."));
        rows.slice(0, 50).forEach(function (r) {
          var row = el("div", "admin-log-row"); var e = el("span", null, r.email); e.dir = "ltr"; row.appendChild(e);
          row.appendChild(el("span", "admin-log-time", new Date(r.collected_at).toLocaleString("he-IL")));
          emailsHost.appendChild(row);
        });
      });
    }
    loadEmails();

    var lim = el("details", "auto-limits");
    lim.appendChild(el("summary", null, "מגבלות שחשוב לדעת"));
    ["כל תגובה מקבלת הודעה פרטית אחת בלבד, לנצח. בדקו מחשבון אחר לפני שמפרסמים לקהל.",
     "תגובות שנכתבו לפני שהאוטומציה קיימת לא יקבלו הודעה.",
     "התגובה שלכם על הפוסט של עצמכם לא מפעילה כלום — בודקים מחשבון אחר.",
     "לפוסט מתוזמן: עובד הרקע יוצר את האוטומציה 3 דקות לפני הפרסום ומצמיד אותה ברגע שהוא עולה. אם משהו משתבש — היא מושהית ותופיע התראה.",
     "רק אינסטגרם: בטיקטוק זה לא אפשרי, ביוטיוב אין הודעות פרטיות.",
     "Link tracking כבוי תמיד — עטיפת הפניה בהודעות נקראת כספאם."].forEach(function (t) { lim.appendChild(el("p", "field-hint-start", t)); });
    b.appendChild(lim);
  }

  X.hooks.push(function () {
    if (X.view === "automations") {
      var host = el("div", "bank-page"); host.id = "bankPage";
      var app = document.querySelector(".app");
      app.appendChild(host);
      openBank(new URLSearchParams(location.search).get("id"));
      return;
    }
    // בתוך ה-CRM יש לבנק פריט בתפריט; מחוץ לו — כפתור
    if (!X.inCrm) X.headerButton("בנק אוטומציות", BOLT, function () { openBank(); });
  });
})();
