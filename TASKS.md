# Personal Tasks

The root route `/` is the site owner's private task manager. It follows the existing KDE Breeze workspace design and uses a Todoist-inspired workflow without copying Todoist branding.

## Access and views

The page is visible in the shared workspace shell, but task data is available only after the Supabase-authenticated administrator check succeeds. Signed-out and non-administrator visitors receive the standard `OwnerAccess` guidance and no task records.

The first version includes:

- Inbox for tasks that have not been scheduled;
- Today for the current local date;
- a Monday-to-Sunday weekly calendar with 30-minute slots from 00:00 to 24:00;
- optional date-only tasks in each day's all-day row;
- optional single-level projects;
- completed-task history with restore;
- task title, notes, date, start time and duration;
- pointer and touch scheduling, duration resizing, and equivalent form controls.

The same task record appears through these derived views; views do not duplicate data. Recurrence, reminders, labels, priority levels, nested projects, collaboration, external calendar synchronization and product shortcuts are intentionally excluded.

## Persistence

Task data is stored outside Git in:

```text
${TASKS_DATA_DIR:-~/.local/share/labulubius/tasks}/tasks.json
```

`TASKS_DATA_DIR`, when set, must be an absolute real directory outside the repository. The service creates the directory with owner-only permissions. Writes are serialized within the web process and committed through an exclusive temporary file, `fsync`, and atomic rename. Reads and writes reject symbolic links. Task IDs and project IDs are opaque UUIDs.

Planned date and time use local calendar values rather than UTC conversion: `YYYY-MM-DD`, a start-minute value in 30-minute increments, and a duration in 30-minute increments. Creation, update and completion timestamps use ISO UTC timestamps.

## API and security

The management API is under `/api/tasks` and `/api/tasks/projects`. Every read and mutation requires a Supabase bearer token and a successful `site_is_admin` check. Responses use private, no-store caching headers. Browser UI state is not treated as authorization.

The API validates request size, UUIDs, field lengths, real calendar dates, half-hour alignment, project references and the end-of-day boundary. A task cannot extend past 24:00; overlapping tasks are allowed and shown side by side.

## Backup and restore

Back up the entire Tasks directory with the other persistent datasets. An empty directory is valid before the first task is created. Validate a restored copy with:

```bash
node scripts/verify-backup.mjs \
  --tasks /restore/tasks \
  --drive /restore/drive \
  --news /restore/news \
  --forums /restore/forums \
  --freshrss-dump /restore/freshrss.dump
```

Restore only while the application is stopped or into an isolated directory. Do not edit `tasks.json` manually. After restoration, verify Inbox, Today, weekly scheduling, project assignment, completion and restore with the administrator account.
