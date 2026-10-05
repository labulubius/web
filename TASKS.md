# Personal Tasks

The root route `/` is a private, administrator-only task manager. Signed-out and non-administrator visitors see only a generic Home screen; the page does not identify the private feature.

## Views and behavior

Tasks have two modes derived from project membership:

- All tasks contains every project task and every Uncategorized task. Uncategorized tasks have no dates and never appear in Gantt.
- Project pages contain all tasks assigned to that project. Project tasks may remain unscheduled or use an inclusive start and end date. Projects can be reordered by dragging their sidebar rows and edited or deleted with trailing row actions.
- Gantt contains only scheduled project tasks in the selected date range.

The Gantt chart uses one-day columns and an administrator-selected date range of at most two months. It supports ranges across month boundaries, task movement and edge resizing. The browser remembers the selected All tasks, Gantt or project location and the valid Gantt date range. Only opaque project IDs and navigation dates are saved locally; task content is not.

Tasks contain a title, optional project and optional project-only date range. They do not contain descriptions, notes or times of day. Completing a task permanently deletes it. There is no completed-task history or restore view. All tasks and project rows provide explicit edit and confirmed Delete actions; the edit dialog itself contains only Cancel and Save.

The current version intentionally excludes dependencies, progress percentages, milestones, recurrence, reminders, labels, priority levels, nested projects, collaboration and external calendar synchronization.

## Persistence and migration

Task data is stored outside Git in:

```text
${TASKS_DATA_DIR:-~/.local/share/labulubius/tasks}/tasks.json
```

`TASKS_DATA_DIR`, when set, must be an absolute real directory outside the repository. The service creates the directory with owner-only permissions. Writes are serialized within the web process and committed through an exclusive temporary file, `fsync`, and atomic rename. Reads and writes reject symbolic links. Task IDs and project IDs are opaque UUIDs. Project order is the validated order of the `projects` array and is saved atomically with the rest of the task data.

Version 3 stores optional inclusive `startDate` and `endDate` values as local `YYYY-MM-DD` dates only for project tasks. Both values may be null for unscheduled project tasks and must be null for Uncategorized tasks. Version 1 and version 2 data migrate atomically on first authenticated read. Historical completed tasks are discarded, old notes are removed, and dates are cleared from tasks without a project.

Deleting a project preserves its tasks by making them Uncategorized and clearing their dates.

## API and security

The management API is under `/api/tasks` and `/api/tasks/projects`; the projects collection PATCH endpoint saves a complete validated project order. Every read and mutation requires a Supabase bearer token and a successful `site_is_admin` check. Responses use private, no-store caching headers. Browser UI state is not treated as authorization.

The API validates request size, UUIDs, field lengths, real calendar dates, ordered date ranges, project references and the rule that only project tasks may have dates. Completion uses the authenticated task DELETE endpoint and leaves no completed record.

## Backup and restore

Back up the entire Tasks directory with the other persistent datasets. An empty directory is valid before the first task is created. The backup verifier accepts versions 1, 2 and 3 so older backups can be restored and migrated by the application:

```bash
node scripts/verify-backup.mjs \
  --tasks /restore/tasks \
  --drive /restore/drive \
  --news /restore/news \
  --forums /restore/forums \
  --freshrss-dump /restore/freshrss.dump
```

Restore only while the application is stopped or into an isolated directory. Do not edit `tasks.json` manually. After restoration, verify All tasks and Uncategorized classification, project task scheduling, cross-month Gantt ranges, completion deletion and explicit deletion with the administrator account.
