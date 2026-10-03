-- Private owner-only tasks for the Home Inbox and Day Planner.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  notes text not null default '' check (char_length(notes) <= 10000),
  status text not null default 'open' check (status in ('open', 'completed')),
  scheduled_date date,
  start_minute smallint check (start_minute between 0 and 1425 and start_minute % 15 = 0),
  position bigint not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_minute is null or scheduled_date is not null),
  check (status <> 'completed' or completed_at is not null),
  check (status <> 'open' or completed_at is null)
);

create index tasks_owner_status_date_idx on public.tasks (owner_id, status, scheduled_date);
create index tasks_owner_date_time_idx on public.tasks (owner_id, scheduled_date, start_minute);

alter table public.tasks enable row level security;

revoke all on public.tasks from public, anon, authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

create policy "site admins manage only their own tasks"
on public.tasks for all to authenticated
using (owner_id = (select auth.uid()) and public.site_is_admin())
with check (owner_id = (select auth.uid()) and public.site_is_admin());

create function public.touch_private_task_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.owner_id := old.owner_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_touch_before_update
before update on public.tasks
for each row execute function public.touch_private_task_row();
