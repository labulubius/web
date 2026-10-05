# Personal Tasks

The root route `/` is a private, administrator-only task manager. Signed-out and non-administrator visitors see only a generic Home screen; the page does not identify the private feature.

## Views and behavior

The task manager includes:

- Inbox for tasks that have not been assigned dates;
- a month-scale Gantt chart with one-day columns;
- inclusive start and end dates, without times of day;
- optional single-level projects and project-filtered charts;
- task title and notes;
- drag scheduling, range movement and edge resizing, with equivalent date fields in the task dialog.

Completing a task permanently deletes it. There is no completed-task history or restore view. Explicit Delete remains a separately confirmed destructive action.

The first version intentionally excludes time-of-day planning, week planning, dependencies, progress percentages, milestones, recurrence, reminders, labels, priority levels, nested projects, collaboration and external calendar synchronization.

## Persistence and migration

Task data is stored outside Git in:

```text
${TASKS_DATA_DIR:-~/.local/share/labulubius/tasks}/tasks.json
```

`TASKS_DATA_DIR`, when set, must be an absolute real directory outside the repository. The service creates the directory with owner-only permissions. Writes are serialized within the web process and committed through an exclusive temporary file, `fsync`, and atomic rename. Reads and writes reject symbolic links. Task IDs and project IDs are opaque UUIDs.

Version 2 stores optional inclusive `startDate` and `endDate` values as local `YYYY-MM-DD` dates. Both values are null for Inbox tasks. Version 1 week-planner data is migrated atomically on first authenticated read: active dated tasks become one-day ranges, active undated tasks remain in Inbox, and historical completed tasks are discarded.

## API and security

The management API is under `/api/tasks` and `/api/tasks/projects`. Every read and mutation requires a Supabase bearer token and a successful `site_is_admin` check. Responses use private, no-store caching headers. Browser UI state is not treated as authorization.

The API validates request size, UUIDs, field lengths, real calendar dates, ordered date ranges and project references. Completion uses the authenticated task DELETE endpoint and leaves no completed record.

## Backup and restore

Back up the entire Tasks directory with the other persistent datasets. An empty directory is valid before the first task is created. The backup verifier accepts both version 1 and version 2 so an older backup can be restored and migrated by the application:

```bash
node scripts/verify-backup.mjs \
  --tasks /restore/tasks \
  --drive /restore/drive \
  --news /restore/news \
  --forums /restore/forums \
  --freshrss-dump /restore/freshrss.dump
```

Restore only while the application is stopped or into an isolated directory. Do not edit `tasks.json` manually. After restoration, verify Inbox, Gantt ranges, project assignment, completion deletion and explicit deletion with the administrator account.
