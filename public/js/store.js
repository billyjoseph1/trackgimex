/* ==========================================================
   TrackGimex — data store (Supabase)
   The pages read from a local copy of the user's data (Store.db),
   loaded after login and refreshed after every change. All changes go
   to the server; the database rules decide what each user may do.
   ========================================================== */
const Store = (() => {
  const sb = window.supabase.createClient(TG_CONFIG.supabaseUrl, TG_CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  /* ---------- helpers ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const ym = (d = new Date()) => { const x = typeof d === "string" ? new Date(d) : d; return x.getFullYear() + "-" + pad(x.getMonth() + 1); };
  const addMonths = (dateStr, n) => { const d = new Date(dateStr); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };

  function friendly(error) {
    const m = (error && (error.message || error.error_description)) || String(error);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "No internet connection. Please check your network and try again.";
    if (/JWT|session|refresh token/i.test(m)) return "Your session has expired. Please log in again.";
    if (/Invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/Email not confirmed/i.test(m)) return "Please confirm your email first — check your inbox for the link we sent.";
    if (/User already registered/i.test(m)) return "An account with this email already exists. Log in instead.";
    if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a few minutes and try again.";
    if (/duplicate key value.*label/i.test(m)) return "Another house in this building already uses that label.";
    if (/row-level security|permission denied/i.test(m)) return "You are not allowed to do that.";
    return m;
  }
  async function run(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(friendly(error));
    return data;
  }
  const rpc = (fn, args) => run(sb.rpc(fn, args));
  // PostgREST returns at most 1000 rows per request: page through everything
  async function all(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = await run(build().range(from, from + 999));
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }
  const chunks = (arr, n = 150) => { const r = []; for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n)); return r; };
  async function allIn(table, col, ids, select = "*") {
    if (!ids.length) return [];
    const parts = await Promise.all(chunks([...new Set(ids)]).map((c) => all(() => sb.from(table).select(select).in(col, c))));
    return parts.flat();
  }

  /* ---------- row mappers (database → page objects) ---------- */
  const mapProperty = (r) => ({ id: r.id, landlordId: r.landlord_id, name: r.name, location: r.location, description: r.description });
  const mapUnit = (r) => ({ id: r.id, propertyId: r.property_id, label: r.label, type: r.type, rent: r.rent, deposit: r.deposit,
    status: r.status, tenantId: r.tenant_id, leaseStart: r.lease_start, leaseEnd: r.lease_end });
  const mapTenant = (r) => ({ id: r.id, role: "tenant", name: r.name, phone: r.phone, email: r.email, userId: r.user_id,
    hasAccount: !!r.user_id, landlordId: r.landlord_id, inviteCode: r.invite_code });
  const mapLandlord = (r) => ({ id: r.id, role: "landlord", kind: r.kind, name: r.name, phone: r.phone, payoutInfo: r.payout_info || "", mpesaReady: !!r.mpesa_ready });
  const mapPayment = (r) => ({ id: r.id, receiptNo: "TG-" + r.receipt_no, landlordId: r.landlord_id, propertyId: r.property_id,
    unitId: r.unit_id, unitLabel: r.unit_label, tenantId: r.tenant_id, kind: r.kind, month: r.month, amount: r.amount,
    method: r.method, ref: r.ref, status: r.status, recordedBy: r.recorded_by, date: r.created_at, viaStk: !!r.stk_request_id });
  const mapRequest = (r) => ({ id: r.id, unitId: r.unit_id, tenantId: r.tenant_id, landlordId: r.landlord_id, status: r.status,
    message: r.message, paid: r.paid, date: r.created_at });
  const mapNotice = (r) => ({ id: r.id, unitId: r.unit_id, tenantId: r.tenant_id, landlordId: r.landlord_id,
    moveOutDate: r.move_out_date, reason: r.reason, status: r.status, date: r.created_at });
  const mapNote = (r) => ({ id: r.id, userId: r.user_id, text: r.text, link: r.link, read: r.read, date: r.created_at });
  const mapExpense = (r) => ({ id: r.id, landlordId: r.landlord_id, propertyId: r.property_id, category: r.category,
    amount: r.amount, date: r.date, note: r.note });
  const mapCheck = (r) => ({ id: r.id, propertyId: r.property_id, month: r.month, items: r.items, date: r.created_at });

  /* ---------- state ---------- */
  const empty = () => ({ users: [], properties: [], units: [], payments: [], requests: [], notices: [], notifications: [], expenses: [], checks: [] });
  let db = empty();
  let me = null;           // { id, role, kind, name, phone, email, payoutInfo, tenantIds[] }
  const listeners = [];

  async function loadProfile() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { me = null; return null; }
    const p = await run(sb.from("profiles").select("id, role, kind, name, phone, payout_info, mpesa_ready").eq("id", session.user.id).maybeSingle());
    if (!p) { me = null; return null; }
    me = { id: p.id, role: p.role, kind: p.kind, name: p.name, phone: p.phone, payoutInfo: p.payout_info || "", mpesaReady: !!p.mpesa_ready, email: session.user.email, tenantIds: [] };
    return me;
  }

  async function load() {
    if (!me) return;
    const d = empty();
    if (me.role === "landlord") {
      const props = await all(() => sb.from("properties").select("*").eq("landlord_id", me.id).order("created_at"));
      d.properties = props.map(mapProperty);
      const [units, tenants, pays, reqs, notices, notes, ex, checks] = await Promise.all([
        allIn("units", "property_id", d.properties.map((p) => p.id)),
        all(() => sb.from("tenants").select("*")),
        all(() => sb.from("payments").select("*").eq("landlord_id", me.id).order("created_at", { ascending: false })),
        all(() => sb.from("house_requests").select("*").eq("landlord_id", me.id)),
        all(() => sb.from("move_out_notices").select("*").eq("landlord_id", me.id)),
        run(sb.from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(300)),
        all(() => sb.from("expenses").select("*").eq("landlord_id", me.id)),
        all(() => sb.from("monthly_checks").select("*").eq("landlord_id", me.id)),
      ]);
      d.units = units.map(mapUnit);
      d.users = tenants.map(mapTenant).concat([mapLandlord({ ...me, payout_info: me.payoutInfo, mpesa_ready: me.mpesaReady })]);
      Object.assign(d, { payments: pays.map(mapPayment), requests: reqs.map(mapRequest), notices: notices.map(mapNotice),
        notifications: notes.map(mapNote), expenses: ex.map(mapExpense), checks: checks.map(mapCheck) });
    } else {
      const [tenants, units, pays, reqs, notices, notes] = await Promise.all([
        all(() => sb.from("tenants").select("*")),
        all(() => sb.from("units").select("*")),     // own house(s), requested houses, and every vacant house
        all(() => sb.from("payments").select("*").order("created_at", { ascending: false })),
        all(() => sb.from("house_requests").select("*")),
        all(() => sb.from("move_out_notices").select("*")),
        run(sb.from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(300)),
      ]);
      me.tenantIds = tenants.filter((t) => t.user_id === me.id).map((t) => t.id);
      d.units = units.map(mapUnit);
      d.properties = (await allIn("properties", "id", d.units.map((u) => u.propertyId))).map(mapProperty);
      const landlords = await allIn("profiles", "id", d.properties.map((p) => p.landlordId), "id, role, kind, name, phone, payout_info, mpesa_ready");
      d.users = tenants.map(mapTenant).concat(landlords.map(mapLandlord));
      Object.assign(d, { payments: pays.map(mapPayment), requests: reqs.map(mapRequest), notices: notices.map(mapNotice),
        notifications: notes.map(mapNote) });
    }
    db = d;
  }

  let channel = null;
  function subscribe() {
    if (channel || !me) return;
    channel = sb.channel("notes-" + me.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + me.id }, async (msg) => {
        try { await load(); } catch (e) { /* keep old data */ }
        listeners.forEach((fn) => fn(msg.new));
      })
      .subscribe();
  }

  /** Start a page: returns the logged-in profile (or null) with data loaded. */
  async function init() {
    await loadProfile();
    if (me) { await load(); subscribe(); }
    return me;
  }
  const onChange = (fn) => listeners.push(fn);
  async function refresh() { await load(); }

  /* ---------- auth ---------- */
  async function login(email, password, role) {
    await run(sb.auth.signInWithPassword({ email: email.trim(), password }));
    const p = await loadProfile();
    if (!p) { await sb.auth.signOut(); throw new Error("This account has no profile. Please contact support."); }
    if (p.role !== role) {
      await sb.auth.signOut();
      throw new Error(role === "landlord" ? "This is a tenant account. Use the Tenant tab to log in."
        : "This is a landlord/agent account. Use the Landlord / Agent tab to log in.");
    }
    return p;
  }
  async function register({ name, email, phone, password, role, kind }) {
    if (!name || !email || !password) throw new Error("Please fill in name, email and password.");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    const data = await run(sb.auth.signUp({
      email: email.trim(), password,
      options: { data: { role, kind, name: name.trim(), phone: (phone || "").trim() }, emailRedirectTo: new URL("login.html?role=" + role, location.href).href },
    }));
    // When email confirmation is ON, Supabase returns no session yet.
    if (!data.session) return { needsConfirmation: true };
    return { needsConfirmation: false, profile: await loadProfile() };
  }
  async function logout() { try { await sb.auth.signOut(); } catch (e) {} me = null; }
  const resetPassword = (email) => run(sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: new URL("login.html?mode=recovery", location.href).href }));
  const updatePassword = (password) => run(sb.auth.updateUser({ password }));
  const onAuth = (fn) => sb.auth.onAuthStateChange(fn);
  async function updateProfile(f) {
    const row = { name: f.name, phone: f.phone };
    if (me.role === "landlord") { row.kind = f.kind; row.payout_info = f.payoutInfo || ""; }
    await run(sb.from("profiles").update(row).eq("id", me.id));
    await loadProfile(); await load();
  }

  /* ---------- lookups (synchronous, from the loaded data) ---------- */
  const user = (id) => db.users.find((u) => u.id === id);
  const property = (id) => db.properties.find((p) => p.id === id);
  const unit = (id) => db.units.find((u) => u.id === id);
  const propertiesOf = (landlordId) => db.properties.filter((p) => p.landlordId === landlordId);
  const unitsOf = (propertyId) => db.units.filter((u) => u.propertyId === propertyId)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const landlordUnits = (landlordId) => { const ids = propertiesOf(landlordId).map((p) => p.id); return db.units.filter((u) => ids.includes(u.propertyId)); };
  const landlordOfUnit = (unitId) => { const u = unit(unitId); return u ? property(u.propertyId)?.landlordId : null; };
  const isMine = (tenantId) => !!me && me.tenantIds.includes(tenantId);
  const myUnit = () => db.units.find((u) => isMine(u.tenantId));
  const tenantUnit = (tenantId) => db.units.find((u) => u.tenantId === tenantId);
  const notificationsOf = (userId) => db.notifications.filter((n) => n.userId === userId);
  const paymentsOf = (fn) => db.payments.filter(fn).sort((a, b) => b.date.localeCompare(a.date));
  const lastCheck = (propertyId, month) => db.checks.find((c) => c.propertyId === propertyId && c.month === month);
  function rentStatus(u, month) {
    const expected = u.tenantId ? u.rent : 0;
    const paid = db.payments.filter((p) => p.unitId === u.id && p.kind === "rent" && p.month === month && p.tenantId === u.tenantId && p.status === "confirmed")
      .reduce((s, p) => s + p.amount, 0);
    const pending = db.payments.filter((p) => p.unitId === u.id && p.kind === "rent" && p.month === month && p.tenantId === u.tenantId && p.status === "pending")
      .reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, expected - paid);
    const status = !u.tenantId ? "none" : paid >= expected ? "paid" : paid > 0 ? "partial" : "unpaid";
    return { expected, paid, pending, balance, status };
  }
  const depositPaid = (u) => !u.tenantId ? 0 : db.payments.filter((p) => p.unitId === u.id && p.kind === "deposit" && p.tenantId === u.tenantId && p.status === "confirmed")
    .reduce((s, p) => s + p.amount, 0);

  /* ---------- changes (all async; data is reloaded afterwards) ---------- */
  const after = async (promise) => { const r = await promise; await load(); return r; };
  const num = (x) => Math.max(0, Math.round(Number(x) || 0));

  const addProperty = (_me, d) => after(rpc("create_property", { p_name: d.name, p_location: d.location, p_description: d.description || "",
    p_count: num(d.count), p_prefix: d.prefix || "", p_type: d.type, p_rent: num(d.rent), p_deposit: num(d.deposit) }));
  const addUnits = (pid, d) => after(rpc("add_units", { p_property: pid, p_count: num(d.count), p_prefix: d.prefix || "", p_type: d.type, p_rent: num(d.rent), p_deposit: num(d.deposit) }));
  const updateProperty = (id, d) => after(run(sb.from("properties").update({ name: d.name, location: d.location, description: d.description || "" }).eq("id", id)));
  const deleteProperty = (id) => after(run(sb.from("properties").delete().eq("id", id)));
  async function updateUnit(id, d) {
    const u = unit(id);
    if (d.status && d.status !== u.status) await rpc("set_unit_status", { p_unit: id, p_status: d.status });
    const row = { label: d.label, type: d.type, rent: num(d.rent), deposit: num(d.deposit) };
    if (d.leaseStart) row.lease_start = d.leaseStart;
    if (d.leaseEnd) row.lease_end = d.leaseEnd;
    await run(sb.from("units").update(row).eq("id", id));
    await load();
  }
  async function deleteUnit(id) {
    const rows = await run(sb.from("units").delete().eq("id", id).select("id"));
    if (!rows.length) throw new Error("Check the tenant out before deleting this house.");
    await load();
  }
  const addTenant = (d) => after(rpc("add_tenant", { p_unit: d.unitId, p_name: d.name, p_phone: d.phone || "", p_email: d.email || "",
    p_start: d.start || today(), p_months: Number(d.months) || 12, p_deposit_paid: !!d.depositPaid, p_rent_paid: !!d.rentPaid, p_month: ym() }));
  const newInviteCode = (tenantId) => after(rpc("new_invite_code", { p_tenant: tenantId }));
  const claimInvite = async (code) => { const r = await rpc("claim_invite", { p_code: code }); await loadProfile(); await load(); return r; };
  const vacateUnit = (unitId) => after(rpc("vacate_unit", { p_unit: unitId }));
  const renewLease = (unitId, months) => after(rpc("renew_lease", { p_unit: unitId, p_months: months }));
  const notifyTenant = (unitId, text) => rpc("notify_tenant", { p_unit: unitId, p_text: text });
  const announce = (propertyId, text) => rpc("announce", { p_property: propertyId || null, p_text: text });

  const payArgs = (d) => ({ p_unit: d.unitId, p_kind: d.kind, p_month: d.kind === "rent" ? d.month : null, p_amount: num(d.amount), p_method: d.method, p_ref: d.ref || "" });
  const recordPayment = async (d) => { const r = await rpc("record_payment", payArgs(d)); await load(); return db.payments.find((p) => p.id === r.id) || mapPayment(r); };
  const reportPayment = async (d) => { const r = await rpc("report_payment", payArgs(d)); await load(); return db.payments.find((p) => p.id === r.id) || mapPayment(r); };
  const reviewPayment = (id, approve) => after(rpc("review_payment", { p_payment: id, p_approve: approve }));
  const deletePayment = (id) => after(rpc("delete_payment", { p_payment: id }));

  const requestUnit = (unitId, message, option = "none", method = null, ref = null) =>
    after(rpc("request_unit", { p_unit: unitId, p_message: message || "", p_option: option, p_method: method, p_ref: ref, p_month: ym() }));
  const decideRequest = (id, approve) => after(rpc("decide_request", { p_request: id, p_approve: approve }));
  const cancelRequest = (id) => after(rpc("cancel_request", { p_request: id }));
  const giveNotice = (unitId, date, reason) => after(rpc("give_notice", { p_unit: unitId, p_date: date, p_reason: reason || "" }));
  const acknowledgeNotice = (id) => after(rpc("ack_notice", { p_notice: id }));
  const withdrawNotice = (id) => after(rpc("withdraw_notice", { p_notice: id }));
  const saveCheck = (_me, propertyId, month, items) => after(rpc("save_check", { p_property: propertyId, p_month: month, p_items: items }));
  const addExpense = (_me, d) => after(run(sb.from("expenses").insert({ property_id: d.propertyId || null, category: d.category,
    amount: num(d.amount), date: d.date || today(), note: d.note || "" })));
  const deleteExpense = (id) => after(run(sb.from("expenses").delete().eq("id", id)));
  async function markAllRead() {
    if (!me || !db.notifications.some((n) => !n.read)) return;
    db.notifications.forEach((n) => (n.read = true));
    await run(sb.from("notifications").update({ read: true }).eq("user_id", me.id).eq("read", false));
  }

  /* ---------- M-Pesa (server functions) ---------- */
  async function fn(name, body) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("Your session has expired. Please log in again.");
    let res;
    try {
      res = await fetch(TG_CONFIG.supabaseUrl + "/functions/v1/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: TG_CONFIG.supabaseKey, Authorization: "Bearer " + session.access_token },
        body: JSON.stringify(body || {}),
      });
    } catch (e) { throw new Error(friendly(e)); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || "The server could not complete this (" + res.status + ").");
    return data;
  }
  const mpesaStatus = () => rpc("my_mpesa_status", {});
  async function connectMpesa(d) { const r = await fn("pay-connect", d); await loadProfile(); await load(); return r; }
  async function disconnectMpesa() { await rpc("disconnect_mpesa", {}); await loadProfile(); await load(); }
  /** Send the M-Pesa PIN prompt. d = { unitId, kind, month, amount, phone } */
  const stkPay = (d) => fn("pay-start", { action: "pay", ...d });
  const stkStatus = (id) => rpc("stk_status", { p_id: id });
  const stkCheck = (id) => fn("pay-start", { action: "check", id });
  const stkTest = (phone) => fn("pay-start", { action: "test", phone });
  /** Wait for an STK push to finish. Returns { status: paid|failed|cancelled|timeout, receipt, message }.
      onTick(secondsWaited) is called every poll so the page can update its message. */
  async function waitForStk(id, { onTick, isOpen } = {}) {
    const t0 = Date.now();
    let lastCheck = 0;
    while (Date.now() - t0 < 150000) {
      await new Promise((r) => setTimeout(r, 3000));
      if (isOpen && !isOpen()) return { status: "closed" };
      let st = null;
      try { st = await stkStatus(id); } catch (e) { /* network blip: keep waiting */ }
      // if Safaricom's confirmation is slow, ask Safaricom directly (every 10s after 20s)
      if (st && st.status === "sent" && Date.now() - t0 > 20000 && Date.now() - lastCheck > 10000) {
        lastCheck = Date.now();
        try { const c = await stkCheck(id); if (c.status !== "sent") st = await stkStatus(id); } catch (e) { /* keep waiting */ }
      }
      if (onTick) onTick(Math.round((Date.now() - t0) / 1000));
      if (st && ["paid", "failed", "cancelled"].includes(st.status)) return st;
    }
    return { status: "timeout" };
  }

  /* ---------- formatting ---------- */
  const money = (n) => "Ksh " + Number(n || 0).toLocaleString("en-KE");
  const monthLabel = (m) => { if (!m) return ""; const [y, mo] = m.split("-"); return new Date(+y, +mo - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); };
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

  return {
    get db() { return db; }, get me() { return me; }, client: sb,
    today, ym, addMonths, init, refresh, onChange,
    currentUser: () => me, peek: loadProfile, login, register, logout, resetPassword, updatePassword, onAuth, updateProfile,
    user, property, unit, propertiesOf, unitsOf, landlordUnits, landlordOfUnit, tenantUnit, isMine, myUnit,
    notificationsOf, markAllRead, paymentsOf, rentStatus, depositPaid, lastCheck,
    addProperty, addUnits, updateProperty, deleteProperty, updateUnit, deleteUnit,
    addTenant, newInviteCode, claimInvite, vacateUnit, renewLease, notifyTenant, announce,
    recordPayment, reportPayment, reviewPayment, deletePayment,
    requestUnit, decideRequest, cancelRequest, giveNotice, acknowledgeNotice, withdrawNotice,
    saveCheck, addExpense, deleteExpense,
    mpesaStatus, connectMpesa, disconnectMpesa, stkPay, stkStatus, stkCheck, stkTest, waitForStk,
    money, monthLabel, fmtDate,
  };
})();
