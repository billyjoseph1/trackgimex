/* TrackGimex — tenant dashboard */
(() => {
  const { esc, badge, icon, modal, toast, confirmBox } = UI;
  const S = Store;
  const filters = { q: "", type: "", max: "" };
  const refresh = () => Shell.render();
  const propName = (id) => S.property(id)?.name || "";
  const myNotice = (u) => u && S.db.notices.find((n) => n.unitId === u.id && S.isMine(n.tenantId) && n.status !== "completed");
  const myRequests = () => S.db.requests.filter((r) => S.isMine(r.tenantId)).sort((a, b) => b.date.localeCompare(a.date));
  const myPayments = () => S.paymentsOf((p) => S.isMine(p.tenantId));
  const houseIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>`;
  const payStatus = (p) => p.status === "confirmed" ? "" : p.status === "pending" ? badge("awaiting") : badge(p.status);

  const inviteForm = `<form id="inviteForm" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <input name="code" placeholder="Invite code e.g. 7KQ2MX9P" maxlength="12" style="max-width:240px;text-transform:uppercase" autocomplete="off">
      <button class="btn btn-outline" data-act="claim">Link my house</button></form>`;

  const views = {};

  views.home = () => {
    const me = S.me;
    const u = S.myUnit();
    if (!u) {
      const pending = myRequests().filter((r) => r.status === "pending");
      return `<div class="home-hero"><div><p class="eyebrow" style="margin-bottom:8px">Welcome, ${esc(me.name.split(" ")[0])}</p>
          <h2>You're not linked to a house yet</h2>
          <p class="muted" style="margin-top:8px;max-width:540px">Looking for a house? Browse empty houses and request or book one.
          Already renting? Enter the invite code your landlord gave you.</p>
          ${inviteForm}</div>
          <div style="align-self:center"><a class="btn btn-primary btn-lg" href="#find">${icon("search")} Find a house</a></div></div>
        ${pending.length ? `<div class="card"><div class="card-head"><h3>Your pending requests</h3><a href="#requests" class="btn btn-ghost btn-sm">View all</a></div>
          ${pending.map((r) => { const h = S.unit(r.unitId); if (!h) return ""; return `<div class="notif"><span class="n-dot" style="background:var(--amber)"></span><div style="flex:1">
            <strong>${esc(h.label)}</strong> at ${esc(propName(h.propertyId))} · ${S.money(h.rent)}/month<div class="n-time">${r.paid ? "Payment reported — waiting for the landlord" : "Waiting for the landlord"}</div></div>
            ${r.paid || h.status !== "vacant" ? "" : `<a class="btn btn-primary btn-sm" href="pay.html?unit=${h.id}&kind=booking">Pay deposit</a>`}</div>`; }).join("")}</div>` : ""}`;
    }
    const p = S.property(u.propertyId);
    const ll = S.user(p?.landlordId);
    const r = S.rentStatus(u, S.ym());
    const dep = S.depositPaid(u);
    const notice = myNotice(u);
    const months = [];
    for (let i = 1; i <= 12; i++) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      const m = S.ym(d);
      if (!u.leaseStart || m < u.leaseStart.slice(0, 7)) break;
      const st = S.rentStatus(u, m);
      if (st.balance) months.push({ m, ...st });
    }
    const pays = myPayments().slice(0, 5);
    return `
      ${notice ? `<div class="alert-box danger" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <div><strong>You gave notice to move out on ${S.fmtDate(notice.moveOutDate)}.</strong> ${notice.status === "acknowledged" ? "Your landlord has acknowledged it." : "Your landlord has been notified."}</div>
        <button class="btn btn-sm btn-outline" data-act="withdraw" data-id="${notice.id}">Withdraw notice</button></div>` : ""}
      ${months.length ? `<div class="alert-box warn">You have unpaid rent for ${months.map((x) => S.monthLabel(x.m) + " (" + S.money(x.balance) + ")").join(", ")}.</div>` : ""}
      ${r.pending ? `<div class="alert-box info">${S.money(r.pending)} for ${S.monthLabel(S.ym())} is waiting for your landlord to confirm.</div>` : ""}
      <div class="home-hero">
        <div><p class="eyebrow" style="margin-bottom:8px">My home</p>
          <h2>House ${esc(u.label)} · ${esc(p?.name)}</h2>
          <p class="muted" style="margin-top:4px">${esc(u.type)} · ${esc(p?.location)}</p>
          <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
            <a class="btn btn-primary" href="pay.html?unit=${u.id}&kind=rent">${icon("cash")} Pay rent</a>
            ${dep < u.deposit ? `<a class="btn btn-outline" href="pay.html?unit=${u.id}&kind=deposit">Pay deposit</a>` : ""}
            ${notice ? "" : `<button class="btn btn-outline" data-act="moveOut">${icon("door")} I'm moving out</button>`}
          </div></div>
        <div style="min-width:240px"><div class="muted small">${S.monthLabel(S.ym())} rent</div>
          <div style="font-size:2rem;font-weight:800">${S.money(r.paid)} <span class="muted" style="font-size:1rem">/ ${S.money(r.expected)}</span></div>
          ${badge(r.status)} ${r.balance ? `<span class="small" style="color:var(--red)">Balance ${S.money(r.balance)}</span>` : ""}
          <div class="bar"><span style="width:${r.expected ? Math.min(100, (r.paid / r.expected) * 100) : 0}%"></span></div></div>
      </div>
      <div class="two-col">
        <div class="card"><div class="card-head"><h3>Recent payments</h3><a class="btn btn-ghost btn-sm" href="#payments">All payments</a></div>
          ${pays.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>For</th><th>Method</th><th class="num">Amount</th><th></th></tr></thead><tbody>
          ${pays.map(payRow).join("")}</tbody></table></div>` : '<div class="empty">No payments yet.</div>'}</div>
        <div class="card"><div class="card-head"><h3>Lease details</h3></div>
          <dl class="kv"><dt>Monthly rent</dt><dd>${S.money(u.rent)}</dd>
            <dt>Deposit</dt><dd>${S.money(dep)} of ${S.money(u.deposit)} ${dep >= u.deposit ? "✓" : ""}</dd>
            <dt>Moved in</dt><dd>${S.fmtDate(u.leaseStart)}</dd><dt>Lease ends</dt><dd>${S.fmtDate(u.leaseEnd)}</dd>
            <dt>${esc(ll?.kind || "Landlord")}</dt><dd>${esc(ll?.name)}</dd><dt>Phone</dt><dd>${ll?.phone ? `<a href="tel:${esc(ll.phone)}">${esc(ll.phone)}</a>` : "—"}</dd></dl></div>
      </div>`;
  };

  const payRow = (p) => `<tr><td>${S.fmtDate(p.date)}</td>
    <td>${p.kind === "rent" ? "Rent · " + S.monthLabel(p.month) : "Deposit"} <span class="muted small">· ${esc(p.unitLabel)}</span> ${payStatus(p)}</td>
    <td>${esc(p.method)}${p.ref ? `<div class="muted small">${esc(p.ref)}</div>` : ""}</td><td class="num"><strong>${S.money(p.amount)}</strong></td>
    <td class="actions"><button class="btn btn-sm btn-ghost" data-act="receipt" data-id="${p.id}">${p.status === "confirmed" ? "Receipt" : "View"}</button></td></tr>`;

  views.find = () => {
    const mine = S.myUnit();
    const vacant = S.db.units.filter((u) => u.status === "vacant" && S.property(u.propertyId));
    const types = [...new Set(vacant.map((u) => u.type))].sort();
    const list = vacant.filter((u) => {
      const p = S.property(u.propertyId);
      const hay = (p.name + " " + p.location + " " + u.label + " " + u.type).toLowerCase();
      return (!filters.q || hay.includes(filters.q.toLowerCase())) && (!filters.type || u.type === filters.type) && (!filters.max || u.rent <= +filters.max);
    }).sort((a, b) => a.rent - b.rent);
    const reqd = new Set(myRequests().filter((r) => r.status === "pending").map((r) => r.unitId));
    return `${mine ? `<div class="alert-box info">You currently rent ${esc(mine.label)} at ${esc(propName(mine.propertyId))}. Give your landlord a move-out notice before moving to a new house.</div>` : ""}
      <div class="toolbar">
        <input type="search" id="fq" placeholder="Search area, building…" value="${esc(filters.q)}" style="min-width:240px">
        <select data-change="fType"><option value="">All types</option>${types.map((t) => `<option ${t === filters.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
        <select data-change="fMax"><option value="">Any rent</option>${[5000, 8000, 10000, 15000, 20000, 30000, 50000].map((v) => `<option value="${v}" ${String(v) === filters.max ? "selected" : ""}>Up to ${S.money(v)}</option>`).join("")}</select>
        <span class="spacer"></span><span class="muted small">${list.length} empty house${list.length === 1 ? "" : "s"}</span></div>
      ${list.length ? `<div class="grid grid-3">${list.map((u) => { const p = S.property(u.propertyId);
        return `<div class="house"><div class="house-img">${houseIcon}${badge("vacant")}</div>
          <div class="house-body"><h3>${esc(p.name)} · ${esc(u.label)}</h3>
            <p class="muted small">${esc(u.type)} · ${esc(p.location)}</p>
            ${p.description ? `<p class="small" style="color:#cfd2d6">${esc(p.description)}</p>` : ""}
            <div class="price">${S.money(u.rent)} <small>/ month</small></div>
            <p class="muted small">Deposit ${S.money(u.deposit)}</p>
            <div class="house-actions">
              ${reqd.has(u.id) ? `<span class="badge st-reserved" style="align-self:center">Requested</span>`
                : `<button class="btn btn-outline btn-sm" data-act="request" data-unit="${u.id}">Request</button>`}
              <a class="btn btn-primary btn-sm" href="pay.html?unit=${u.id}&kind=booking">Book &amp; pay</a></div></div></div>`; }).join("")}</div>`
        : '<div class="card empty">No empty houses match your search right now. Try again later or widen the filters.</div>'}`;
  };

  views.requests = () => {
    const list = myRequests();
    return `<div class="card"><div class="card-head"><h3>My house requests</h3></div>
      ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>House</th><th class="num">Rent</th><th>Sent</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((r) => { const u = S.unit(r.unitId); return `<tr><td><strong>${esc(u?.label || "—")}</strong> <span class="muted small">· ${esc(propName(u?.propertyId))}</span></td>
        <td class="num">${u ? S.money(u.rent) : "—"}</td><td>${S.fmtDate(r.date)}</td><td>${r.paid ? '<span class="badge st-reserved">Reported</span>' : '<span class="muted small">Not paid</span>'}</td>
        <td>${badge(r.status)}</td><td class="actions">${r.status === "pending" ? `${r.paid || !u || u.status !== "vacant" ? "" : `<a class="btn btn-sm btn-primary" href="pay.html?unit=${u.id}&kind=booking">Pay deposit</a>`}
          <button class="btn btn-sm btn-ghost" data-act="cancelReq" data-id="${r.id}">Cancel</button>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty">You haven't requested any house yet.<br><a class="btn btn-primary" href="#find">Find a house</a></div>`}</div>`;
  };

  views.payments = () => {
    const list = myPayments();
    const u = S.myUnit();
    return `<div class="toolbar"><span class="muted">${list.length} payment${list.length === 1 ? "" : "s"}</span><span class="spacer"></span>
        ${u ? `<a class="btn btn-primary btn-sm" href="pay.html?unit=${u.id}&kind=rent">${icon("cash")} Pay rent</a>` : ""}</div>
      <div class="card">${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>For</th><th>Method</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${list.map(payRow).join("")}</tbody></table></div>` : '<div class="empty">No payments yet.</div>'}</div>`;
  };

  views.notifications = (m) => Shell.notificationsView(m);

  views.profile = () => `<div class="two-col"><div class="card"><div class="card-head"><h3>My profile</h3></div>
    <form id="profileForm">
      <div class="field"><label>Full name</label><input name="name" maxlength="120" value="${esc(S.me.name)}"></div>
      <div class="field"><label>Phone</label><input name="phone" maxlength="30" value="${esc(S.me.phone)}"><p class="hint">Your landlord sees this number.</p></div>
      <div class="field"><label>Email</label><input value="${esc(S.me.email)}" disabled></div>
      <button class="btn btn-primary" data-act="saveProfile">Save</button></form></div>
    <div class="card"><div class="card-head"><h3>Link a house</h3></div>
      <p class="muted">Got an invite code from your landlord? Enter it to see your house, pay rent and give notice.</p>${inviteForm}</div></div>`;

  const actions = {
    receipt: (d) => UI.receipt(S.db.payments.find((p) => p.id === d.id)),
    fType: (d, el) => { filters.type = el.value; refresh(); },
    fMax: (d, el) => { filters.max = el.value; refresh(); },
    claim: async () => {
      const code = (UI.$("#inviteForm [name=code]").value || "").trim();
      if (!code) throw new Error("Enter the code from your landlord.");
      const house = await S.claimInvite(code);
      toast(house ? "Linked! Welcome to " + house + "." : "Linked to your landlord's record.");
      location.hash = "home"; refresh();
    },
    request: (d) => { const u = S.unit(d.unit); const p = S.property(u.propertyId);
      modal("Request " + u.label + " at " + p.name, `
        <p class="muted" style="margin-bottom:14px">${esc(u.type)} · ${S.money(u.rent)}/month · deposit ${S.money(u.deposit)}. The landlord will be notified and can approve your request.</p>
        <div class="field"><label>Message to landlord (optional)</label><textarea name="message" maxlength="1000" placeholder="When you'd like to move in, questions, etc."></textarea></div>
        <p class="hint">Want to secure it now? Use “Book &amp; pay” to pay the deposit.</p>`,
      { submitText: "Send request", onSubmit: async (f) => { await S.requestUnit(u.id, f.message.trim(), "none"); toast("Request sent to the landlord."); refresh(); } }); },
    cancelReq: (d) => confirmBox("Cancel this request?" + (S.db.requests.find((r) => r.id === d.id)?.paid ? " If you already paid, ask the landlord for a refund." : ""),
      async () => { await S.cancelRequest(d.id); toast("Request cancelled."); refresh(); }, "Cancel request"),
    moveOut: () => { const u = S.myUnit(); const min = S.today(); const owed = S.rentStatus(u, S.ym()).balance;
      modal("Give move-out notice", `
        <p class="muted" style="margin-bottom:14px">Your landlord will be notified immediately that you are leaving ${esc(u.label)} at ${esc(propName(u.propertyId))}.</p>
        <div class="field"><label>Moving out on</label><input type="date" name="date" min="${min}" value="${S.addMonths(min, 1)}" required></div>
        <div class="field"><label>Reason (optional)</label><textarea name="reason" maxlength="1000" placeholder="e.g. Relocating for work"></textarea></div>
        ${owed ? `<p class="alert-box warn small">You still owe ${S.money(owed)} for this month.</p>` : ""}`,
      { submitText: "Send notice", onSubmit: async (f) => { if (!f.date) throw new Error("Pick a date."); await S.giveNotice(u.id, f.date, f.reason.trim()); toast("Notice sent. Your landlord has been notified."); refresh(); } }); },
    withdraw: (d) => confirmBox("Withdraw your move-out notice and stay?", async () => { await S.withdrawNotice(d.id); toast("Notice withdrawn."); refresh(); }, "Withdraw"),
    saveProfile: async () => { const f = Object.fromEntries(new FormData(UI.$("#profileForm")));
      if (!f.name.trim()) throw new Error("Enter your name.");
      await S.updateProfile({ name: f.name.trim(), phone: f.phone.trim() }); toast("Profile saved."); refresh(); },
  };

  const after = {
    find: () => { const q = UI.$("#fq"); let t;
      q.oninput = () => { clearTimeout(t); t = setTimeout(() => { filters.q = q.value; refresh(); const n = UI.$("#fq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); }; },
  };

  Shell.init({
    role: "tenant",
    nav: [["home", "My home", "home"], ["find", "Find a house", "search"], ["requests", "My requests", "inbox"],
      ["payments", "Payments & receipts", "receipt"], ["notifications", "Notifications", "bell"], ["profile", "Profile", "users"]],
    views, actions, after,
    counts: (m) => ({ requests: myRequests().filter((r) => r.status === "pending").length,
      notifications: S.notificationsOf(m.id).filter((n) => !n.read).length }),
  });
})();
