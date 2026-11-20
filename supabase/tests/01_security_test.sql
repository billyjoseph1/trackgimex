-- TrackGimex security tests. Run with: supabase/tests/run_local.sh
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

-- helpers (test-only)
create function public.t_as(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p)::text, false); end $$;
create function public.t_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm not ilike '%' || p_like || '%' then raise exception 'Expected error like "%" but got "%" for: %', p_like, sqlerrm, p_sql; end if;
    return;
  end;
  raise exception 'Expected failure but succeeded: %', p_sql;
end $$;
create function public.t_eq(p_got bigint, p_want bigint, p_what text) returns void language plpgsql as $$
begin if p_got is distinct from p_want then raise exception 'FAIL %: got %, want %', p_what, p_got, p_want; end if;
      raise notice 'ok  %', p_what; end $$;
grant execute on function public.t_as(uuid), public.t_fail(text, text), public.t_eq(bigint, bigint, text) to authenticated, anon;
set client_min_messages = notice;

-- users
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
 ('00000000-0000-0000-0000-00000000000a', 'l1@test.local', '{"role":"landlord","name":"Jane Landlord","kind":"Agent","phone":"0712"}', now()),
 ('00000000-0000-0000-0000-00000000000b', 'l2@test.local', '{"role":"landlord","name":"Other Landlord"}', now()),
 ('00000000-0000-0000-0000-000000000001', 't1@test.local', '{"role":"tenant","name":"Tenant One","phone":"0722"}', now()),
 ('00000000-0000-0000-0000-000000000002', 't2@test.local', '{"role":"tenant","name":"Tenant Two"}', now()),
 ('00000000-0000-0000-0000-000000000003', 't3@test.local', '{"role":"tenant","name":"Tenant Three"}', now()),
 ('00000000-0000-0000-0000-000000000009', 'evil@test.local', '{"role":"superadmin","name":"Evil","kind":"Agent"}', null);
select t_eq((select count(*) from profiles where role = 'landlord'), 2, 'sign-up creates landlord profiles');
select t_eq((select count(*) from profiles where id = '00000000-0000-0000-0000-000000000009' and role = 'tenant' and kind = 'Tenant'), 1, 'unknown role in sign-up becomes plain tenant');
select t_eq((select count(*) from tenants where landlord_id is null), 4, 'each tenant gets a self record');

set role authenticated;

-- ===== landlord 1 sets up a building =====
select t_as('00000000-0000-0000-0000-00000000000a');
create temp table ids (k text primary key, v uuid);
insert into ids select 'p1', create_property('Sunrise', 'Kasarani', '', 5, 'A', '1 Bedroom', 15000, 15000);
select t_eq((select count(*) from units where property_id = (select v from ids where k = 'p1')), 5, 'create_property makes 5 houses');
select add_units((select v from ids where k = 'p1'), 2, 'A', 'Bedsitter', 9000, 9000);
select t_eq((select count(*) from units where label = 'A7'), 1, 'add_units continues numbering (A6, A7)');
insert into ids select 'a1', id from units where label = 'A1';
insert into ids select 'a2', id from units where label = 'A2';
insert into ids select 'a3', id from units where label = 'A3';
update units set rent = 16000 where id = (select v from ids where k = 'a1');
select t_eq((select rent from units where id = (select v from ids where k = 'a1')), 16000, 'landlord edits own rent');
select t_fail($$update units set tenant_id = gen_random_uuid()$$, 'permission denied');
select t_fail($$update units set status = 'occupied'$$, 'permission denied');
select t_fail($$insert into units (property_id, label) values ((select v from ids where k = 'p1'), 'Z1')$$, 'permission denied');
select t_fail($$select set_unit_status((select v from ids where k = 'a3'), 'occupied')$$, 'has no tenant');

-- add tenant by verified email -> auto-linked to Tenant One
select add_tenant((select v from ids where k = 'a1'), 'Tenant One', '0722', 'T1@test.local', current_date, 12, true, false, null)->>'linked' = 'true' as linked \gset
select t_eq(:'linked'::boolean::int, 1, 'add_tenant links a verified tenant email');
-- add offline tenant (no email) -> invite code
select add_tenant((select v from ids where k = 'a2'), 'Offline Person', '0733', '', current_date, 12, false, true, to_char(current_date, 'YYYY-MM'))->>'invite_code' as code \gset
select t_eq(length(:'code'), 8, 'offline tenant gets an 8-char invite code');
select t_eq((select count(*) from payments where status = 'confirmed'), 2, 'cash deposit + rent recorded at add_tenant');
select t_fail($$select add_tenant((select v from ids where k = 'a1'), 'X', '', '', current_date, 12, false, false, null)$$, 'already has a tenant');

