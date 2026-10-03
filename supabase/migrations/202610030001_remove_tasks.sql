-- Permanently remove the retired private Tasks and Day Planner data.
drop table if exists public.task_settings;
drop table if exists public.tasks;
drop function if exists public.touch_private_task_row();
