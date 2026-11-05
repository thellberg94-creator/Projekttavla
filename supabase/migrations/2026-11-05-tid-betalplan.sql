-- Tidplan och betalplan på korten. Kör hela filen en gång i Supabase: SQL Editor -> New query -> Run.
-- Den går att köra om utan att något försvinner.

alter table public.cards add column if not exists tidplan   jsonb not null default '[]'::jsonb;
alter table public.cards add column if not exists betalplan jsonb;

-- Ändringsloggen ska bara notera att en plan ändrats, inte spara hela innehållet.
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
        if k in ('tidplan', 'betalplan') then
          d := d || jsonb_build_object(k, '[0,1]'::jsonb);  -- logga bara att planen ändrats, inte hela innehållet
        else
          d := d || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
        end if;
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
