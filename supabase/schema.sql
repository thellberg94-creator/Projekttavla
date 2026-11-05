-- Projekttavla: databasschema för Supabase.
-- Kör hela filen i Supabase: SQL Editor -> New query -> Run.
-- Filen går att köra om utan att data försvinner (create ... if not exists).

-- ---------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------

-- Vem som får komma åt tavlan och med vilken roll.
-- admin: allt, inklusive import. editor: ändra kort och dokumentationsrader. viewer: bara läsa.
create table if not exists public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       text not null check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.cards (
  id         text primary key,
  col        text not null check (col in ('akut', 'pagar', 'redo', 'vantar', 'besikt', 'planera', 'klar')),
  pos        integer not null default 0,
  name       text not null check (char_length(name) between 1 and 200),
  client     text not null default '' check (char_length(client) <= 200),
  tags       text[] not null default '{}',
  chip_cls   text check (chip_cls in ('late', 'soon', 'info')),
  chip_text  text check (char_length(chip_text) <= 200),
  lage       text not null default '' check (char_length(lage) <= 4000),
  next       text not null default '' check (char_length(next) <= 4000),
  notes      text[] not null default '{}',
  start_date date,
  end_date   date,
  tech       text not null default '' check (char_length(tech) <= 100),
  deleted    boolean not null default false,
  rev        integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.docs (
  id         text primary key,
  project    text not null check (char_length(project) between 1 and 200),
  body       text not null default '' check (char_length(body) <= 1000),
  done       boolean not null default false,
  pos        integer not null default 0,
  deleted    boolean not null default false,
  rev        integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Ändringslogg. Skrivs bara av triggern nedan, aldrig direkt av användare.
create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  user_email text,
  action     text not null,   -- insert, update, delete, restore
  entity     text not null,   -- card, doc
  entity_id  text not null,
  title      text,
  detail     jsonb            -- vid update: { fält: [före, efter] }
);

create index if not exists activity_at_idx on public.activity (id desc);

-- ---------------------------------------------------------------
-- Hjälpfunktion: min roll (null om jag inte är medlem)
-- ---------------------------------------------------------------

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.members where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------
-- Triggers: versionsnummer, tidsstämpel och ändringslogg
-- ---------------------------------------------------------------

create or replace function public.touch_row()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.rev := old.rev + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ent  text := tg_argv[0];
  o    jsonb;
  n    jsonb;
  d    jsonb := '{}'::jsonb;
  k    text;
  act  text;
  ttl  text;
  rid  text;
  mail text;
begin
  select email into mail from public.members where user_id = auth.uid();

  if tg_op = 'INSERT' then
    n := to_jsonb(new);
    rid := new.id;
    act := 'insert';
    ttl := coalesce(n ->> 'name', n ->> 'project');
  elsif tg_op = 'DELETE' then
    o := to_jsonb(old);
    rid := old.id;
    act := 'delete';
    ttl := coalesce(o ->> 'name', o ->> 'project');
  else
    o := to_jsonb(old);
    n := to_jsonb(new);
    rid := new.id;
    ttl := coalesce(n ->> 'name', n ->> 'project');
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at', 'updated_by', 'rev', 'created_at')
         and (o -> k) is distinct from (n -> k) then
        d := d || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if d = '{}'::jsonb then
      return new;  -- inget som är värt att logga
    end if;
    if (o ->> 'deleted') = 'false' and (n ->> 'deleted') = 'true' then
      act := 'delete';
    elsif (o ->> 'deleted') = 'true' and (n ->> 'deleted') = 'false' then
      act := 'restore';
    else
      act := 'update';
    end if;
  end if;

  insert into public.activity (user_id, user_email, action, entity, entity_id, title, detail)
  values (auth.uid(), mail, act, ent, rid, ttl, case when act = 'update' then d else null end);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists cards_touch on public.cards;
create trigger cards_touch before insert or update on public.cards
  for each row execute function public.touch_row();

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.touch_row();

drop trigger if exists cards_log on public.cards;
create trigger cards_log after insert or update or delete on public.cards
  for each row execute function public.log_change('card');

drop trigger if exists docs_log on public.docs;
create trigger docs_log after insert or update or delete on public.docs
  for each row execute function public.log_change('doc');

-- ---------------------------------------------------------------
-- Behörighet (Row Level Security)
-- Utan en rad i members kan ingen läsa eller skriva något,
-- även om någon lyckas skapa ett konto.
-- ---------------------------------------------------------------

alter table public.members  enable row level security;
alter table public.cards    enable row level security;
alter table public.docs     enable row level security;
alter table public.activity enable row level security;

revoke all on public.members, public.cards, public.docs, public.activity from anon;

drop policy if exists members_read   on public.members;
drop policy if exists members_admin  on public.members;
create policy members_read on public.members
  for select to authenticated
  using (user_id = auth.uid() or public.my_role() = 'admin');
create policy members_admin on public.members
  for all to authenticated
  using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin');

drop policy if exists cards_read   on public.cards;
drop policy if exists cards_insert on public.cards;
drop policy if exists cards_update on public.cards;
drop policy if exists cards_delete on public.cards;
create policy cards_read   on public.cards for select to authenticated using (public.my_role() is not null);
create policy cards_insert on public.cards for insert to authenticated with check (public.my_role() in ('admin', 'editor'));
create policy cards_update on public.cards for update to authenticated using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));
create policy cards_delete on public.cards for delete to authenticated using (public.my_role() = 'admin');

drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_read   on public.docs for select to authenticated using (public.my_role() is not null);
create policy docs_insert on public.docs for insert to authenticated with check (public.my_role() in ('admin', 'editor'));
create policy docs_update on public.docs for update to authenticated using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));
create policy docs_delete on public.docs for delete to authenticated using (public.my_role() = 'admin');

drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated using (public.my_role() is not null);

-- ---------------------------------------------------------------
-- Realtid: andra inloggade ser ändringar direkt.
-- ---------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.cards;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.docs;
  exception when duplicate_object then null;
  end;
end $$;
