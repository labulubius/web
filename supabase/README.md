# Supabase setup

Supabase supplies authentication, the site-wide administrator role, the navigator database and icon storage, and the private note. Drive, Share, News and Forums persistent server files are **not** stored in Supabase; see the root [README](../README.md) and the feature-specific documents for their deployment and backups.

## New project

1. Create a Supabase project. In its **SQL Editor**, run every file in `migrations/` in filename order. The migrations build on each other: navigator tables and policies, the `site_admins` role, icon storage policies and the private-note table. Do not skip `202609260001_private_note.sql` if you intend to use `/note`.
2. In **Authentication → Users**, create the owner's email/password user. Then in the SQL Editor, replace the placeholder email below and grant the site-wide administrator role:

   ```sql
   insert into public.site_admins (user_id)
   select id from auth.users where email = 'YOUR_EMAIL@example.com'
   on conflict (user_id) do nothing;
   ```

3. In **Authentication → Providers → Email**, disable new-user sign-ups after creating the owner account if this is a private workspace.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the main-site and `web` deployments (and local `.env.local` when developing). Use the publishable key, **never** a service-role/secret key in a `NEXT_PUBLIC_` variable. Do not commit `.env.local`.
5. Sign in as the owner and add navigator categories and websites using `/nav`; `app/nav/sites.ts` contains TypeScript types, not seed data. Confirm that visitors only see published entries, administrators can edit them and `/note` loads without a migration error.

Supabase Row Level Security governs navigator and private-note access. `site_is_admin()` is the site-wide role check also used by server-side Drive, Share, News and Forums authorization. Site-admin records are not publicly readable. Store backups of server-side data separately; applying SQL migrations alone does not restore files, News preferences, Forums selections or FreshRSS data.