-- ===== landlord 2 must not touch landlord 1 =====
select t_as('00000000-0000-0000-0000-00000000000b');
select t_eq((select count(*) from units where property_id = (select v from ids where k = 'p1')), 5, 'other landlord sees only VACANT houses (5 of 7)');
update units set rent = 1 where id = (select v from ids where k = 'a3');
select t_eq((select count(*) from units where rent = 1), 0, 'other landlord cannot change rent');
select t_fail($$select add_units((select v from ids where k = 'p1'), 1, 'A', 'x', 1, 1)$$, 'Building not found');
select t_fail($$select vacate_unit((select v from ids where k = 'a1'))$$, 'House not found');
select t_fail($$select record_payment((select v from ids where k = 'a1'), 'rent', '2026-11', 100, 'Cash', '')$$, 'House not found');
select t_eq((select count(*) from tenants), 0, 'other landlord sees no tenants');
select t_eq((select count(*) from payments), 0, 'other landlord sees no payments');
delete from properties where id = (select v from ids where k = 'p1');
select t_eq((select count(*) from properties where id = (select v from ids where k = 'p1')), 1, 'other landlord cannot delete building') ;
select t_fail($$insert into expenses (property_id, category, amount) values ((select v from ids where k = 'p1'), 'Repairs', 100)$$, 'row-level security');

-- ===== tenant one =====
select t_as('00000000-0000-0000-0000-000000000001');
select t_eq((select count(*) from units where tenant_id is not null), 1, 'tenant sees only own occupied house');
select t_fail($$select record_payment((select v from ids where k = 'a1'), 'rent', '2026-11', 100, 'Cash', '')$$, 'Only landlords');
select t_fail($$insert into payments (landlord_id, kind, amount, method) values ('00000000-0000-0000-0000-00000000000a', 'rent', 1, 'Cash')$$, 'permission denied');
select t_fail($$select report_payment((select v from ids where k = 'a2'), 'rent', '2026-11', 100, 'M-Pesa', 'X1')$$, 'own house');
select t_fail($$select report_payment((select v from ids where k = 'a1'), 'rent', null, 100, 'M-Pesa', 'X1')$$, 'month');
select report_payment((select v from ids where k = 'a1'), 'rent', to_char(current_date, 'YYYY-MM'), 16000, 'M-Pesa', 'qk12ab34');
select t_eq((select count(*) from payments where status = 'pending'), 1, 'tenant report creates a PENDING payment');
select t_fail($$select report_payment((select v from ids where k = 'a1'), 'rent', '2026-10', 100, 'M-Pesa', 'QK12AB34')$$, 'already been used');
select t_fail($$select email from profiles where role = 'landlord'$$, 'permission denied');
select t_eq((select count(*) from profiles where role = 'landlord'), 2, 'tenant can see landlord contact names');
select t_eq((select count(*) from profiles where role = 'tenant'), 1, 'tenant sees only own tenant profile');
select t_fail($$update profiles set role = 'landlord' where id = auth.uid()$$, 'permission denied');
select t_fail($$update profiles set kind = 'Agent' where id = auth.uid()$$, 'kind_matches_role');
update notifications set read = true;
select t_fail($$update notifications set text = 'hacked'$$, 'permission denied');
select t_fail($$select give_notice((select v from ids where k = 'a1'), current_date - 1, '')$$, 'from today');
select give_notice((select v from ids where k = 'a1'), current_date + 30, 'Relocating');
select t_fail($$select give_notice((select v from ids where k = 'a1'), current_date + 30, '')$$, 'already given notice');

-- ===== tenant two claims the invite for A2 =====
select t_as('00000000-0000-0000-0000-000000000002');
select t_eq((select count(*) from units where id = (select v from ids where k = 'a2')), 0, 'before claiming, tenant two cannot see A2');
select t_fail($$select claim_invite('WRONG123')$$, 'not valid');
select claim_invite(:'code');
select t_eq((select count(*) from units where id = (select v from ids where k = 'a2')), 1, 'after invite code, tenant two sees A2');
select t_eq((select count(*) from payments), 1, 'tenant two sees the rent recorded for A2');
select t_eq((select count(*) from payments where unit_id = (select v from ids where k = 'a1')), 0, 'tenant two cannot see tenant one payments');
-- tenant two also books A3 (already rents A2 -> approval must fail later)
select request_unit((select v from ids where k = 'a3'), 'hi', 'deposit', 'M-Pesa', 'T2DEP', null);

