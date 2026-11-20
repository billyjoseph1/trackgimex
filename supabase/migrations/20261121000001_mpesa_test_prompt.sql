-- =====================================================================
-- TrackGimex — landlord "test prompt": a Ksh 1 STK push to the landlord's
-- own phone that proves the Paybill/Till, keys and passkey are right.
-- Tenants only see "Pay with M-Pesa" after this test has succeeded.
-- =====================================================================

alter table private.stk_requests alter column tenant_id drop not null;
alter table private.stk_requests add column is_test boolean not null default false;
alter table private.stk_requests add constraint stk_tenant_unless_test check (is_test or tenant_id is not null);
alter table private.mpesa_accounts add column tested_at timestamptz;

-- accounts already connected: keep them working if they have taken a real payment
update private.mpesa_accounts a set tested_at = a.verified_at
 where exists (select 1 from private.stk_requests s where s.landlord_id = a.landlord_id and s.status = 'paid');
update public.profiles p set mpesa_ready = exists (select 1 from private.mpesa_accounts a where a.landlord_id = p.id and a.tested_at is not null)
 where p.role = 'landlord';

-- saving (new or changed) details always needs a fresh test
create or replace function public.svc_save_mpesa_account(p_landlord uuid, p_env text, p_type text, p_shortcode text, p_party_b text,
  p_shared boolean, p_key text, p_secret text, p_passkey text) returns void
language plpgsql security definer set search_path = '' as $$
declare a private.mpesa_accounts;
begin
  if not exists (select 1 from public.profiles where id = p_landlord and role = 'landlord') then raise exception 'Not a landlord.'; end if;
  if p_shared and p_env <> 'sandbox' then raise exception 'Shared test keys are only for sandbox.'; end if;
  select * into a from private.mpesa_accounts where landlord_id = p_landlord;
  insert into private.mpesa_accounts as m (landlord_id, environment, account_type, business_shortcode, party_b, use_shared_sandbox,
                                            key_secret_id, secret_secret_id, passkey_secret_id, verified_at, tested_at, updated_at)
  values (p_landlord, p_env, p_type, p_shortcode, coalesce(nullif(p_party_b, ''), p_shortcode), p_shared,
          case when p_shared then null else private.put_secret(a.key_secret_id, p_key, 'mpesa_key') end,
          case when p_shared then null else private.put_secret(a.secret_secret_id, p_secret, 'mpesa_secret') end,
          case when p_shared then null else private.put_secret(a.passkey_secret_id, p_passkey, 'mpesa_passkey') end,
          now(), null, now())
  on conflict (landlord_id) do update set environment = excluded.environment, account_type = excluded.account_type,
     business_shortcode = excluded.business_shortcode, party_b = excluded.party_b, use_shared_sandbox = excluded.use_shared_sandbox,
     key_secret_id = excluded.key_secret_id, secret_secret_id = excluded.secret_secret_id,
     passkey_secret_id = excluded.passkey_secret_id, verified_at = now(), tested_at = null, updated_at = now();
  update public.profiles set mpesa_ready = false where id = p_landlord;   -- until the test prompt succeeds
end $$;

create or replace function public.my_mpesa_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a private.mpesa_accounts;
begin
  perform private.require_landlord();
  select * into a from private.mpesa_accounts where landlord_id = auth.uid();
  if a.landlord_id is null then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', a.verified_at is not null, 'tested', a.tested_at is not null, 'testedAt', a.tested_at,
    'environment', a.environment, 'type', a.account_type, 'shortcode', a.business_shortcode, 'partyB', a.party_b,
    'sharedSandbox', a.use_shared_sandbox, 'verifiedAt', a.verified_at, 'updatedAt', a.updated_at);
end $$;

