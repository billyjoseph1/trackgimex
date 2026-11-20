// TrackGimex — a landlord connects their M-Pesa Paybill / Till (Daraja keys).
// The keys are checked with Safaricom, then saved encrypted in Vault.
import { admin, callerId, cors, json, rpc, token, SANDBOX_SHORTCODE } from "../_shared/daraja.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const uid = await callerId(req);
    if (!uid) return json({ error: "Please log in again." }, 401);
    if ((await rpc<string | null>("svc_user_role", { p_user: uid })) !== "landlord") {
      return json({ error: "Only landlords and agents can connect M-Pesa." }, 403);
    }

    const b = await req.json().catch(() => ({}));
    // Only live Paybills / Tills can be connected (test modes were removed for launch).
    if (b.sharedSandbox === true || b.environment !== "production") {
      return json({ error: "Only a live Paybill or Till can be connected." }, 400);
    }
    const shared = false;
    const env = "production";
    const type = b.type === "till" ? "till" : "paybill";
    const shortcode = shared ? SANDBOX_SHORTCODE : String(b.shortcode || "").trim();
    const partyB = shared ? SANDBOX_SHORTCODE : String(b.partyB || "").trim() || shortcode;
    const key = String(b.key || "").trim(), secret = String(b.secret || "").trim(), passkey = String(b.passkey || "").trim();
    if (!/^\d{5,8}$/.test(shortcode)) return json({ error: type === "till" ? "Enter the Store number (Head office number) of your Till." : "Enter your Paybill number." }, 400);
    if (!/^\d{5,8}$/.test(partyB)) return json({ error: "Enter your Till number." }, 400);

    if (shared) {
      const k = Deno.env.get("DARAJA_SANDBOX_KEY"), s = Deno.env.get("DARAJA_SANDBOX_SECRET");
      if (!k || !s) return json({ error: "Test mode is not set up on the server yet." }, 400);
      await token("sandbox", k, s);
    } else {
      // blank fields mean "keep what is saved" — but a first connection needs all three
      const { data: st } = await admin().rpc("svc_mpesa_credentials", { p_landlord: uid });
      const current = (st || {}) as Record<string, string | null>;
      const k = key || current.key, s = secret || current.secret, p = passkey || current.passkey;
      if (!k || !s || !p) return json({ error: "Enter the Consumer Key, Consumer Secret and Passkey." }, 400);
      await token(env, k, s);   // throws a friendly message if Safaricom rejects them
    }
    await rpc("svc_save_mpesa_account", { p_landlord: uid, p_env: env, p_type: type, p_shortcode: shortcode, p_party_b: partyB,
      p_shared: shared, p_key: key, p_secret: secret, p_passkey: passkey });
    return json({ ok: true, environment: env });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, 400);
  }
});
