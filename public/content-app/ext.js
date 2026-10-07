/* Extensions to the original gantt: Zernio connection, import, scheduling,
   automations, tracking. The original board code stays as it was; it exposes
   window.GANTT and calls GanttExt.boot() once it has rendered. */
(function () {
  "use strict";

  var NET = {
    instagram: { name: "אינסטגרם", icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="3.5" width="13" height="13" rx="3.8"/><circle cx="10" cy="10" r="3.1"/><circle cx="14" cy="6" r=".8" fill="currentColor" stroke="none"/></svg>' },
    facebook: { name: "פייסבוק", icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="7"/><path d="M11.3 17V9.6c0-1.2.6-1.8 1.8-1.8h1M8.6 11h4.6"/></svg>' },
    tiktok: { name: "טיקטוק", icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3.5v9.2a2.7 2.7 0 1 1-2.7-2.7"/><path d="M11 3.5c.3 2 1.8 3.4 3.8 3.6"/></svg>' },
    youtube: { name: "יוטיוב", icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.8" y="5" width="14.4" height="10" rx="3"/><path d="M8.6 8v4l3.5-2-3.5-2Z" fill="currentColor"/></svg>' }
  };
  var ORDER = ["instagram", "facebook", "tiktok", "youtube"];

  function api(method, path, body) {
    // הכל תחת /api/content ב-CRM
    if (path.indexOf("/api/") === 0 && path.indexOf("/api/content/") !== 0) path = "/api/content/" + path.slice(5);
    var opt = { method: method, headers: { "X-Gantt": "1" }, cache: "no-store" };
    if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ("HTTP " + r.status)); e.status = r.status; e.data = j; throw e; }
        return j;
      });
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var X = window.GanttExt = { NET: NET, ORDER: ORDER, api: api, el: el, accounts: null };

  function renderBar() {
    var bar = document.getElementById("zernioBar");
    if (!bar || !X.accounts) return;
    bar.innerHTML = "";
    ORDER.forEach(function (p) {
      var info = X.accounts.platforms[p];
      var pill = el("span", "net-pill");
      var ico = el("span", "net-ico"); ico.innerHTML = NET[p].icon;
      if (info && info.connected) {
        var a = info.account;
        if (a.profilePicture) { var img = el("img"); img.src = a.profilePicture; img.alt = ""; img.referrerPolicy = "no-referrer"; img.onerror = function () { img.replaceWith(ico); }; pill.appendChild(img); }
        else pill.appendChild(ico);
        pill.appendChild(el("span", "net-name", "@" + (a.username || a.displayName || "")));
        if (!info.healthy) { pill.classList.add("is-bad"); pill.title = NET[p].name + ": החשבון דורש חיבור מחדש ב-Zernio"; }
        else pill.title = NET[p].name + " מחובר: " + (a.displayName || a.username);
      } else {
        pill.classList.add("is-off");
        pill.appendChild(ico);
        pill.appendChild(el("span", "net-name", NET[p].name));
        pill.title = NET[p].name + ": לא מחובר ב-Zernio";
      }
      bar.appendChild(pill);
    });
    if (X.accounts.error) {
      var w = el("span", "net-pill is-bad", "Zernio: " + X.accounts.error);
      bar.appendChild(w);
    }
  }

  X.loadAccounts = function (force) {
    return api("GET", "/api/accounts" + (force ? "?force=1" : "")).then(function (a) {
      X.accounts = a; renderBar(); if (X.onAccounts) X.onAccounts(); return a;
    }).catch(function (e) {
      X.accounts = { platforms: {}, error: e.message }; renderBar();
    });
  };

  // ---------- generic modal, in the gantt's own modal styling ----------
  X.modal = function (title, opts) {
    opts = opts || {};
    var overlay = el("div", "modal-overlay ext-modal-overlay");
    overlay.dir = "rtl"; overlay.lang = "he";
    var box = el("div", "modal" + (opts.wide ? " modal-wide" : ""));
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    var head = el("div", "modal-header");
    var h = el("h2", null, title);
    var close = el("button", "icon-btn"); close.type = "button"; close.setAttribute("aria-label", "סגירה");
    close.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>';
    head.appendChild(h); head.appendChild(close);
    var body = el("div");
    box.appendChild(head); box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(function () { overlay.classList.add("is-open"); });
    var api = {
      body: body, title: h,
      close: function () {
        overlay.classList.remove("is-open");
        document.removeEventListener("keydown", onKey, true);
        setTimeout(function () { overlay.remove(); if (!document.querySelector(".modal-overlay.is-open")) document.documentElement.style.overflow = ""; }, 200);
        if (opts.onClose) opts.onClose();
      }
    };
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); api.close(); } }
    document.addEventListener("keydown", onKey, true);
    close.addEventListener("click", api.close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay && !opts.sticky) api.close(); });
    return api;
  };

  X.btn = function (text, cls, onClick) {
    var b = el("button", "btn " + (cls || "btn-ghost"), text); b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };

  X.headerButton = function (label, svg, onClick) {
    var b = el("button", "icon-btn"); b.type = "button";
    b.setAttribute("aria-label", label); b.title = label; b.innerHTML = svg;
    b.addEventListener("click", onClick);
    var host = document.getElementById("titleActions");
    host.insertBefore(b, document.getElementById("openSyncBtn") || document.getElementById("openSettingsBtn"));
    return b;
  };



  // בתוך ה-CRM התפריט בצד הוא הניווט: ?view=automations|reels, ?item=<id> פותח פריט
  var params = new URLSearchParams(location.search);
  X.view = params.get("view") || "board";
  X.inCrm = window.top !== window;
  X.navigate = function (path) {
    if (X.inCrm) window.top.location.href = path; else location.href = path;
  };
  document.documentElement.classList.add("view-" + X.view);
  if (X.inCrm) document.documentElement.classList.add("in-crm");

  X.hooks = [];
  X.boot = function (G) {
    X.G = G;
    if (X.view === "reels") {
      var tab = document.getElementById("tabAnalytics");
      if (tab) tab.click();
    }
    var openItem = params.get("item");
    if (openItem && X.view === "board") {
      var it = G.findItem(openItem);
      if (it) setTimeout(function () { G.openDayModal(it.date, it.id); }, 50);
    }
    X.loadAccounts(false);
    // import/backup lives in the gantt's own sync window (the cloud button)
    X.hooks.forEach(function (h) { try { h(G); } catch (e) { console.error(e); } });
  };
})();
