-- M-Pesa (Stage 2) tests. Runs after security_test.sql in the same database.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;

-- new landlord + tenant for these tests
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000c1', 'ml@test.local', '{"role":"landlord","name":"Mpesa Landlord"}', now()),
 ('00000000-0000-0000-0000-0000000000c2', 'mt@test.local', '{"role":"tenant","name":"Mpesa Tenant"}', now()),
 ('00000000-0000-0000-0000-0000000000c3', 'mh@test.local', '{"role":"tenant","name":"House Hunter"}', now());

-- test-only: let the checks below read tables while acting as the service role
grant usage on schema private to service_role;
grant select on public.payments, public.units, public.house_requests, private.stk_requests to service_role;

set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
create temp table mids (k text primary key, v uuid);
grant all on mids to public;
insert into mids select 'p', create_property('Mpesa Court', 'Thika', '', 3, 'M', 'Bedsitter', 8000, 8000);
insert into mids select 'm1', id from units where label = 'M1' and property_id = (select v from mids where k = 'p');
insert into mids select 'm2', id from units where label = 'M2' and property_id = (select v from mids where k = 'p');
select add_tenant((select v from mids where k = 'm1'), 'Mpesa Tenant', '0711', 'mt@test.local', current_date, 12, false, false, null);
select t_eq(((my_mpesa_status())->>'connected')::boolean::int, 0, 'landlord starts with M-Pesa not connected');
-- the browser can never call the service functions or read the secrets
select t_fail($$select svc_save_mpesa_account(auth.uid(), 'sandbox', 'paybill', '174379', '', false, 'k', 's', 'p')$$, 'permission denied');
select t_fail($$select svc_mpesa_credentials(auth.uid())$$, 'permission denied');
select t_fail($$select * from private.mpesa_accounts$$, 'permission denied');
select t_fail($$select * from private.stk_requests$$, 'permission denied');
select t_fail($$select * from vault.decrypted_secrets$$, 'permission denied');

-- Edge Function (service role) saves verified credentials
reset role; set role service_role;
select svc_save_mpesa_account('00000000-0000-0000-0000-0000000000c1', 'sandbox', 'paybill', '174379', '', false, 'KEY1', 'SECRET1', 'PASS1');
reset role; select t_eq((select count(*) from vault.secrets where secret in ('KEY1', 'SECRET1', 'PASS1')), 3, 'keys stored in Vault'); set role service_role;
select t_eq(((svc_mpesa_credentials('00000000-0000-0000-0000-0000000000c1'))->>'key' = 'KEY1')::int, 1, 'service role can read keys back');
select svc_save_mpesa_account('00000000-0000-0000-0000-0000000000c1', 'sandbox', 'paybill', '174379', '', false, '', 'SECRET2', '');
select t_eq(((svc_mpesa_credentials('00000000-0000-0000-0000-0000000000c1'))->>'key' = 'KEY1' and (svc_mpesa_credentials('00000000-0000-0000-0000-0000000000c1'))->>'secret' = 'SECRET2')::int, 1, 'blank fields keep old keys; changed field updates');
reset role; select t_eq((select count(*) from vault.secrets), 3, 'updating does not leave old secrets behind'); set role service_role;
select t_fail($$select svc_save_mpesa_account('00000000-0000-0000-0000-000000000003', 'sandbox', 'paybill', '174379', '', false, 'k', 's', 'p')$$, 'Not a landlord');
select t_fail($$select svc_save_mpesa_account('00000000-0000-0000-0000-0000000000c1', 'production', 'paybill', '174379', '', true, '', '', '')$$, 'only for sandbox');

reset role; set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
select t_eq(((my_mpesa_status())->>'connected')::boolean::int, 1, 'landlord sees M-Pesa connected');
select t_eq(((my_mpesa_status()) ? 'key')::int, 0, 'status never includes keys');
select t_as('00000000-0000-0000-0000-0000000000c2');
select t_eq((select mpesa_ready::int from profiles where id = '00000000-0000-0000-0000-0000000000c1'), 1, 'tenant can see landlord accepts M-Pesa');

-- ===== tenant pays rent by STK =====
reset role; set role service_role;
select t_fail($$select svc_prepare_stk('00000000-0000-0000-0000-0000000000c2', (select v from mids where k = 'm1'), 'rent', '2026-11', 8000, '0712345678')$$, 'valid Safaricom number');
select t_fail($$select svc_prepare_stk('00000000-0000-0000-0000-0000000000c2', (select v from mids where k = 'm2'), 'rent', '2026-11', 8000, '254712345678')$$, 'Choose deposit');
select t_fail($$select svc_prepare_stk('00000000-0000-0000-0000-0000000000c2', (select v from mids where k = 'm1'), 'rent', '2026-11', 300000, '254712345678')$$, 'at most Ksh 250,000');
select (svc_prepare_stk('00000000-0000-0000-0000-0000000000c2', (select v from mids where k = 'm1'), 'rent', '2026-11', 8000, '254712345678'))->>'id' as stk1 \gset
insert into mids values ('stk1', :'stk1');
select t_eq((select count(*) from payments where stk_request_id = :'stk1' and status = 'pending'), 1, 'STK creates a pending payment');
select svc_stk_sent(:'stk1', true, 'ws_CO_1', 'MR_1', '');
reset role; select t_eq((select count(*) from private.stk_requests where id = :'stk1' and status = 'sent'), 1, 'STK marked sent'); set role service_role;
select t_eq((svc_stk_for_callback(:'stk1', 'wrong-secret') is null)::int, 1, 'callback with wrong secret finds nothing');
select t_fail($$select svc_stk_complete((select v from mids where k = 'stk1'), true, 'SKA1B2C3D4', 100, '0', 'ok')$$, 'Amount mismatch');
select t_eq((svc_stk_complete(:'stk1', true, 'SKA1B2C3D4', 8000, '0', 'The service request is processed successfully.') = 'paid')::int, 1, 'callback confirms payment');
select t_eq((svc_stk_complete(:'stk1', true, 'SKA1B2C3D4', 8000, '0', 'again') like 'already%')::int, 1, 'second callback is ignored');
select t_eq((select count(*) from payments where stk_request_id = :'stk1' and status = 'confirmed' and ref = 'SKA1B2C3D4'), 1, 'payment confirmed with M-Pesa receipt');

