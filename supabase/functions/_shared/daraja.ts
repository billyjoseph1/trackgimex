// TrackGimex — shared helpers for Safaricom Daraja (M-Pesa Express / STK push)
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

export const SANDBOX_SHORTCODE = "174379";
// Safaricom's published passkey for the sandbox shortcode 174379 (public test value)
export const SANDBOX_PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

export type Creds = {
  environment: "sandbox" | "production";
  type: "paybill" | "till";
  shortcode: string;
  partyB: string;
  sharedSandbox: boolean;
  key: string | null;
  secret: string | null;
  passkey: string | null;
};

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Supabase client with the service role (server only — never sent to browsers). */
export const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** The logged-in user who called the function (from their Authorization header). */
export async function callerId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await admin().auth.getUser(jwt);
  return error || !data.user ? null : data.user.id;
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Fill in TrackGimex's own sandbox keys when a landlord uses "test mode". */
export function resolve(c: Creds): Required<Pick<Creds, "key" | "secret" | "passkey">> & Creds {
  if (c.sharedSandbox) {
    const key = Deno.env.get("DARAJA_SANDBOX_KEY"), secret = Deno.env.get("DARAJA_SANDBOX_SECRET");
    if (!key || !secret) throw new Error("Test mode is not set up yet (missing sandbox keys on the server).");
    return { ...c, key, secret, passkey: SANDBOX_PASSKEY, shortcode: SANDBOX_SHORTCODE, partyB: SANDBOX_SHORTCODE };
  }
  if (!c.key || !c.secret || !c.passkey) throw new Error("M-Pesa keys are incomplete. Reconnect M-Pesa in Settings.");
  return c as Required<Pick<Creds, "key" | "secret" | "passkey">> & Creds;
}

const base = (env: string) => env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

async function daraja(url: string, init: RequestInit, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
    return { status: res.status, body };
  } finally { clearTimeout(t); }
}

export async function token(env: string, key: string, secret: string): Promise<string> {
  const { status, body } = await daraja(`${base(env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: "Basic " + btoa(`${key}:${secret}`) },
  });
  if (status !== 200 || !body.access_token) {
    throw new Error("Safaricom rejected the Consumer Key / Consumer Secret" +
      (body.errorMessage ? ` (${body.errorMessage})` : "") + ". Check you copied them from the right app (sandbox vs live).");
  }
  return String(body.access_token);
}

/** Daraja wants the time in Kenya (EAT, UTC+3) as YYYYMMDDHHmmss. */
export function timestamp(d = new Date()): string {
  const k = new Date(d.getTime() + 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}${p(k.getUTCHours())}${p(k.getUTCMinutes())}${p(k.getUTCSeconds())}`;
}
const password = (shortcode: string, passkey: string, ts: string) => btoa(shortcode + passkey + ts);

export function normalisePhone(input: string): string | null {
  const d = String(input || "").replace(/\D/g, "");
  const m = d.match(/^(?:254|0)?((?:7|1)\d{8})$/);
  return m ? "254" + m[1] : null;
}

export async function stkPush(c: ReturnType<typeof resolve>, o: { amount: number; phone: string; callbackUrl: string; accountRef: string; description: string }) {
  const ts = timestamp();
  const tok = await token(c.environment, c.key, c.secret);
  const { status, body } = await daraja(`${base(c.environment)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: c.shortcode,
      Password: password(c.shortcode, c.passkey, ts),
      Timestamp: ts,
      TransactionType: c.type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: Math.round(o.amount),
      PartyA: o.phone,
      PartyB: c.partyB,
      PhoneNumber: o.phone,
      CallBackURL: o.callbackUrl,
      AccountReference: o.accountRef.slice(0, 12),
      TransactionDesc: o.description.slice(0, 13),
    }),
  });
  if (status === 200 && String(body.ResponseCode) === "0") {
    return { ok: true as const, checkoutRequestId: String(body.CheckoutRequestID), merchantRequestId: String(body.MerchantRequestID) };
  }
  return { ok: false as const, message: String(body.errorMessage || body.ResponseDescription || body.raw || `HTTP ${status}`) };
}

/** Ask Safaricom for the real result of an STK push. */
export async function stkCheck(c: ReturnType<typeof resolve>, checkoutRequestId: string) {
  const ts = timestamp();
  const tok = await token(c.environment, c.key, c.secret);
  const { status, body } = await daraja(`${base(c.environment)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ BusinessShortCode: c.shortcode, Password: password(c.shortcode, c.passkey, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
  });
  if (status === 200 && body.ResultCode !== undefined) {
    return { state: String(body.ResultCode) === "0" ? "paid" as const : "failed" as const, code: String(body.ResultCode), desc: String(body.ResultDesc || "") };
  }
  // "The transaction is being processed" or Safaricom temporarily unavailable
  return { state: "waiting" as const, code: String(body.errorCode || status), desc: String(body.errorMessage || "") };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
