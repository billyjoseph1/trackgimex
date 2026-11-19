/* TrackGimex — shared UI helpers */
const UI = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 21V7l6-3v17"/><path d="M10 21V9l10 3v9"/><path d="M2 21h20"/>
    <path d="M7 10v.01M7 13v.01M7 16v.01M14 14h2M14 17h2"/></svg>`;

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    building: '<path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-4h6v4M9 8h.01M15 8h.01M9 12h.01M15 12h.01"/>',
    check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
    users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
    door: '<path d="M13 4h3a2 2 0 012 2v14"/><path d="M2 20h3M13 20h9M10 12v.01"/><path d="M13 4.56v16.32a1 1 0 01-1.24.97L5 20V5.56a2 2 0 011.52-1.94l4-1A2 2 0 0113 4.56z"/>',
    receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .67V2l-1 .67L16 1l-3 2-3-2-3 2-3-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    wallet: '<path d="M20 12V8H6a2 2 0 010-4h12v4"/><path d="M4 6v12a2 2 0 002 2h14v-4"/><path d="M18 12a2 2 0 000 4h4v-4z"/>',
    file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>',
    bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    megaphone: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/>',
  };
  const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  const STATUS = {
    vacant: ["Vacant", "st-vacant"], occupied: ["Occupied", "st-occupied"], reserved: ["Reserved", "st-reserved"],
    maintenance: ["Maintenance", "st-maint"], notice: ["Moving out", "st-notice"],
    paid: ["Paid", "st-occupied"], partial: ["Partial", "st-reserved"], unpaid: ["Unpaid", "st-unpaid"], none: ["—", "st-none"],
    pending: ["Pending", "st-reserved"], approved: ["Approved", "st-occupied"], rejected: ["Declined", "st-unpaid"],
    cancelled: ["Cancelled", "st-none"], acknowledged: ["Acknowledged", "st-vacant"], completed: ["Completed", "st-none"],
  };
  const badge = (s) => { const [t, c] = STATUS[s] || [s, "st-none"]; return `<span class="badge ${c}">${esc(t)}</span>`; };

  /* ---------- toast ---------- */
  function toast(msg, type = "ok") {
    let box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast " + type;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add("out"), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  /* ---------- modal ---------- */
  function modal(title, body, { submitText, onSubmit, wide, footer } = {}) {
    closeModal();
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">&times;</button></div>
      <form class="modal-body" novalidate>${body}
        ${onSubmit || footer ? `<div class="modal-foot">${footer || ""}${onSubmit ? `<button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${esc(submitText || "Save")}</button>` : ""}</div>` : ""}
      </form></div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("no-scroll");
    const form = $("form", wrap);
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) closeModal(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!onSubmit) return;
      const data = Object.fromEntries(new FormData(form).entries());
      $$("input[type=checkbox]", form).forEach((c) => (data[c.name] = c.checked));
      try { if (onSubmit(data, form) !== false) closeModal(); }
      catch (err) { toast(err.message, "err"); }
    });
    const first = $("input,select,textarea", form);
    if (first) setTimeout(() => first.focus(), 30);
    return wrap;
  }
  function closeModal() {
    $$(".modal-backdrop").forEach((m) => m.remove());
    document.body.classList.remove("no-scroll");
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  function confirmBox(text, onYes, yesText = "Yes, continue") {
    modal("Please confirm", `<p class="muted">${esc(text)}</p>`, { submitText: yesText, onSubmit: () => { onYes(); } });
  }

  /* ---------- receipt ---------- */
  function receipt(p) {
    const u = Store.unit(p.unitId) || { label: "(removed)" };
    const prop = Store.property(p.propertyId) || { name: "(removed)", location: "" };
    const t = Store.user(p.tenantId) || { name: "—", phone: "" };
    const ll = Store.user(prop.landlordId) || { name: "" };
    const kind = { rent: "Rent — " + Store.monthLabel(p.month), deposit: "Security deposit", booking: "Booking fee" }[p.kind];
    modal("Receipt " + p.receiptNo, `
      <div class="receipt" id="receipt">
        <div class="r-head"><span class="logo-mark sm">${LOGO}</span><div><strong>TrackGimex</strong><br><span class="muted">Official payment receipt</span></div>
          <div class="r-no"><span class="muted">Receipt No.</span><br><strong>${esc(p.receiptNo)}</strong></div></div>
        <table class="r-table">
          <tr><td>Date</td><td>${new Date(p.date).toLocaleString("en-GB")}</td></tr>
          <tr><td>Received from</td><td>${esc(t.name)} ${t.phone ? "(" + esc(t.phone) + ")" : ""}</td></tr>
          <tr><td>Property</td><td>${esc(prop.name)}, ${esc(prop.location)}</td></tr>
          <tr><td>House</td><td>${esc(u.label)} ${u.type ? "· " + esc(u.type) : ""}</td></tr>
          <tr><td>Payment for</td><td>${esc(kind)}</td></tr>
          <tr><td>Method</td><td>${esc(p.method)} ${p.ref ? "· Ref " + esc(p.ref) : ""}</td></tr>
          <tr class="r-total"><td>Amount</td><td>${Store.money(p.amount)}</td></tr>
        </table>
        ${p.refunded ? '<p class="badge st-unpaid">Refunded</p>' : ""}
        <p class="muted small">Landlord / Agent: ${esc(ll.name)} · Thank you for your payment.</p>
      </div>`, { footer: `<button type="button" class="btn btn-primary" onclick="window.print()">Print / Save PDF</button>` });
  }

  /* ---------- CSV export ---------- */
  function downloadCSV(filename, rows) {
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const timeAgo = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Store.fmtDate(iso);
  };

  /* fill any element with data-logo */
  document.addEventListener("DOMContentLoaded", () => $$("[data-logo]").forEach((el) => (el.innerHTML = LOGO)));

  return { esc, $, $$, LOGO, icon, badge, toast, modal, closeModal, confirmBox, receipt, downloadCSV, timeAgo };
})();
