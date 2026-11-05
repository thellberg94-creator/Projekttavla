-- Kalkylerade timmar per projekt. Kör hela filen en gång i Supabase: SQL Editor -> New query -> Run.
-- Den går att köra om utan att något försvinner.

alter table public.cards add column if not exists kalk_h numeric(9,1)
  check (kalk_h is null or (kalk_h >= 0 and kalk_h <= 100000));
