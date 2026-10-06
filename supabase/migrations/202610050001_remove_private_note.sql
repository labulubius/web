-- Retire the removed private Note feature and permanently delete its stored content.
drop table if exists public.private_note;
drop function if exists public.private_note_touch();