-- ===== tenant three books A3 too =====
select t_as('00000000-0000-0000-0000-000000000003');
select request_unit((select v from ids where k = 'a3'), 'please', 'deposit_rent', 'M-Pesa', 'T3PAY', to_char(current_date, 'YYYY-MM'));
select t_fail($$select request_unit((select v from ids where k = 'a3'), '', 'none', null, null, null)$$, 'already requested');
select t_fail($$select request_unit((select v from ids where k = 'a1'), '', 'none', null, null, null)$$, 'no longer available');
select t_eq((select count(*) from payments where status = 'pending'), 2, 'booking with deposit+rent creates 2 pending payments');

-- ===== landlord 1 handles everything =====
select t_as('00000000-0000-0000-0000-00000000000a');
select t_eq((select count(*) from notifications where text like 'MOVE-OUT:%'), 1, 'landlord notified of move-out');
select t_eq((select count(*) from house_requests where status = 'pending'), 2, 'landlord sees 2 requests');
select t_eq((select count(*) from tenants), 4, 'landlord sees tenants of own houses + requesters');
select review_payment((select id from payments where ref = 'QK12AB34'), true);
select t_eq((select count(*) from payments where ref = 'QK12AB34' and status = 'confirmed'), 1, 'landlord confirms reported payment');
select t_fail($$select review_payment((select id from payments where ref = 'QK12AB34'), true)$$, 'already reviewed');
select t_fail($$select decide_request((select r.id from house_requests r join tenants t on t.id = r.tenant_id where t.name = 'Tenant Two'), true)$$, 'already rents another house');
select decide_request((select r.id from house_requests r join tenants t on t.id = r.tenant_id where t.name = 'Tenant Three'), true);
select t_eq((select count(*) from units where id = (select v from ids where k = 'a3') and status = 'occupied'), 1, 'approval moves tenant three into A3');
select t_eq((select count(*) from house_requests where status = 'rejected'), 1, 'competing request auto-declined');
select t_eq((select count(*) from payments where ref like 'T3PAY%' and status = 'confirmed'), 2, 'approved booking payments confirmed');
select t_eq((select count(*) from payments where ref = 'T2DEP' and status = 'rejected'), 1, 'losing booking payment rejected');
select ack_notice((select id from move_out_notices limit 1));
select vacate_unit((select v from ids where k = 'a1'));
select t_eq((select count(*) from units where id = (select v from ids where k = 'a1') and status = 'vacant' and tenant_id is null), 1, 'vacate empties the house');
select t_eq((select count(*) from move_out_notices where status = 'completed'), 1, 'vacate completes the notice');
select save_check((select v from ids where k = 'p1'), to_char(current_date, 'YYYY-MM'),
  jsonb_build_array(jsonb_build_object('unitId', (select v from ids where k = 'a3'), 'status', 'maintenance')));
select t_eq((select count(*) from units where id = (select v from ids where k = 'a3') and status = 'maintenance' and tenant_id is null), 1, 'monthly check to maintenance checks tenant out');
select t_eq((select count(*) from monthly_checks), 1, 'monthly check saved');
insert into expenses (property_id, category, amount) values ((select v from ids where k = 'p1'), 'Repairs', 2500);
select t_eq((select count(*) from expenses), 1, 'landlord adds expense');
select t_eq((select (announce(null, 'Water off Saturday'))->>'sent')::int, 1, 'announcement reaches linked tenants only');

-- ===== tenant one after move-out =====
select t_as('00000000-0000-0000-0000-000000000001');
select t_eq((select count(*) from units where tenant_id is not null), 0, 'moved-out tenant no longer has a house');
select t_eq((select count(*) from payments), 2, 'moved-out tenant still sees own payment history (deposit + rent)');

-- ===== anonymous visitor =====
reset role; set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select * from units$$, 'permission denied');
select t_fail($$select * from profiles$$, 'permission denied');
select t_fail($$select create_property('x','y','',1,'A','x',1,1)$$, 'permission denied');

reset role;
\echo ALL SECURITY TESTS PASSED
