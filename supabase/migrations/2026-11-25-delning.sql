-- Privata kort som kan delas. Kör hela filen en gång i Supabase: SQL Editor -> New query -> Run.
-- Den går att köra om utan att något försvinner.
--
-- Regler efter den här filen:
--  * Den som skapar ett kort äger det. Bara ägaren och administratörer ser det.
--  * Ägaren (och administratörer) delar kortet med enskilda användare. De som fått kortet kan ändra det.
--  * Administratörer ser och kan ändra alla kort hela tiden.
--  * Dokumentationsrader följer korten: de syns för den som ser kortet med samma namn, och för den som skapat dem.
--  * Teknikerplaneringen är gemensam. Projektnamn syns där även för dem som inte fått kortet.
--  * Alla befintliga kort och rader får den första administratören som ägare.

alter table public.cards add column if not exists owner uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.docs  add column if not exists owner uuid default auth.uid() references auth.users (id) on delete set null;

-- Befintliga rader: första administratören blir ägare. Triggrarna stängs av så att det inte loggas som ändringar.
alter table public.cards disable trigger user;
alter table public.docs  disable trigger user;
update public.cards set owner = (select user_id from public.members where role = 'admin' order by created_at limit 1) where owner is null;
update public.docs  set owner = (select user_id from public.members where role = 'admin' order by created_at limit 1) where owner is null;
alter table public.cards enable trigger user;
alter table public.docs  enable trigger user;

create table if not exists public.card_shares (
  card_id    text not null references public.cards (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (card_id, user_id)
);
create index if not exists card_shares_user_idx on public.card_shares (user_id);

-- Hjälpfunktioner. De körs med ägarens rättigheter så att reglerna inte hamnar i en ändlös loop.
create or replace function public.can_see_card(cid text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and (
    public.my_role() = 'admin'
    or exists (select 1 from public.cards c where c.id = cid and c.owner = auth.uid())
    or exists (select 1 from public.card_shares s where s.card_id = cid and s.user_id = auth.uid())
  )
$$;

create or replace function public.is_card_owner(cid text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and (
    public.my_role() = 'admin'
    or exists (select 1 from public.cards c where c.id = cid and c.owner = auth.uid())
  )
$$;

create or replace function public.can_see_doc(did text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and (
    public.my_role() = 'admin'
    or exists (select 1 from public.docs d where d.id = did and (
         d.owner = auth.uid()
         or exists (select 1 from public.cards c where c.name = d.project and public.can_see_card(c.id))))
  )
$$;

create or replace function public.is_member(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = uid)
$$;

-- Lista över användare att dela med. Visar bara id, e-post och roll, och bara för inloggade medlemmar.
create or replace function public.list_members()
returns table (user_id uuid, email text, role text)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.email, m.role from public.members m where public.my_role() is not null order by m.email
$$;

-- Namn på alla projekt, så att teknikerplaneringen kan visa dem även när kortet är privat.
create or replace function public.plan_card_names()
returns table (id text, name text, client text, tags text[])
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.client, c.tags from public.cards c where public.my_role() is not null and not c.deleted
$$;

revoke all on function public.list_members(), public.plan_card_names() from public, anon;
grant execute on function public.list_members(), public.plan_card_names() to authenticated;

-- Ägaren kan inte ändras av någon annan än en administratör.
create or replace function public.keep_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner is distinct from old.owner and coalesce(public.my_role(), '') <> 'admin' then
    new.owner := old.owner;
  end if;
  return new;
end;
$$;
drop trigger if exists cards_owner on public.cards;
create trigger cards_owner before update on public.cards for each row execute function public.keep_owner();
drop trigger if exists docs_owner on public.docs;
create trigger docs_owner before update on public.docs for each row execute function public.keep_owner();

alter table public.card_shares enable row level security;
revoke all on public.card_shares from anon;

drop policy if exists card_shares_read   on public.card_shares;
drop policy if exists card_shares_insert on public.card_shares;
drop policy if exists card_shares_delete on public.card_shares;
create policy card_shares_read on public.card_shares for select to authenticated
  using (public.my_role() is not null and (user_id = auth.uid() or public.is_card_owner(card_id)));
create policy card_shares_insert on public.card_shares for insert to authenticated
  with check (public.my_role() in ('admin', 'editor') and public.is_card_owner(card_id) and public.is_member(user_id));
create policy card_shares_delete on public.card_shares for delete to authenticated
  using (public.my_role() in ('admin', 'editor') and public.is_card_owner(card_id));

-- Kort
drop policy if exists cards_read   on public.cards;
drop policy if exists cards_insert on public.cards;
drop policy if exists cards_update on public.cards;
create policy cards_read   on public.cards for select to authenticated using (public.can_see_card(id));
create policy cards_insert on public.cards for insert to authenticated
  with check (public.my_role() in ('admin', 'editor') and (owner is null or owner = auth.uid() or public.my_role() = 'admin'));
create policy cards_update on public.cards for update to authenticated
  using (public.my_role() in ('admin', 'editor') and public.can_see_card(id))
  with check (public.my_role() in ('admin', 'editor') and public.can_see_card(id));

-- Dokumentationsrader
drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
create policy docs_read   on public.docs for select to authenticated using (public.can_see_doc(id));
create policy docs_insert on public.docs for insert to authenticated
  with check (public.my_role() in ('admin', 'editor') and (owner is null or owner = auth.uid() or public.my_role() = 'admin'));
create policy docs_update on public.docs for update to authenticated
  using (public.my_role() in ('admin', 'editor') and public.can_see_doc(id))
  with check (public.my_role() in ('admin', 'editor') and public.can_see_doc(id));

-- Ändringsloggen visar bara det man själv får se. Administratörer ser allt.
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated
  using (public.my_role() is not null and (
    public.my_role() = 'admin'
    or user_id = auth.uid()
    or (entity = 'card' and public.can_see_card(entity_id))
    or (entity = 'doc'  and public.can_see_doc(entity_id))
  ));

do $$
begin
  begin alter publication supabase_realtime add table public.card_shares; exception when duplicate_object then null; end;
end $$;
