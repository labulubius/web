# Personal Tasks

The root route `/` is a private, administrator-only task manager. Signed-out and non-administrator visitors see only a generic Home screen; the page does not identify the private feature.

## Views and behavior

Tasks have views derived from project membership:

- All tasks contains every active project task and every Uncategorized task, but excludes Archive.
- Archive appears in the Projects list and supports the same selection, quick-add, rename, delete and drag-order interactions as every other project. Its only special behavior is that assigned tasks stay out of All tasks and Gantt; assigning another project restores them to active views.
- Project pages contain all tasks assigned to that project. Project tasks may remain unscheduled or use an inclusive start and end date. Projects can be reordered by dragging their sidebar rows and edited or deleted with trailing row actions.
- Gantt contains only scheduled non-Archive tasks in the selected date range.

The Gantt chart uses one-day columns and an administrator-selected date range of at most two months. It supports ranges across month boundaries, task movement and edge resizing. The browser remembers the selected All tasks, Gantt or project location and the valid Gantt date range. A legacy saved Archive view restores as the Archive project. Only opaque project IDs and navigation dates are saved locally; task content is not.

Tasks contain a title, optional project and optional project-only date range. They do not contain descriptions, notes or times of day. Completing a task permanently deletes it. There is no completed-task history or restore view. All tasks and project rows provide explicit edit and confirmed Delete actions; the edit dialog itself contains only Cancel and Save.

The current version intentionally excludes dependencies, progress percentages, milestones, recurrence, reminders, labels, priority levels, nested projects, collaboration and external calendar synchronization.

## Persistence and migration

Archive uses a stable reserved project ID only to implement active-view filtering. It otherwise follows ordinary project API behavior, including rename, reorder and deletion. Version 5 creates Archive for new data and migrates versions 1–4 once; deleting it from version 5 data does not recreate it. Creating a new project named Archive when the reserved ID is absent restores the archived-project role.

Task data is stored outside Git in:

```text
${TASKS_DATA_DIR:-~/.local/share/labulubius/tasks}/tasks.json
```

`TASKS_DATA_DIR`, when set, must be an absolute real directory outside the repository. The service creates the directory with owner-only permissions. Writes are serialized within the web process and committed through an exclusive temporary file, `fsync`, and atomic rename. Reads and writes reject symbolic links. Task IDs and project IDs are opaque UUIDs. Project order is the validated order of the `projects` array and is saved atomically with the rest of the task data.

Version 5 stores task descriptions, optional inclusive `startDate` and `endDate` values as local `YYYY-MM-DD` dates, and ordinary ordered projects including Archive. Versions 1–4 migrate atomically on first authenticated read. Historical completed tasks are discarded and old notes are removed.

Deleting a project preserves its tasks by making them Uncategorized and clearing their dates.

## API and security

The management API is under `/api/tasks` and `/api/tasks/projects`; the projects collection PATCH endpoint saves a complete validated project order. Every read and mutation requires a Supabase bearer token and a successful `site_is_admin` check. Responses use private, no-store caching headers. Browser UI state is not treated as authorization.

The API validates request size, UUIDs, field lengths, real calendar dates, ordered date ranges, project references and the rule that only project tasks may have dates. Completion uses the authenticated task DELETE endpoint and leaves no completed record.

## Backup and restore

Back up the entire Tasks directory with the other persistent datasets. An empty directory is valid before the first task is created. The backup verifier accepts versions 1 through 5 so current and older backups can be restored and migrated by the application:

```bash
node scripts/verify-backup.mjs \
  --tasks /restore/tasks \
  --drive /restore/drive \
  --news /restore/news
```

Restore only while the application is stopped or into an isolated directory. Do not edit `tasks.json` manually. After restoration, verify All tasks and Uncategorized classification, project task scheduling, cross-month Gantt ranges, completion deletion and explicit deletion with the administrator account.
