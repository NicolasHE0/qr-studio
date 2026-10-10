-- QR Studio · esquema para QR dinámicos
-- Ejecutar en el editor SQL de Supabase (o con `supabase db push`).
-- Seguridad: RLS activado en todas las tablas; los visitantes anónimos NO acceden a nada directamente.
-- La función de redirección usa la service_role key (solo en el servidor) para resolver códigos y registrar visitas.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- configuración
create table if not exists public.app_settings (
  key text primary key,
  value int not null
);
insert into public.app_settings (key, value) values ('max_links_per_user', 50)
  on conflict (key) do nothing;
alter table public.app_settings enable row level security;  -- sin políticas: solo service_role/administración

-- ---------------------------------------------------------------- enlaces dinámicos
create table if not exists public.qr_links (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[a-z0-9]{6,16}$'),
  owner          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 120),
  category       text not null default 'Web' check (char_length(category) <= 60),
  destination    text not null check (char_length(destination) <= 2048 and destination ~* '^https://[^\s@/?#]+([/?#]\S*)?$'),
  status         text not null default 'active' check (status in ('active', 'paused')),
  stats_enabled  boolean not null default false,
  retention_days int not null default 90 check (retention_days between 1 and 365),
  style          jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists qr_links_owner_idx on public.qr_links (owner, created_at desc);

-- Validación de destino en el servidor (independiente del cliente): solo https y hosts públicos.
create or replace function public.is_public_https_url(u text) returns boolean
language plpgsql immutable as $$
declare
  host text;
begin
  if u !~* '^https://' then return false; end if;
  host := lower(substring(u from '^https://([^/?#:]+)'));
  if host is null or host = '' then return false; end if;
  if host = 'localhost' or host like '%.local' or host like '%.internal' or host like '%.localhost' then return false; end if;
  if host !~ '\.' then return false; end if;
  if host ~ '^\d{1,3}(\.\d{1,3}){3}$' then
    if host ~ '^(10|127|0)\.' or host ~ '^169\.254\.' or host ~ '^192\.168\.' or host ~ '^172\.(1[6-9]|2\d|3[01])\.' then return false; end if;
  end if;
  return true;
end $$;

create or replace function public.qr_links_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  max_links int;
  current_links int;
begin
  if not public.is_public_https_url(new.destination) then
    raise exception 'invalid_destination' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    select value into max_links from public.app_settings where key = 'max_links_per_user';
    select count(*) into current_links from public.qr_links where owner = new.owner;
    if max_links is not null and current_links >= max_links then
      raise exception 'limit_reached' using errcode = '54000';
    end if;
  else
    -- Inmutables: el código (la URL impresa), el dueño y la fecha de creación.
    if new.code <> old.code or new.owner <> old.owner or new.created_at <> old.created_at then
      raise exception 'immutable_field' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists qr_links_guard_trg on public.qr_links;
create trigger qr_links_guard_trg before insert or update on public.qr_links
  for each row execute function public.qr_links_guard();

-- ---------------------------------------------------------------- visitas (mínimas, sin IP)
create table if not exists public.qr_hits (
  id      bigint generated always as identity primary key,
  link_id uuid not null references public.qr_links(id) on delete cascade,
  ts      timestamptz not null default now(),
  device  text not null default 'other' check (device in ('mobile', 'tablet', 'desktop', 'other')),
  is_bot  boolean not null default false
);
create index if not exists qr_hits_link_ts_idx on public.qr_hits (link_id, ts desc);

-- ---------------------------------------------------------------- RLS
alter table public.qr_links enable row level security;
alter table public.qr_hits  enable row level security;

revoke all on public.qr_links, public.qr_hits, public.app_settings from anon;
revoke all on public.qr_hits from authenticated;
grant select, delete on public.qr_hits to authenticated;
grant select, insert, update, delete on public.qr_links to authenticated;

drop policy if exists qr_links_select on public.qr_links;
drop policy if exists qr_links_insert on public.qr_links;
drop policy if exists qr_links_update on public.qr_links;
drop policy if exists qr_links_delete on public.qr_links;
create policy qr_links_select on public.qr_links for select to authenticated using (owner = auth.uid());
create policy qr_links_insert on public.qr_links for insert to authenticated with check (owner = auth.uid());
create policy qr_links_update on public.qr_links for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy qr_links_delete on public.qr_links for delete to authenticated using (owner = auth.uid());

drop policy if exists qr_hits_select on public.qr_hits;
drop policy if exists qr_hits_delete on public.qr_hits;
create policy qr_hits_select on public.qr_hits for select to authenticated
  using (exists (select 1 from public.qr_links l where l.id = link_id and l.owner = auth.uid()));
create policy qr_hits_delete on public.qr_hits for delete to authenticated
  using (exists (select 1 from public.qr_links l where l.id = link_id and l.owner = auth.uid()));
-- Sin política de INSERT en qr_hits: solo la función de redirección (service_role) puede registrar visitas.

-- ---------------------------------------------------------------- retención de datos
create or replace function public.purge_old_hits() returns bigint
language sql security definer set search_path = public as $$
  with d as (
    delete from public.qr_hits h using public.qr_links l
    where h.link_id = l.id and h.ts < now() - make_interval(days => l.retention_days)
    returning 1
  ) select count(*) from d;
$$;
revoke all on function public.purge_old_hits() from public, anon, authenticated;

-- Programación diaria (requiere la extensión pg_cron: Database → Extensions en Supabase).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('qr-purge-old-hits', '17 3 * * *', 'select public.purge_old_hits()');
  else
    raise notice 'pg_cron no está activada: activala para borrar automáticamente las visitas vencidas, o ejecutá select purge_old_hits() periódicamente.';
  end if;
end $$;
