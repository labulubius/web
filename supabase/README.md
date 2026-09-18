# Supabase setup

1. Open **SQL Editor** in the Supabase dashboard.
2. Paste and run `migrations/202609180001_navigator.sql`.
3. Open **Authentication → Users → Add user** and create the owner account.
4. Return to **SQL Editor** and run the following statement after replacing the email:

```sql
insert into public.navigator_admins (user_id)
select id from auth.users where email = 'YOUR_EMAIL@example.com'
on conflict (user_id) do nothing;
```

5. In **Authentication → Providers → Email**, disable new-user sign-ups after creating the owner account.

The publishable key is used by the browser. Authorization is enforced by PostgreSQL Row Level Security; only user IDs in `navigator_admins` can modify navigator data.
