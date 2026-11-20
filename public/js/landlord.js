/* TrackGimex — landlord / agent dashboard */
(() => {
  const { esc, badge, icon, modal, toast, confirmBox } = UI;
  const S = Store;
  const state = { propertyId: null, month: S.ym(), checkProp: null, checkMonth: S.ym(), rentProp: "", rentFilter: "", payProp: "", payMonth: "" };

  /* ---------- helpers ---------- */
  const myProps = () => S.propertiesOf(S.me.id);
  const myUnits = () => S.landlordUnits(S.me.id);
  const propName = (id) => S.property(id)?.name || "";
  const tenantName = (u) => (u.tenantId ? S.user(u.tenantId)?.name : "") || "";
  const STATUSES = [["vacant", "Vacant / empty"], ["occupied", "Occupied"], ["reserved", "Reserved"], ["notice", "Moving out"], ["maintenance", "Maintenance"]];
  const statusOptions = (sel) => STATUSES.map(([v, l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${l}</option>`).join("");
  const propOptions = (sel, all) => (all ? `<option value="">All properties</option>` : "") +
    myProps().map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const TYPES = ["Bedsitter", "Single room", "1 Bedroom", "2 Bedroom", "3 Bedroom", "4+ Bedroom", "Shop", "Office"];
  const typeOptions = (sel) => TYPES.map((t) => `<option ${t === sel ? "selected" : ""}>${t}</option>`).join("");
  const daysLeft = (d) => Math.ceil((new Date(d) - new Date(S.today())) / 86400000);
  const pendingRequests = () => S.db.requests.filter((r) => r.status === "pending" && myUnits().some((u) => u.id === r.unitId));
  const openNotices = () => S.db.notices.filter((n) => n.status !== "completed" && myUnits().some((u) => u.id === n.unitId));
  const myPayments = () => { const ids = myProps().map((p) => p.id); return S.paymentsOf((p) => ids.includes(p.propertyId)); };
  const pendingPays = () => S.db.payments.filter((p) => p.status === "pending" && !p.viaStk && !S.db.requests.some((r) => r.unitId === p.unitId && r.tenantId === p.tenantId && r.status === "pending"));
  const refresh = () => Shell.render();
  const noProps = () => `<div class="card empty">
      <h3 style="color:var(--text)">Add your first building</h3>
      <p>Tell us the name, location and how many houses it has. We'll create every unit for you.</p>
      <button class="btn btn-primary" data-act="addProperty">${icon("plus")} Add building</button></div>`;

  /* ======================= VIEWS ======================= */
  const views = {};

  views.overview = () => {
    if (!myProps().length) return noProps();
    const units = myUnits();
    const occ = units.filter((u) => u.tenantId).length;
    const vacant = units.filter((u) => u.status === "vacant").length;
    const rows = units.filter((u) => u.tenantId).map((u) => ({ u, r: S.rentStatus(u, S.ym()) }));
    const expected = rows.reduce((s, x) => s + x.r.expected, 0);
    const collected = rows.reduce((s, x) => s + Math.min(x.r.paid, x.r.expected), 0);
    const rate = expected ? Math.round((collected / expected) * 100) : 0;
    const arrears = rows.filter((x) => x.r.balance > 0);
    const notices = openNotices();
    const expiring = units.filter((u) => u.tenantId && u.leaseEnd && daysLeft(u.leaseEnd) <= 30);
    const reqs = pendingRequests();
    const notes = S.notificationsOf(S.me.id).slice(0, 6);
    return `
      ${notices.length ? `<div class="alert-box danger"><strong>${notices.length} move-out notice${notices.length > 1 ? "s" : ""}.</strong>
        ${notices.map((n) => `${esc(S.user(n.tenantId)?.name)} (${esc(S.unit(n.unitId)?.label)}) on ${S.fmtDate(n.moveOutDate)}`).join("; ")}.
        <a href="#moveouts">View</a></div>` : ""}
      ${pendingPays().length ? `<div class="alert-box warn"><strong>${pendingPays().length} payment${pendingPays().length > 1 ? "s" : ""}</strong> reported by tenants need your confirmation. <a href="#payments">Confirm</a></div>` : ""}
      ${reqs.length ? `<div class="alert-box info"><strong>${reqs.length} house request${reqs.length > 1 ? "s" : ""}</strong> waiting for your approval. <a href="#requests">Review</a></div>` : ""}
      ${expiring.length ? `<div class="alert-box warn"><strong>${expiring.length} lease${expiring.length > 1 ? "s" : ""}</strong> end within 30 days. <a href="#leases">Renew</a></div>` : ""}
      <div class="stats">
        <div class="stat"><div class="label">Buildings</div><div class="value">${myProps().length}</div><div class="sub">${units.length} houses in total</div></div>
        <div class="stat"><div class="label">Occupancy</div><div class="value">${units.length ? Math.round((occ / units.length) * 100) : 0}%</div>
          <div class="sub">${occ} occupied · ${vacant} empty</div><div class="bar"><span style="width:${units.length ? (occ / units.length) * 100 : 0}%"></span></div></div>
        <div class="stat"><div class="label">Collected — ${S.monthLabel(S.ym())}</div><div class="value">${S.money(collected)}</div>
          <div class="sub">of ${S.money(expected)} expected (${rate}%)</div><div class="bar"><span style="width:${rate}%"></span></div></div>
        <div class="stat"><div class="label">Outstanding this month</div><div class="value" style="color:var(--red)">${S.money(expected - collected)}</div>
          <div class="sub">${arrears.length} tenant${arrears.length === 1 ? "" : "s"} with a balance</div></div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-head"><h3>Unpaid rent this month</h3><a class="btn btn-ghost btn-sm" href="#rent">Open rent tracker</a></div>
          ${arrears.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>House</th><th>Tenant</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead><tbody>
            ${arrears.map(({ u, r }) => `<tr><td><strong>${esc(u.label)}</strong><div class="muted small">${esc(propName(u.propertyId))}</div></td>
              <td>${esc(tenantName(u))}</td><td class="num">${S.money(r.balance)}</td><td>${badge(r.status)}</td>
              <td class="actions"><button class="btn btn-sm btn-primary" data-act="recordPayment" data-unit="${u.id}">Record</button>
              <button class="btn btn-sm btn-ghost" data-act="remind" data-unit="${u.id}">Remind</button></td></tr>`).join("")}
            </tbody></table></div>` : `<div class="empty">Everyone has paid this month. 🎉</div>`}
        </div>
        <div class="card">
          <div class="card-head"><h3>Recent activity</h3><a class="btn btn-ghost btn-sm" href="#notifications">See all</a></div>
          ${notes.length ? notes.map((n) => `<div class="notif ${n.read ? "" : "unread"} ${/MOVE-OUT/.test(n.text) ? "alert" : ""}"><span class="n-dot"></span>
            <div><div>${esc(n.text)}</div><div class="n-time">${UI.timeAgo(n.date)}</div></div></div>`).join("") : '<div class="empty">No activity yet.</div>'}
        </div>
      </div>`;
  };

  views.properties = () => {
    if (state.propertyId && !S.property(state.propertyId)) state.propertyId = null;
    if (state.propertyId) return propertyDetail(S.property(state.propertyId));
    const props = myProps();
    if (!props.length) return noProps();
    return `<div class="toolbar"><span class="muted">${props.length} building${props.length > 1 ? "s" : ""}. Click one to see its houses.</span><span class="spacer"></span>
      <button class="btn btn-primary" data-act="addProperty">${icon("plus")} Add building</button></div>
      <div class="grid grid-3">${props.map((p) => {
        const us = S.unitsOf(p.id);
        const c = (s) => us.filter((u) => u.status === s).length;
        return `<div class="prop-card" data-act="openProperty" data-id="${p.id}">
          <h3>${esc(p.name)}</h3><p class="muted small">${esc(p.location)}</p>
          <p style="margin-top:10px"><strong style="font-size:1.6rem">${us.length}</strong> <span class="muted">houses</span></p>
          <div class="mini-legend">${badge("occupied").replace("Occupied", c("occupied") + " occupied")}
            ${badge("vacant").replace("Vacant", c("vacant") + " empty")}
            ${c("reserved") ? badge("reserved").replace("Reserved", c("reserved") + " reserved") : ""}
            ${c("notice") ? badge("notice").replace("Moving out", c("notice") + " moving out") : ""}
            ${c("maintenance") ? badge("maintenance").replace("Maintenance", c("maintenance") + " repair") : ""}</div></div>`;
      }).join("")}</div>`;
  };

  function propertyDetail(p) {
    const us = S.unitsOf(p.id);
    const count = (s) => us.filter((u) => u.status === s).length;
    return `<div class="toolbar">
        <button class="btn btn-ghost btn-sm" data-act="backToProps">← All buildings</button><span class="spacer"></span>
        <button class="btn btn-outline btn-sm" data-act="editProperty" data-id="${p.id}">Edit building</button>
        <button class="btn btn-danger btn-sm" data-act="deleteProperty" data-id="${p.id}">Delete</button>
        <button class="btn btn-primary btn-sm" data-act="addUnits" data-id="${p.id}">${icon("plus")} Add houses</button>
      </div>
      <div class="card">
        <div class="card-head"><div><h3 style="font-size:1.4rem">${esc(p.name)}</h3><p class="muted">${esc(p.location)}${p.description ? " · " + esc(p.description) : ""}</p></div>
          <a class="btn btn-outline btn-sm" href="#check" data-act="goCheck" data-id="${p.id}">${icon("check")} Monthly check</a></div>
        <div class="legend" style="margin-bottom:18px">
          ${STATUSES.map(([s]) => `<span>${badge(s)} <span class="muted small">${count(s)}</span></span>`).join("")}
        </div>
        ${us.length ? `<div class="unit-grid">${us.map((u) => {
          const r = S.rentStatus(u, S.ym());
          return `<button class="unit s-${u.status}" data-act="editUnit" data-id="${u.id}">
            <div class="u-label">${esc(u.label)}</div><div class="u-meta">${esc(u.type)} · ${S.money(u.rent)}</div>
            ${badge(u.status)}
            <div class="u-tenant">${u.tenantId ? esc(tenantName(u)) : "&nbsp;"}</div>
            ${u.tenantId ? `<div style="margin-top:6px">${badge(r.status)}</div>` : ""}
          </button>`;
        }).join("")}</div>` : `<div class="empty">No houses yet. <br><button class="btn btn-primary" data-act="addUnits" data-id="${p.id}">Add houses</button></div>`}
        <p class="hint" style="margin-top:14px">Tip: click a house to change its rent, status or tenant.</p>
      </div>`;
  }

  views.check = () => {
    if (!myProps().length) return noProps();
    if (!state.checkProp || !S.property(state.checkProp)) state.checkProp = myProps()[0].id;
    const us = S.unitsOf(state.checkProp);
    const last = S.lastCheck(state.checkProp, state.checkMonth);
    const history = S.db.checks.filter((c) => c.propertyId === state.checkProp).sort((a, b) => b.month.localeCompare(a.month));
    return `<div class="toolbar">
        <select data-change="setCheckProp">${propOptions(state.checkProp)}</select>
        <input type="month" value="${state.checkMonth}" data-change="setCheckMonth">
        <span class="spacer"></span>
        <button class="btn btn-outline btn-sm" data-act="checkAll" data-s="occupied">Mark all with tenants occupied</button>
      </div>
      <div class="alert-box ${last ? "info" : "warn"}">${last ? `Checked on ${S.fmtDate(last.date)} for ${S.monthLabel(state.checkMonth)}. You can update it anytime.`
        : `You have not done the check for ${S.monthLabel(state.checkMonth)} yet. Walk through the building and mark each house below.`}</div>
      <div class="card">
        <form id="checkForm">
        <div class="table-wrap"><table class="tbl"><thead><tr><th>House</th><th>Type</th><th>Tenant</th><th>Status this month</th><th>Rent (${S.monthLabel(state.checkMonth)})</th></tr></thead><tbody>
        ${us.map((u) => {
          const r = S.rentStatus(u, state.checkMonth);
          const saved = last?.items.find((i) => i.unitId === u.id)?.status;
          return `<tr><td><strong>${esc(u.label)}</strong></td><td>${esc(u.type)}</td><td>${esc(tenantName(u)) || '<span class="muted">—</span>'}</td>
            <td><select name="${u.id}">${statusOptions(saved || u.status)}</select></td>
            <td>${u.tenantId ? badge(r.status) + ` <span class="muted small">${S.money(r.paid)} / ${S.money(r.expected)}</span>` : '<span class="muted">—</span>'}</td></tr>`;
        }).join("")}
        </tbody></table></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:16px;flex-wrap:wrap">
          <span class="hint">Marking a house with a tenant as <strong>Vacant</strong> checks that tenant out.</span>
          <button class="btn btn-primary" data-act="saveCheck">Save monthly check</button></div>
        </form>
      </div>
      ${history.length ? `<div class="card"><div class="card-head"><h3>Check history</h3></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Month</th><th>Checked on</th><th>Occupied</th><th>Empty</th><th>Other</th></tr></thead><tbody>
        ${history.map((c) => { const n = (s) => c.items.filter((i) => i.status === s).length;
          return `<tr><td>${S.monthLabel(c.month)}</td><td>${S.fmtDate(c.date)}</td><td>${n("occupied")}</td><td>${n("vacant")}</td><td>${c.items.length - n("occupied") - n("vacant")}</td></tr>`; }).join("")}
        </tbody></table></div></div>` : ""}`;
  };

  function rentRows() {
    return myUnits().filter((u) => u.tenantId && (!state.rentProp || u.propertyId === state.rentProp))
      .map((u) => ({ u, r: S.rentStatus(u, state.month) }))
      .filter((x) => !state.rentFilter || x.r.status === state.rentFilter)
      .sort((a, b) => propName(a.u.propertyId).localeCompare(propName(b.u.propertyId)) || a.u.label.localeCompare(b.u.label, undefined, { numeric: true }));
  }
  views.rent = () => {
    if (!myProps().length) return noProps();
    const rows = rentRows();
    const exp = rows.reduce((s, x) => s + x.r.expected, 0);
    const paid = rows.reduce((s, x) => s + Math.min(x.r.paid, x.r.expected), 0);
    return `<div class="toolbar">
        <input type="month" value="${state.month}" data-change="setMonth">
        <select data-change="setRentProp">${propOptions(state.rentProp, true)}</select>
        <select data-change="setRentFilter">
          ${[["", "All statuses"], ["paid", "Paid"], ["partial", "Partial"], ["unpaid", "Unpaid"]].map(([v, l]) => `<option value="${v}" ${v === state.rentFilter ? "selected" : ""}>${l}</option>`).join("")}
        </select><span class="spacer"></span>
        <button class="btn btn-outline btn-sm" data-act="exportRent">Export CSV</button>
        <button class="btn btn-outline btn-sm" data-act="remindAll">Remind all unpaid</button>
        <button class="btn btn-primary btn-sm" data-act="recordPayment">${icon("plus")} Record payment</button>
      </div>
      <div class="stats">
        <div class="stat"><div class="label">Expected</div><div class="value">${S.money(exp)}</div></div>
        <div class="stat"><div class="label">Collected</div><div class="value green">${S.money(paid)}</div><div class="bar"><span style="width:${exp ? (paid / exp) * 100 : 0}%"></span></div></div>
        <div class="stat"><div class="label">Balance</div><div class="value" style="color:var(--red)">${S.money(exp - paid)}</div></div>
        <div class="stat"><div class="label">Paid / Partial / Unpaid</div><div class="value">${["paid", "partial", "unpaid"].map((s) => rows.filter((x) => x.r.status === s).length).join(" / ")}</div></div>
      </div>
      <div class="card">
        ${rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>House</th><th>Tenant</th><th>Phone</th><th class="num">Rent</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map(({ u, r }) => { const t = S.user(u.tenantId);
          return `<tr><td><strong>${esc(u.label)}</strong><div class="muted small">${esc(propName(u.propertyId))}</div></td>
          <td>${esc(t?.name)}</td><td>${esc(t?.phone)}</td><td class="num">${S.money(r.expected)}</td><td class="num">${S.money(r.paid)}</td>
          <td class="num">${r.balance ? `<strong style="color:var(--red)">${S.money(r.balance)}</strong>` : S.money(0)}</td><td>${badge(r.status)}</td>
          <td class="actions">${r.balance ? `<button class="btn btn-sm btn-primary" data-act="recordPayment" data-unit="${u.id}">Record</button>
            <button class="btn btn-sm btn-ghost" data-act="markPaid" data-unit="${u.id}">Mark paid</button>
            <button class="btn btn-sm btn-ghost" data-act="remind" data-unit="${u.id}">Remind</button>` : '<span class="muted small">Cleared ✓</span>'}</td></tr>`; }).join("")}
        </tbody></table></div>` : '<div class="empty">No tenants match these filters.</div>'}
      </div>`;
  };

  views.tenants = () => {
    if (!myProps().length) return noProps();
    const occupied = myUnits().filter((u) => u.tenantId).sort((a, b) => propName(a.propertyId).localeCompare(propName(b.propertyId)) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    return `<div class="toolbar"><input type="search" placeholder="Search name, phone or house…" id="tSearch" style="min-width:260px">
        <span class="spacer"></span>
        <button class="btn btn-outline btn-sm" data-act="announce">${icon("megaphone")} Send announcement</button>
        <button class="btn btn-primary btn-sm" data-act="assignTenant">${icon("plus")} Add tenant</button></div>
      <div class="card">${occupied.length ? `<div class="table-wrap"><table class="tbl" id="tTable"><thead><tr><th>Tenant</th><th>Phone</th><th>House</th><th>Moved in</th><th>Lease ends</th><th class="num">Deposit</th><th>This month</th><th></th></tr></thead><tbody>
        ${occupied.map((u) => { const t = S.user(u.tenantId) || { name: "—", phone: "" }; const r = S.rentStatus(u, S.ym()); const dep = S.depositPaid(u);
          return `<tr data-search="${esc((t.name + " " + t.phone + " " + u.label + " " + propName(u.propertyId)).toLowerCase())}">
          <td><strong>${esc(t.name)}</strong><div class="muted small">${t.hasAccount ? "✓ Has TrackGimex account"
            : t.inviteCode ? `No account yet · code <strong style="color:var(--text)">${esc(t.inviteCode)}</strong> <a href="#" data-act="shareCode" data-tenant="${t.id}">Share</a>` : "No account yet"}</div></td>
          <td>${esc(t.phone)}</td><td>${esc(u.label)} <span class="muted small">· ${esc(propName(u.propertyId))}</span> ${u.status === "notice" ? badge("notice") : ""}</td>
          <td>${S.fmtDate(u.leaseStart)}</td><td>${S.fmtDate(u.leaseEnd)}</td>
          <td class="num">${dep >= u.deposit ? S.money(dep) : `<span style="color:var(--amber)">${S.money(dep)} / ${S.money(u.deposit)}</span>`}</td>
          <td>${badge(r.status)}</td>
          <td class="actions"><button class="btn btn-sm btn-ghost" data-act="message" data-unit="${u.id}">Message</button>
            <button class="btn btn-sm btn-danger" data-act="vacate" data-unit="${u.id}">Check out</button></td></tr>`; }).join("")}
        </tbody></table></div>` : `<div class="empty">No tenants yet.<br><button class="btn btn-primary" data-act="assignTenant">Add tenant</button></div>`}</div>`;
  };

  // payments a tenant reported for a house request (booking)
  const requestPayments = (r) => S.db.payments.filter((p) => p.unitId === r.unitId && p.tenantId === r.tenantId && p.status !== "cancelled");

  views.requests = () => {
    const ids = myUnits().map((u) => u.id);
    const list = S.db.requests.filter((r) => ids.includes(r.unitId)).sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1) || b.date.localeCompare(a.date));
    return `<div class="card"><div class="card-head"><h3>House requests &amp; bookings</h3><span class="muted small">Tenants ask for empty houses here. Approving moves them in and confirms their booking payment.</span></div>
      ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Tenant</th><th>House</th><th class="num">Rent</th><th>Payment reported</th><th>Message</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((r) => { const u = S.unit(r.unitId); const t = S.user(r.tenantId); const pays = requestPayments(r);
        return `<tr><td><strong>${esc(t?.name)}</strong><div class="muted small">${esc(t?.phone)} ${esc(t?.email)}</div></td>
        <td>${esc(u?.label)}<div class="muted small">${esc(propName(u?.propertyId))}</div></td><td class="num">${S.money(u?.rent)}</td>
        <td>${pays.length ? pays.map((p) => `<div>${S.money(p.amount)} ${esc(p.kind)} · ${esc(p.method)} <strong>${esc(p.ref)}</strong> ${badge(p.status === "pending" ? "awaiting" : p.status)}</div>`).join("")
          : '<span class="muted small">Not paid</span>'}
          ${r.status === "pending" && pays.some((p) => p.status === "pending") ? '<div class="hint">Check this code on your M-Pesa / bank statement before approving.</div>' : ""}</td>
        <td style="max-width:240px">${esc(r.message) || '<span class="muted">—</span>'}</td><td>${S.fmtDate(r.date)}</td><td>${badge(r.status)}</td>
        <td class="actions">${r.status === "pending" ? `<button class="btn btn-sm btn-primary" data-act="approve" data-id="${r.id}">Approve</button>
          <button class="btn btn-sm btn-danger" data-act="decline" data-id="${r.id}">Decline</button>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>` : '<div class="empty">No requests yet. Tenants who register can see your empty houses and request them.</div>'}</div>`;
  };

  views.moveouts = () => {
    const ids = myUnits().map((u) => u.id);
    const list = S.db.notices.filter((n) => ids.includes(n.unitId)).sort((a, b) => (a.status === "completed") - (b.status === "completed") || a.moveOutDate.localeCompare(b.moveOutDate));
    return `<div class="card"><div class="card-head"><h3>Move-out notices</h3><span class="muted small">Tenants who said they are leaving. You are notified the moment they submit.</span></div>
      ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Tenant</th><th>House</th><th>Notice given</th><th>Moving out on</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((n) => { const u = S.unit(n.unitId); const t = S.user(n.tenantId); const d = daysLeft(n.moveOutDate); const r = u && u.tenantId === n.tenantId ? S.rentStatus(u, S.ym()) : null;
        return `<tr><td><strong>${esc(t?.name)}</strong><div class="muted small">${esc(t?.phone)}</div></td>
        <td>${esc(u?.label)}<div class="muted small">${esc(propName(u?.propertyId))}</div></td><td>${S.fmtDate(n.date)}</td>
        <td>${S.fmtDate(n.moveOutDate)}${n.status !== "completed" ? `<div class="small" style="color:${d <= 7 ? "var(--red)" : "var(--muted)"}">${d >= 0 ? d + " days left" : "date passed"}</div>` : ""}</td>
        <td style="max-width:220px">${esc(n.reason) || '<span class="muted">—</span>'}</td><td>${badge(n.status)}
          ${n.status !== "completed" && r && r.balance ? `<div class="small" style="color:var(--amber)">Owes ${S.money(r.balance)}</div>` : ""}</td>
        <td class="actions">${n.status === "pending" ? `<button class="btn btn-sm btn-outline" data-act="ackNotice" data-id="${n.id}">Acknowledge</button>` : ""}
          ${n.status !== "completed" && u && u.tenantId === n.tenantId ? `<button class="btn btn-sm btn-primary" data-act="vacate" data-unit="${u.id}">Mark house empty</button>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>` : '<div class="empty">No move-out notices.</div>'}</div>`;
  };

  const forLabel = (p) => p.kind === "rent" ? "Rent · " + S.monthLabel(p.month) : "Deposit";
  views.payments = () => {
    const pending = myPayments().filter((p) => p.status === "pending" && !p.viaStk);
    const list = myPayments().filter((p) => p.status !== "pending" && !(p.viaStk && p.status === "cancelled") && (!state.payProp || p.propertyId === state.payProp) && (!state.payMonth || p.date.slice(0, 7) === state.payMonth));
    const total = list.filter((p) => p.status === "confirmed").reduce((s, p) => s + p.amount, 0);
    return `${pending.length ? `<div class="card" style="border-color:rgba(242,180,65,.45)"><div class="card-head"><h3>Waiting for your confirmation (${pending.length})</h3>
        <span class="muted small">Tenants say they paid. Check each code on your M-Pesa / bank statement, then confirm.</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Reported</th><th>Tenant</th><th>House</th><th>For</th><th>Method &amp; code</th><th class="num">Amount</th><th></th></tr></thead><tbody>
        ${pending.map((p) => { const req = S.db.requests.find((r) => r.unitId === p.unitId && r.tenantId === p.tenantId && r.status === "pending");
          return `<tr><td>${UI.timeAgo(p.date)}</td><td>${esc(S.user(p.tenantId)?.name)}</td>
          <td>${esc(p.unitLabel)} <span class="muted small">· ${esc(propName(p.propertyId))}</span></td><td>${forLabel(p)}${req ? '<div class="muted small">House booking</div>' : ""}</td>
          <td>${esc(p.method)} <strong>${esc(p.ref)}</strong></td><td class="num"><strong>${S.money(p.amount)}</strong></td>
          <td class="actions">${req ? `<a class="btn btn-sm btn-outline" href="#requests">Review booking</a>`
            : `<button class="btn btn-sm btn-primary" data-act="confirmPay" data-id="${p.id}">Confirm</button>
               <button class="btn btn-sm btn-danger" data-act="rejectPay" data-id="${p.id}">Reject</button>`}</td></tr>`; }).join("")}
        </tbody></table></div></div>` : ""}
      <div class="toolbar"><select data-change="setPayProp">${propOptions(state.payProp, true)}</select>
        <input type="month" value="${state.payMonth}" data-change="setPayMonth" title="Filter by date paid">
        ${state.payMonth ? `<button class="btn btn-ghost btn-sm" data-act="clearPayMonth">Clear month</button>` : ""}
        <span class="spacer"></span><strong>${S.money(total)}</strong><span class="muted small">confirmed</span>
        <button class="btn btn-outline btn-sm" data-act="exportPayments">Export CSV</button>
        <button class="btn btn-primary btn-sm" data-act="recordPayment">${icon("plus")} Record payment</button></div>
      <div class="card">${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Receipt</th><th>Tenant</th><th>House</th><th>For</th><th>Method</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td>${S.fmtDate(p.date)}</td><td>${esc(p.receiptNo)}</td><td>${esc(S.user(p.tenantId)?.name)}</td>
        <td>${esc(p.unitLabel || "—")} <span class="muted small">· ${esc(propName(p.propertyId))}</span></td>
        <td>${forLabel(p)} ${p.status !== "confirmed" ? badge(p.status) : ""}</td>
        <td>${esc(p.method)}${p.ref ? `<div class="muted small">${esc(p.ref)}</div>` : ""}</td><td class="num"><strong>${S.money(p.amount)}</strong></td>
        <td class="actions"><button class="btn btn-sm btn-ghost" data-act="receipt" data-id="${p.id}">${p.status === "confirmed" ? "Receipt" : "View"}</button>
        ${p.recordedBy === S.me.id ? `<button class="btn btn-sm btn-ghost" data-act="deletePayment" data-id="${p.id}" title="Delete">✕</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : '<div class="empty">No payments found.</div>'}</div>`;
  };

  views.expenses = () => {
    const month = state.month;
    const ex = S.db.expenses.filter((e) => e.landlordId === S.me.id).sort((a, b) => b.date.localeCompare(a.date));
    const exMonth = ex.filter((e) => e.date.slice(0, 7) === month);
    const income = myPayments().filter((p) => p.status === "confirmed" && p.kind === "rent" && p.month === month).reduce((s, p) => s + p.amount, 0);
    const spent = exMonth.reduce((s, e) => s + e.amount, 0);
    return `<div class="toolbar"><input type="month" value="${month}" data-change="setMonth"><span class="spacer"></span>
        <button class="btn btn-primary btn-sm" data-act="addExpense">${icon("plus")} Add expense</button></div>
      <div class="stats">
        <div class="stat"><div class="label">Rent collected · ${S.monthLabel(month)}</div><div class="value green">${S.money(income)}</div></div>
        <div class="stat"><div class="label">Expenses · ${S.monthLabel(month)}</div><div class="value" style="color:var(--amber)">${S.money(spent)}</div></div>
        <div class="stat"><div class="label">Net income</div><div class="value">${S.money(income - spent)}</div></div>
      </div>
      <div class="card"><div class="card-head"><h3>All expenses</h3></div>
      ${ex.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Building</th><th>Category</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${ex.map((e) => `<tr><td>${S.fmtDate(e.date)}</td><td>${esc(propName(e.propertyId)) || "General"}</td><td>${esc(e.category)}</td><td>${esc(e.note)}</td>
        <td class="num">${S.money(e.amount)}</td><td class="actions"><button class="btn btn-sm btn-ghost" data-act="deleteExpense" data-id="${e.id}">✕</button></td></tr>`).join("")}
      </tbody></table></div>` : '<div class="empty">No expenses recorded.</div>'}</div>`;
  };

  views.leases = () => {
    const list = myUnits().filter((u) => u.tenantId).sort((a, b) => (a.leaseEnd || "9").localeCompare(b.leaseEnd || "9"));
    return `<div class="card"><div class="card-head"><h3>Leases</h3><span class="muted small">Sorted by end date. Renew before they expire.</span></div>
      ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Tenant</th><th>House</th><th>Start</th><th>End</th><th>Days left</th><th></th></tr></thead><tbody>
      ${list.map((u) => { const d = u.leaseEnd ? daysLeft(u.leaseEnd) : null;
        return `<tr><td>${esc(tenantName(u))}</td><td>${esc(u.label)} <span class="muted small">· ${esc(propName(u.propertyId))}</span></td>
        <td>${S.fmtDate(u.leaseStart)}</td><td>${S.fmtDate(u.leaseEnd)}</td>
        <td>${d === null ? "—" : d < 0 ? badge("unpaid").replace("Unpaid", "Expired") : d <= 30 ? `<span class="badge st-reserved">${d} days</span>` : d + " days"}</td>
        <td class="actions"><button class="btn btn-sm btn-outline" data-act="renew" data-unit="${u.id}" data-m="6">+6 months</button>
          <button class="btn btn-sm btn-primary" data-act="renew" data-unit="${u.id}" data-m="12">+12 months</button></td></tr>`; }).join("")}
      </tbody></table></div>` : '<div class="empty">No active leases.</div>'}</div>`;
  };

  views.notifications = (m) => Shell.notificationsView(m);

  views.settings = () => `<div class="two-col">
      <div class="card"><div class="card-head"><h3>My profile</h3></div>
        <form id="profileForm">
          <div class="field"><label>Full name</label><input name="name" value="${esc(S.me.name)}"></div>
          <div class="field-row"><div class="field"><label>Phone</label><input name="phone" value="${esc(S.me.phone)}"></div>
          <div class="field"><label>Role</label><select name="kind">${["Landlord", "Agent", "Caretaker"].map((k) => `<option ${k === S.me.kind ? "selected" : ""}>${k}</option>`).join("")}</select></div></div>
          <div class="field"><label>Email</label><input value="${esc(S.me.email)}" disabled></div>
          <div class="field"><label>How tenants should pay you</label>
            <textarea name="payoutInfo" maxlength="500" placeholder="e.g. M-Pesa Paybill 123456, Account: your house number (e.g. A4). Or Till 987654.">${esc(S.me.payoutInfo)}</textarea>
            <p class="hint">Shown to your tenants on the payment page. They pay you directly, then enter the M-Pesa code for you to confirm.</p></div>
          <button class="btn btn-primary" data-act="saveProfile">Save</button>
        </form></div>
      <div class="card"><div class="card-head"><h3>Your records</h3></div>
        <p class="muted" style="margin-bottom:14px">Your data is stored securely online and is available on any device you log in from. You can also download a copy.</p>
        <button class="btn btn-outline" data-act="exportPayments">Export all payments (CSV)</button></div></div>
      <div class="card" style="margin-top:20px"><div class="card-head"><h3>M-Pesa payments</h3>
        <span class="muted small">Tenants get a PIN prompt on their phone; the money goes straight to your Paybill / Till and is confirmed automatically.</span></div>
        <div id="mpesaBox"><p class="muted">Checking M-Pesa connection…</p></div></div>`;

  /* ======================= MODALS ======================= */
  function propertyModal(p) {
    const isNew = !p;
    modal(isNew ? "Add a building" : "Edit building", `
      <div class="field"><label>Building / plot name</label><input name="name" required maxlength="120" value="${esc(p?.name)}" placeholder="e.g. Sunrise Apartments"></div>
      <div class="field"><label>Location</label><input name="location" required maxlength="160" value="${esc(p?.location)}" placeholder="e.g. Kasarani, Nairobi"></div>
      <div class="field"><label>Description (shown to tenants)</label><textarea name="description" maxlength="1000" placeholder="Water, security, parking…">${esc(p?.description)}</textarea></div>
      ${isNew ? `<h4 style="margin:6px 0 12px">Houses in this building</h4>
      <div class="field-row">
        <div class="field"><label>Number of houses</label><input name="count" type="number" min="1" max="500" value="10" required></div>
        <div class="field"><label>Label prefix</label><input name="prefix" value="A" maxlength="6"><p class="hint">Houses will be A1, A2, A3…</p></div>
      </div>
      <div class="field-row">
        <div class="field"><label>House type</label><select name="type">${typeOptions("1 Bedroom")}</select></div>
        <div class="field"><label>Monthly rent (Ksh)</label><input name="rent" type="number" min="0" value="10000"></div>
        <div class="field"><label>Deposit (Ksh)</label><input name="deposit" type="number" min="0" value="10000"></div>
      </div><p class="hint">You can change the rent and type of each house later. Mixed buildings? Add the rest with “Add houses”.</p>` : ""}`,
    { submitText: isNew ? "Create building" : "Save", onSubmit: async (d) => {
      if (!d.name.trim() || !d.location.trim()) throw new Error("Name and location are required.");
      if (isNew) {
        if (!(+d.count >= 1)) throw new Error("Enter how many houses the building has.");
        state.propertyId = await S.addProperty(S.me.id, d);
        toast(`${d.name} created with ${d.count} houses.`);
        location.hash = "properties";
      } else { await S.updateProperty(p.id, { name: d.name.trim(), location: d.location.trim(), description: d.description }); toast("Building updated."); }
      refresh();
    } });
  }

  function addUnitsModal(pid) {
    const last = S.unitsOf(pid).slice(-1)[0];
    const prefix = last ? last.label.replace(/\d+$/, "") : "A";
    modal("Add houses to " + propName(pid), `
      <div class="field-row"><div class="field"><label>How many?</label><input name="count" type="number" min="1" max="500" value="1" required></div>
        <div class="field"><label>Label prefix</label><input name="prefix" value="${esc(prefix)}" maxlength="6"><p class="hint">Numbering continues after the last house.</p></div></div>
      <div class="field-row"><div class="field"><label>Type</label><select name="type">${typeOptions(last?.type || "1 Bedroom")}</select></div>
        <div class="field"><label>Rent (Ksh)</label><input name="rent" type="number" min="0" value="${last?.rent || 10000}"></div>
        <div class="field"><label>Deposit (Ksh)</label><input name="deposit" type="number" min="0" value="${last?.deposit || 10000}"></div></div>`,
    { submitText: "Add houses", onSubmit: async (d) => {
      if (!(+d.count >= 1)) throw new Error("Enter a number of houses.");
      await S.addUnits(pid, d); toast(d.count + " house(s) added."); refresh();
    } });
  }

  function unitModal(id) {
    const u = S.unit(id);
    const t = u.tenantId ? S.user(u.tenantId) : null;
    const r = S.rentStatus(u, S.ym());
    modal("House " + u.label + " · " + propName(u.propertyId), `
      ${t ? `<div class="alert-box info" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div><strong>${esc(t.name)}</strong> · ${esc(t.phone)}<br><span class="small">Rent ${S.monthLabel(S.ym())}: ${S.money(r.paid)} of ${S.money(r.expected)} · Deposit ${S.money(S.depositPaid(u))}</span></div>
        <div>${badge(r.status)}</div></div>` : ""}
      <div class="field-row"><div class="field"><label>House label</label><input name="label" value="${esc(u.label)}" maxlength="20" required></div>
        <div class="field"><label>Type</label><select name="type">${typeOptions(u.type)}</select></div></div>
      <div class="field-row"><div class="field"><label>Monthly rent (Ksh)</label><input name="rent" type="number" min="0" value="${u.rent}"></div>
        <div class="field"><label>Deposit (Ksh)</label><input name="deposit" type="number" min="0" value="${u.deposit}"></div></div>
      <div class="field"><label>Status</label><select name="status">${statusOptions(u.status)}</select>
        ${t ? '<p class="hint">Setting Vacant or Maintenance will check the tenant out.</p>' : ""}</div>
      ${t ? `<div class="field-row"><div class="field"><label>Lease start</label><input type="date" name="leaseStart" value="${u.leaseStart || ""}"></div>
        <div class="field"><label>Lease end</label><input type="date" name="leaseEnd" value="${u.leaseEnd || ""}"></div></div>` : ""}`,
    { wide: true, submitText: "Save house",
      footer: `<button type="button" class="btn btn-danger btn-sm" data-act="deleteUnit" data-id="${u.id}" style="margin-right:auto">Delete house</button>
        ${t ? `<button type="button" class="btn btn-outline btn-sm" data-act="recordPayment" data-unit="${u.id}">Record payment</button>`
            : `<button type="button" class="btn btn-outline btn-sm" data-act="assignTenant" data-unit="${u.id}">Add tenant</button>`}`,
      onSubmit: async (d) => {
        if (!d.label.trim()) throw new Error("Label is required.");
        if (S.unitsOf(u.propertyId).some((x) => x.id !== u.id && x.label.toLowerCase() === d.label.trim().toLowerCase())) throw new Error("Another house already uses that label.");
        if (!t && (d.status === "occupied" || d.status === "notice")) { toast("Use “Add tenant” to put someone in this house.", "err"); return false; }
        const checkingOut = t && (d.status === "vacant" || d.status === "maintenance");
        await S.updateUnit(u.id, { label: d.label.trim(), type: d.type, rent: d.rent, deposit: d.deposit, status: d.status,
          leaseStart: checkingOut ? null : d.leaseStart, leaseEnd: checkingOut ? null : d.leaseEnd });
        toast("House " + d.label + " saved."); refresh();
      } });
  }

  const inviteText = (t) => {
    const u = S.tenantUnit(t.id);
    return `Hello ${t.name}, your house ${u ? u.label + " at " + propName(u.propertyId) : ""} is on TrackGimex. ` +
      `Create a tenant account at ${new URL("login.html?role=tenant&mode=register", location.href).href} ` +
      `and enter this code to link your house: ${t.inviteCode}`;
  };
  function showInvite(t) {
    const txt = inviteText(t);
    const phone = (t.phone || "").replace(/\D/g, "").replace(/^0/, "254");
    modal("Invite " + t.name, `
      <p class="muted">Give ${esc(t.name)} this code. When they create a tenant account and enter it, they can pay rent and give notice online.</p>
      <div class="code-box">${esc(t.inviteCode)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="https://wa.me/${phone}?text=${encodeURIComponent(txt)}">Send on WhatsApp</a>
        <a class="btn btn-outline btn-sm" href="sms:${esc(t.phone)}?body=${encodeURIComponent(txt)}">Send SMS</a>
        <button type="button" class="btn btn-outline btn-sm" id="copyInvite">Copy message</button></div>`);
    UI.$("#copyInvite").onclick = async () => { try { await navigator.clipboard.writeText(txt); toast("Copied."); } catch (e) { toast("Copy failed — select the code and copy it.", "err"); } };
  }

  function assignTenantModal(unitId) {
    const free = myUnits().filter((u) => !u.tenantId && u.status !== "maintenance");
    if (!free.length) return toast("All your houses are occupied. Add more houses first.", "err");
    modal("Add a tenant", `
      <div class="field"><label>House</label><select name="unitId" required>${free.map((u) =>
        `<option value="${u.id}" ${u.id === unitId ? "selected" : ""}>${esc(propName(u.propertyId))} — ${esc(u.label)} (${esc(u.type)}, ${S.money(u.rent)})</option>`).join("")}</select></div>
      <div class="field"><label>Full name</label><input name="name" required maxlength="120"></div>
      <div class="field-row"><div class="field"><label>Phone</label><input name="phone" placeholder="07XX XXX XXX" required maxlength="30"></div>
        <div class="field"><label>Email (optional)</label><input name="email" type="email" maxlength="254"></div></div>
      <p class="hint" style="margin:-6px 0 14px">You'll get an invite code to send them. If they sign up with this email, their house is linked automatically.</p>
      <div class="field-row"><div class="field"><label>Move-in date</label><input type="date" name="start" value="${S.today()}"></div>
        <div class="field"><label>Lease length</label><select name="months"><option value="6">6 months</option><option value="12" selected>12 months</option><option value="24">24 months</option></select></div></div>
      <label class="check"><input type="checkbox" name="depositPaid"> Deposit already paid (record as cash)</label>
      <label class="check" style="margin-top:8px"><input type="checkbox" name="rentPaid"> This month's rent already paid (record as cash)</label>`,
    { submitText: "Add tenant", onSubmit: async (d) => {
      if (!d.name.trim() || !d.phone.trim()) throw new Error("Name and phone are required.");
      if (d.email && !/^\S+@\S+\.\S+$/.test(d.email.trim())) throw new Error("That email doesn't look right.");
      const res = await S.addTenant({ ...d, name: d.name.trim(), phone: d.phone.trim(), email: d.email.trim() });
      const u = S.unit(d.unitId);
      toast(d.name + " moved into " + u.label + ".");
      refresh();
      if (!res.linked) setTimeout(() => showInvite(S.user(res.tenant_id)), 50);
    } });
  }

  function paymentModal(unitId) {
    const occ = myUnits().filter((u) => u.tenantId);
    if (!occ.length) return toast("You have no tenants yet.", "err");
    const u0 = S.unit(unitId) || occ[0];
    const r0 = S.rentStatus(u0, state.month);
    modal("Record a payment", `
      <div class="field"><label>House / tenant</label><select name="unitId" id="pmUnit">${occ.map((u) =>
        `<option value="${u.id}" ${u.id === u0.id ? "selected" : ""}>${esc(u.label)} · ${esc(propName(u.propertyId))} — ${esc(tenantName(u))}</option>`).join("")}</select></div>
      <div class="field-row"><div class="field"><label>Payment for</label><select name="kind" id="pmKind"><option value="rent">Rent</option><option value="deposit">Deposit</option></select></div>
        <div class="field" id="pmMonthF"><label>Month</label><input type="month" name="month" id="pmMonth" value="${state.month}"></div></div>
      <div class="field-row"><div class="field"><label>Amount (Ksh)</label><input type="number" name="amount" id="pmAmt" min="1" value="${r0.balance || u0.rent}" required></div>
        <div class="field"><label>Method</label><select name="method"><option>Cash</option><option>M-Pesa</option><option>Bank</option><option>Cheque</option></select></div></div>
      <div class="field"><label>Reference (M-Pesa code / bank ref)</label><input name="ref" maxlength="60" placeholder="optional"></div>`,
    { submitText: "Save & issue receipt", onSubmit: async (d) => {
      if (!(+d.amount > 0)) throw new Error("Enter an amount.");
      const p = await S.recordPayment(d);
      toast("Payment saved. Receipt " + p.receiptNo);
      refresh();
      setTimeout(() => UI.receipt(p), 50);
    } });
    const upd = () => {
      const u = S.unit(UI.$("#pmUnit").value);
      const k = UI.$("#pmKind").value;
      UI.$("#pmMonthF").hidden = k !== "rent";
      UI.$("#pmAmt").value = k === "rent" ? (S.rentStatus(u, UI.$("#pmMonth").value).balance || u.rent) : Math.max(0, u.deposit - S.depositPaid(u)) || u.deposit;
    };
    ["#pmUnit", "#pmKind", "#pmMonth"].forEach((s) => UI.$(s).addEventListener("change", upd));
  }

  function remindText(u) {
    const r = S.rentStatus(u, state.month);
    return `Reminder: your rent balance of ${S.money(r.balance)} for ${S.monthLabel(state.month)} (house ${u.label}, ${propName(u.propertyId)}) is due. Please pay and enter the M-Pesa code in TrackGimex, or contact your landlord.`;
  }

  /* ======================= ACTIONS ======================= */
  const actions = {
    addProperty: () => propertyModal(null),
    editProperty: (d) => propertyModal(S.property(d.id)),
    deleteProperty: (d) => confirmBox(`Delete ${propName(d.id)} and all its houses? Payment history is kept.`, async () => {
      await S.deleteProperty(d.id); state.propertyId = null; toast("Building deleted."); refresh(); }, "Delete building"),
    openProperty: (d) => { state.propertyId = d.id; refresh(); },
    backToProps: () => { state.propertyId = null; refresh(); },
    addUnits: (d) => addUnitsModal(d.id),
    editUnit: (d) => unitModal(d.id),
    deleteUnit: (d) => { const u = S.unit(d.id);
      if (u.tenantId) return toast("Check the tenant out before deleting this house.", "err");
      confirmBox("Delete house " + u.label + "?", async () => { await S.deleteUnit(d.id); toast("House deleted."); refresh(); }, "Delete"); },
    goCheck: (d) => { state.checkProp = d.id; location.hash = "check"; },
    setCheckProp: (d, el) => { state.checkProp = el.value; refresh(); },
    setCheckMonth: (d, el) => { state.checkMonth = el.value || S.ym(); refresh(); },
    checkAll: () => UI.$$("#checkForm select").forEach((s) => { const u = S.unit(s.name); if (u.tenantId && u.status !== "notice") s.value = "occupied"; }),
    saveCheck: async () => {
      const items = UI.$$("#checkForm select").map((s) => ({ unitId: s.name, status: s.value }));
      const out = items.filter((i) => { const u = S.unit(i.unitId); return u.tenantId && (i.status === "vacant" || i.status === "maintenance"); });
      const badOcc = items.filter((i) => { const u = S.unit(i.unitId); return !u.tenantId && (i.status === "occupied" || i.status === "notice"); });
      const go = async () => {
        await S.saveCheck(S.me.id, state.checkProp, state.checkMonth, items);
        toast(`Check for ${S.monthLabel(state.checkMonth)} saved.` + (badOcc.length ? ` ${badOcc.map((i) => S.unit(i.unitId).label).join(", ")} need a tenant added before they can be occupied.` : ""));
        refresh();
      };
      if (out.length) confirmBox(`This will check out the tenant(s) in ${out.map((i) => S.unit(i.unitId).label).join(", ")}. Continue?`, go);
      else await go();
    },
    setMonth: (d, el) => { state.month = el.value || S.ym(); refresh(); },
    setRentProp: (d, el) => { state.rentProp = el.value; refresh(); },
    setRentFilter: (d, el) => { state.rentFilter = el.value; refresh(); },
    setPayProp: (d, el) => { state.payProp = el.value; refresh(); },
    setPayMonth: (d, el) => { state.payMonth = el.value; refresh(); },
    clearPayMonth: () => { state.payMonth = ""; refresh(); },
    recordPayment: (d) => paymentModal(d.unit),
    confirmPay: async (d) => { await S.reviewPayment(d.id, true); toast("Payment confirmed. The tenant has been notified."); refresh(); },
    rejectPay: (d) => confirmBox("Reject this payment? Only do this if the code is not on your statement.", async () => {
      await S.reviewPayment(d.id, false); toast("Payment rejected. The tenant has been notified."); refresh(); }, "Reject"),
    markPaid: (d) => { const u = S.unit(d.unit); const r = S.rentStatus(u, state.month);
      confirmBox(`Record ${S.money(r.balance)} cash for ${u.label} (${S.monthLabel(state.month)})?`, async () => {
        const p = await S.recordPayment({ unitId: u.id, kind: "rent", month: state.month, amount: r.balance, method: "Cash", ref: "" });
        toast("Marked as paid. Receipt " + p.receiptNo); refresh(); }, "Mark paid"); },
    remind: async (d) => { const u = S.unit(d.unit); const t = S.user(u.tenantId);
      const ok = await S.notifyTenant(u.id, remindText(u));
      toast(ok ? "Reminder sent to " + t.name + "." : t.name + " has no TrackGimex account yet. Call or SMS them on " + t.phone + "."); },
    remindAll: async () => { const rows = rentRows().filter((x) => x.r.balance > 0);
      let sent = 0;
      for (const { u } of rows) if (await S.notifyTenant(u.id, remindText(u))) sent++;
      toast(rows.length ? `Reminders sent to ${sent} tenant(s).` + (rows.length > sent ? ` ${rows.length - sent} have no account yet — call or SMS them.` : "") : "Nobody owes rent for this month."); },
    exportRent: () => UI.downloadCSV(`rent-${state.month}.csv`, [["Building", "House", "Tenant", "Phone", "Rent", "Paid", "Balance", "Status"],
      ...rentRows().map(({ u, r }) => [propName(u.propertyId), u.label, tenantName(u), S.user(u.tenantId)?.phone, r.expected, r.paid, r.balance, r.status])]),
    exportPayments: () => UI.downloadCSV("payments.csv", [["Date", "Receipt", "Building", "House", "Tenant", "For", "Month", "Method", "Ref", "Amount", "Status"],
      ...myPayments().map((p) => [p.date.slice(0, 10), p.receiptNo, propName(p.propertyId), p.unitLabel, S.user(p.tenantId)?.name, p.kind, p.month || "", p.method, p.ref, p.amount, p.status])]),
    receipt: (d) => UI.receipt(S.db.payments.find((p) => p.id === d.id)),
    deletePayment: (d) => confirmBox("Delete this payment record?", async () => { await S.deletePayment(d.id); toast("Payment deleted."); refresh(); }, "Delete"),
    assignTenant: (d) => assignTenantModal(d.unit),
    shareCode: (d) => showInvite(S.user(d.tenant)),
    vacate: (d) => { const u = S.unit(d.unit); const r = S.rentStatus(u, S.ym());
      confirmBox(`Check ${tenantName(u)} out of ${u.label}? The house will be marked empty and shown to house hunters.` + (r.balance ? ` Note: they still owe ${S.money(r.balance)} this month.` : ""),
        async () => { await S.vacateUnit(u.id); toast(u.label + " is now empty."); refresh(); }, "Check out"); },
    message: (d) => { const u = S.unit(d.unit); const t = S.user(u.tenantId);
      modal("Message " + t.name, `<div class="field"><label>Message</label><textarea name="text" maxlength="900" required></textarea></div>
        ${t.hasAccount ? "" : `<p class="hint">${esc(t.name)} hasn't joined TrackGimex yet, so they won't see this. Call or SMS ${esc(t.phone)}, or send them their invite code.</p>`}`,
      { submitText: "Send", onSubmit: async (f) => { if (!f.text.trim()) throw new Error("Type a message.");
        const ok = await S.notifyTenant(u.id, "Message from " + S.me.name + ": " + f.text.trim());
        toast(ok ? "Message sent." : t.name + " has no account yet — message not delivered."); } }); },
    announce: () => modal("Send announcement", `
      <div class="field"><label>To tenants of</label><select name="prop">${propOptions("", true).replace("All properties", "All my buildings")}</select></div>
      <div class="field"><label>Message</label><textarea name="text" maxlength="900" required placeholder="e.g. Water will be off on Saturday from 9am to 1pm."></textarea></div>`,
    { submitText: "Send to all", onSubmit: async (f) => {
      if (!f.text.trim()) throw new Error("Type a message.");
      const r = await S.announce(f.prop, f.text.trim());
      toast(`Announcement sent to ${r.sent} tenant(s).` + (r.offline ? ` ${r.offline} have no account yet.` : "")); } }),
    approve: (d) => { const r = S.db.requests.find((x) => x.id === d.id); const u = S.unit(r.unitId);
      if (u.tenantId) return toast(u.label + " already has a tenant.", "err");
      const pays = requestPayments(r).filter((p) => p.status === "pending");
      confirmBox(`Approve ${S.user(r.tenantId)?.name} for ${u.label}? They will be moved in today with a 12-month lease.` +
        (pays.length ? ` This also CONFIRMS their payment(s): ${pays.map((p) => S.money(p.amount) + " ref " + p.ref).join(", ")}. Only approve if you have received it.` : ""),
        async () => { await S.decideRequest(r.id, true); toast("Approved. " + u.label + " is now occupied."); refresh(); }, "Approve"); },
    decline: (d) => { const r = S.db.requests.find((x) => x.id === d.id);
      confirmBox("Decline this request?" + (r.paid ? " If the tenant really paid you, you must refund them." : ""), async () => { await S.decideRequest(r.id, false); toast("Request declined."); refresh(); }, "Decline"); },
    ackNotice: async (d) => { await S.acknowledgeNotice(d.id); toast("Tenant notified that you received the notice."); refresh(); },
    addExpense: () => modal("Add expense", `
      <div class="field-row"><div class="field"><label>Building</label><select name="propertyId"><option value="">General</option>${propOptions("")}</select></div>
        <div class="field"><label>Category</label><select name="category">${["Repairs", "Water", "Electricity", "Security", "Cleaning", "Caretaker", "Taxes", "Other"].map((c) => `<option>${c}</option>`).join("")}</select></div></div>
      <div class="field-row"><div class="field"><label>Amount (Ksh)</label><input type="number" name="amount" min="1" required></div>
        <div class="field"><label>Date</label><input type="date" name="date" value="${S.today()}"></div></div>
      <div class="field"><label>Note</label><input name="note" maxlength="300" placeholder="e.g. Fixed tap in A3"></div>`,
    { submitText: "Add expense", onSubmit: async (f) => { if (!(+f.amount > 0)) throw new Error("Enter an amount."); await S.addExpense(S.me.id, f); toast("Expense added."); refresh(); } }),
    deleteExpense: (d) => confirmBox("Delete this expense?", async () => { await S.deleteExpense(d.id); toast("Expense removed."); refresh(); }, "Delete"),
    renew: async (d) => { await S.renewLease(d.unit, +d.m); toast("Lease renewed to " + S.fmtDate(S.unit(d.unit).leaseEnd) + "."); refresh(); },
    connectMpesa: () => mpesaModal(),
    testMpesa: () => testPromptModal(),
    disconnectMpesa: () => confirmBox("Disconnect M-Pesa? Your keys will be deleted and tenants will go back to entering M-Pesa codes.", async () => {
      await S.disconnectMpesa(); toast("M-Pesa disconnected."); refresh(); }, "Disconnect"),
    saveProfile: async () => { const f = Object.fromEntries(new FormData(UI.$("#profileForm")));
      if (!f.name.trim()) throw new Error("Enter your name.");
      await S.updateProfile({ name: f.name.trim(), phone: f.phone.trim(), kind: f.kind, payoutInfo: f.payoutInfo.trim() });
      toast("Profile saved."); refresh(); },
  };

  async function fillMpesa() {
    const box = UI.$("#mpesaBox");
    if (!box) return;
    let st;
    try { st = await S.mpesaStatus(); } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
    if (!UI.$("#mpesaBox")) return;
    if (!st.connected) {
      box.innerHTML = `<p class="muted" style="margin-bottom:14px">Not connected. Tenants can still pay you and enter the M-Pesa code for you to confirm.</p>
        <button class="btn btn-primary" data-act="connectMpesa">Connect M-Pesa</button>`;
      return;
    }
    const live = st.environment === "production";
    const where = (st.type === "till" ? "Till " + esc(st.partyB) + " (store " + esc(st.shortcode) + ")" : "Paybill " + esc(st.shortcode)) +
      (st.sharedSandbox ? " · TrackGimex test keys" : "");
    box.innerHTML = `
      <div class="alert-box ${live ? "info" : "warn"}"><strong>${live ? "Live" : "Test mode (Safaricom sandbox — no real money)"}</strong> · ${where}</div>
      ${st.tested
        ? `<div class="alert-box info">✓ <strong>Tested ${S.fmtDate(st.testedAt)}</strong> — a Ksh 1 test payment went through. Your tenants see <em>Pay with M-Pesa</em>.</div>`
        : `<div class="alert-box warn"><strong>One last step:</strong> send a Ksh 1 test prompt to your own phone. Tenants can pay you by M-Pesa only after the test succeeds — it proves your ${st.type === "till" ? "Till" : "Paybill"}, keys and passkey are correct.</div>`}
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn ${st.tested ? "btn-outline" : "btn-primary"}" data-act="testMpesa">${st.tested ? "Send another test" : "Send test prompt (Ksh 1)"}</button>
        <button class="btn btn-outline" data-act="connectMpesa">Change details</button>
        <button class="btn btn-danger" data-act="disconnectMpesa">Disconnect</button></div>`;
  }

  function mpesaModal() {
    modal("Connect M-Pesa", `
      <div class="field"><label>Mode</label><select name="mode" id="mpMode">
        <option value="live_paybill">Live — my Paybill</option>
        <option value="live_till">Live — my Till (Buy Goods)</option>
        <option value="sandbox">Test — my own Daraja sandbox app</option>
        <option value="shared">Test — TrackGimex test keys (quick try, no keys needed)</option></select></div>
      <div id="mpFields">
        <div class="field-row">
          <div class="field"><label id="mpShortLabel">Paybill number</label><input name="shortcode" inputmode="numeric" maxlength="8" placeholder="e.g. 123456"></div>
          <div class="field" id="mpTillF" hidden><label>Till number</label><input name="partyB" inputmode="numeric" maxlength="8" placeholder="e.g. 987654"></div>
        </div>
        <div class="field"><label>Consumer Key</label><input name="key" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label>Consumer Secret</label><input name="secret" type="password" autocomplete="off"></div>
        <div class="field"><label>Passkey</label><input name="passkey" type="password" autocomplete="off"></div>
        <p class="hint">Get these from <strong>developer.safaricom.co.ke</strong> → your app (live keys come after <em>Go Live</em>; Safaricom emails the passkey).
          Leave a key blank to keep the one already saved. Keys are checked with Safaricom and stored encrypted — nobody, including you, can view them again.</p>
      </div>
      <p class="hint" id="mpSharedNote" hidden>Uses Safaricom's sandbox (Paybill 174379). Prompts go to your phone but <strong>no real money moves</strong>. Switch to Live before real tenants pay.</p>`,
    { submitText: "Check & connect", onSubmit: async (f) => {
      const m = f.mode;
      const d = { sharedSandbox: m === "shared", environment: m.startsWith("live") ? "production" : "sandbox",
        type: m === "live_till" ? "till" : "paybill", shortcode: (f.shortcode || "").trim(), partyB: (f.partyB || "").trim(),
        key: f.key, secret: f.secret, passkey: f.passkey };
      if (m === "sandbox" && !d.shortcode) d.shortcode = "174379";
      await S.connectMpesa(d);
      toast("Keys accepted by Safaricom. Now send yourself a Ksh 1 test prompt.");
      refresh();
      setTimeout(testPromptModal, 100);
    } });
    const sync = () => {
      const m = UI.$("#mpMode").value;
      UI.$("#mpFields").hidden = m === "shared";
      UI.$("#mpSharedNote").hidden = m !== "shared";
      UI.$("#mpTillF").hidden = m !== "live_till";
      UI.$("#mpShortLabel").textContent = m === "live_till" ? "Store number (Head office)" : m === "sandbox" ? "Shortcode (sandbox: 174379)" : "Paybill number";
    };
    UI.$("#mpMode").addEventListener("change", sync); sync();
  }

  function testPromptModal() {
    modal("Send a test prompt", `
      <p class="muted" style="margin-bottom:14px">We'll send a <strong>Ksh 1</strong> M-Pesa prompt to your phone, paid into your own Paybill / Till.
        Enter your PIN, then check the Ksh 1 arrives in your business account. This proves tenants' payments will reach you.</p>
      <div class="field"><label>Your Safaricom number</label><input name="phone" value="${esc(S.me.phone)}" placeholder="07XX XXX XXX" inputmode="tel" required></div>`,
    { submitText: "Send prompt", onSubmit: async (f) => {
      const started = await S.stkTest(f.phone);
      modal("Check your phone", `<div class="stk"><div class="spinner"></div>
        <p><strong>Enter your M-Pesa PIN on your phone</strong></p><p class="muted">to pay Ksh 1 to your own ${esc("Paybill / Till")}.</p>
        <p class="hint" id="stkMsg" style="margin-top:14px">Waiting for M-Pesa…</p></div>`);
      const r = await S.waitForStk(started.id, { isOpen: () => !!UI.$(".modal-backdrop"),
        onTick: (sec) => { const m = UI.$("#stkMsg"); if (m && sec > 30) m.textContent = "Still waiting… If no prompt arrived, close this and check your details."; } });
      UI.closeModal();
      if (r.status === "closed") return false;
      await S.refresh().catch(() => {});
      if (r.status === "paid") toast("Test passed! Ksh 1 received (" + (r.receipt || "") + "). Tenants can now pay you with M-Pesa.");
      else if (r.status === "cancelled") toast("You cancelled the prompt. Send it again when ready.", "err");
      else if (r.status === "timeout") toast("No answer from M-Pesa yet. If you paid, refresh in a minute.", "err");
      else toast("Test failed: " + (r.message || "unknown reason") + ". Check your Paybill/Till number and passkey.", "err");
      refresh();
      return false;   // modal already closed
    } });
  }

  const after = {
    settings: () => { fillMpesa(); },
    tenants: () => { const s = UI.$("#tSearch"); if (s) s.oninput = () => UI.$$("#tTable tbody tr").forEach((tr) => (tr.hidden = !tr.dataset.search.includes(s.value.toLowerCase()))); },
  };

  Shell.init({
    role: "landlord",
    nav: [["overview", "Overview", "home"], ["properties", "Buildings & houses", "building"], ["check", "Monthly check", "check"],
      ["rent", "Rent tracker", "cash"], ["tenants", "Tenants", "users"], ["requests", "House requests", "inbox"],
      ["moveouts", "Move-out notices", "door"], ["payments", "Payments & receipts", "receipt"], ["expenses", "Expenses", "wallet"],
      ["leases", "Leases", "file"], ["notifications", "Notifications", "bell"], ["settings", "Settings", "users"]],
    views, actions, after,
    counts: (m) => ({ requests: pendingRequests().length, moveouts: openNotices().filter((n) => n.status === "pending").length,
      payments: S.db.payments.filter((p) => p.status === "pending" && !p.viaStk && !S.db.requests.some((r) => r.unitId === p.unitId && r.tenantId === p.tenantId && r.status === "pending")).length,
      notifications: S.notificationsOf(m.id).filter((n) => !n.read).length }),
  });
})();
