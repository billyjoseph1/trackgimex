-- =====================================================================
-- TrackGimex — Stage 2: M-Pesa Express (STK push) via each landlord's
-- own Paybill / Till (Safaricom Daraja).
--
--  * Landlords' Daraja keys are stored ENCRYPTED in Supabase Vault and can
--    only be read by the server functions (service role). The browser can
--    only see "connected: yes/no" and the shortcode.
--  * A payment only becomes "confirmed" after Safaricom's callback AND a
--    second check with Safaricom's STK Query API (done in the Edge Function).
--  * Functions named svc_* are for the Edge Functions only (service role).
-- =====================================================================

-- ---------------------------------------------------------------------
-- landlord M-Pesa accounts (private: not reachable through the API)
-- ---------------------------------------------------------------------
create table private.mpesa_accounts (
  landlord_id        uuid primary key references public.profiles (id) on delete cascade,
  environment        text not null check (environment in ('sandbox', 'production')),
  account_type       text not null check (account_type in ('paybill', 'till')),
  business_shortcode text not null check (business_shortcode ~ '^\d{5,8}$'),   -- Paybill no. or Till's store number
  party_b            text not null check (party_b ~ '^\d{5,8}$'),              -- Paybill no. or Till no.
  use_shared_sandbox boolean not null default false,  -- test mode with TrackGimex's own sandbox keys
  key_secret_id      uuid,   -- vault ids
  secret_secret_id   uuid,
  passkey_secret_id  uuid,
  verified_at        timestamptz,
  updated_at         timestamptz not null default now()
);
alter table private.mpesa_accounts enable row level security;   -- no policies: nobody but the owner role / service role

-- one row per STK push sent to a tenant's phone
create table private.stk_requests (
  id                  uuid primary key default gen_random_uuid(),
  callback_secret     text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  landlord_id         uuid not null references public.profiles (id) on delete cascade,
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  unit_id             uuid references public.units (id) on delete set null,
  request_id          uuid references public.house_requests (id) on delete set null,
  amount              integer not null check (amount between 1 and 250000),     -- M-Pesa per-transaction limit
  phone               text not null check (phone ~ '^254(7|1)\d{8}$'),
  account_ref         text not null,
  status              text not null default 'initiated' check (status in ('initiated', 'sent', 'paid', 'failed', 'cancelled')),
  checkout_request_id text unique,
  merchant_request_id text,
  mpesa_receipt       text unique,
  result_code         text,
  result_desc         text,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index stk_user_idx on private.stk_requests (user_id, created_at desc);
alter table private.stk_requests enable row level security;

-- payments made through STK point at their request
alter table public.payments add column stk_request_id uuid references private.stk_requests (id) on delete set null;
-- an M-Pesa receipt can pay deposit + rent in one go, so the duplicate-reference
-- rule only applies to codes typed in by people
drop index public.payments_ref_unique;
create unique index payments_ref_unique on public.payments (landlord_id, upper(ref))
  where ref <> '' and status in ('pending', 'confirmed') and stk_request_id is null;

-- tenants' pages need to know if a landlord accepts the M-Pesa prompt
alter table public.profiles add column mpesa_ready boolean not null default false;
grant select (mpesa_ready) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- landlord: status and disconnect (browser-callable)
-- ---------------------------------------------------------------------
create function public.my_mpesa_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a private.mpesa_accounts;
begin
  perform private.require_landlord();
  select * into a from private.mpesa_accounts where landlord_id = auth.uid();
  if a.landlord_id is null then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', a.verified_at is not null, 'environment', a.environment, 'type', a.account_type,
    'shortcode', a.business_shortcode, 'partyB', a.party_b, 'sharedSandbox', a.use_shared_sandbox,
    'verifiedAt', a.verified_at, 'updatedAt', a.updated_at);
end $$;

