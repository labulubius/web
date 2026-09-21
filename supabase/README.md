# Supabase setup

1. Open **SQL Editor** in the Supabase dashboard.
2. Paste and run every file in `migrations/` in filename order.
3. Open **Authentication → Users → Add user** and create the owner account.
4. Return to **SQL Editor** and run the following statement after replacing the email:

```sql
insert into public.site_admins (user_id)
select id from auth.users where email = 'YOUR_EMAIL@example.com'
on conflict (user_id) do nothing;
```

5. In **Authentication → Providers → Email**, disable new-user sign-ups after creating the owner account.

The publishable key is used by the browser. Authorization is enforced by PostgreSQL Row Level Security. Users in `site_admins` are global site administrators; navigator management is currently the first feature granted to that role, and future features can reuse `site_is_admin()`.
