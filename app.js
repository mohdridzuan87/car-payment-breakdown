/* Loan Breakdown app - Hire Purchase Loan. UI, local storage, PDF export */
(function () {
  "use strict";
  var STORE = "breakdown.forms.v1";
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- number helpers ---------- */
  function num(v) {
    var n = parseFloat(String(v === undefined || v === null ? "" : v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  function money(n) {
    var neg = n < 0, s = (Math.round(Math.abs(n) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return neg ? "-" + s : s;
  }
  function rm(n) { return n < 0 ? "(RM " + money(-n) + ")" : "RM " + money(n); }

  /* ---------- calculations (same as the Excel sheet) ---------- */
  function compute(d) {
    var sub1 = num(d.price) + num(d.insurance) + num(d.accessories) + num(d.others) + num(d.color);
    var sub2 = sub1 - num(d.rebate);
    var balance = sub2 - num(d.booking);
    var refund = num(d.loan) - balance;
    return { sub1: sub1, sub2: sub2, balance: balance, refund: refund };
  }
  function refundLabel(r) { return r < 0 ? "Customer to pay" : "Refund to customer"; }

  /* ---------- storage ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { return []; } }
  function saveAll(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list)); return true; }
    catch (e) { toast("Could not save - phone storage is full."); return false; }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  var forms = load();
  var current = null;

  /* ---------- schema ----------
     Placeholders show example values only; the form always starts empty. */
  var SECTIONS = [
    { title: "1. Customer & Vehicle Information", open: true, fields: [
      { key: "model", label: "Car Model", ph: "Innova Zenix 2.0V", caps: true },
      { key: "customer", label: "Customer", ph: "Customer name", caps: true },
      { key: "phone", label: "Customer Phone Number", ph: "012-345 6789", mode: "tel", phone: true },
      { key: "sa", label: "Sales Advisor Name", ph: "Wan Jasni", caps: true },
      { key: "branch", label: "Branch", ph: "PCM Telok Panglima Garang", caps: true }] },
    { title: "2. Payment Breakdown", open: true, fields: [
      { key: "price", label: "Price", note: "Vehicle price", ph: "165,000.00", money: true },
      { key: "insurance", label: "Insurance Price", note: "Insurance premium after NCD", ph: "2,864.16", money: true },
      { key: "accessories", label: "Car Accessories", note: "Added to subtotal", ph: "1,500.00", money: true },
      { key: "others", label: "Others", note: "Other charges, added to subtotal", ph: "500.00", money: true },
      { key: "color", label: "Car Color", note: "Colour charge (e.g. premium colour), added to subtotal", ph: "800.00", money: true },
      { calc: "sub1", label: "Subtotal" },
      { key: "rebate", label: "Less: Rebate Promotion", note: "Deducted from subtotal", ph: "10,000.00", money: true },
      { calc: "sub2", label: "Subtotal" },
      { key: "booking", label: "Less: Paid Booking Fee", note: "Already paid by customer", ph: "1,000.00", money: true },
      { calc: "balance", label: "Balance After Rebate & Booking" },
      { key: "loan", label: "Loan amount", note: "Bank loan approved", ph: "158,200.00", money: true },
      { calc: "refund", label: "Refund to customer", big: true },
      { hint: "Refund = Loan amount minus Balance. If the result is negative the customer pays the difference." }] }
  ];

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }
  function fieldEl(f) {
    if (f.hint) return el("div", { class: "hint", text: f.hint });
    if (f.calc) return el("div", { class: "calc" + (f.big ? " big" : "") }, [el("span", { id: "l_" + f.calc, text: f.label }), el("span", { id: "c_" + f.calc, text: "-" })]);
    if (f.money) {
      return el("div", { class: "money" + (f.key === "loan" ? " loan" : "") }, [
        el("div", { class: "lbl" }, [el("span", { text: f.label }), f.note ? el("small", { class: "note", text: f.note }) : null]),
        el("input", { "data-k": f.key, type: "text", inputmode: "decimal", placeholder: f.ph || "0.00", class: "mny" })]);
    }
    var input = el("input", { "data-k": f.key, type: "text", placeholder: f.ph || "" });
    if (f.caps) { input.setAttribute("autocapitalize", "characters"); input.className = "caps"; }
    if (f.mode) input.setAttribute("inputmode", f.mode);
    if (f.phone) { input.setAttribute("type", "tel"); input.setAttribute("maxlength", "14"); input.setAttribute("autocomplete", "tel"); input.setAttribute("data-phone", "1"); }
    return el("label", { class: "f" }, [el("span", { text: f.label }), input]);
  }
  function buildForm() {
    var form = $("form"); form.innerHTML = "";
    SECTIONS.forEach(function (s) {
      var d = el("details", { class: "sec" }, [el("summary", { text: s.title }), el("div", { class: "sec-body" }, s.fields.map(fieldEl))]);
      if (s.open) d.open = true;
      form.appendChild(d);
    });
    form.addEventListener("input", onInput);
  }

  function fillForm(data) {
    document.querySelectorAll("#form [data-k]").forEach(function (i) {
      var v = data[i.getAttribute("data-k")]; v = v === undefined || v === null ? "" : v;
      i.value = v;
      if ((i.className === "mny" || i.getAttribute("data-phone")) && v) i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    refreshCalc();
  }
  function onInput(e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-k");
    if (!k || !current) return;
    var t = e.target;
    if (t.getAttribute("data-phone")) {
      var dg = t.value.replace(/\D/g, "").slice(0, 11);
      var cut = 3, mid = dg.indexOf("011") === 0 ? 4 : 3;
      var ph = dg.slice(0, cut);
      if (dg.length > cut) ph += "-" + dg.slice(cut, cut + mid);
      if (dg.length > cut + mid) ph += " " + dg.slice(cut + mid);
      if (ph !== t.value) t.value = ph;
    } else if (t.className === "mny") {
      var pos = t.selectionStart, before = t.value.slice(0, pos).replace(/[^0-9.]/g, "").length;
      var raw = t.value.replace(/[^0-9.]/g, ""), dot = raw.indexOf(".");
      if (dot >= 0) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, "").slice(0, 2);
      var ip = dot >= 0 ? raw.slice(0, dot) : raw, fp = dot >= 0 ? raw.slice(dot) : "";
      var out = ip.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") + fp;
      if (out !== t.value) {
        t.value = out;
        var n = 0, np = 0; while (np < out.length && n < before) { if (/[0-9.]/.test(out[np])) n++; np++; }
        try { t.setSelectionRange(np, np); } catch (x) { /* ignore */ }
      }
    }
    if (t.className === "caps") {
      var up = t.value.toUpperCase();
      if (up !== t.value) { var p = t.selectionStart; t.value = up; try { t.setSelectionRange(p, p); } catch (x) { /* ignore */ } }
    }
    current.data[k] = t.value; refreshCalc(); scheduleSave();
  }
  function refreshCalc() {
    if (!current) return;
    var c = compute(current.data);
    ["sub1", "sub2", "balance", "refund"].forEach(function (k) { var n = $("c_" + k); if (n) n.textContent = rm(c[k]); });
    $("l_refund").textContent = refundLabel(c.refund);
    $("dueLbl").textContent = refundLabel(c.refund);
    $("dueVal").textContent = rm(c.refund);
  }
  var saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrent, 300); }
  function saveCurrent() {
    if (!current) return;
    current.updated = Date.now();
    var i = forms.findIndex(function (o) { return o.id === current.id; });
    if (i < 0) forms.unshift(current); else forms[i] = current;
    saveAll(forms);
  }

  /* ---------- views ---------- */
  function showList() {
    saveCurrent(); current = null;
    $("listView").hidden = false; $("editView").hidden = true; $("editBar").hidden = true;
    $("backBtn").hidden = true; $("title").textContent = "Loan Breakdown";
    renderList(); window.scrollTo(0, 0);
  }
  function renderList() {
    forms.sort(function (a, b) { return b.updated - a.updated; });
    var box = $("orderList"); box.innerHTML = ""; $("emptyMsg").hidden = forms.length > 0;
    forms.forEach(function (o) {
      var d = o.data, c = compute(d);
      var info = el("div", { class: "info" }, [
        el("div", { class: "name", text: d.customer || "(no customer yet)" }),
        el("div", { class: "meta", text: [d.model, d.phone].filter(Boolean).join(" | ") || "Draft" }),
        el("div", { class: "amt", text: refundLabel(c.refund) + ": " + rm(c.refund) })]);
      var dup = el("button", { class: "small", text: "Copy" });
      var del = el("button", { class: "small danger", text: "Delete" });
      var card = el("div", { class: "order" }, [info, el("div", { class: "acts" }, [dup, del])]);
      info.addEventListener("click", function () { openForm(o.id); });
      dup.addEventListener("click", function () {
        var cp = { id: uid(), updated: Date.now(), data: JSON.parse(JSON.stringify(o.data)) };
        forms.unshift(cp); saveAll(forms); renderList(); toast("Copied");
      });
      del.addEventListener("click", function () {
        if (!confirm("Delete the breakdown for " + (d.customer || "this customer") + "? This cannot be undone.")) return;
        forms = forms.filter(function (x) { return x.id !== o.id; }); saveAll(forms); renderList();
      });
      box.appendChild(card);
    });
  }
  function openForm(id) {
    var o = forms.find(function (x) { return x.id === id; }); if (!o) return;
    current = o;
    $("listView").hidden = true; $("editView").hidden = false; $("editBar").hidden = false;
    $("backBtn").hidden = false; $("title").textContent = "Loan Breakdown";
    fillForm(o.data); window.scrollTo(0, 0); location.hash = "#edit";
  }
  function newForm() {
    var o = { id: uid(), updated: Date.now(), data: {} };
    var last = forms[0] && forms[0].data;
    if (last && last.sa) o.data.sa = last.sa;         /* remember SA and branch from the last form */
    if (last && last.branch) o.data.branch = last.branch;
    forms.unshift(o); saveAll(forms); openForm(o.id);
  }

  /* ---------- PDF (A4 portrait, laid out like the Excel sheet) ---------- */
  function buildPdf(d) {
    var doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    var c = compute(d), L = 15, R = 195, W = R - L;
    var RED = [200, 16, 46], GREY = [240, 240, 242];
    function shown(v) { return v === "" || v === undefined || v === null || !String(v).trim() ? "-" : money(num(v)); }

    doc.setFillColor(RED[0], RED[1], RED[2]); doc.rect(0, 0, 210, 30, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.text("Hire Purchase Loan", 105, 11, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("Calculation Payment Breakdown", 105, 22.5, { align: "center" });

    doc.setTextColor(30);
    var info = [["Car Model:", d.model], ["Customer:", d.customer], ["Customer Phone Number:", d.phone], ["Sales Advisor Name:", d.sa], ["Branch:", d.branch]];
    info.forEach(function (r, i) {
      var y = 44 + i * 9;
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.text(r[0], L, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text(String(r[1] || "").trim() || "-", L + 56, y);
      doc.setDrawColor(200); doc.setLineWidth(0.2); doc.line(L + 55, y + 1.8, R, y + 1.8);
    });

    var top = 98, h = 11, cx2 = L + 118;   /* column split: item + amount | notes */
    doc.setFillColor(RED[0], RED[1], RED[2]); doc.rect(L, top, W, h, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
    doc.text("Item", L + 3, top + 7.3); doc.text("Amount (RM)", cx2 - 3, top + 7.3, { align: "right" }); doc.text("Notes", cx2 + 3, top + 7.3);
    var rows = [
      { t: "Price", v: shown(d.price), n: "Vehicle price" },
      { t: "Insurance Price", v: shown(d.insurance), n: "Insurance premium after NCD" },
      { t: "Car Accessories", v: shown(d.accessories), n: "Added to subtotal" },
      { t: "Others", v: shown(d.others), n: "Other charges" },
      { t: "Car Color", v: shown(d.color), n: "Colour charge" },
      { t: "Subtotal", v: money(c.sub1), calc: 1 },
      { t: "Less: Rebate Promotion", v: shown(d.rebate), n: "Deducted from subtotal" },
      { t: "Subtotal", v: money(c.sub2), calc: 1 },
      { t: "Less: Paid Booking Fee", v: shown(d.booking), n: "Already paid by customer" },
      { t: "Balance After Rebate & Booking", v: money(c.balance), calc: 1 },
      { t: "Loan amount", v: shown(d.loan), n: "Bank loan approved", loan: 1 },
      { t: refundLabel(c.refund), v: money(Math.abs(c.refund)), n: c.refund < 0 ? "Balance minus loan" : "Loan minus balance", big: 1 }
    ];
    /* Loan amount: label + number bold, 20% bigger than the Balance row (10.5 -> 12.6).
       Refund / Customer to pay: number bold, 50% bigger than its label (12 -> 18), taller row. */
    var y = top + h;
    rows.forEach(function (r) {
      var rh = r.big ? 15 : h, base = y + rh / 2 + 1.8;
      if (r.big) { doc.setFillColor(253, 236, 239); doc.rect(L, y, W, rh, "F"); }
      else if (r.calc) { doc.setFillColor(GREY[0], GREY[1], GREY[2]); doc.rect(L, y, W, rh, "F"); }
      doc.setDrawColor(200); doc.setLineWidth(0.2); doc.rect(L, y, W, rh, "S"); doc.line(cx2, y, cx2, y + rh);
      var bold = r.calc || r.big || r.loan;
      doc.setTextColor(r.big ? RED[0] : 30, r.big ? RED[1] : 30, r.big ? RED[2] : 30);
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(r.big ? 12 : r.loan ? 12.6 : 10.5);
      doc.text(r.t, L + 3, base);
      if (r.big) { doc.setFontSize(18); doc.text(r.v, cx2 - 3, base + 1.2, { align: "right" }); }
      else doc.text(r.v, cx2 - 3, base, { align: "right" });
      if (r.n) { doc.setFont("helvetica", "italic"); doc.setFontSize(9.5); doc.setTextColor(95); doc.text(r.n, cx2 + 3, base); }
      y += rh;
    });
    doc.setTextColor(110); doc.setFont("helvetica", "italic"); doc.setFontSize(8);
    doc.text("Figures are estimates for discussion and are subject to final bank and insurer approval.", L, y + 8);
    return doc;
  }
  function fileName(d) {
    var s = (d.customer || "customer").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return "Payment_Breakdown_" + s + ".pdf";
  }
  function openSheet() {
    saveCurrent();
    var blob, name;
    try { blob = buildPdf(current.data).output("blob"); name = fileName(current.data); } catch (e) { toast("Could not create PDF: " + e.message); return; }
    var url = URL.createObjectURL(blob), body = $("sheetBody"); body.innerHTML = "";
    body.appendChild(el("div", { class: "fname", text: name + "  (" + Math.round(blob.size / 1024) + " KB, A4 1 page)" }));
    body.appendChild(el("a", { class: "primary act", href: url, download: name, text: "Download PDF" }));
    var file = null; try { file = new File([blob], name, { type: "application/pdf" }); } catch (e) { /* old browser */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      var sh = el("button", { class: "primary act sec2", type: "button", text: "Share (WhatsApp, Email, Drive...)" });
      sh.addEventListener("click", function () { navigator.share({ files: [file], title: name }).catch(function (e) { if (e.name !== "AbortError") toast("Share failed: " + e.message); }); });
      body.appendChild(sh);
    }
    body.appendChild(el("a", { class: "primary act sec2", href: url, target: "_blank", rel: "noopener", text: "Open / Print" }));
    $("sheet").hidden = false; $("sheet").dataset.url = url;
  }
  function closeSheet() {
    $("sheet").hidden = true; var u = $("sheet").dataset.url;
    if (u) setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }
  var toastTimer;
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600); }

  /* ---------- wire up ---------- */
  buildForm();
  $("newBtn").addEventListener("click", newForm);
  $("backBtn").addEventListener("click", function () { if (location.hash === "#edit") history.back(); else showList(); });
  $("pdfBtn").addEventListener("click", openSheet);
  $("sheetClose").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", function (e) { if (e.target.id === "sheet") closeSheet(); });
  window.addEventListener("hashchange", function () { if (location.hash !== "#edit" && current) showList(); });
  window.addEventListener("pagehide", saveCurrent);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveCurrent(); });
  if (location.hash === "#edit") history.replaceState(null, "", location.pathname);
  showList();
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(function () {});
  window.__bd = { buildPdf: buildPdf, compute: compute, forms: function () { return forms; } };
})();
