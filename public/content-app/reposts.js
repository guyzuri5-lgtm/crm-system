/*
 * העלאות חוזרות — הקטע במסך ניתוח הרילז (גיא, 14.11.2026).
 * הכללים נשמרים בהגדרות (PATCH /api/content/settings, המפתח reposts), והשרת מנרמל אותם
 * (src/lib/content/pure/reposts.ts). הרשימה: GET /api/content/reposts — העלאות שכבר בגאנט ועוד לא עלו.
 */
(function () {
  "use strict";
  var form = document.getElementById("rpForm");
  if (!form) return;

  var $ = function (id) { return document.getElementById(id); };
  var thrEl = $("rpThr"), afterEl = $("rpAfter"), unitEl = $("rpUnit"), repEl = $("rpRep");
  var saveEl = $("rpSave"), resetEl = $("rpReset"), statusEl = $("rpStatus"), errorEl = $("rpError");
  var sentenceEl = $("rpSentence"), listEl = $("rpList"), countEl = $("rpCount");
  var MAX_AFTER = { days: 365, weeks: 52, months: 12 };
  var MONTHS = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];
  var saved = null;
  var busy = false;
  var loaded = false;

  function fmt(n) { return Number(n).toLocaleString("he-IL"); }
  function unitWord(n, u) {
    if (u === "months") return n === 1 ? "חודש" : n === 2 ? "חודשיים" : n + " חודשים";
    if (u === "weeks") return n === 1 ? "שבוע" : n === 2 ? "שבועיים" : n + " שבועות";
    return n === 1 ? "יום" : n === 2 ? "יומיים" : n + " ימים";
  }
  function dmy(key) {
    var p = String(key || "").slice(0, 10).split("-");
    return p.length === 3 ? Number(p[2]) + "." + Number(p[1]) + "." + p[0].slice(2) : "";
  }

  function draft() {
    return { threshold: thrEl.value.trim(), after: afterEl.value.trim(), unit: unitEl.value, repeatThreshold: repEl.value.trim() };
  }

  // אותה בדיקה כמו normalizeRepostRules בשרת, אבל מסבירה במקום לתקן בשקט
  function check(d) {
    var thr = Number(d.threshold), after = Number(d.after), rep = Number(d.repeatThreshold);
    var max = MAX_AFTER[d.unit] || 12;
    if (!/^\d+$/.test(d.threshold) || thr < 100) return { field: thrEl, text: "הסף צריך להיות מספר שלם, 100 צפיות לפחות." };
    if (!/^\d+$/.test(d.after) || after < 1 || after > max) return { field: afterEl, text: "הזמן עד ההעלאה צריך להיות בין 1 ל-" + max + " " + (d.unit === "months" ? "חודשים" : d.unit === "weeks" ? "שבועות" : "ימים") + "." };
    if (!/^\d+$/.test(d.repeatThreshold) || rep < thr) return { field: repEl, text: "הסף להעלאה נוספת צריך להיות לפחות כמו הסף הראשון (" + fmt(thr) + ")." };
    return null;
  }

  function same(d, s) {
    return s && Number(d.threshold) === s.threshold && Number(d.after) === s.after && d.unit === s.unit && Number(d.repeatThreshold) === s.repeatThreshold;
  }

  function update() {
    var d = draft();
    var err = check(d);
    [thrEl, afterEl, repEl].forEach(function (f) { f.removeAttribute("aria-invalid"); });
    afterEl.max = String(MAX_AFTER[d.unit] || 12);
    if (err) {
      err.field.setAttribute("aria-invalid", "true");
      errorEl.textContent = err.text;
      errorEl.hidden = false;
      sentenceEl.textContent = "תקן את השדה המסומן כדי לראות את הכלל.";
    } else {
      errorEl.hidden = true;
      sentenceEl.textContent = "ריל שעובר " + fmt(d.threshold) + " צפיות יעלה שוב " + unitWord(Number(d.after), d.unit) +
        " אחרי שעלה, באותה שעה. אם גם ההעלאה החוזרת תעבור " + fmt(d.repeatThreshold) + " צפיות, הוא יעלה פעם נוספת.";
    }
    var dirty = !same(d, saved);
    saveEl.disabled = busy || !dirty || Boolean(err);
    resetEl.hidden = !dirty;
  }

  function fill(r) {
    thrEl.value = String(r.threshold);
    afterEl.value = String(r.after);
    unitEl.value = r.unit;
    repEl.value = String(r.repeatThreshold);
    update();
  }

  function setStatus(text, isError) {
    statusEl.textContent = text || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function renderList(items) {
    listEl.innerHTML = "";
    countEl.textContent = items.length ? items.length + " העלאות" : "";
    if (!items.length) {
      var e = document.createElement("li");
      e.className = "rp-empty";
      e.textContent = "אין כרגע העלאות חוזרות שמחכות. כשריל יעבור את הסף, הוא ייכנס לכאן ולגאנט.";
      listEl.appendChild(e);
      return;
    }
    items.forEach(function (it) {
      var li = document.createElement("li");
      li.className = "rp-item";
      var date = document.createElement("span");
      date.className = "rp-date";
      var p = String(it.date || "").split("-");
      var b = document.createElement("b");
      b.textContent = p.length === 3 ? String(Number(p[2])) : "—";
      var m = document.createElement("span");
      m.textContent = p.length === 3 ? MONTHS[Number(p[1]) - 1] : "";
      date.appendChild(b); date.appendChild(m);
      // לקורא מסך: התאריך המלא במקום "22 / דצמ׳"
      date.setAttribute("aria-label", p.length === 3 ? dmy(it.date) + (it.time ? " בשעה " + it.time : "") : "בלי תאריך");
      b.setAttribute("aria-hidden", "true"); m.setAttribute("aria-hidden", "true");
      var what = document.createElement("span");
      what.className = "rp-what";
      var t = document.createElement("b");
      t.textContent = it.title || "ללא כותרת";
      var f = document.createElement("span");
      f.textContent = [it.time || null, it.views != null ? fmt(it.views) + " צפיות" : null,
        it.publishedAt ? "עלה במקור ב-" + dmy(it.publishedAt) : null,
        it.generation > 1 ? "העלאה מס׳ " + (it.generation + 1) : null,
        it.status === "scheduled" ? "מתוזמן" : "עוד לא מתוזמן"].filter(Boolean).join(" · ");
      what.appendChild(t); what.appendChild(f);
      li.appendChild(date); li.appendChild(what);
      listEl.appendChild(li);
    });
  }

  function load() {
    if (busy) return;
    fetch("/api/content/reposts", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        loaded = true;
        saved = j.rules;
        // לא דורסים מה שגיא באמצע להקליד
        if (!form.contains(document.activeElement)) fill(saved); else update();
        renderList(j.upcoming || []);
      })
      .catch(function () { setStatus("לא הצלחתי לטעון את הכללים. נסה לרענן את העמוד.", true); });
  }

  [thrEl, afterEl, repEl].forEach(function (f) { f.addEventListener("input", function () { setStatus(""); update(); }); });
  unitEl.addEventListener("change", function () { setStatus(""); update(); });

  resetEl.addEventListener("click", function () {
    if (saved) fill(saved);
    setStatus("");
    thrEl.focus();
  });

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var d = draft();
    var err = check(d);
    if (err) { update(); err.field.focus(); return; }
    busy = true;
    update();
    setStatus("שומר…");
    fetch("/api/content/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", "X-Gantt": "1" },
      body: JSON.stringify({ reposts: { threshold: Number(d.threshold), after: Number(d.after), unit: d.unit, repeatThreshold: Number(d.repeatThreshold) } })
    })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (s) {
        busy = false;
        saved = s.reposts;
        fill(saved);
        setStatus("הכללים נשמרו. הם יחולו מהבדיקה היומית הבאה.");
      })
      .catch(function () {
        busy = false;
        update();
        setStatus("השמירה נכשלה. הכללים הקודמים עדיין בתוקף. נסה שוב.", true);
      });
  });

  // נטען כשעוברים למסך הניתוח (ובטעינה, אם נפתח ישר עליו)
  var tab = $("tabAnalytics");
  if (tab) tab.addEventListener("click", function () { if (!loaded) load(); });
  var view = $("analyticsView");
  if (view && view.classList.contains("is-active")) load();
  else if (/[?&]view=reels\b/.test(location.search)) load();
  update();
})();
