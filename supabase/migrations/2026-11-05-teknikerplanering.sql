-- Teknikerplanering: tekniker, övriga rader (semester, sjuk med mera) och bokningar per dag.
-- Kör hela filen en gång i Supabase: SQL Editor -> New query -> Run. Går att köra om utan att något försvinner.

create table if not exists public.plan_techs (
  id         text primary key,
  name       text not null check (char_length(name) between 1 and 100),
  pos        integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_other (
  id         text primary key,
  name       text not null check (char_length(name) between 1 and 100),
  kind       text not null default 'work' check (kind in ('abs', 'work')),  -- abs = frånvaro
  pos        integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- En rad per tekniker, dag och projekt. ref: 'k:<kortets id>' (projekt på tavlan) eller 'o:<id i plan_other>'.
create table if not exists public.plan_bookings (
  day        date not null check (day between date '2020-01-01' and date '2100-01-01'),
  tech_id    text not null references public.plan_techs (id) on delete cascade,
  ref        text not null check (ref ~ '^[ko]:[A-Za-z0-9_-]{1,60}$'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (day, tech_id, ref)
);

create index if not exists plan_bookings_tech_idx on public.plan_bookings (tech_id, day);

alter table public.plan_techs    enable row level security;
alter table public.plan_other    enable row level security;
alter table public.plan_bookings enable row level security;

revoke all on public.plan_techs, public.plan_other, public.plan_bookings from anon;

drop policy if exists plan_techs_read   on public.plan_techs;
drop policy if exists plan_techs_insert on public.plan_techs;
drop policy if exists plan_techs_update on public.plan_techs;
drop policy if exists plan_techs_delete on public.plan_techs;
create policy plan_techs_read   on public.plan_techs for select to authenticated using (public.my_role() is not null);
create policy plan_techs_insert on public.plan_techs for insert to authenticated with check (public.my_role() in ('admin', 'editor'));
create policy plan_techs_update on public.plan_techs for update to authenticated using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));
create policy plan_techs_delete on public.plan_techs for delete to authenticated using (public.my_role() = 'admin');

drop policy if exists plan_other_read   on public.plan_other;
drop policy if exists plan_other_insert on public.plan_other;
drop policy if exists plan_other_update on public.plan_other;
drop policy if exists plan_other_delete on public.plan_other;
create policy plan_other_read   on public.plan_other for select to authenticated using (public.my_role() is not null);
create policy plan_other_insert on public.plan_other for insert to authenticated with check (public.my_role() in ('admin', 'editor'));
create policy plan_other_update on public.plan_other for update to authenticated using (public.my_role() in ('admin', 'editor')) with check (public.my_role() in ('admin', 'editor'));
create policy plan_other_delete on public.plan_other for delete to authenticated using (public.my_role() = 'admin');

drop policy if exists plan_bookings_read   on public.plan_bookings;
drop policy if exists plan_bookings_insert on public.plan_bookings;
drop policy if exists plan_bookings_delete on public.plan_bookings;
create policy plan_bookings_read   on public.plan_bookings for select to authenticated using (public.my_role() is not null);
create policy plan_bookings_insert on public.plan_bookings for insert to authenticated with check (public.my_role() in ('admin', 'editor'));
create policy plan_bookings_delete on public.plan_bookings for delete to authenticated using (public.my_role() in ('admin', 'editor'));

-- Realtid: andra ser ändringar direkt.
do $$
begin
  begin alter publication supabase_realtime add table public.plan_bookings; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.plan_techs;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.plan_other;    exception when duplicate_object then null; end;
end $$;

-- Startdata, bara om tabellerna är tomma: teknikerna från Excelfilen och några vanliga rader.
insert into public.plan_techs (id, name, pos)
select * from (values
    ('pt-1', 'Sebastian Weslien', 10),
    ('pt-2', 'Sebastian Falk', 20),
    ('pt-3', 'Martin Limpar', 30),
    ('pt-4', 'Esteban Medina', 40),
    ('pt-5', 'Lucaz', 50),
    ('pt-6', 'Daniel Lundin', 60),
    ('pt-7', 'Fredrik Sundström', 70),
    ('pt-8', 'Tobias Ladenstedt', 80),
    ('pt-9', 'Sebastian Hultgren', 90),
    ('pt-10', 'Love Jarl', 100),
    ('pt-11', 'Alex Lindberg', 110),
    ('pt-12', 'Rolf Roxberger', 120),
    ('pt-13', 'Mats Johansson', 130),
    ('pt-14', 'Daniel Lundgren', 140),
    ('pt-15', 'Andreas A', 150),
    ('pt-16', 'Jimmy Holm', 160),
    ('pt-17', 'Marcus Eckenäs', 170),
    ('pt-18', 'Eddie B', 180),
    ('pt-19', 'Richard B', 190),
    ('pt-20', 'Alex M.', 200),
    ('pt-21', 'Magnus Jansson', 210)
) as v(id, name, pos)
where not exists (select 1 from public.plan_techs);

insert into public.plan_other (id, name, kind, pos)
select * from (values
    ('po-1', 'Semester', 'abs', 10),
    ('po-2', 'Sjuk', 'abs', 20),
    ('po-3', 'Utlånad', 'work', 30),
    ('po-4', 'Service - Diverse', 'work', 40)
) as v(id, name, kind, pos)
where not exists (select 1 from public.plan_other);