reset role; set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c2');
select t_eq(((stk_status(:'stk1'))->>'status' = 'paid')::int, 1, 'tenant sees own STK status');
select t_eq((select count(*) from notifications where text like 'Payment received%'), 1, 'tenant notified of receipt');
select t_as('00000000-0000-0000-0000-0000000000c3');
select t_eq((stk_status(:'stk1') is null)::int, 1, 'other users cannot see that STK');
select t_as('00000000-0000-0000-0000-0000000000c1');
select t_eq((select count(*) from notifications where text like '%paid Ksh 8,000 by M-Pesa%'), 1, 'landlord notified of M-Pesa payment');

-- ===== house hunter books M2 with deposit + rent =====
reset role; set role service_role;
select (svc_prepare_stk('00000000-0000-0000-0000-0000000000c3', (select v from mids where k = 'm2'), 'deposit_rent', null, null, '254798765432'))->>'id' as stk2 \gset
reset role; select t_eq((select amount from private.stk_requests where id = :'stk2'), 16000, 'booking asks for deposit + rent in one prompt'); set role service_role;
select svc_stk_sent(:'stk2', true, 'ws_CO_2', 'MR_2', '');
-- tenant cancels on the phone first time
select t_eq((svc_stk_complete(:'stk2', false, null, null, '1032', 'Request cancelled by user') = 'failed')::int, 1, 'cancelled prompt recorded');
select t_eq((select count(*) from payments where stk_request_id = :'stk2' and status = 'cancelled'), 2, 'cancelled prompt cancels its payments');
select t_eq((select count(*) from units where id = (select v from mids where k = 'm2') and status = 'vacant'), 1, 'house stays vacant after cancel');
select (svc_prepare_stk('00000000-0000-0000-0000-0000000000c3', (select v from mids where k = 'm2'), 'deposit_rent', null, null, '254798765432'))->>'id' as stk3 \gset
select t_eq((select count(*) from house_requests where unit_id = (select v from mids where k = 'm2') and status = 'pending'), 1, 'retry reuses the same house request');
select svc_stk_sent(:'stk3', true, 'ws_CO_3', 'MR_3', '');
select svc_stk_complete(:'stk3', true, 'SKB9C8D7E6', 16000, '0', 'ok');
select t_eq((select count(*) from units where id = (select v from mids where k = 'm2') and status = 'reserved'), 1, 'paid booking reserves the house');
select t_eq((select count(*) from house_requests where unit_id = (select v from mids where k = 'm2') and paid), 1, 'request marked paid');
select t_eq((select count(*) from payments where ref = 'SKB9C8D7E6' and status = 'confirmed'), 2, 'one receipt confirms deposit and rent');
select t_fail($$select svc_prepare_stk('00000000-0000-0000-0000-000000000002', (select v from mids where k = 'm2'), 'deposit', null, null, '254711111111')$$, 'no longer available');

-- landlord approves -> house hunter moves in
reset role; set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
select decide_request((select id from house_requests where unit_id = (select v from mids where k = 'm2') and status = 'pending'), true);
select t_eq((select count(*) from units u join tenants t on t.id = u.tenant_id where u.id = (select v from mids where k = 'm2') and t.user_id = '00000000-0000-0000-0000-0000000000c3'), 1, 'approved: house hunter now rents M2');

-- a failed send cancels everything
reset role; set role service_role;
select (svc_prepare_stk('00000000-0000-0000-0000-0000000000c2', (select v from mids where k = 'm1'), 'rent', '2026-12', 8000, '254712345678'))->>'id' as stk4 \gset
select svc_stk_sent(:'stk4', false, null, null, 'Invalid Access Token');
select t_eq((select count(*) from payments where stk_request_id = :'stk4' and status = 'cancelled'), 1, 'failed send cancels the pending payment');

-- disconnect wipes the keys
reset role; set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
select disconnect_mpesa();
reset role;
select t_eq((select count(*) from vault.secrets), 0, 'disconnect deletes keys from Vault');
select t_eq((select mpesa_ready::int from profiles where id = '00000000-0000-0000-0000-0000000000c1'), 0, 'landlord no longer accepts M-Pesa prompts');
set role service_role;
select t_fail($$select svc_prepare_stk('00000000-0000-0000-0000-0000000000c2', (select v from mids where k = 'm1'), 'rent', '2026-12', 8000, '254712345678')$$, 'not connected M-Pesa');
reset role;
\echo ALL M-PESA TESTS PASSED
