-- A single private plain-text note. The row exists before the UI is deployed.
create table public.private_note (
  id smallint primary key default 1 check (id = 1),
  content text not null default '' check (char_length(content) <= 100000),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

insert into public.private_note (id) values (1);

alter table public.private_note enable row level security;
revoke all on public.private_note from public, anon, authenticated;
grant select, update on public.private_note to authenticated;

create policy "only site admins read private note"
on public.private_note for select to authenticated
using (public.site_is_admin());

create policy "only site admins update private note"
on public.private_note for update to authenticated
using (public.site_is_admin()) with check (public.site_is_admin());

-- Bump revision and timestamp server-side, independently of any browser clock.
create function public.private_note_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger private_note_touch_before_update
before update on public.private_note
for each row execute function public.private_note_touch();
