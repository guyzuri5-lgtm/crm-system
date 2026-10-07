/* Stage 6: "what worked" — every item of the month, per network and per automation. */
(function () {
  "use strict";
  var X = window.GanttExt, el = X.el, api = X.api, NET = X.NET, ORDER = X.ORDER;
  var COLORS = { published: "#0ca30c", failed: "#d03b3b", cancelled: "#9b9a8f", partial: "#fab219", scheduled: "#2a78d6", publishing: "#fab219" };

  function monthOfView() {
    var lab = document.getElementById("monthLabel").textContent.trim();
    var names = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
    var p = lab.split(" ");
    var m = names.indexOf(p[0]) + 1, y = parseInt(p[1], 10);
    return y + "-" + (m < 10 ? "0" + m : m);
  }

  function open() {
    var ym = monthOfView();
    var m = X.modal("מה עבד — " + document.getElementById("monthLabel").textContent, { wide: true });
    var items = X.G.state.items.filter(function (it) { return (it.date || "").slice(0, 7) === ym && (it.pub || it.automation || (it.platforms && it.platforms.length)); })
      .sort(function (a, b) { return (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")); });
    var tot = { posts: 0, published: 0, failed: 0, comments: 0, links: 0 };
    if (!items.length) { m.body.appendChild(el("p", "settings-intro", "אין החודש פריטים שתוזמנו דרך Zernio או שיש להם אוטומציה.")); return; }
    var table = el("div", "rep-table");
    items.forEach(function (it) {
      var row = el("div", "rep-row");
      var head = el("div", "rep-head");
      head.appendChild(el("span", "rep-date", it.date.slice(8, 10) + "/" + it.date.slice(5, 7) + (it.time ? " " + it.time : "")));
      var t = el("button", "rep-title", it.title); t.type = "button";
      t.addEventListener("click", function () { m.close(); X.G.openDayModal(it.date, it.id); });
      head.appendChild(t);
      if (it.pub) head.appendChild(el("span", "admin-tag", it.pub.statusHe || it.pub.status));
      row.appendChild(head);
      var nets = el("div", "rep-nets");
      ORDER.forEach(function (p) {
        var tg = it.targets && it.targets[p];
        if (!tg && !(it.platforms || []).includes(p)) return;
        var cell = el("span", "rep-net");
        var ic = el("span", "net-ico"); ic.innerHTML = NET[p].icon; ic.style.color = tg ? (COLORS[tg.status] || "var(--ink-400)") : "var(--ink-400)";
        cell.appendChild(ic);
        cell.appendChild(el("span", null, tg ? (tg.statusHe || tg.status) : "לא נשלח"));
        if (tg && tg.permalink) { var a = el("a", "ig-open-link", "↗"); a.href = tg.permalink; a.target = "_blank"; a.rel = "noopener noreferrer"; cell.appendChild(a); }
        if (tg && tg.error) cell.title = tg.error;
        nets.appendChild(cell);
        if (tg) { tot.posts++; if (tg.status === "published") tot.published++; if (tg.status === "failed") tot.failed++; }
      });
      row.appendChild(nets);
      var au = it.automation;
      if (au) {
        var s = au.stats || {};
        var line = el("div", "rep-auto");
        line.appendChild(el("span", null, "⚡ " + (au.name || "") + " · " + (au.statusHe || au.status) + (au.overdue ? " (העובד פספס!)" : "")));
        if (au.stats) {
          line.appendChild(el("span", null, "הגיבו " + (s.comments || 0) + " · קיבלו הודעה " + (s.dmsSent || 0)));
          tot.comments += s.comments || 0;
        } else line.appendChild(el("span", null, "אין עדיין מספרים"));
        row.appendChild(line);
      }
      table.appendChild(row);
    });
    var sum = el("div", "stat-strip rep-sum");
    [["פרסומים לרשתות", tot.posts], ["עלו", tot.published], ["נכשלו", tot.failed], ["תגובות שהפעילו אוטומציה", tot.comments]].forEach(function (p) {
      var tile = el("div", "stat-tile"); tile.appendChild(el("span", "stat-value", String(p[1]))); tile.appendChild(el("span", "stat-label", p[0])); sum.appendChild(tile);
    });
    m.body.appendChild(sum);
    m.body.appendChild(table);
    m.body.appendChild(el("p", "field-hint-start", "המספרים של האוטומציות מתעדכנים ע\"י עובד הרקע כל 15 דקות. לחיצות, מיילים ולינקים — בחלון האוטומציה (⚡)."));
  }

  // automation numbers in the chip tooltip
  var prevDecorate = X.decorateAutomation;
  X.decorateAutomation = function (w, item) {
    prevDecorate(w, item);
    var a = item.automation;
    if (a && a.stats) {
      var b = w().querySelector(".auto-badge");
      if (b) b.title += " · הגיבו " + (a.stats.comments || 0) + " · קיבלו הודעה " + (a.stats.dmsSent || 0);
    }
  };

  X.hooks.push(function () {
    X.headerButton("מה עבד החודש", '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 16V9M8.5 16V5M13 16v-5M17 16V7"/></svg>', open);
  });
  X.openReport = open;
})();