-- a Ksh 1 prompt to the landlord's own phone
create function public.svc_prepare_test_stk(p_landlord uuid, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare stk private.stk_requests;
begin
  if not exists (select 1 from private.mpesa_accounts where landlord_id = p_landlord) then raise exception 'Connect M-Pesa first.'; end if;
  if p_phone !~ '^254(7|1)\d{8}$' then raise exception 'Enter a valid Safaricom number, e.g. 0712 345 678.'; end if;
  if (select count(*) from private.stk_requests where user_id = p_landlord and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many attempts. Please wait a few minutes.'; end if;
  insert into private.stk_requests (landlord_id, tenant_id, user_id, amount, phone, account_ref, is_test)
  values (p_landlord, null, p_landlord, 1, p_phone, 'TGTEST', true) returning * into stk;
  return jsonb_build_object('id', stk.id, 'secret', stk.callback_secret, 'landlordId', p_landlord, 'amount', 1,
    'phone', p_phone, 'accountRef', 'TGTEST', 'description', 'TrackGimex test');
end $$;

create or replace function public.svc_stk_complete(p_id uuid, p_paid boolean, p_receipt text, p_amount int, p_code text, p_desc text) returns text
language plpgsql security definer set search_path = '' as $$
declare s private.stk_requests; u public.units; nm text; pname text;
begin
  select * into s from private.stk_requests where id = p_id for update;
  if s.id is null then return 'unknown'; end if;
  if s.status in ('paid', 'failed', 'cancelled') then return 'already ' || s.status; end if;   -- callbacks can arrive twice
  if p_paid and p_amount is not null and p_amount < s.amount then
    raise exception 'Amount mismatch: expected %, got %', s.amount, p_amount; end if;

  if s.is_test then
    update private.stk_requests set status = case when p_paid then 'paid' when p_code = '1032' then 'cancelled' else 'failed' end,
           mpesa_receipt = case when p_paid then p_receipt end, result_code = p_code, result_desc = left(p_desc, 300), completed_at = now()
     where id = p_id;
    if p_paid then
      update private.mpesa_accounts set tested_at = now() where landlord_id = s.landlord_id;
      update public.profiles set mpesa_ready = true where id = s.landlord_id;
      perform private.notify(s.landlord_id, 'M-Pesa test passed: Ksh 1 received (' || p_receipt || '). Your tenants can now pay you with an M-Pesa prompt.', 'settings');
      return 'paid';
    end if;
    perform private.notify(s.landlord_id, 'M-Pesa test did not go through: ' || coalesce(p_desc, 'unknown reason') || '. Check your details in Settings and try again.', 'settings');
    return 'failed';
  end if;

  select * into u from public.units where id = s.unit_id;
  select name into pname from public.properties where id = u.property_id;
  select name into nm from public.profiles where id = s.user_id;
  if p_paid then
    update private.stk_requests set status = 'paid', mpesa_receipt = p_receipt, result_code = p_code, result_desc = p_desc, completed_at = now()
     where id = p_id;
    update public.payments set status = 'confirmed', ref = upper(p_receipt), reviewed_at = now()
     where stk_request_id = p_id and status = 'pending';
    if s.request_id is not null then
      update public.house_requests set paid = true where id = s.request_id and status = 'pending';
      update public.units set status = 'reserved' where id = s.unit_id and status = 'vacant' and tenant_id is null;
      perform private.notify(s.landlord_id, nm || ' booked ' || coalesce(u.label, 'a house') || ' at ' || coalesce(pname, '') ||
        ' and paid ' || private.money(s.amount) || ' by M-Pesa (' || p_receipt || '). The house is reserved — approve the request to move them in.', 'requests');
    else
      perform private.notify(s.landlord_id, nm || ' paid ' || private.money(s.amount) || ' by M-Pesa for ' || coalesce(u.label, 'their house') ||
        ' (' || p_receipt || ').', 'payments');
    end if;
    perform private.notify(s.user_id, 'Payment received: ' || private.money(s.amount) || ' (M-Pesa ' || p_receipt || '). Your receipt is ready.', 'payments');
    return 'paid';
  else
    update private.stk_requests set status = case when p_code = '1032' then 'cancelled' else 'failed' end,
           result_code = p_code, result_desc = left(p_desc, 300), completed_at = now() where id = p_id;
    update public.payments set status = 'cancelled' where stk_request_id = p_id and status = 'pending';
    return 'failed';
  end if;
end $$;

revoke all on function public.svc_prepare_test_stk(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_prepare_test_stk(uuid, text) to service_role;
revoke all on function public.svc_save_mpesa_account(uuid, text, text, text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_save_mpesa_account(uuid, text, text, text, text, boolean, text, text, text) to service_role;
revoke all on function public.svc_stk_complete(uuid, boolean, text, int, text, text) from public, anon, authenticated;
grant execute on function public.svc_stk_complete(uuid, boolean, text, int, text, text) to service_role;
