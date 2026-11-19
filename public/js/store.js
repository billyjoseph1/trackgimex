/* ==========================================================
   TrackGimex — data store
   All data is saved in the browser (localStorage). This makes the
   site work with no server: perfect for a demo or a single computer.
   To use it across many phones/computers, swap these functions for
   calls to a real backend (Firebase, Supabase, Node/PHP + MySQL).
   ========================================================== */
const Store = (() => {
  const KEY = "trackgimex_db_v2";
  const SESSION_KEY = "trackgimex_session";

  /* ---------- helpers ---------- */
  const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const today = () => new Date().toISOString().slice(0, 10);
  const nowISO = () => new Date().toISOString();
  const ym = (d = new Date()) => {
    const x = typeof d === "string" ? new Date(d) : d;
    return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0");
  };
  const addMonths = (dateStr, n) => {
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + n);
    return d.toISOString().slice(0, 10);
  };
  // Simple (non-cryptographic) hash so plain passwords are not stored.
  // A real deployment must hash passwords on a server.
  const hash = (s) => {
    let h = 5381;
    const str = "tg$" + s;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return "h" + h.toString(16);
  };

  /* ---------- persistence ---------- */
  let db;
  function emptyDb() {
    return { users: [], properties: [], units: [], payments: [], requests: [],
      notices: [], notifications: [], expenses: [], checks: [], seq: 1000 };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const d = JSON.parse(raw); if (d && d.users) return d; }
    } catch (e) { /* storage blocked or corrupt */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn("Could not save", e); }
  }
  function reset() { db = seed(); save(); }

  /* ---------- demo data ---------- */
  function seed() {
    const d = emptyDb();
    const L = { id: "u_landlord", role: "landlord", kind: "Landlord", name: "Jane Wanjiku", email: "landlord@demo.com",
      phone: "0712345678", pass: hash("demo123"), createdAt: nowISO() };
    const T = { id: "u_tenant", role: "tenant", name: "Brian Otieno", email: "tenant@demo.com",
      phone: "0722000111", pass: hash("demo123"), createdAt: nowISO() };
    const T2 = { id: "u_tenant2", role: "tenant", name: "Mercy Akinyi", email: "mercy@demo.com",
      phone: "0733222444", pass: hash("demo123"), createdAt: nowISO() };
    d.users.push(L, T, T2);

    const offline = ["Peter Kamau", "Faith Njeri", "John Mwangi", "Grace Achieng", "Samuel Kiptoo",
      "Ann Mutua", "David Ochieng", "Lucy Wairimu"];
    offline.forEach((n, i) => d.users.push({ id: "u_off" + i, role: "tenant", name: n,
      email: "", phone: "07" + (10000000 + i * 1234567).toString().slice(0, 8), pass: null, offline: true, createdAt: nowISO() }));

    const p1 = { id: "p_sunrise", landlordId: L.id, name: "Sunrise Apartments", location: "Kasarani, Nairobi",
      description: "Modern apartments 5 minutes from Thika Road. Water, security and parking.", createdAt: nowISO() };
    const p2 = { id: "p_green", landlordId: L.id, name: "Green Court", location: "Ruiru, Kiambu",
      description: "Quiet gated court with bedsitters and one bedrooms.", createdAt: nowISO() };
    d.properties.push(p1, p2);

    const thisMonth = ym();
    const lastMonth = ym(new Date(new Date().setMonth(new Date().getMonth() - 1)));
    const start = addMonths(today(), -8);

    const mk = (prop, label, type, rent, deposit, status, tenantId, leaseStart) => {
      const u = { id: uid("un"), propertyId: prop.id, label, type, rent, deposit, status, tenantId: tenantId || null,
        leaseStart: leaseStart || null, leaseEnd: leaseStart ? addMonths(leaseStart, 12) : null };
      d.units.push(u);
      return u;
    };
    const s = [];
    for (let i = 1; i <= 10; i++) {
      const label = "A" + i;
      const type = i <= 4 ? "1 Bedroom" : i <= 8 ? "2 Bedroom" : "Bedsitter";
      const rent = type === "1 Bedroom" ? 15000 : type === "2 Bedroom" ? 22000 : 9000;
      let tenant = null, status = "vacant", ls = null;
      if (i === 1) { tenant = T.id; status = "occupied"; ls = start; }
      else if (i <= 7) { tenant = "u_off" + (i - 2); status = "occupied"; ls = addMonths(today(), -(i + 1)); }
      if (i === 8) status = "maintenance";
      s.push(mk(p1, label, type, rent, rent, status, tenant, ls));
    }
    for (let i = 1; i <= 6; i++) {
      const type = i <= 3 ? "Bedsitter" : "1 Bedroom";
      const rent = type === "Bedsitter" ? 7500 : 12000;
      let tenant = null, status = "vacant", ls = null;
      if (i <= 2) { tenant = "u_off" + (5 + i); status = "occupied"; ls = addMonths(today(), -4); }
      s.push(mk(p2, "G" + i, type, rent, rent, status, tenant, ls));
    }
    // one lease about to expire, for the renewals view
    s[3].leaseEnd = addMonths(today(), 1);

    let seq = 1000;
    const pay = (u, kind, month, amount, method, daysAgo) => {
      const date = new Date(); date.setDate(date.getDate() - daysAgo);
      d.payments.push({ id: uid("pay"), receiptNo: "TG-" + (++seq), unitId: u.id, propertyId: u.propertyId,
        tenantId: u.tenantId, kind, month, amount, method, ref: method === "M-Pesa" ? "SK" + Math.random().toString(36).slice(2, 10).toUpperCase() : "",
        date: date.toISOString(), recordedBy: method === "Cash" ? L.id : u.tenantId });
    };
    s.filter((u) => u.tenantId).forEach((u, i) => {
      // deposit at move-in, then full rent for every past month of the lease
      const moved = Math.round((Date.now() - new Date(u.leaseStart)) / 86400000);
      pay(u, "deposit", null, u.deposit, "M-Pesa", moved);
      for (let m = Math.floor(moved / 30); m >= 2; m--) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m);
        pay(u, "rent", ym(d), u.rent, i % 3 ? "M-Pesa" : "Cash", m * 30);
      }
      pay(u, "rent", lastMonth, u.rent, i % 3 ? "M-Pesa" : "Cash", 30 + i);
      if (i % 3 === 0) pay(u, "rent", thisMonth, u.rent, "M-Pesa", 3);
      else if (i % 3 === 1) pay(u, "rent", thisMonth, Math.round(u.rent / 2), "M-Pesa", 2);
    });
    d.seq = seq;

    d.expenses.push(
      { id: uid("ex"), landlordId: L.id, propertyId: p1.id, category: "Repairs", amount: 4500, date: today(), note: "Plumbing in A8" },
      { id: uid("ex"), landlordId: L.id, propertyId: p1.id, category: "Security", amount: 12000, date: today(), note: "Guard salary" },
      { id: uid("ex"), landlordId: L.id, propertyId: p2.id, category: "Water", amount: 3200, date: today(), note: "Water bill" }
    );

    // a pending request by Mercy for A9
    d.requests.push({ id: uid("rq"), unitId: s[8].id, tenantId: T2.id, status: "pending", paid: false,
      message: "Hello, I would like to move in at the start of next month.", date: nowISO() });

    d.notifications.push(
      { id: uid("nt"), userId: L.id, text: "Mercy Akinyi requested house A9 at Sunrise Apartments.", date: nowISO(), read: false, link: "requests" },
      { id: uid("nt"), userId: T.id, text: "Welcome to TrackGimex! Your house A1 at Sunrise Apartments is linked to your account.", date: nowISO(), read: false, link: "home" }
    );
    return d;
  }

  db = load() || seed();
  if (!load()) save();

  /* ---------- session / auth ---------- */
  function currentUser() {
    let id = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
    return db.users.find((u) => u.id === id) || null;
  }
  function login(email, password, role) {
    const u = db.users.find((x) => x.email && x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u || u.pass !== hash(password)) throw new Error("Wrong email or password.");
    if (u.role !== role) throw new Error(role === "landlord"
      ? "This is a tenant account. Use the Tenant tab to log in."
      : "This is a landlord/agent account. Use the Landlord / Agent tab to log in.");
    try { localStorage.setItem(SESSION_KEY, u.id); } catch (e) {}
    return u;
  }
  function register({ name, email, phone, password, role, kind }) {
    if (!name || !email || !password) throw new Error("Please fill in name, email and password.");
    if (password.length < 6) throw new Error("Password must be at least 6 characters.");
    if (db.users.some((x) => x.email && x.email.toLowerCase() === email.trim().toLowerCase()))
      throw new Error("An account with this email already exists. Log in instead.");
    // A landlord may have added this tenant offline by phone; link them.
    let u = role === "tenant" && phone ? db.users.find((x) => x.offline && normPhone(x.phone) === normPhone(phone)) : null;
    if (u) {
      Object.assign(u, { name, email: email.trim(), pass: hash(password), offline: false });
    } else {
      u = { id: uid("u"), role, kind: role === "landlord" ? (kind || "Landlord") : undefined, name: name.trim(),
        email: email.trim(), phone: phone || "", pass: hash(password), createdAt: nowISO() };
      db.users.push(u);
    }
    save();
    try { localStorage.setItem(SESSION_KEY, u.id); } catch (e) {}
    return u;
  }
  function logout() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  const normPhone = (p) => String(p || "").replace(/\D/g, "").replace(/^254/, "0").replace(/^7/, "07").replace(/^1/, "01");

  /* ---------- lookups ---------- */
  const user = (id) => db.users.find((u) => u.id === id);
  const property = (id) => db.properties.find((p) => p.id === id);
  const unit = (id) => db.units.find((u) => u.id === id);
  const propertiesOf = (landlordId) => db.properties.filter((p) => p.landlordId === landlordId);
  const unitsOf = (propertyId) => db.units.filter((u) => u.propertyId === propertyId)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const landlordUnits = (landlordId) => {
    const ids = propertiesOf(landlordId).map((p) => p.id);
    return db.units.filter((u) => ids.includes(u.propertyId));
  };
  const landlordOfUnit = (unitId) => { const u = unit(unitId); return u ? property(u.propertyId)?.landlordId : null; };
  const tenantUnit = (tenantId) => db.units.find((u) => u.tenantId === tenantId);

  /* ---------- notifications ---------- */
  function notify(userId, text, link) {
    if (!userId) return;
    db.notifications.unshift({ id: uid("nt"), userId, text, date: nowISO(), read: false, link: link || "" });
  }
  const notificationsOf = (userId) => db.notifications.filter((n) => n.userId === userId);
  function markAllRead(userId) { notificationsOf(userId).forEach((n) => (n.read = true)); save(); }

  /* ---------- properties & units ---------- */
  function addProperty(landlordId, { name, location, description, count, prefix, type, rent, deposit }) {
    const p = { id: uid("p"), landlordId, name, location, description: description || "", createdAt: nowISO() };
    db.properties.push(p);
    addUnits(p.id, { count, prefix, type, rent, deposit }, false);
    save();
    return p;
  }
  function addUnits(propertyId, { count, prefix, type, rent, deposit }, persist = true) {
    const existing = unitsOf(propertyId);
    const pre = prefix || "";
    let n = existing.filter((u) => u.label.startsWith(pre))
      .map((u) => parseInt(u.label.slice(pre.length), 10)).filter((x) => !isNaN(x))
      .reduce((m, x) => Math.max(m, x), 0);
    for (let i = 0; i < Number(count || 0); i++) {
      db.units.push({ id: uid("un"), propertyId, label: pre + (++n), type: type || "1 Bedroom",
        rent: Number(rent) || 0, deposit: Number(deposit) || 0, status: "vacant", tenantId: null, leaseStart: null, leaseEnd: null });
    }
    if (persist) save();
  }
  function updateProperty(id, data) { Object.assign(property(id), data); save(); }
  function deleteProperty(id) {
    const unitIds = unitsOf(id).map((u) => u.id);
    db.units = db.units.filter((u) => u.propertyId !== id);
    db.requests = db.requests.filter((r) => !unitIds.includes(r.unitId));
    db.properties = db.properties.filter((p) => p.id !== id);
    save();
  }
  function updateUnit(id, data) {
    const u = unit(id);
    if (data.rent !== undefined) data.rent = Number(data.rent) || 0;
    if (data.deposit !== undefined) data.deposit = Number(data.deposit) || 0;
    Object.assign(u, data);
    if (u.status === "vacant" || u.status === "maintenance") { u.tenantId = null; }
    save();
  }
  function deleteUnit(id) {
    db.units = db.units.filter((u) => u.id !== id);
    db.requests = db.requests.filter((r) => r.unitId !== id);
    save();
  }

  /* ---------- tenants ---------- */
  function addOfflineTenant({ name, phone, email }) {
    const existing = (email && db.users.find((x) => x.email && x.email.toLowerCase() === email.toLowerCase()))
      || (phone && db.users.find((x) => x.role === "tenant" && normPhone(x.phone) === normPhone(phone)));
    if (existing) {
      if (existing.role !== "tenant") throw new Error("That email belongs to a landlord account.");
      return existing;
    }
    const t = { id: uid("u"), role: "tenant", name, phone: phone || "", email: email || "", pass: null, offline: true, createdAt: nowISO() };
    db.users.push(t);
    return t;
  }
  function assignTenant(unitId, tenantId, leaseStart, months = 12) {
    const u = unit(unitId);
    const prev = tenantUnit(tenantId);
    if (prev && prev.id !== unitId) throw new Error(user(tenantId).name + " already rents " + prev.label + ". Vacate that house first.");
    u.tenantId = tenantId;
    u.status = "occupied";
    u.leaseStart = leaseStart || today();
    u.leaseEnd = addMonths(u.leaseStart, months);
    save();
  }
  function vacateUnit(unitId, landlordId) {
    const u = unit(unitId);
    const tId = u.tenantId;
    u.tenantId = null; u.status = "vacant"; u.leaseStart = null; u.leaseEnd = null;
    db.notices.filter((n) => n.unitId === unitId && n.status !== "completed").forEach((n) => (n.status = "completed"));
    if (tId) notify(tId, "You have been checked out of house " + u.label + " at " + property(u.propertyId).name + ". Thank you for staying with us.", "home");
    save();
  }
  function renewLease(unitId, months = 12) {
    const u = unit(unitId);
    u.leaseEnd = addMonths(u.leaseEnd || today(), months);
    notify(u.tenantId, "Your lease for " + u.label + " has been renewed to " + u.leaseEnd + ".", "home");
    save();
  }

  /* ---------- rent ---------- */
  const paymentsOf = (filterFn) => db.payments.filter(filterFn).sort((a, b) => b.date.localeCompare(a.date));
  function rentStatus(u, month) {
    const expected = u.tenantId ? u.rent : 0;
    const paid = db.payments.filter((p) => p.unitId === u.id && p.kind === "rent" && p.month === month && p.tenantId === u.tenantId && !p.refunded)
      .reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, expected - paid);
    const status = !u.tenantId ? "none" : paid >= expected ? "paid" : paid > 0 ? "partial" : "unpaid";
    return { expected, paid, balance, status };
  }
  function depositPaid(u) {
    if (!u.tenantId) return 0;
    return db.payments.filter((p) => p.unitId === u.id && p.kind === "deposit" && p.tenantId === u.tenantId && !p.refunded)
      .reduce((s, p) => s + p.amount, 0);
  }
  function recordPayment({ unitId, tenantId, kind, month, amount, method, ref, recordedBy }) {
    const u = unit(unitId);
    const p = { id: uid("pay"), receiptNo: "TG-" + (++db.seq), unitId, propertyId: u.propertyId, tenantId,
      kind, month: kind === "rent" ? month : null, amount: Number(amount), method, ref: ref || "",
      date: nowISO(), recordedBy };
    db.payments.push(p);
    const landlordId = property(u.propertyId).landlordId;
    const label = { rent: "rent for " + monthLabel(month), deposit: "deposit", booking: "booking fee" }[kind];
    if (recordedBy === tenantId) {
      notify(landlordId, user(tenantId).name + " paid " + money(amount) + " " + label + " for " + u.label + " (" + method + ").", "payments");
    } else {
      notify(tenantId, "Payment of " + money(amount) + " " + label + " for " + u.label + " was recorded. Receipt " + p.receiptNo + ".", "payments");
    }
    save();
    return p;
  }
  function deletePayment(id) { db.payments = db.payments.filter((p) => p.id !== id); save(); }

  /* ---------- house requests / bookings ---------- */
  function requestUnit(tenantId, unitId, message, paid) {
    const u = unit(unitId);
    if (!u || (u.status !== "vacant" && !(paid && u.status === "reserved"))) throw new Error("Sorry, this house is no longer available.");
    if (db.requests.some((r) => r.tenantId === tenantId && r.unitId === unitId && r.status === "pending")) {
      const r = db.requests.find((r) => r.tenantId === tenantId && r.unitId === unitId && r.status === "pending");
      if (paid) { r.paid = true; u.status = "reserved"; save(); }
      return r;
    }
    const r = { id: uid("rq"), unitId, tenantId, status: "pending", paid: !!paid, message: message || "", date: nowISO() };
    db.requests.push(r);
    if (paid) u.status = "reserved";
    notify(landlordOfUnit(unitId), user(tenantId).name + (paid ? " booked and paid for " : " requested ") + "house " + u.label +
      " at " + property(u.propertyId).name + ".", "requests");
    save();
    return r;
  }
  function decideRequest(requestId, approve) {
    const r = db.requests.find((x) => x.id === requestId);
    const u = unit(r.unitId);
    const p = property(u.propertyId);
    if (approve) {
      assignTenant(u.id, r.tenantId, today());
      r.status = "approved";
      notify(r.tenantId, "Good news! Your request for " + u.label + " at " + p.name + " was approved. Welcome home.", "home");
      // other pending requests for the same house are declined
      db.requests.filter((x) => x.unitId === u.id && x.status === "pending" && x.id !== r.id).forEach((x) => {
        x.status = "rejected";
        notify(x.tenantId, "House " + u.label + " at " + p.name + " has been taken." + (x.paid ? " Your payment will be refunded." : ""), "requests");
        refundBooking(x);
      });
    } else {
      r.status = "rejected";
      refundBooking(r);
      if (u.status === "reserved" && !db.requests.some((x) => x.unitId === u.id && x.status === "pending" && x.paid)) u.status = "vacant";
      notify(r.tenantId, "Your request for " + u.label + " at " + p.name + " was declined." + (r.paid ? " Your payment will be refunded." : ""), "requests");
    }
    save();
  }
  function refundBooking(r) {
    if (!r.paid) return;
    db.payments.filter((p) => p.unitId === r.unitId && p.tenantId === r.tenantId && !p.refunded).forEach((p) => (p.refunded = true));
  }
  function cancelRequest(requestId) {
    const r = db.requests.find((x) => x.id === requestId);
    r.status = "cancelled";
    const u = unit(r.unitId);
    refundBooking(r);
    if (u.status === "reserved" && !db.requests.some((x) => x.unitId === u.id && x.status === "pending" && x.paid)) u.status = "vacant";
    notify(landlordOfUnit(r.unitId), user(r.tenantId).name + " cancelled their request for " + u.label + ".", "requests");
    save();
  }

  /* ---------- move-out notices ---------- */
  function giveNotice(tenantId, moveOutDate, reason) {
    const u = tenantUnit(tenantId);
    if (!u) throw new Error("You are not linked to any house.");
    if (db.notices.some((n) => n.unitId === u.id && n.tenantId === tenantId && n.status !== "completed"))
      throw new Error("You have already given notice for this house.");
    db.notices.push({ id: uid("mo"), unitId: u.id, tenantId, moveOutDate, reason: reason || "", date: nowISO(), status: "pending" });
    u.status = "notice";
    notify(landlordOfUnit(u.id), "MOVE-OUT: " + user(tenantId).name + " will move out of " + u.label + " at " +
      property(u.propertyId).name + " on " + fmtDate(moveOutDate) + ".", "moveouts");
    save();
  }
  function acknowledgeNotice(id) {
    const n = db.notices.find((x) => x.id === id);
    n.status = "acknowledged";
    notify(n.tenantId, "Your landlord received your move-out notice for " + fmtDate(n.moveOutDate) + ".", "home");
    save();
  }
  function withdrawNotice(id) {
    const n = db.notices.find((x) => x.id === id);
    const u = unit(n.unitId);
    db.notices = db.notices.filter((x) => x.id !== id);
    if (u.status === "notice") u.status = "occupied";
    notify(landlordOfUnit(u.id), user(n.tenantId).name + " withdrew their move-out notice for " + u.label + ".", "moveouts");
    save();
  }

  /* ---------- monthly check ---------- */
  function saveCheck(landlordId, propertyId, month, items) {
    items.forEach(({ unitId, status }) => {
      const u = unit(unitId);
      if (u.status !== status) {
        if ((status === "vacant" || status === "maintenance") && u.tenantId) vacateUnit(unitId, landlordId);
        u.status = status;
        if (status === "vacant" || status === "maintenance") u.tenantId = null;
      }
    });
    db.checks = db.checks.filter((c) => !(c.propertyId === propertyId && c.month === month));
    db.checks.push({ id: uid("ck"), landlordId, propertyId, month, items, date: nowISO() });
    save();
  }
  const lastCheck = (propertyId, month) => db.checks.find((c) => c.propertyId === propertyId && c.month === month);

  /* ---------- expenses ---------- */
  function addExpense(landlordId, data) {
    db.expenses.push({ id: uid("ex"), landlordId, ...data, amount: Number(data.amount) });
    save();
  }
  function deleteExpense(id) { db.expenses = db.expenses.filter((e) => e.id !== id); save(); }

  /* ---------- formatting ---------- */
  const money = (n) => "Ksh " + Number(n || 0).toLocaleString("en-KE");
  const monthLabel = (m) => {
    if (!m) return "";
    const [y, mo] = m.split("-");
    return new Date(+y, +mo - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  };
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

  return {
    get db() { return db; }, save, reset, uid, today, ym, addMonths, hash,
    currentUser, login, register, logout,
    user, property, unit, propertiesOf, unitsOf, landlordUnits, landlordOfUnit, tenantUnit,
    notify, notificationsOf, markAllRead,
    addProperty, addUnits, updateProperty, deleteProperty, updateUnit, deleteUnit,
    addOfflineTenant, assignTenant, vacateUnit, renewLease,
    paymentsOf, rentStatus, depositPaid, recordPayment, deletePayment,
    requestUnit, decideRequest, cancelRequest,
    giveNotice, acknowledgeNotice, withdrawNotice,
    saveCheck, lastCheck, addExpense, deleteExpense,
    money, monthLabel, fmtDate, normPhone,
  };
})();
