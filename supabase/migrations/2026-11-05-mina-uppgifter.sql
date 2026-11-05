-- Mina uppgifter: personliga uppgifter, valfritt kopplade till ett projektkort.
-- Kör hela filen en gång i Supabase: SQL Editor -> New query -> Run. Går att köra om utan att något försvinner.
-- Varje användare ser och ändrar bara sina egna uppgifter.

create table if not exists public.my_tasks (
  id         text primary key check (id ~ '^[A-Za-z0-9_-]{1,60}$'),
  owner      uuid not null default auth.uid(),
  title      text not null check (char_length(title) between 1 and 300),
  sect       text not null default 'ny' check (sect in ('ny', 'idag', 'vecka', 'senare')),
  due        date check (due is null or due between date '2020-01-01' and date '2100-01-01'),
  card       text check (card is null or card ~ '^[A-Za-z0-9_-]{1,60}$'),
  done       boolean not null default false,
  pos        integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists my_tasks_owner_idx on public.my_tasks (owner);

create or replace function public.my_tasks_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.owner := old.owner;  -- ägaren kan inte ändras
  return new;
end;
$$;

drop trigger if exists my_tasks_touch on public.my_tasks;
create trigger my_tasks_touch before update on public.my_tasks
  for each row execute function public.my_tasks_touch();

alter table public.my_tasks enable row level security;
revoke all on public.my_tasks from anon;

drop policy if exists my_tasks_read   on public.my_tasks;
drop policy if exists my_tasks_insert on public.my_tasks;
drop policy if exists my_tasks_update on public.my_tasks;
drop policy if exists my_tasks_delete on public.my_tasks;
create policy my_tasks_read   on public.my_tasks for select to authenticated using (owner = auth.uid() and public.my_role() is not null);
create policy my_tasks_insert on public.my_tasks for insert to authenticated with check (owner = auth.uid() and public.my_role() is not null);
create policy my_tasks_update on public.my_tasks for update to authenticated using (owner = auth.uid() and public.my_role() is not null) with check (owner = auth.uid() and public.my_role() is not null);
create policy my_tasks_delete on public.my_tasks for delete to authenticated using (owner = auth.uid() and public.my_role() is not null);
