-- =====================================================================
-- TrackGimex — database schema, security rules and server functions
-- Stage 1 (backend). Run once in Supabase → SQL Editor.
--
-- Security model
--   * Row Level Security (RLS) is ON for every table.
--   * The browser may only READ through RLS policies, plus a few safe
--     direct edits (e.g. a house's rent). Everything that changes money,
--     tenants or house status goes through the functions at the bottom,
--     which check who is calling and whether they are allowed.
-- =====================================================================

create schema if not exists private;          -- helpers, NOT exposed by the API
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------

-- One row per login (auth.users). Created automatically on sign-up.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null check (role in ('landlord', 'tenant')),
  kind        text not null default 'Tenant',
  name        text not null check (length(btrim(name)) between 1 and 120),
  phone       text not null default '' check (length(phone) <= 30),
  email       text not null default '',
  payout_info text not null default '' check (length(payout_info) <= 500),  -- landlord's Paybill / bank details shown to tenants
  created_at  timestamptz not null default now(),
  constraint kind_matches_role check (
    (role = 'tenant' and kind = 'Tenant') or
    (role = 'landlord' and kind in ('Landlord', 'Agent', 'Caretaker')))
);

-- A tenant "record". Either a registered tenant (user_id set, landlord_id null)
-- or someone a landlord added (landlord_id set). A landlord-added record is
-- linked to an account by verified email or by the invite code.
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  landlord_id uuid references public.profiles (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  phone       text not null default '' check (length(phone) <= 30),
  email       text not null default '' check (length(email) <= 254),
  invite_code text unique,
  created_at  timestamptz not null default now()
);
create unique index tenants_one_self_row on public.tenants (user_id) where landlord_id is null;
create index tenants_user_idx on public.tenants (user_id);
create index tenants_landlord_idx on public.tenants (landlord_id);

create table public.properties (
  id          uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  location    text not null check (length(btrim(location)) between 1 and 160),
  description text not null default '' check (length(description) <= 1000),
  created_at  timestamptz not null default now()
);
create index properties_landlord_idx on public.properties (landlord_id);

create table public.units (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  label       text not null check (length(btrim(label)) between 1 and 20),
  type        text not null default '1 Bedroom' check (length(type) <= 40),
  rent        integer not null default 0 check (rent between 0 and 10000000),
  deposit     integer not null default 0 check (deposit between 0 and 10000000),
  status      text not null default 'vacant' check (status in ('vacant', 'occupied', 'reserved', 'notice', 'maintenance')),
  tenant_id   uuid references public.tenants (id) on delete set null,
  lease_start date,
  lease_end   date,
  created_at  timestamptz not null default now(),
  unique (property_id, label)
);
create index units_property_idx on public.units (property_id);
create index units_tenant_idx on public.units (tenant_id);
create index units_status_idx on public.units (status);

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  receipt_no   bigint generated always as identity (start with 1001),
  landlord_id  uuid not null references public.profiles (id) on delete cascade,
  property_id  uuid references public.properties (id) on delete set null,
  unit_id      uuid references public.units (id) on delete set null,
  unit_label   text not null default '',          -- kept for receipts if the house is deleted
  tenant_id    uuid references public.tenants (id) on delete set null,
  kind         text not null check (kind in ('rent', 'deposit')),
  month        text check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount       integer not null check (amount between 1 and 10000000),
  method       text not null check (method in ('Cash', 'M-Pesa', 'Bank', 'Cheque', 'Card')),
  ref          text not null default '' check (length(ref) <= 60),
  -- pending  = tenant says they paid, landlord must confirm
  -- confirmed= counts towards rent
  status       text not null default 'confirmed' check (status in ('pending', 'confirmed', 'rejected', 'cancelled', 'refunded')),
  recorded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  constraint rent_has_month check (kind <> 'rent' or month is not null)
);
create index payments_landlord_idx on public.payments (landlord_id, created_at desc);
create index payments_tenant_idx on public.payments (tenant_id);
create index payments_unit_month_idx on public.payments (unit_id, month);
-- the same M-Pesa / bank reference cannot be used twice with one landlord
create unique index payments_ref_unique on public.payments (landlord_id, upper(ref))
  where ref <> '' and status in ('pending', 'confirmed');

