# Supabase setup

Supabase supplies authentication, the site-wide administrator role, the private Home Tasks and Day Planner, the navigator database and icon storage, and the private note. Drive, Share, News and Forums persistent server files are **not** stored in Supabase; see the root [README](../README.md) and the feature-specific documents for their deployment and backups.

## New project

1. Create a Supabase project. In its **SQL Editor**, run every file in `migrations/` in filename order. The migrations build on each other: navigator tables and policies, the `site_admins` role, icon storage policies, the private-note table, and the private task table. Do not skip `202609260001_private_note.sql` if you intend to use `/note`, or `202610020001_tasks.sql` if you intend to use the Home planner.
2. In **Authentication → Users**, create the owner's email/password user. Then in the SQL Editor, replace the placeholder email below and grant the site-wide administrator role:

   ```sql
   insert into public.site_admins (user_id)
   select id from auth.users where email = 'YOUR_EMAIL@example.com'
   on conflict (user_id) do nothing;
   ```

3. In **Authentication → Providers → Email**, disable new-user sign-ups after creating the owner account if this is a private workspace.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the `web` deployment `.env.local`. Use the publishable key, **never** a service-role/secret key in a `NEXT_PUBLIC_` variable. Do not commit `.env.local`.
5. Sign in as the owner and add navigator categories and websites using `/nav`; `app/nav/sites.ts` contains TypeScript types, not seed data. Confirm that visitors only see published entries, administrators can edit them, `/note` loads, and Home can create and complete a task without a migration error.

## Private Tasks and Day Planner

`202610020001_tasks.sql` creates the `tasks` table used by Home. Tasks can remain in Inbox without a date, or have a `scheduled_date` and optional 15-minute `start_minute`. The initial UI supports quick capture, editing, day assignment, completion/reopening and permanent deletion.

The task policy requires both `owner_id = auth.uid()` and `site_is_admin()`. Validate the deployment with three sessions:

1. An anonymous session cannot select, insert, update or delete rows in `tasks`.
2. An authenticated account not present in `site_admins` cannot access any task rows.
3. The site owner can access only rows whose `owner_id` matches their own user ID.

If an earlier development version of the task migration was already applied, its additional nullable/defaulted columns can remain; the lightweight Home UI uses only the documented subset. Do not rerun a `create table` migration against an existing production table. Apply future schema changes as new forward migrations.

Supabase Row Level Security governs task, navigator and private-note access. `site_is_admin()` is the site-wide role check also used by server-side Drive, Share, News and Forums authorization. Site-admin records are not publicly readable. Store backups of server-side data separately; applying SQL migrations alone does not restore files, News preferences, Forums selections or FreshRSS data.