create function public.disconnect_mpesa() returns void
language plpgsql security definer set search_path = '' as $$
declare a private.mpesa_accounts;
begin
  perform private.require_landlord();
  delete from private.mpesa_accounts where landlord_id = auth.uid() returning * into a;
  if a.landlord_id is not null then
    delete from vault.secrets where id in (a.key_secret_id, a.secret_secret_id, a.passkey_secret_id);
  end if;
  update public.profiles set mpesa_ready = false where id = auth.uid();
end $$;

-- tenant: follow an STK request they started
create function public.stk_status(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', status, 'receipt', mpesa_receipt, 'message', result_desc, 'amount', amount)
    from private.stk_requests where id = p_id and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- SERVICE-ONLY functions (Edge Functions call these with the service role)
-- ---------------------------------------------------------------------
create function private.put_secret(p_old uuid, p_value text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if p_value is null or p_value = '' then return p_old; end if;   -- keep the existing one
  if p_old is not null and exists (select 1 from vault.secrets where id = p_old) then
    perform vault.update_secret(p_old, p_value);
    return p_old;
  end if;
  return vault.create_secret(p_value, p_name || '_' || gen_random_uuid());
end $$;

-- saves a landlord's Daraja details AFTER the Edge Function verified them with Safaricom
create function public.svc_save_mpesa_account(p_landlord uuid, p_env text, p_type text, p_shortcode text, p_party_b text,
  p_shared boolean, p_key text, p_secret text, p_passkey text) returns void
language plpgsql security definer set search_path = '' as $$
declare a private.mpesa_accounts;
begin
  if not exists (select 1 from public.profiles where id = p_landlord and role = 'landlord') then raise exception 'Not a landlord.'; end if;
  if p_shared and p_env <> 'sandbox' then raise exception 'Shared test keys are only for sandbox.'; end if;
  select * into a from private.mpesa_accounts where landlord_id = p_landlord;
  insert into private.mpesa_accounts as m (landlord_id, environment, account_type, business_shortcode, party_b, use_shared_sandbox,
                                            key_secret_id, secret_secret_id, passkey_secret_id, verified_at, updated_at)
  values (p_landlord, p_env, p_type, p_shortcode, coalesce(nullif(p_party_b, ''), p_shortcode), p_shared,
          case when p_shared then null else private.put_secret(a.key_secret_id, p_key, 'mpesa_key') end,
          case when p_shared then null else private.put_secret(a.secret_secret_id, p_secret, 'mpesa_secret') end,
          case when p_shared then null else private.put_secret(a.passkey_secret_id, p_passkey, 'mpesa_passkey') end,
          now(), now())
  on conflict (landlord_id) do update set environment = excluded.environment, account_type = excluded.account_type,
     business_shortcode = excluded.business_shortcode, party_b = excluded.party_b, use_shared_sandbox = excluded.use_shared_sandbox,
     key_secret_id = excluded.key_secret_id, secret_secret_id = excluded.secret_secret_id,
     passkey_secret_id = excluded.passkey_secret_id, verified_at = now(), updated_at = now();
  update public.profiles set mpesa_ready = true where id = p_landlord;
end $$;

-- the stored details for a landlord (decrypted) — Edge Functions only
create function public.svc_mpesa_credentials(p_landlord uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('environment', a.environment, 'type', a.account_type, 'shortcode', a.business_shortcode,
    'partyB', a.party_b, 'sharedSandbox', a.use_shared_sandbox,
    'key', (select decrypted_secret from vault.decrypted_secrets where id = a.key_secret_id),
    'secret', (select decrypted_secret from vault.decrypted_secrets where id = a.secret_secret_id),
    'passkey', (select decrypted_secret from vault.decrypted_secrets where id = a.passkey_secret_id))
  from private.mpesa_accounts a where a.landlord_id = p_landlord;
$$;

-- check everything and create the STK request + pending payment rows
-- p_kind: 'rent' | 'deposit' (own house) or 'deposit' | 'deposit_rent' (booking a vacant house)
create function public.svc_prepare_stk(p_user uuid, p_unit uuid, p_kind text, p_month text, p_amount int, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t uuid; u public.units; p public.properties; mine boolean; req uuid; stk private.stk_requests;
  total int; nm text; acct text;
begin
  select id into t from public.tenants where user_id = p_user and landlord_id is null;
  if t is null then raise exception 'Only tenant accounts can pay.'; end if;
  select * into u from public.units where id = p_unit;
  if u.id is null then raise exception 'House not found.'; end if;
  select * into p from public.properties where id = u.property_id;
  if not exists (select 1 from public.profiles where id = p.landlord_id and mpesa_ready) then
    raise exception 'This landlord has not connected M-Pesa yet. Pay with the M-Pesa code instead.'; end if;
  mine := u.tenant_id in (select id from public.tenants where user_id = p_user);
  if p_phone !~ '^254(7|1)\d{8}$' then raise exception 'Enter a valid Safaricom number, e.g. 0712 345 678.'; end if;
  if (select count(*) from private.stk_requests where user_id = p_user and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many payment attempts. Please wait a few minutes.'; end if;

  if mine then
    perform private.check_payment_args(p_kind, p_month, p_amount);
    total := p_amount;
    t := u.tenant_id;
  else
    if u.status <> 'vacant' then raise exception 'Sorry, this house is no longer available.'; end if;
    if p_kind not in ('deposit', 'deposit_rent') then raise exception 'Choose deposit or deposit + rent.'; end if;
    if exists (select 1 from public.units where tenant_id in (select id from public.tenants where user_id = p_user)) then
      raise exception 'You already rent a house. Give notice there before booking another.'; end if;
    total := greatest(u.deposit, 1) + case when p_kind = 'deposit_rent' then u.rent else 0 end;
    select id into req from public.house_requests where unit_id = u.id and tenant_id = t and status = 'pending';
    if req is null then
      if (select count(*) from public.house_requests where tenant_id = t and status = 'pending') >= 5 then
        raise exception 'You can have at most 5 open requests. Cancel one first.'; end if;
      insert into public.house_requests (unit_id, tenant_id, landlord_id, message, paid)
      values (u.id, t, p.landlord_id, 'Booking via M-Pesa.', false) returning id into req;
    end if;
  end if;
  if total > 250000 then raise exception 'M-Pesa allows at most Ksh 250,000 per payment. Pay in parts.'; end if;

  acct := left(regexp_replace(upper(p.name), '[^A-Z0-9]', '', 'g'), 6) || u.label;
  insert into private.stk_requests (landlord_id, tenant_id, user_id, unit_id, request_id, amount, phone, account_ref)
  values (p.landlord_id, t, p_user, u.id, req, total, p_phone, left(acct, 12)) returning * into stk;

  if mine then
    insert into public.payments (landlord_id, property_id, unit_id, unit_label, tenant_id, kind, month, amount, method, status, recorded_by, stk_request_id)
    values (p.landlord_id, u.property_id, u.id, u.label, t, p_kind, case when p_kind = 'rent' then p_month end, p_amount, 'M-Pesa', 'pending', p_user, stk.id);
  else
    insert into public.payments (landlord_id, property_id, unit_id, unit_label, tenant_id, kind, amount, method, status, recorded_by, stk_request_id)
    values (p.landlord_id, u.property_id, u.id, u.label, t, 'deposit', greatest(u.deposit, 1), 'M-Pesa', 'pending', p_user, stk.id);
    if p_kind = 'deposit_rent' and u.rent > 0 then
      insert into public.payments (landlord_id, property_id, unit_id, unit_label, tenant_id, kind, month, amount, method, status, recorded_by, stk_request_id)
      values (p.landlord_id, u.property_id, u.id, u.label, t, 'rent', to_char(now() at time zone 'Africa/Nairobi', 'YYYY-MM'), u.rent, 'M-Pesa', 'pending', p_user, stk.id);
    end if;
  end if;

  return jsonb_build_object('id', stk.id, 'secret', stk.callback_secret, 'landlordId', p.landlord_id, 'amount', total,
    'phone', p_phone, 'accountRef', stk.account_ref, 'description', left('Rent ' || u.label, 13));
end $$;

create function public.svc_stk_sent(p_id uuid, p_ok boolean, p_checkout text, p_merchant text, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update private.stk_requests set status = 'sent', checkout_request_id = p_checkout, merchant_request_id = p_merchant
     where id = p_id and status = 'initiated';
  else
    update private.stk_requests set status = 'failed', result_desc = left(p_message, 300), completed_at = now()
     where id = p_id and status = 'initiated';
    update public.payments set status = 'cancelled' where stk_request_id = p_id and status = 'pending';
  end if;
end $$;

-- look up an STK request for the callback (checks the secret)
create function public.svc_stk_for_callback(p_id uuid, p_secret text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'landlordId', landlord_id, 'checkoutRequestId', checkout_request_id, 'status', status, 'amount', amount)
    from private.stk_requests where id = p_id and callback_secret = p_secret;
$$;

-- final result. Only call with p_paid = true after the STK Query API also said it succeeded.
create function public.svc_stk_complete(p_id uuid, p_paid boolean, p_receipt text, p_amount int, p_code text, p_desc text) returns text
language plpgsql security definer set search_path = '' as $$
declare s private.stk_requests; u public.units; nm text; tuser uuid; pname text;
begin
  select * into s from private.stk_requests where id = p_id for update;
  if s.id is null then return 'unknown'; end if;
  if s.status in ('paid', 'failed', 'cancelled') then return 'already ' || s.status; end if;   -- callbacks can arrive twice
  select * into u from public.units where id = s.unit_id;
  select name into pname from public.properties where id = u.property_id;
  select name into nm from public.profiles where id = s.user_id;
  if p_paid then
    if p_amount is not null and p_amount < s.amount then
      raise exception 'Amount mismatch: expected %, got %', s.amount, p_amount; end if;
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

-- requests stuck in "sent" (callback never came) so the Edge Function can query them
create function public.svc_stale_stk(p_user uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'landlordId', landlord_id, 'checkoutRequestId', checkout_request_id, 'status', status, 'amount', amount)
    from private.stk_requests where id = p_id and user_id = p_user;
$$;

-- a booking whose house got reserved by M-Pesa must free the house again when declined/cancelled
create or replace function public.cancel_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me_t uuid := private.require_tenant(); r public.house_requests; lbl text;
begin
  select * into r from public.house_requests where id = p_request and tenant_id = me_t for update;
  if r.id is null or r.status <> 'pending' then raise exception 'Request not found.'; end if;
  update public.house_requests set status = 'cancelled' where id = r.id;
  update public.payments set status = 'cancelled' where unit_id = r.unit_id and tenant_id = me_t and status = 'pending';
  update public.units set status = 'vacant' where id = r.unit_id and status = 'reserved' and tenant_id is null;
  select label into lbl from public.units where id = r.unit_id;
  perform private.notify(r.landlord_id, (select name from public.profiles where id = auth.uid()) ||
    ' cancelled their request for ' || lbl || '.' || case when r.paid then ' They paid — please refund them.' else '' end, 'requests');
end $$;

-- ---------------------------------------------------------------------
-- permissions
-- ---------------------------------------------------------------------
revoke all on function public.my_mpesa_status(), public.disconnect_mpesa(), public.stk_status(uuid) from public, anon;
grant execute on function public.my_mpesa_status(), public.disconnect_mpesa(), public.stk_status(uuid) to authenticated;
revoke all on function private.put_secret(uuid, text, text) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'svc\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
-- the house-hunting tenant who booked can still see a house once it is reserved
-- (already covered by private.can_see_unit through their house request)
