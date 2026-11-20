// TrackGimex — start an M-Pesa STK push (PIN prompt on the tenant's phone),
// or check on one whose confirmation from Safaricom has not arrived yet.
//   POST { action: "pay", unitId, kind, month?, amount?, phone }
//   POST { action: "check", id }
//   POST { action: "test", phone }      (landlord: Ksh 1 prompt to their own phone)
import { callerId, cors, json, normalisePhone, resolve, rpc, stkCheck, stkPush, type Creds } from "../_shared/daraja.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const uid = await callerId(req);
    if (!uid) return json({ error: "Please log in again." }, 401);
    const b = await req.json().catch(() => ({}));

    if (b.action === "check") {
      const s = await rpc<{ id: string; landlordId: string; checkoutRequestId: string | null; status: string } | null>("svc_stale_stk", { p_user: uid, p_id: b.id });
      if (!s) return json({ error: "Payment not found." }, 404);
      if (s.status !== "sent" || !s.checkoutRequestId) return json({ status: s.status });
      const c = resolve(await rpc<Creds>("svc_mpesa_credentials", { p_landlord: s.landlordId }));
      const r = await stkCheck(c, s.checkoutRequestId);
      if (r.state === "waiting") return json({ status: "sent" });
      // Safaricom's query does not return the receipt number; the callback normally fills it in.
      const receipt = "Q" + s.checkoutRequestId.replace(/[^A-Za-z0-9]/g, "").slice(-9).toUpperCase();
      const out = await rpc<string>("svc_stk_complete", { p_id: s.id, p_paid: r.state === "paid", p_receipt: receipt, p_amount: null, p_code: r.code, p_desc: r.desc });
      return json({ status: out === "paid" ? "paid" : r.code === "1032" ? "cancelled" : "failed", message: r.desc });
    }

    const phone = normalisePhone(b.phone);
    if (!phone) return json({ error: "Enter a valid Safaricom number, e.g. 0712 345 678." }, 400);
    type Prep = { id: string; secret: string; landlordId: string; amount: number; phone: string; accountRef: string; description: string };
    let prep: Prep;
    if (b.action === "test") {
      // landlord checks their own Paybill/Till with a Ksh 1 prompt to their phone
      if ((await rpc<string | null>("svc_user_role", { p_user: uid })) !== "landlord") return json({ error: "Only landlords can send a test prompt." }, 403);
      prep = await rpc<Prep>("svc_prepare_test_stk", { p_landlord: uid, p_phone: phone });
    } else {
      prep = await rpc<Prep>("svc_prepare_stk", { p_user: uid, p_unit: b.unitId, p_kind: b.kind, p_month: b.month ?? null, p_amount: b.amount ?? null, p_phone: phone });
    }
    let c;
    try { c = resolve(await rpc<Creds>("svc_mpesa_credentials", { p_landlord: prep.landlordId })); }
    catch (e) { await rpc("svc_stk_sent", { p_id: prep.id, p_ok: false, p_checkout: null, p_merchant: null, p_message: String(e) }); throw e; }

    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pay-callback?id=${prep.id}&s=${prep.secret}`;
    const r = await stkPush(c, { amount: prep.amount, phone, callbackUrl, accountRef: prep.accountRef, description: prep.description });
    await rpc("svc_stk_sent", { p_id: prep.id, p_ok: r.ok, p_checkout: r.ok ? r.checkoutRequestId : null,
      p_merchant: r.ok ? r.merchantRequestId : null, p_message: r.ok ? "" : r.message });
    if (!r.ok) return json({ error: "M-Pesa could not send the prompt: " + r.message }, 502);
    return json({ id: prep.id, amount: prep.amount });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, 400);
  }
});