create table public.house_requests (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.units (id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  landlord_id uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  message     text not null default '' check (length(message) <= 1000),
  paid        boolean not null default false,    -- tenant reported a booking payment
  created_at  timestamptz not null default now()
);
create index requests_landlord_idx on public.house_requests (landlord_id);
create index requests_tenant_idx on public.house_requests (tenant_id);
create unique index requests_one_pending on public.house_requests (unit_id, tenant_id) where status = 'pending';

create table public.move_out_notices (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references public.units (id) on delete cascade,
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  landlord_id   uuid not null references public.profiles (id) on delete cascade,
  move_out_date date not null,
  reason        text not null default '' check (length(reason) <= 1000),
  status        text not null default 'pending' check (status in ('pending', 'acknowledged', 'completed')),
  created_at    timestamptz not null default now()
);
create index notices_landlord_idx on public.move_out_notices (landlord_id);
create index notices_tenant_idx on public.move_out_notices (tenant_id);
create unique index notices_one_open on public.move_out_notices (unit_id, tenant_id) where status <> 'completed';

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  text       text not null,
  link       text not null default '',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.expenses (
  id          uuid primary key default gen_random_uuid(),
  landlord_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  property_id uuid references public.properties (id) on delete set null,
  category    text not null check (length(category) between 1 and 40),
  amount      integer not null check (amount between 1 and 100000000),
  date        date not null default current_date,
  note        text not null default '' check (length(note) <= 300),
  created_at  timestamptz not null default now()
);
create index expenses_landlord_idx on public.expenses (landlord_id, date desc);

create table public.monthly_checks (
  id          uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.profiles (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  month       text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  items       jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  unique (property_id, month)
);

-- ---------------------------------------------------------------------
-- HELPERS (private schema, security definer so they can look across
-- tables without RLS recursion)
-- ---------------------------------------------------------------------
create function private.is_landlord() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'landlord');
$$;

create function private.my_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.tenants where user_id = auth.uid();
$$;

create function private.owns_property(p_property uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.properties where id = p_property and landlord_id = auth.uid());
$$;

create function private.owns_unit(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.units u join public.properties p on p.id = u.property_id
                 where u.id = p_unit and p.landlord_id = auth.uid());
$$;

create function private.can_see_unit(p_unit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.house_requests r where r.unit_id = p_unit
                   and r.tenant_id in (select id from public.tenants where user_id = auth.uid()))
      or exists (select 1 from public.move_out_notices n where n.unit_id = p_unit
                   and n.tenant_id in (select id from public.tenants where user_id = auth.uid()));
$$;

create function private.landlord_sees_tenant(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenants t where t.id = p_tenant and t.landlord_id = auth.uid())
      or exists (select 1 from public.units u join public.properties p on p.id = u.property_id
                 where u.tenant_id = p_tenant and p.landlord_id = auth.uid())
      or exists (select 1 from public.house_requests r where r.tenant_id = p_tenant and r.landlord_id = auth.uid())
      or exists (select 1 from public.move_out_notices n where n.tenant_id = p_tenant and n.landlord_id = auth.uid())
      or exists (select 1 from public.payments y where y.tenant_id = p_tenant and y.landlord_id = auth.uid());
$$;

create function private.notify(p_user uuid, p_text text, p_link text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is not null then
    insert into public.notifications (user_id, text, link) values (p_user, left(p_text, 1000), p_link);
  end if;
end $$;

create function private.money(p integer) returns text
language sql immutable set search_path = '' as $$
  select 'Ksh ' || to_char(p, 'FM999,999,999');
$$;

create function private.month_label(p text) returns text
language sql immutable set search_path = '' as $$
  select to_char(to_date(p || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
$$;

create function private.check_payment_args(p_kind text, p_month text, p_amount int) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_kind not in ('rent', 'deposit') then raise exception 'Choose rent or deposit.'; end if;
  if p_kind = 'rent' and (p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$') then raise exception 'Choose the month this rent is for.'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then raise exception 'Enter an amount between Ksh 1 and Ksh 10,000,000.'; end if;
end $$;

create function private.require_landlord() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please log in again.'; end if;
  if not private.is_landlord() then raise exception 'Only landlords and agents can do this.'; end if;
  return auth.uid();
end $$;

create function private.require_tenant() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Please log in again.'; end if;
  select id into t from public.tenants where user_id = auth.uid() and landlord_id is null;
  if t is null then raise exception 'Only tenant accounts can do this.'; end if;
  return t;   -- the caller's own tenant record
end $$;

create function private.new_invite_code() returns text
language plpgsql volatile set search_path = '' as $$
declare c text;
begin
  loop
    -- 8 characters, no look-alike letters (0/O, 1/I)
    c := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
          from generate_series(1, 8));
    exit when not exists (select 1 from public.tenants where invite_code = c);
  end loop;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- SIGN-UP: create the profile (and tenant record) automatically.
-- Landlord-added tenant records are linked once the email is verified.
-- ---------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m     jsonb := coalesce(new.raw_user_meta_data, '{}');
  rl    text  := case when m->>'role' = 'landlord' then 'landlord' else 'tenant' end;
  knd   text  := case when rl = 'tenant' then 'Tenant'
                      when m->>'kind' in ('Agent', 'Caretaker') then m->>'kind' else 'Landlord' end;
  nm    text  := left(coalesce(nullif(btrim(m->>'name'), ''), split_part(new.email, '@', 1), 'User'), 120);
  ph    text  := left(coalesce(m->>'phone', ''), 30);
begin
  insert into public.profiles (id, role, kind, name, phone, email)
  values (new.id, rl, knd, nm, ph, coalesce(new.email, ''));
  if rl = 'tenant' then
    insert into public.tenants (user_id, name, phone, email) values (new.id, nm, ph, coalesce(new.email, ''));
    if new.email_confirmed_at is not null then
      perform private.link_by_email(new.id, new.email);
    end if;
    perform private.notify(new.id, 'Welcome to TrackGimex! Find a house, or enter the code your landlord gave you to link your house.', 'home');
  end if;
  return new;
end $$;

create function private.link_by_email(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_email is null or p_email = '' then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and role = 'tenant') then return; end if;
  update public.tenants set user_id = p_user
   where user_id is null and landlord_id is not null and lower(email) = lower(p_email);
end $$;

create function private.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    perform private.link_by_email(new.id, new.email);
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function private.handle_user_confirmed();

-- keep a tenant's own record in sync with their profile
create function private.sync_self_tenant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.tenants set name = new.name, phone = new.phone
   where user_id = new.id and landlord_id is null;
  return new;
end $$;
create trigger profiles_sync_tenant after update of name, phone on public.profiles
  for each row when (new.role = 'tenant') execute function private.sync_self_tenant();

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.tenants          enable row level security;
alter table public.properties       enable row level security;
alter table public.units            enable row level security;
alter table public.payments         enable row level security;
alter table public.house_requests   enable row level security;
alter table public.move_out_notices enable row level security;
alter table public.notifications    enable row level security;
alter table public.expenses         enable row level security;
alter table public.monthly_checks   enable row level security;

-- profiles: you see yourself; everyone logged in sees landlords' public
-- contact (name, phone, payment details). Email is never exposed to others
-- (column grants below).
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or role = 'landlord');
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy tenants_select on public.tenants for select to authenticated
  using (user_id = auth.uid() or landlord_id = auth.uid() or private.landlord_sees_tenant(id));
create policy tenants_update on public.tenants for update to authenticated
  using (landlord_id = auth.uid()) with check (landlord_id = auth.uid());

create policy properties_select on public.properties for select to authenticated using (true);
create policy properties_update on public.properties for update to authenticated
  using (landlord_id = auth.uid()) with check (landlord_id = auth.uid());
create policy properties_delete on public.properties for delete to authenticated
  using (landlord_id = auth.uid());

create policy units_select on public.units for select to authenticated
  using (status = 'vacant'
         or private.owns_unit(id)
         or tenant_id in (select private.my_tenant_ids())
         or private.can_see_unit(id));
create policy units_update on public.units for update to authenticated
  using (private.owns_unit(id)) with check (private.owns_unit(id));
create policy units_delete on public.units for delete to authenticated
  using (private.owns_unit(id) and tenant_id is null);

create policy payments_select on public.payments for select to authenticated
  using (landlord_id = auth.uid() or tenant_id in (select private.my_tenant_ids()));

create policy requests_select on public.house_requests for select to authenticated
  using (landlord_id = auth.uid() or tenant_id in (select private.my_tenant_ids()));

create policy notices_select on public.move_out_notices for select to authenticated
  using (landlord_id = auth.uid() or tenant_id in (select private.my_tenant_ids()));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

create policy expenses_all on public.expenses for all to authenticated
  using (landlord_id = auth.uid())
  with check (landlord_id = auth.uid() and private.is_landlord()
              and (property_id is null or private.owns_property(property_id)));

create policy checks_select on public.monthly_checks for select to authenticated
  using (landlord_id = auth.uid());

-- ---------------------------------------------------------------------
-- TABLE / COLUMN PRIVILEGES (nothing for anonymous visitors)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select (id, role, kind, name, phone, payout_info, created_at) on public.profiles to authenticated;
grant update (name, phone, kind, payout_info) on public.profiles to authenticated;
grant select on public.tenants to authenticated;
grant update (name, phone, email) on public.tenants to authenticated;
grant select, delete on public.properties to authenticated;
grant update (name, location, description) on public.properties to authenticated;
grant select, delete on public.units to authenticated;
grant update (label, type, rent, deposit, lease_start, lease_end) on public.units to authenticated;
grant select on public.payments, public.house_requests, public.move_out_notices, public.monthly_checks to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_landlord(), private.my_tenant_ids(), private.owns_property(uuid),
  private.owns_unit(uuid), private.can_see_unit(uuid), private.landlord_sees_tenant(uuid) to authenticated;

-- live notifications in the browser
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- =====================================================================
-- SERVER FUNCTIONS (called from the website with supabase.rpc(...))
-- =====================================================================

-- ---------- buildings & houses ----------
create function public.add_units(p_property uuid, p_count int, p_prefix text, p_type text, p_rent int, p_deposit int)
returns int language plpgsql security definer set search_path = '' as $$
declare n int; pre text := left(coalesce(btrim(p_prefix), ''), 6); i int;
begin
  perform private.require_landlord();
  if not private.owns_property(p_property) then raise exception 'Building not found.'; end if;
  if p_count is null or p_count < 1 or p_count > 500 then raise exception 'You can add between 1 and 500 houses at a time.'; end if;
  if (select count(*) from public.units where property_id = p_property) + p_count > 2000 then
    raise exception 'A building can have at most 2000 houses.'; end if;
  select coalesce(max(substr(label, length(pre) + 1)::int), 0) into n
    from public.units
   where property_id = p_property and left(label, length(pre)) = pre and substr(label, length(pre) + 1) ~ '^\d{1,6}$';
  for i in 1..p_count loop
    insert into public.units (property_id, label, type, rent, deposit)
    values (p_property, pre || (n + i), coalesce(nullif(p_type, ''), '1 Bedroom'), greatest(coalesce(p_rent, 0), 0), greatest(coalesce(p_deposit, 0), 0));
  end loop;
  return p_count;
end $$;

create function public.create_property(p_name text, p_location text, p_description text,
  p_count int, p_prefix text, p_type text, p_rent int, p_deposit int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_landlord(); pid uuid;
begin
  if (select count(*) from public.properties where landlord_id = me) >= 200 then raise exception 'Limit of 200 buildings reached.'; end if;
  insert into public.properties (landlord_id, name, location, description)
  values (me, btrim(p_name), btrim(p_location), coalesce(p_description, '')) returning id into pid;
  perform public.add_units(pid, p_count, p_prefix, p_type, p_rent, p_deposit);
  return pid;
end $$;

-- internal: check a tenant out of a house
create function private.vacate(p_unit uuid, p_status text default 'vacant') returns void
language plpgsql security definer set search_path = '' as $$
declare u public.units; pname text;
begin
  select * into u from public.units where id = p_unit for update;
  select name into pname from public.properties where id = u.property_id;
  if u.tenant_id is not null then
    perform private.notify((select user_id from public.tenants where id = u.tenant_id),
      'You have been checked out of house ' || u.label || ' at ' || pname || '. Thank you for staying with us.', 'home');
    update public.move_out_notices set status = 'completed' where unit_id = p_unit and status <> 'completed';
  end if;
  update public.units set tenant_id = null, status = p_status, lease_start = null, lease_end = null where id = p_unit;
end $$;

create function public.set_unit_status(p_unit uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare u public.units;
begin
  perform private.require_landlord();
  if not private.owns_unit(p_unit) then raise exception 'House not found.'; end if;
  select * into u from public.units where id = p_unit;
  if p_status not in ('vacant', 'occupied', 'reserved', 'notice', 'maintenance') then raise exception 'Unknown status.'; end if;
  if u.tenant_id is null and p_status in ('occupied', 'notice') then
    raise exception 'House % has no tenant. Use "Add tenant" first.', u.label; end if;
  if u.tenant_id is not null and p_status in ('vacant', 'maintenance') then
    perform private.vacate(p_unit, p_status);
  else
    update public.units set status = p_status where id = p_unit;
  end if;
end $$;

create function public.vacate_unit(p_unit uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_landlord();
  if not private.owns_unit(p_unit) then raise exception 'House not found.'; end if;
  perform private.vacate(p_unit, 'vacant');
end $$;

create function public.renew_lease(p_unit uuid, p_months int) returns date
language plpgsql security definer set search_path = '' as $$
declare u public.units; newend date;
begin
  perform private.require_landlord();
  if not private.owns_unit(p_unit) then raise exception 'House not found.'; end if;
  if p_months not between 1 and 60 then raise exception 'Choose between 1 and 60 months.'; end if;
  select * into u from public.units where id = p_unit;
  if u.tenant_id is null then raise exception 'This house has no tenant.'; end if;
  newend := (coalesce(u.lease_end, current_date) + make_interval(months => p_months))::date;
  update public.units set lease_end = newend where id = p_unit;
  perform private.notify((select user_id from public.tenants where id = u.tenant_id),
    'Your lease for ' || u.label || ' has been renewed to ' || to_char(newend, 'FMDD Mon YYYY') || '.', 'home');
  return newend;
end $$;

create function public.save_check(p_property uuid, p_month text, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_landlord(); it jsonb; u public.units; st text;
begin
  if not private.owns_property(p_property) then raise exception 'Building not found.'; end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid month.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    select * into u from public.units where id = (it->>'unitId')::uuid and property_id = p_property;
    continue when u.id is null;
    st := it->>'status';
    continue when st = u.status or st not in ('vacant', 'occupied', 'reserved', 'notice', 'maintenance');
    if u.tenant_id is null and st in ('occupied', 'notice') then continue; end if;  -- needs a tenant first
    if u.tenant_id is not null and st in ('vacant', 'maintenance') then perform private.vacate(u.id, st);
    else update public.units set status = st where id = u.id; end if;
  end loop;
  insert into public.monthly_checks (landlord_id, property_id, month, items)
  values (me, p_property, p_month,
          (select coalesce(jsonb_agg(jsonb_build_object('unitId', id, 'status', status)), '[]') from public.units where property_id = p_property))
  on conflict (property_id, month) do update set items = excluded.items, created_at = now();
end $$;

-- ---------- tenants ----------
create function public.add_tenant(p_unit uuid, p_name text, p_phone text, p_email text,
  p_start date, p_months int, p_deposit_paid boolean, p_rent_paid boolean, p_month text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_landlord(); u public.units; t uuid; code text; linked uuid; pname text;
begin
  if not private.owns_unit(p_unit) then raise exception 'House not found.'; end if;
  select * into u from public.units where id = p_unit for update;
  if u.tenant_id is not null then raise exception 'House % already has a tenant.', u.label; end if;
  if u.status = 'maintenance' then raise exception 'House % is under maintenance.', u.label; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the tenant''s name.'; end if;
  if p_months not between 1 and 60 then raise exception 'Choose a lease between 1 and 60 months.'; end if;
  code := private.new_invite_code();
  -- link straight away if a tenant account with this verified email exists
  select a.id into linked from auth.users a join public.profiles pr on pr.id = a.id and pr.role = 'tenant'
   where p_email <> '' and lower(a.email) = lower(btrim(p_email)) and a.email_confirmed_at is not null limit 1;
  insert into public.tenants (landlord_id, user_id, name, phone, email, invite_code)
  values (me, linked, btrim(p_name), coalesce(btrim(p_phone), ''), coalesce(lower(btrim(p_email)), ''), code)
  returning id into t;
  update public.units set tenant_id = t, status = 'occupied', lease_start = coalesce(p_start, current_date),
         lease_end = (coalesce(p_start, current_date) + make_interval(months => p_months))::date
   where id = p_unit;
  select name into pname from public.properties where id = u.property_id;
  if p_deposit_paid and u.deposit > 0 then
    insert into public.payments (landlord_id, property_id, unit_id, unit_label, tenant_id, kind, amount, method, status, recorded_by)
    values (me, u.property_id, u.id, u.label, t, 'deposit', u.deposit, 'Cash', 'confirmed', me);
  end if;
  if p_rent_paid and u.rent > 0 then
    insert into public.payments (landlord_id, property_id, unit_id, unit_label, tenant_id, kind, month, amount, method, status, recorded_by)
    values (me, u.property_id, u.id, u.label, t, 'rent', coalesce(p_month, to_char(current_date, 'YYYY-MM')), u.rent, 'Cash', 'confirmed', me);
  end if;
  perform private.notify(linked, 'You have been added as the tenant of ' || u.label || ' at ' || pname || '.', 'home');
  return jsonb_build_object('tenant_id', t, 'invite_code', code, 'linked', linked is not null);
end $$;

create function public.claim_invite(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare me_t uuid := private.require_tenant(); t public.tenants; lbl text;
begin
  select * into t from public.tenants where invite_code = upper(btrim(p_code)) for update;
  if t.id is null then raise exception 'That code is not valid. Check it with your landlord.'; end if;
  if t.user_id is not null and t.user_id <> auth.uid() then raise exception 'That code has already been used.'; end if;
  update public.tenants set user_id = auth.uid() where id = t.id;
  select u.label || ' at ' || p.name into lbl from public.units u join public.properties p on p.id = u.property_id where u.tenant_id = t.id limit 1;
  perform private.notify(t.landlord_id, (select name from public.profiles where id = auth.uid()) ||
    ' linked their TrackGimex account to ' || coalesce(lbl, 'their tenant record') || '.', 'tenants');
  return coalesce(lbl, '');
end $$;

create function public.new_invite_code(p_tenant uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  perform private.require_landlord();
  if not exists (select 1 from public.tenants where id = p_tenant and landlord_id = auth.uid()) then
    raise exception 'Tenant not found.'; end if;
  code := private.new_invite_code();
  update public.tenants set invite_code = code where id = p_tenant;
  return code;
end $$;

create function public.notify_tenant(p_unit uuid, p_text text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  perform private.require_landlord();
  if not private.owns_unit(p_unit) then raise exception 'House not found.'; end if;
  if coalesce(btrim(p_text), '') = '' then raise exception 'Type a message.'; end if;
  select t.user_id into uid from public.units u join public.tenants t on t.id = u.tenant_id where u.id = p_unit;
  perform private.notify(uid, left(p_text, 1000), 'home');
  return uid is not null;   -- false = tenant has no account yet, call/SMS them
end $$;

create function public.announce(p_property uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_landlord(); r record; sent int := 0; offline int := 0;
begin
  if coalesce(btrim(p_text), '') = '' then raise exception 'Type a message.'; end if;
  for r in select t.user_id, p.name from public.units u join public.properties p on p.id = u.property_id
             join public.tenants t on t.id = u.tenant_id
            where p.landlord_id = me and (p_property is null or p.id = p_property) loop
    if r.user_id is null then offline := offline + 1;
    else perform private.notify(r.user_id, '📢 ' || r.name || ': ' || left(p_text, 900), 'home'); sent := sent + 1; end if;
  end loop;
  return jsonb_build_object('sent', sent, 'offline', offline);
end $$;

-- ---------- payments ----------
-- landlord records money they received (cash, M-Pesa to their phone, bank)
create function public.record_payment(p_unit uuid, p_kind text, p_month text, p_amount int, p_method text, p_ref text)
returns public.payments language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_landlord(); u public.units; pay public.payments;
begin
  if not private.owns_unit(p_unit) then raise exception 'House not found.'; end if;
  perform private.check_payment_args(p_kind, p_month, p_amount);
  if p_method not in ('Cash', 'M-Pesa', 'Bank', 'Cheque') then raise exception 'Choose a payment method.'; end if;
  select * into u from public.units where id = p_unit;
  if u.tenant_id is null then raise exception 'House % has no tenant.', u.label; end if;
  insert into public.payments (landlord_id, property_id, unit_id, unit_label, tenant_id, kind, month, amount, method, ref, status, recorded_by, reviewed_at)
  values (me, u.property_id, u.id, u.label, u.tenant_id, p_kind, case when p_kind = 'rent' then p_month end,
          p_amount, p_method, upper(coalesce(btrim(p_ref), '')), 'confirmed', me, now())
  returning * into pay;
  perform private.notify((select user_id from public.tenants where id = u.tenant_id),
    'Payment of ' || private.money(p_amount) || ' ' ||
    case when p_kind = 'rent' then 'rent for ' || private.month_label(p_month) else 'deposit' end ||
    ' for ' || u.label || ' was recorded. Receipt TG-' || pay.receipt_no || '.', 'payments');
  return pay;
exception when unique_violation then raise exception 'That payment reference has already been used.';
end $$;

-- tenant says "I paid" (Paybill / bank). Landlord confirms before it counts.
-- Stage 2 adds automatic confirmation for M-Pesa / card payments.
create function public.report_payment(p_unit uuid, p_kind text, p_month text, p_amount int, p_method text, p_ref text)
returns public.payments language plpgsql security definer set search_path = '' as $$
declare me_t uuid := private.require_tenant(); u public.units; ll uuid; pay public.payments; nm text;
begin
  select * into u from public.units where id = p_unit and tenant_id in (select private.my_tenant_ids());
  if u.id is null then raise exception 'You can only pay for your own house.'; end if;
  perform private.check_payment_args(p_kind, p_month, p_amount);
  if p_method not in ('M-Pesa', 'Bank') then raise exception 'Choose M-Pesa or Bank.'; end if;
  if coalesce(btrim(p_ref), '') = '' then raise exception 'Enter the M-Pesa or bank reference.'; end if;
  if (select count(*) from public.payments where tenant_id = u.tenant_id and status = 'pending') >= 10 then
    raise exception 'You have too many payments waiting for confirmation.'; end if;
  select landlord_id into ll from public.properties where id = u.property_id;
  insert into public.payments (landlord_id, property_id, unit_id, unit_label, tenant_id, kind, month, amount, method, ref, status, recorded_by)
  values (ll, u.property_id, u.id, u.label, u.tenant_id, p_kind, case when p_kind = 'rent' then p_month end,
          p_amount, p_method, upper(btrim(p_ref)), 'pending', auth.uid())
  returning * into pay;
  select name into nm from public.profiles where id = auth.uid();
  perform private.notify(ll, nm || ' says they paid ' || private.money(p_amount) || ' ' ||
    case when p_kind = 'rent' then 'rent for ' || private.month_label(p_month) else 'deposit' end ||
    ' for ' || u.label || ' (' || p_method || ' ref ' || pay.ref || '). Please confirm.', 'payments');
  return pay;
exception when unique_violation then raise exception 'That reference has already been used. Check the code and try again.';
end $$;

create function public.review_payment(p_payment uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_landlord(); pay public.payments;
begin
  select * into pay from public.payments where id = p_payment and landlord_id = me for update;
  if pay.id is null then raise exception 'Payment not found.'; end if;
  if pay.status <> 'pending' then raise exception 'This payment was already reviewed.'; end if;
  update public.payments set status = case when p_approve then 'confirmed' else 'rejected' end, reviewed_at = now()
   where id = p_payment;
  perform private.notify((select user_id from public.tenants where id = pay.tenant_id),
    case when p_approve then 'Your payment of ' || private.money(pay.amount) || ' (ref ' || pay.ref || ') was confirmed. Receipt TG-' || pay.receipt_no || '.'
         else 'Your payment of ' || private.money(pay.amount) || ' (ref ' || pay.ref || ') could not be confirmed. Please contact your landlord.' end,
    'payments');
end $$;

create function public.delete_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_landlord();
  delete from public.payments where id = p_payment and landlord_id = auth.uid() and recorded_by = auth.uid();
  if not found then raise exception 'You can only delete payments you recorded yourself.'; end if;
end $$;

-- ---------- house requests / bookings ----------
-- p_option: 'none' (just ask), 'deposit', or 'deposit_rent' (tenant reports having paid)
create function public.request_unit(p_unit uuid, p_message text, p_option text, p_method text, p_ref text, p_month text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me_t uuid := private.require_tenant(); u public.units; ll uuid; req uuid; nm text; pname text; paid boolean := p_option in ('deposit', 'deposit_rent');
begin
  select * into u from public.units where id = p_unit;
  if u.id is null or u.status <> 'vacant' then raise exception 'Sorry, this house is no longer available.'; end if;
  select landlord_id, name into ll, pname from public.properties where id = u.property_id;
  if (select count(*) from public.house_requests where tenant_id = me_t and status = 'pending') >= 5 then
    raise exception 'You can have at most 5 open requests. Cancel one first.'; end if;
  if paid then
    if p_method not in ('M-Pesa', 'Bank') then raise exception 'Choose M-Pesa or Bank.'; end if;
    if coalesce(btrim(p_ref), '') = '' then raise exception 'Enter the M-Pesa or bank reference.'; end if;
  end if;
  select id into req from public.house_requests where unit_id = p_unit and tenant_id = me_t and status = 'pending';
  if req is null then
    insert into public.house_requests (unit_id, tenant_id, landlord_id, message, paid)
    values (p_unit, me_t, ll, coalesce(left(p_message, 1000), ''), paid) returning id into req;
  elsif paid then
    update public.house_requests set paid = true where id = req;
  else
    raise exception 'You have already requested this house.';
  end if;
  if paid then
    insert into public.payments (landlord_id, property_id, unit_id, unit_label, tenant_id, kind, amount, method, ref, status, recorded_by)
    values (ll, u.property_id, u.id, u.label, me_t, 'deposit', greatest(u.deposit, 1), p_method, upper(btrim(p_ref)), 'pending', auth.uid());
    if p_option = 'deposit_rent' and u.rent > 0 then
      insert into public.payments (landlord_id, property_id, unit_id, unit_label, tenant_id, kind, month, amount, method, ref, status, recorded_by)
      values (ll, u.property_id, u.id, u.label, me_t, 'rent', coalesce(p_month, to_char(current_date, 'YYYY-MM')), u.rent, p_method,
              upper(btrim(p_ref)) || '-R', 'pending', auth.uid());
    end if;
  end if;
  select name into nm from public.profiles where id = auth.uid();
  perform private.notify(ll, nm || case when paid then ' booked and says they paid for ' else ' requested ' end ||
    'house ' || u.label || ' at ' || pname || '.', 'requests');
  return req;
exception when unique_violation then raise exception 'That reference has already been used. Check the code and try again.';
end $$;

create function public.decide_request(p_request uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.require_landlord(); r public.house_requests; u public.units; pname text; other record; uid uuid;
begin
  select * into r from public.house_requests where id = p_request and landlord_id = me for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already handled.'; end if;
  select * into u from public.units where id = r.unit_id for update;
  select name into pname from public.properties where id = u.property_id;
  uid := (select user_id from public.tenants where id = r.tenant_id);
  if p_approve then
    if u.tenant_id is not null then raise exception 'House % already has a tenant.', u.label; end if;
    if exists (select 1 from public.units where tenant_id = r.tenant_id
                 or tenant_id in (select id from public.tenants where uid is not null and user_id = uid)) then
      raise exception 'This tenant already rents another house. They must move out first.'; end if;
    update public.units set tenant_id = r.tenant_id, status = 'occupied', lease_start = current_date,
           lease_end = (current_date + interval '12 months')::date where id = u.id;
    update public.house_requests set status = 'approved' where id = r.id;
    update public.payments set status = 'confirmed', reviewed_at = now()
     where unit_id = u.id and tenant_id = r.tenant_id and status = 'pending';
    perform private.notify(uid, 'Good news! Your request for ' || u.label || ' at ' || pname || ' was approved. Welcome home.', 'home');
    for other in select * from public.house_requests where unit_id = u.id and status = 'pending' loop
      update public.house_requests set status = 'rejected' where id = other.id;
      update public.payments set status = 'rejected', reviewed_at = now()
       where unit_id = u.id and tenant_id = other.tenant_id and status = 'pending';
      perform private.notify((select user_id from public.tenants where id = other.tenant_id),
        'House ' || u.label || ' at ' || pname || ' has been taken.' ||
        case when other.paid then ' If you paid, contact the landlord for a refund.' else '' end, 'requests');
    end loop;
  else
    update public.house_requests set status = 'rejected' where id = r.id;
    update public.payments set status = 'rejected', reviewed_at = now()
     where unit_id = u.id and tenant_id = r.tenant_id and status = 'pending';
    if u.status = 'reserved' and u.tenant_id is null then update public.units set status = 'vacant' where id = u.id; end if;
    perform private.notify(uid, 'Your request for ' || u.label || ' at ' || pname || ' was declined.' ||
      case when r.paid then ' If you paid, contact the landlord for a refund.' else '' end, 'requests');
  end if;
end $$;

create function public.cancel_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me_t uuid := private.require_tenant(); r public.house_requests; lbl text;
begin
  select * into r from public.house_requests where id = p_request and tenant_id = me_t for update;
  if r.id is null or r.status <> 'pending' then raise exception 'Request not found.'; end if;
  update public.house_requests set status = 'cancelled' where id = r.id;
  update public.payments set status = 'cancelled' where unit_id = r.unit_id and tenant_id = me_t and status = 'pending';
  select label into lbl from public.units where id = r.unit_id;
  perform private.notify(r.landlord_id, (select name from public.profiles where id = auth.uid()) ||
    ' cancelled their request for ' || lbl || '.', 'requests');
end $$;

-- ---------- move-out notices ----------
create function public.give_notice(p_unit uuid, p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u public.units; ll uuid; pname text; nid uuid; nm text;
begin
  perform private.require_tenant();
  select * into u from public.units where id = p_unit and tenant_id in (select private.my_tenant_ids());
  if u.id is null then raise exception 'You are not linked to this house.'; end if;
  if p_date is null or p_date < current_date then raise exception 'Choose a move-out date from today onwards.'; end if;
  if exists (select 1 from public.move_out_notices where unit_id = u.id and tenant_id = u.tenant_id and status <> 'completed') then
    raise exception 'You have already given notice for this house.'; end if;
  select landlord_id, name into ll, pname from public.properties where id = u.property_id;
  insert into public.move_out_notices (unit_id, tenant_id, landlord_id, move_out_date, reason)
  values (u.id, u.tenant_id, ll, p_date, coalesce(left(p_reason, 1000), '')) returning id into nid;
  update public.units set status = 'notice' where id = u.id;
  select name into nm from public.profiles where id = auth.uid();
  perform private.notify(ll, 'MOVE-OUT: ' || nm || ' will move out of ' || u.label || ' at ' || pname ||
    ' on ' || to_char(p_date, 'FMDD Mon YYYY') || '.', 'moveouts');
  return nid;
end $$;

create function public.ack_notice(p_notice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.move_out_notices;
begin
  perform private.require_landlord();
  update public.move_out_notices set status = 'acknowledged'
   where id = p_notice and landlord_id = auth.uid() and status = 'pending' returning * into n;
  if n.id is null then raise exception 'Notice not found.'; end if;
  perform private.notify((select user_id from public.tenants where id = n.tenant_id),
    'Your landlord received your move-out notice for ' || to_char(n.move_out_date, 'FMDD Mon YYYY') || '.', 'home');
end $$;

create function public.withdraw_notice(p_notice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.move_out_notices; lbl text;
begin
  perform private.require_tenant();
  delete from public.move_out_notices where id = p_notice and tenant_id in (select private.my_tenant_ids())
     and status <> 'completed' returning * into n;
  if n.id is null then raise exception 'Notice not found.'; end if;
  update public.units set status = 'occupied' where id = n.unit_id and status = 'notice' returning label into lbl;
  perform private.notify(n.landlord_id, (select name from public.profiles where id = auth.uid()) ||
    ' withdrew their move-out notice for ' || coalesce(lbl, 'their house') || '.', 'moveouts');
end $$;

-- ---------- function permissions: logged-in users only ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'add_units', 'create_property', 'set_unit_status', 'vacate_unit', 'renew_lease', 'save_check',
              'add_tenant', 'claim_invite', 'new_invite_code', 'notify_tenant', 'announce',
              'record_payment', 'report_payment', 'review_payment', 'delete_payment',
              'request_unit', 'decide_request', 'cancel_request', 'give_notice', 'ack_notice', 'withdraw_notice') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
