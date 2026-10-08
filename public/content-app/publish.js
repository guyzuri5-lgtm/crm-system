/* Stage 2-3: scheduling from the item form. Builds on ext.js (window.GanttExt). */
(function () {
  "use strict";
  var X = window.GanttExt, el = X.el, api = X.api, NET = X.NET, ORDER = X.ORDER;

  var TT_PRIVACY = [["PUBLIC_TO_EVERYONE", "ציבורי"], ["MUTUAL_FOLLOW_FRIENDS", "חברים"], ["FOLLOWER_OF_CREATOR", "עוקבים"], ["SELF_ONLY", "רק אני"]];
  var YT_VIS = [["private", "פרטי"], ["unlisted", "לא רשום"], ["public", "ציבורי"]];
  var YT_CATS = [["22", "אנשים ובלוגים"], ["27", "חינוך"], ["26", "הדרכה וסטייל"], ["24", "בידור"], ["28", "מדע וטכנולוגיה"], ["10", "מוזיקה"], ["23", "קומדיה"]];
  var STATUS_COLOR = { published: "#0ca30c", failed: "#d03b3b", cancelled: "#9b9a8f", partial: "#fab219", scheduled: "#2a78d6", publishing: "#fab219", draft: "#9b9a8f" };

  function label(text) { return el("label", "field-label", text); }
  function checkbox(text, checked, onChange) {
    var row = el("label", "checkbox-row");
    var i = el("input"); i.type = "checkbox"; i.checked = !!checked;
    i.addEventListener("change", function () { onChange(i.checked); });
    row.appendChild(i); row.appendChild(el("span", null, text));
    return row;
  }
  function select(options, value, onChange) {
    var s = el("select", "text-input");
    options.forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; s.appendChild(op); });
    s.value = value; s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }
  function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.round(n / 1024) + "KB"; }
  function fmtWhen(w) {
    if (!w) return "—";
    var p = w.split("T"), d = p[0].split("-");
    return d[2] + "/" + d[1] + "/" + d[0] + " בשעה " + (p[1] || "").slice(0, 5);
  }

  // ---------- measure a video/image before upload (duration and size matter per network) ----------
  function measure(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var done = function (m) { URL.revokeObjectURL(url); resolve(m); };
      if (file.type.indexOf("video/") === 0 || /\.(mov|mp4|m4v|webm)$/i.test(file.name)) {
        var v = document.createElement("video");
        v.preload = "metadata"; v.muted = true;
        v.onloadedmetadata = function () { done({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); };
        v.onerror = function () { done({}); };
        v.src = url;
      } else if (file.type.indexOf("image/") === 0) {
        var im = new Image();
        im.onload = function () { done({ width: im.naturalWidth, height: im.naturalHeight }); };
        im.onerror = function () { done({}); };
        im.src = url;
      } else done({});
      setTimeout(function () { done({}); }, 8000);
    });
  }

  // הקובץ עולה ישירות מהמחשב לאחסון של Zernio — לא דרך השרת ולא דרך Supabase:
  // השרת מבקש כתובת העלאה חתומה, הדפדפן שולח אליה, והשרת מאמת שהקובץ שם.
  function uploadFile(itemId, file, onProgress) {
    return measure(file).then(function (m) {
      return api("POST", "/api/media/presign", { itemId: itemId, filename: file.name, contentType: file.type, size: file.size, meta: m });
    }).then(function (p) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("PUT", p.uploadUrl);
        xhr.setRequestHeader("Content-Type", p.contentType);
        xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
        xhr.onload = function () { if (xhr.status >= 300) reject(new Error("ההעלאה ל-Zernio נכשלה (" + xhr.status + ")")); else resolve(p.mediaId); };
        xhr.onerror = function () { reject(new Error("ההעלאה ל-Zernio נכשלה — בדקו את החיבור")); };
        xhr.send(file);
      });
    }).then(function (mediaId) {
      return api("POST", "/api/media/" + mediaId + "/done", {}).then(function (r) { return r.media; });
    });
  }

  // ---------- network status line, reused in form and chips ----------
  function netBadge(p, t) {
    var b = el("span", "net-badge");
    b.innerHTML = NET[p].icon;
    var st = t && t.status || "draft";
    b.style.color = STATUS_COLOR[st] || "var(--ink-400)";
    b.title = NET[p].name + ": " + ((t && t.statusHe) || st) + (t && t.error ? " — " + t.error : "");
    return b;
  }

  // סרטון שנכנס מהתיקייה ועוד לא תוזמן
  function pendingApproval(item) {
    var p = item && item.pub;
    return !!(item && item.intake && !(p && ["scheduled", "publishing", "published", "partial"].indexOf(p.status) !== -1));
  }
  X.pendingApproval = pendingApproval;

  X.decorateChip = function (chip, item) {
    // הצבע הסגול מגיע מהסטטוס הנגזר בלוח; כאן רק ההסבר במעבר עכבר
    if (pendingApproval(item)) chip.title = "ממתין לאישור — הגיע מהתיקייה 'מוכן לפרסום'" + (chip.title ? " · " + chip.title : "");
    var wrap = null;
    function w() { if (!wrap) { wrap = el("span", "chip-nets"); chip.appendChild(wrap); } return wrap; }
    if (item.targets) {
      ORDER.forEach(function (p) { if (item.targets[p]) w().appendChild(netBadge(p, item.targets[p])); });
    } else if (item.platforms && item.platforms.length && !item.pub) {
      // planned but not sent yet: hollow, neutral
      item.platforms.forEach(function (p) { if (NET[p]) { var b = netBadge(p, null); b.classList.add("is-planned"); b.title = NET[p].name + ": מתוכנן, עוד לא נשלח ל-Zernio"; w().appendChild(b); } });
    }
    if (X.decorateAutomation) X.decorateAutomation(w, item);
  };

  // ---------- confirm screen ----------
  function showValidation(host, v, remote) {
    host.innerHTML = "";
    var any = false;
    function block(title, list, cls) {
      if (!list || !list.length) return;
      any = true;
      var b = el("div", "val-block " + cls);
      b.appendChild(el("strong", null, title));
      var ul = el("ul");
      list.forEach(function (t) { ul.appendChild(el("li", null, t)); });
      b.appendChild(ul); host.appendChild(b);
    }
    block("לא ניתן לתזמן:", v._item && v._item.errors, "is-error");
    block("שימו לב:", v._item && v._item.warnings, "is-warn");
    ORDER.forEach(function (p) {
      if (!v[p]) return;
      block(NET[p].name + " — לא תישלח:", v[p].errors, "is-error");
      block(NET[p].name + " — שימו לב:", v[p].warnings, "is-warn");
    });
    if (remote && remote.unavailable) block("בדיקת Zernio לא זמינה כרגע:", [remote.error], "is-warn");
    if (!any) host.appendChild(el("p", "val-ok", "✓ הבדיקה עברה בכל הרשתות שנבחרו"));
  }

  X.runConfirm = function (m, actionId, opts) {
    // opts.needsConsent: TikTok's own consent; opts.onDone
    var acts = el("div", "modal-actions");
    var out = el("div", "confirm-out");
    var consent = null;
    if (opts && opts.needsConsent) {
      consent = checkbox("ראיתי את התצוגה המקדימה של הפוסט לטיקטוק ואני מאשר/ת את פרסומו לפי מדיניות התוכן של TikTok", false, function () { go.disabled = !consent.querySelector("input").checked; });
      consent.classList.add("consent-row");
      m.body.appendChild(consent);
    }
    m.body.appendChild(out);
    var cancel = X.btn("ביטול", "btn-ghost", function () { m.close(); });
    var go = X.btn((opts && opts.confirmText) || "אשר", "btn-primary", function () {
      go.disabled = true; go.textContent = "שולח…";
      api("POST", "/api/actions/" + actionId + "/confirm", { tiktokConsent: !!(consent && consent.querySelector("input").checked) }).then(function (r) {
        out.innerHTML = "";
        if (r.dryRun) {
          out.appendChild(el("p", "val-block is-warn", r.message));
          var pre = el("pre", "dry-run"); pre.dir = "ltr";
          pre.textContent = JSON.stringify(r.requests, null, 2);
          out.appendChild(pre);
          go.textContent = "לא נשלח (כתיבה כבויה)";
          return;
        }
        out.appendChild(el("p", "val-ok", "✓ " + (r.message || "בוצע")));
        (r.warnings || []).forEach(function (w) { out.appendChild(el("p", "val-block is-warn", typeof w === "string" ? w : JSON.stringify(w))); });
        go.textContent = "בוצע";
        X.refreshServerView();
        if (opts && opts.onDone) opts.onDone(r);
        setTimeout(function () { m.close(); }, 1600);
      }).catch(function (e) {
        go.disabled = false; go.textContent = "נסה שוב";
        out.appendChild(el("p", "val-block is-error", e.message));
      });
    });
    if (consent) go.disabled = true;
    acts.appendChild(el("span"));
    var right = el("div", "modal-actions-right"); right.appendChild(cancel); right.appendChild(go);
    acts.appendChild(right);
    m.body.appendChild(acts);
  };

  function requestsDetails(reqs) {
    var d = el("details", "req-details");
    d.appendChild(el("summary", null, "הבקשות המדויקות שיישלחו ל-Zernio"));
    var pre = el("pre", "dry-run"); pre.dir = "ltr";
    pre.textContent = JSON.stringify(reqs, null, 2);
    d.appendChild(pre);
    return d;
  }

  function openScheduleConfirm(itemId, mode) {
    var m = X.modal(mode === "update" ? "אישור עדכון בזרניו" : "אישור תזמון", { wide: true, sticky: true });
    m.body.appendChild(el("p", "settings-intro", "בודק מול הכללים של כל רשת ומול Zernio…"));
    api("POST", "/api/items/" + encodeURIComponent(itemId) + "/schedule/plan", { mode: mode }).then(function (r) {
      m.body.innerHTML = "";
      var vhost = el("div");
      showValidation(vhost, r.validation, r.remote);
      if (r.blocked) {
        m.body.appendChild(vhost);
        m.body.appendChild(X.btn("סגירה", "btn-ghost", function () { m.close(); }));
        return;
      }
      var s = r.summary;
      var head = el("div", "confirm-head");
      head.appendChild(el("div", "confirm-when", fmtWhen(s.when) + " (" + s.timezone + ")"));
      head.appendChild(el("div", "confirm-title", s.title || ""));
      m.body.appendChild(head);
      var strip = el("div", "confirm-media");
      s.media.forEach(function (md) {
        var cell = el("div", "confirm-media-cell");
        if (md.kind === "video") { var v = el("video"); v.src = md.url; v.muted = true; v.preload = "metadata"; cell.appendChild(v); }
        else { var im = el("img"); im.src = md.url; im.alt = ""; cell.appendChild(im); }
        cell.appendChild(el("span", null, md.filename + " · " + fmtBytes(md.size) + (md.duration ? " · " + Math.round(md.duration) + " שנ׳" : "")));
        strip.appendChild(cell);
      });
      m.body.appendChild(strip);
      s.networks.forEach(function (n) {
        var card = el("div", "confirm-net");
        var h = el("div", "confirm-net-head");
        var ic = el("span", "net-ico"); ic.innerHTML = NET[n.platform].icon;
        h.appendChild(ic);
        h.appendChild(el("strong", null, n.name));
        h.appendChild(el("span", "confirm-acct", "@" + (n.username || "") + (n.displayName ? " · " + n.displayName : "")));
        card.appendChild(h);
        n.details.forEach(function (d) { card.appendChild(el("div", "confirm-detail", d)); });
        var cap = el("div", "confirm-caption", n.caption || "(ללא כיתוב)");
        if (n.customCaption) cap.classList.add("is-custom");
        card.appendChild(cap);
        m.body.appendChild(card);
      });
      m.body.appendChild(vhost);
      m.body.appendChild(requestsDetails(r.requests));
      X.runConfirm(m, r.actionId, { needsConsent: s.tiktok, confirmText: mode === "update" ? "אשר עדכון" : "אשר ותזמן" });
    }).catch(function (e) {
      m.body.innerHTML = "";
      m.body.appendChild(el("p", "val-block is-error", e.message));
    });
  }

  function openSimpleConfirm(itemId, kind, onDone, intro) {
    var title = kind === "cancel" ? "ביטול הפוסט ב-Zernio" : "ניסיון חוזר";
    var m = X.modal(title, { sticky: true });
    api("POST", "/api/items/" + encodeURIComponent(itemId) + "/" + kind + "/plan", {}).then(function (r) {
      if (intro) m.body.appendChild(el("p", "val-block is-warn", intro));
      m.body.appendChild(el("p", "settings-intro", r.summary.text));
      if (r.summary.networks && r.summary.networks.length) m.body.appendChild(el("p", "confirm-detail", "רשתות: " + r.summary.networks.join(", ")));
      m.body.appendChild(requestsDetails(r.requests));
      X.runConfirm(m, r.actionId, { confirmText: kind === "cancel" ? "אשר ביטול" : "אשר ניסיון חוזר", onDone: onDone });
    }).catch(function (e) { m.body.appendChild(el("p", "val-block is-error", e.message)); });
  }
  X.openSimpleConfirm = openSimpleConfirm;
  X.openScheduleConfirm = openScheduleConfirm;

  // ---------- the section inside the item form ----------
  X.buildPublishSection = function (ctx) {
    var editing = ctx.editing;
    var draft = {
      time: (editing && editing.time) || "",
      platforms: (editing && editing.platforms ? editing.platforms.slice() : []),
      platformOptions: JSON.parse(JSON.stringify((editing && editing.platformOptions) || {}))
    };
    var root = el("div", "publish-box");
    // מקופל כברירת מחדל; חץ קטן פותח. התיבה "ממתין לאישור" נשארת גלויה מחוץ לקיפול
    var toggle = el("button", "publish-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 5 7.5 10l5 5"/></svg>';
    toggle.appendChild(el("span", "schedule-helper-title", "פרסום ותזמון דרך Zernio"));
    root.appendChild(toggle);

    // סרטון מהתיקייה שמחכה לאישור: הסרטון עצמו, ומה לבדוק לפני "אשר ותזמן"
    var pendingHost = el("div");
    root.appendChild(pendingHost);
    function renderPending() {
      pendingHost.innerHTML = "";
      var it = editing && X.G.findItem(editing.id);
      if (!pendingApproval(it)) return;
      var box = el("div", "pending-box");
      box.appendChild(el("strong", "pending-title", "ממתין לאישור"));
      box.appendChild(el("p", null, "הסרטון הגיע מהתיקייה \"מוכן לפרסום\"" + (it.intake.file ? " (" + it.intake.file + ")" : "") +
        ". בדוק תאריך, שעה, כיתוב ורשתות, ולחץ \"אשר ותזמן\". שום דבר לא עולה לפני כן."));
      if (it.intake.keyword) box.appendChild(el("p", null, "בסרטון יש קריאה לתגובה. מילת המפתח המוצעת: \"" + it.intake.keyword + "\". אחרי התזמון אפשר לחבר לה אוטומציה מבנק האוטומציות."));
      var vid = (it.mediaFiles || []).filter(function (md) { return md.kind === "video"; })[0];
      if (vid) {
        var v = el("video", "pending-video"); v.src = vid.url; v.controls = true; v.playsInline = true; v.preload = "metadata";
        box.appendChild(v);
      } else box.appendChild(el("p", "pending-warn", "הסרטון עוד עולה ל-Zernio מהמחשב. רענן בעוד דקה."));
      var go = el("div", "pending-actions");
      go.appendChild(X.btn("אשר ותזמן", "btn-primary btn-small", function () { schedBtn.click(); }));
      box.appendChild(go);
      pendingHost.appendChild(box);
    }
    renderPending();

    // live status (when a post exists)
    var statusHost = el("div", "pub-status");
    root.appendChild(statusHost);

    function renderStatus() {
      statusHost.innerHTML = "";
      var it = editing && X.G.findItem(editing.id);
      if (!it || !it.pub) return;
      var p = it.pub;
      var line = el("div", "pub-line");
      var dot = el("span", "pub-dot"); dot.style.background = STATUS_COLOR[p.status] || "var(--ink-400)";
      line.appendChild(dot);
      line.appendChild(el("strong", null, p.statusHe || p.status));
      line.appendChild(el("span", "pub-when", fmtWhen(p.scheduledFor)));
      statusHost.appendChild(line);
      ORDER.forEach(function (pl) {
        var t = it.targets && it.targets[pl];
        if (!t) return;
        var row = el("div", "pub-net");
        row.appendChild(netBadge(pl, t));
        row.appendChild(el("span", null, NET[pl].name + ": " + (t.statusHe || t.status)));
        if (t.permalink) { var a = el("a", "ig-open-link", "פתיחה ↗"); a.href = t.permalink; a.target = "_blank"; a.rel = "noopener noreferrer"; row.appendChild(a); }
        statusHost.appendChild(row);
        if (t.error) statusHost.appendChild(el("div", "pub-error", t.error));
      });
      var boardWhen = it.date + "T" + (it.time || "");
      if (["scheduled", "draft", "failed", "partial"].indexOf(p.status) !== -1 && p.scheduledFor && boardWhen !== p.scheduledFor) {
        statusHost.appendChild(el("div", "pub-error", "התאריך/השעה בלוח (" + fmtWhen(boardWhen) + ") שונים ממה שמתוזמן ב-Zernio (" + fmtWhen(p.scheduledFor) + "). לחצו 'עדכון הפוסט ב-Zernio' כדי לשנות שם."));
      }
      if (p.status === "unknown") {
        statusHost.appendChild(el("div", "pub-error", "Zernio לא החזיר מזהה לפוסט. בדקו באתר של Zernio אם הפוסט נוצר. אם לא — שחררו כדי לתזמן מחדש."));
        statusHost.appendChild(X.btn("בדקתי — אין פוסט כזה ב-Zernio, שחרר", "btn-ghost btn-small", function () {
          api("POST", "/api/items/" + encodeURIComponent(it.id) + "/release-unknown", {}).then(function () { return X.refreshServerView(); }).then(renderStatus);
        }));
      }
      if (p.error && !(it.targets && Object.keys(it.targets).some(function (k) { return it.targets[k].error; }))) statusHost.appendChild(el("div", "pub-error", p.error));
      var acts = el("div", "schedule-helper-actions");
      acts.appendChild(X.btn("רענון סטטוס", "btn-ghost btn-small", function (e) {
        var b = e.currentTarget; b.disabled = true;
        api("POST", "/api/items/" + encodeURIComponent(it.id) + "/sync", {}).then(function () { return X.refreshServerView(); })
          .then(function () { b.disabled = false; renderStatus(); }, function (er) { b.disabled = false; X.G.showToast(er.message); });
      }));
      if (p.status === "failed" || p.status === "partial") acts.appendChild(X.btn("נסה שוב את מה שנכשל", "btn-ghost btn-small", function () { openSimpleConfirm(it.id, "retry"); }));
      if (["scheduled", "failed", "partial", "draft"].indexOf(p.status) !== -1) acts.appendChild(X.btn("ביטול התזמון", "btn-danger-ghost btn-small", function () { openSimpleConfirm(it.id, "cancel"); }));
      statusHost.appendChild(acts);
    }
    renderStatus();

    // time
    root.appendChild(label("שעת פרסום (שעון ישראל)"));
    var timeIn = el("input", "text-input"); timeIn.type = "time"; timeIn.dir = "ltr"; timeIn.value = draft.time;
    timeIn.addEventListener("input", function () { draft.time = timeIn.value; });
    root.appendChild(timeIn);

    // media
    root.appendChild(label("מדיה"));
    var drop = el("div", "dropzone");
    var fileIn = el("input"); fileIn.type = "file"; fileIn.multiple = true; fileIn.accept = "video/*,image/*"; fileIn.hidden = true;
    drop.appendChild(el("span", null, "גררו לכאן וידאו או תמונות (עולים ישירות מהמחשב ל-Zernio), או "));
    var pick = el("button", "link-btn", "בחרו קובץ"); pick.type = "button";
    pick.addEventListener("click", function () { fileIn.click(); });
    drop.appendChild(pick); drop.appendChild(fileIn);
    var mediaList = el("div", "media-list");
    root.appendChild(drop); root.appendChild(mediaList);

    var media = ((editing && X.G.findItem(editing.id)) || {}).mediaFiles || [];
    function renderMedia() {
      mediaList.innerHTML = "";
      media.forEach(function (md, idx) {
        var cell = el("div", "media-cell");
        if (md.kind === "video") { var v = el("video"); v.src = md.url + "#t=0.5"; v.muted = true; v.preload = "metadata"; cell.appendChild(v); }
        else { var im = el("img"); im.src = md.url; im.alt = ""; cell.appendChild(im); }
        var info = el("div", "media-info");
        info.appendChild(el("span", "media-name", md.filename));
        info.appendChild(el("span", "media-meta", fmtBytes(md.size) + (md.duration ? " · " + Math.round(md.duration) + " שנ׳" : "") + (md.width ? " · " + md.width + "×" + md.height : "")));
        if (md.status && md.status !== "ready") info.appendChild(el("span", "media-meta", "לא הסתיים — הסירו והעלו שוב"));
        cell.appendChild(info);
        var tools = el("div", "media-tools");
        if (idx > 0) tools.appendChild(X.btn("↑", "btn-ghost btn-small", function () { move(idx, -1); }));
        tools.appendChild(X.btn("הסרה", "btn-danger-ghost btn-small", function () {
          api("DELETE", "/api/media/" + md.id).then(function (r) { media = r.media; renderMedia(); syncMediaToItem(); });
        }));
        cell.appendChild(tools);
        mediaList.appendChild(cell);
      });
    }
    function move(idx, d) {
      var ids = media.map(function (m) { return m.id; });
      var t = ids[idx]; ids[idx] = ids[idx + d]; ids[idx + d] = t;
      api("POST", "/api/items/" + encodeURIComponent(ctx.itemId) + "/media/order", { ids: ids }).then(function (r) { media = r.media; renderMedia(); syncMediaToItem(); });
    }
    function syncMediaToItem() { var it = X.G.findItem(ctx.itemId); if (it) it.mediaFiles = media; }
    function handleFiles(files) {
      Array.prototype.forEach.call(files, function (f) {
        var prog = el("div", "media-progress", "מעלה " + f.name + "…");
        mediaList.appendChild(prog);
        uploadFile(ctx.itemId, f, function (r) { prog.textContent = "מעלה " + f.name + " — " + Math.round(r * 100) + "%"; })
          .then(function (m) { media = m; renderMedia(); syncMediaToItem(); })
          .catch(function (e) { prog.textContent = f.name + ": " + e.message; prog.classList.add("is-error"); });
      });
    }
    fileIn.addEventListener("change", function () { handleFiles(fileIn.files); fileIn.value = ""; });
    drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("is-over"); });
    drop.addEventListener("dragleave", function () { drop.classList.remove("is-over"); });
    drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("is-over"); handleFiles(e.dataTransfer.files); });
    renderMedia();

    // networks
    root.appendChild(label("רשתות"));
    var netWrap = el("div", "net-picker");
    var panels = el("div", "net-panels");
    root.appendChild(netWrap); root.appendChild(panels);

    function opt(p) { return draft.platformOptions[p] || (draft.platformOptions[p] = {}); }

    function renderNets() {
      netWrap.innerHTML = "";
      var acc = X.accounts && X.accounts.platforms || {};
      ORDER.forEach(function (p) {
        var info = acc[p];
        var connected = info && info.connected;
        var b = el("label", "net-choice");
        var i = el("input"); i.type = "checkbox";
        i.checked = draft.platforms.indexOf(p) !== -1;
        i.disabled = !connected && !i.checked;
        var ic = el("span", "net-ico"); ic.innerHTML = NET[p].icon;
        b.appendChild(i); b.appendChild(ic);
        b.appendChild(el("span", null, NET[p].name));
        if (!connected) { b.classList.add("is-off"); b.title = "לא מחובר ב-Zernio"; b.appendChild(el("small", null, "לא מחובר ב-Zernio")); }
        else if (!info.healthy) { b.classList.add("is-bad"); b.appendChild(el("small", null, "דורש חיבור מחדש")); }
        i.addEventListener("change", function () {
          if (i.checked) { if (draft.platforms.indexOf(p) === -1) draft.platforms.push(p); }
          else draft.platforms = draft.platforms.filter(function (x) { return x !== p; });
          renderPanels();
          if (X.onPlatformsChange) X.onPlatformsChange(draft.platforms);
        });
        netWrap.appendChild(b);
      });
    }

    function captionOverride(p, host) {
      var o = opt(p);
      var row = checkbox("כיתוב נפרד ל" + NET[p].name, o.useCustomCaption, function (v) { o.useCustomCaption = v; ta.style.display = v ? "block" : "none"; if (v && !ta.value) { ta.value = ctx.captionInput.value; o.caption = ta.value; } });
      host.appendChild(row);
      var ta = el("textarea", "text-input textarea");
      ta.rows = 3; ta.value = o.caption || ""; ta.style.display = o.useCustomCaption ? "block" : "none";
      ta.addEventListener("input", function () { o.caption = ta.value; });
      host.appendChild(ta);
    }

    var ttInfo = null;
    function tiktokPrivacyOptions() {
      if (ttInfo && ttInfo.privacyLevels && ttInfo.privacyLevels.length) {
        return ttInfo.privacyLevels.map(function (x) { var he = TT_PRIVACY.filter(function (t) { return t[0] === x.value; })[0]; return [x.value, he ? he[1] : (x.label || x.value)]; });
      }
      return TT_PRIVACY;
    }

    function renderPanels() {
      panels.innerHTML = "";
      draft.platforms.forEach(function (p) {
        var pan = el("div", "net-panel");
        var h = el("div", "net-panel-head"); var ic = el("span", "net-ico"); ic.innerHTML = NET[p].icon;
        h.appendChild(ic); h.appendChild(el("strong", null, NET[p].name)); pan.appendChild(h);
        var o = opt(p);
        if (p === "youtube") {
          pan.appendChild(label("כותרת (חובה, עד 100 תווים)"));
          var ti = el("input", "text-input"); ti.maxLength = 100; ti.value = o.title || "";
          if (!o.title && ctx.titleInput.value) { ti.value = ctx.titleInput.value; o.title = ti.value; }
          ti.addEventListener("input", function () { o.title = ti.value; });
          pan.appendChild(ti);
          pan.appendChild(label("פרטיות"));
          if (!o.visibility) o.visibility = "private";
          pan.appendChild(select(YT_VIS, o.visibility, function (v) { o.visibility = v; }));
          pan.appendChild(el("p", "field-hint-start", "לבדיקה מומלץ 'פרטי' — רק אתם רואים."));
          pan.appendChild(label("קטגוריה"));
          pan.appendChild(select(YT_CATS, o.categoryId || "22", function (v) { o.categoryId = v; }));
          pan.appendChild(label("תגיות (מופרדות בפסיק)"));
          var tg = el("input", "text-input"); tg.value = o.tags || ""; tg.addEventListener("input", function () { o.tags = tg.value; });
          pan.appendChild(tg);
          pan.appendChild(checkbox("מיועד לילדים", o.madeForKids, function (v) { o.madeForKids = v; }));
          pan.appendChild(checkbox("נוצר או שונה עם AI באופן מציאותי", o.containsSyntheticMedia, function (v) { o.containsSyntheticMedia = v; }));
          pan.appendChild(el("p", "field-hint-start", "ביוטיוב עולים Shorts בלבד: סרטון אנכי עד 3 דקות. התיאור הוא הכיתוב."));
        } else if (p === "tiktok") {
          pan.appendChild(label("פרטיות (חובה)"));
          var priv = select([["", "בחרו…"]].concat(tiktokPrivacyOptions()), o.privacyLevel || "", function (v) { o.privacyLevel = v; });
          pan.appendChild(priv);
          pan.appendChild(el("p", "field-hint-start", "לבדיקה מומלץ 'רק אני'. בחשבונות מסוימים טיקטוק מאפשר וידאו ציבורי בלבד — Zernio יחזיר שגיאה אם כך."));
          if (o.allowComment === undefined) o.allowComment = true;
          pan.appendChild(checkbox("לאפשר תגובות", o.allowComment, function (v) { o.allowComment = v; }));
          pan.appendChild(checkbox("לאפשר דואט", o.allowDuet, function (v) { o.allowDuet = v; }));
          pan.appendChild(checkbox("לאפשר סטיץ'", o.allowStitch, function (v) { o.allowStitch = v; }));
          pan.appendChild(label("תוכן מסחרי"));
          pan.appendChild(select([["none", "לא"], ["brand_organic", "קידום המותג שלי"], ["brand_content", "תוכן ממומן (שיתוף פעולה)"]], o.commercialContentType || "none", function (v) { o.commercialContentType = v; }));
          pan.appendChild(checkbox("נוצר עם AI", o.videoMadeWithAi, function (v) { o.videoMadeWithAi = v; }));
          pan.appendChild(checkbox("לשלוח לתיבת הטיוטות בטיקטוק במקום לפרסם", o.draft, function (v) { o.draft = v; }));
          if (!ttInfo && X.accounts && X.accounts.platforms.tiktok && X.accounts.platforms.tiktok.connected) {
            api("GET", "/api/tiktok/creator-info").then(function (r) { ttInfo = r; renderPanels(); }).catch(function () { ttInfo = {}; });
          }
        } else if (p === "instagram") {
          var f = ctx.getFormat();
          if (f === "reel" || f === "post") pan.appendChild(checkbox("להציג את הריל גם בפיד (ולא רק בלשונית ריל)", o.shareToFeed !== false, function (v) { o.shareToFeed = v; }));
          if (f !== "story") {
            pan.appendChild(label("תגובה ראשונה (לא חובה)"));
            var fc = el("input", "text-input"); fc.value = o.firstComment || ""; fc.addEventListener("input", function () { o.firstComment = fc.value; });
            pan.appendChild(fc);
          }
          pan.appendChild(el("p", "field-hint-start", "אינסטגרם קובע את הסוג לפי המדיה: וידאו אחד = ריל, תמונה אחת = פוסט, כמה קבצים = קרוסלה."));
        } else if (p === "facebook") {
          pan.appendChild(el("p", "field-hint-start", "ריל וסטורי לפי הפורמט שנבחר למעלה; פוסט וקרוסלה עולים כפוסט רגיל לעמוד."));
        }
        captionOverride(p, pan);
        panels.appendChild(pan);
      });
      if (X.renderAutomationSlot) X.renderAutomationSlot(autoHost, ctx, draft);
    }

    var autoHost = el("div", "auto-host");

    // actions
    var valHost = el("div", "val-host");
    var acts = el("div", "schedule-helper-actions pub-actions");
    function currentItem() { return editing ? X.G.findItem(editing.id) : null; }
    function primaryLabel() { var it = currentItem(); return it && it.pub && it.pub.zernioPostId && it.pub.status !== "cancelled" ? "עדכון הפוסט ב-Zernio" : pendingApproval(it) ? "אשר ותזמן" : "תזמן ב-Zernio"; }
    var schedBtn = X.btn(primaryLabel(), "btn-primary btn-small", function () {
      var it = ctx.commit();
      if (!it) return;
      editing = it;
      X.G.whenSaved().then(function () {
        var mode = it.pub && it.pub.zernioPostId && it.pub.status !== "cancelled" ? "update" : "create";
        openScheduleConfirm(it.id, mode);
      }).catch(function (e) { X.G.showToast(e.message, true); });
    });
    var checkBtn = X.btn("בדיקה לפי רשת", "btn-ghost btn-small", function () {
      var it = ctx.commit();
      if (!it) return;
      editing = it;
      X.G.whenSaved().then(function () { return api("POST", "/api/items/" + encodeURIComponent(it.id) + "/validate", {}); })
        .then(function (v) { showValidation(valHost, v, null); })
        .catch(function (e) { valHost.textContent = e.message; });
    });
    acts.appendChild(schedBtn); acts.appendChild(checkBtn);

    var copyBtn = X.btn("העתקת הכיתוב", "btn-ghost btn-small", function () {
      var t = ctx.captionInput.value.trim();
      if (!t) { ctx.captionInput.focus(); return; }
      navigator.clipboard.writeText(t).then(function () { copyBtn.textContent = "הועתק ✓"; setTimeout(function () { copyBtn.textContent = "העתקת הכיתוב"; }, 2000); });
    });
    acts.appendChild(copyBtn);

    renderNets();
    renderPanels();
    root.appendChild(autoHost);
    root.appendChild(valHost);
    root.appendChild(acts);
    root.appendChild(el("p", "field-hint-start", "שמירה בטופס שומרת רק בלוח. שום דבר לא נשלח ל-Zernio עד שתאשרו במסך האישור."));

    var body = el("div", "publish-body");
    body.hidden = true;
    Array.prototype.slice.call(root.children).forEach(function (c) { if (c !== toggle && c !== pendingHost) body.appendChild(c); });
    root.appendChild(body);
    toggle.addEventListener("click", function () {
      body.hidden = !body.hidden;
      toggle.setAttribute("aria-expanded", body.hidden ? "false" : "true");
    });

    X.onAccounts = function () { renderNets(); };
    function refreshPrimary() {
      var it = currentItem();
      var done = it && it.pub && ["published", "publishing"].indexOf(it.pub.status) !== -1;
      schedBtn.style.display = done ? "none" : "";
      schedBtn.textContent = primaryLabel();
    }
    refreshPrimary();
    X.onServerView = function () { renderStatus(); renderPending(); refreshPrimary(); };

    return {
      el: root,
      collect: function (target) {
        target.time = draft.time || "";
        target.platforms = draft.platforms.slice();
        target.platformOptions = draft.platformOptions;
        if (X.collectAutomation) X.collectAutomation(target);
      },
      onFormatChange: function () { renderPanels(); }
    };
  };

  // ---------- refresh server-owned fields without reloading ----------
  X.refreshServerView = function () {
    return api("GET", "/api/server-view").then(function (r) {
      var G = X.G, changed = false;
      G.state.items.forEach(function (it) {
        var v = r.items[it.id] || {};
        ["pub", "targets", "automation", "mediaFiles"].forEach(function (k) {
          var a = JSON.stringify(it[k] || null), b = JSON.stringify(v[k] || null);
          if (a !== b) { changed = true; if (v[k]) it[k] = v[k]; else delete it[k]; }
        });
      });
      X.worker = r.worker;
      // סרטון חדש נכנס מהתיקייה (או שינוי מחלון אחר): טוענים מחדש, אבל רק
      // כשאין שינוי שלא נשמר ואין חלון פתוח — כדי לא לאבד כלום
      if (typeof r.revision === "number" && typeof G.state.revision === "number" && r.revision > G.state.revision &&
          G.isIdle && G.isIdle() && !document.querySelector(".modal-overlay.is-open")) {
        location.reload();
        return r;
      }
      if (changed) {
        G.rerenderCalendar();
        if (X.onServerView) X.onServerView();
      }
      if (X.onWorker) X.onWorker(r.worker);
      if (X.onAlerts) X.onAlerts(r.alerts || [], r.worker || {}, r.armedCount || 0);
      return r;
    });
  };

  X.hooks.push(function () {
    setInterval(function () { if (!document.hidden) X.refreshServerView().catch(function () {}); }, 30000);
    X.refreshServerView().catch(function () {});
  });
})();
