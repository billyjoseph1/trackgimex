// TrackGimex — Safaricom calls this when an STK push finishes.
// Safaricom does not sign callbacks, so we:
//   1. only accept the secret, one-time URL we gave for this payment, and
//   2. ask Safaricom (STK query) for the real result before marking it paid.
import { resolve, rpc, sleep, stkCheck, type Creds } from "../_shared/daraja.ts";

const ack = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return ack();
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id") || "", secret = url.searchParams.get("s") || "";
    if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{48}$/.test(secret)) return ack();
    const s = await rpc<{ id: string; landlordId: string; checkoutRequestId: string; status: string; amount: number } | null>(
      "svc_stk_for_callback", { p_id: id, p_secret: secret });
    if (!s || s.status !== "sent") return ack();

    const body = await req.json().catch(() => ({}));
    const cb = body?.Body?.stkCallback || {};
    if (String(cb.CheckoutRequestID || "") !== s.checkoutRequestId) return ack();
    const code = String(cb.ResultCode ?? "");
    const items: { Name: string; Value?: unknown }[] = cb.CallbackMetadata?.Item || [];
    const item = (n: string) => items.find((i) => i.Name === n)?.Value;

    if (code !== "0") {
      await rpc("svc_stk_complete", { p_id: s.id, p_paid: false, p_receipt: null, p_amount: null, p_code: code, p_desc: String(cb.ResultDesc || "") });
      return ack();
    }
    // Confirm with Safaricom directly (retry briefly while it says "being processed")
    const c = resolve(await rpc<Creds>("svc_mpesa_credentials", { p_landlord: s.landlordId }));
    let check = await stkCheck(c, s.checkoutRequestId);
    for (let i = 0; i < 3 && check.state === "waiting"; i++) { await sleep(2500); check = await stkCheck(c, s.checkoutRequestId); }
    if (check.state !== "paid") {
      if (check.state === "failed") {
        await rpc("svc_stk_complete", { p_id: s.id, p_paid: false, p_receipt: null, p_amount: null, p_code: check.code, p_desc: check.desc });
      }
      return ack();   // still unclear: leave it "sent"; the tenant's page asks again later
    }
    const receipt = String(item("MpesaReceiptNumber") || "").toUpperCase();
    const amount = Number(item("Amount") || 0);
    await rpc("svc_stk_complete", { p_id: s.id, p_paid: true, p_receipt: /^[A-Z0-9]{8,12}$/.test(receipt) ? receipt : "Q" + s.checkoutRequestId.slice(-9).toUpperCase(),
      p_amount: amount || null, p_code: "0", p_desc: String(cb.ResultDesc || "") });
  } catch (e) {
    console.error("pay-callback", e);
  }
  return ack();
});
