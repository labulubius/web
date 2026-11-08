# Personal Tasks

The root route `/` is a private, administrator-only task manager. Signed-out and non-administrator visitors see a generic Home screen.

## Views and behavior

The sidebar offers Important, Uncategorized and the ordered Projects list. Important shows starred tasks from every project, including Archive. Uncategorized shows tasks without a project. Each project view shows tasks assigned to that project. The initial view is Important. The browser remembers the selected view or project; saved All tasks and Gantt locations migrate to Uncategorized and Important, respectively.

Archive is an ordinary project row with the same selection, quick-add, rename, delete and drag-order interactions as other projects. Its reserved ID still marks archived tasks in persistent data for compatibility. Assigning a task to another project restores it to that project's list. Deleting a project makes its tasks Uncategorized while retaining their dates.

Tasks have a title, optional short description, optional project, optional inclusive start and end dates, and an Important flag. Dates remain visible and editable in list and dialog views. Completing a task permanently deletes it. There is no completed-task history or restore view. List rows have explicit edit and confirmed Delete actions. Projects and tasks can be reordered by dragging; Important has its own order. The task editor contains Cancel and Save.

The current version excludes dependencies, progress percentages, milestones, recurrence, reminders, labels, priority levels, nested projects, collaboration and external calendar synchronization.

## Persistence and migration

Archive uses a stable reserved project ID. Version 6 creates Archive for new data and migrates versions 1–5 once; deleting it from version 6 data does not recreate it. Creating a new project named Archive when the reserved ID is absent restores its archived-project role.

Task data is stored outside Git in:

```text
${TASKS_DATA_DIR:-~/.local/share/labulubius/tasks}/tasks.json
${TASKS_DATA_DIR:-~/.local/share/labulubius/tasks}/preferences/<account-uuid>.navigation.json
```

`TASKS_DATA_DIR`, when set, must be an absolute real directory outside the repository. The service creates task and preference directories with owner-only permissions. Writes are serialized within the web process and committed through an exclusive temporary file, `fsync`, and atomic rename. Reads and writes reject symbolic links. Task IDs and project IDs are opaque UUIDs. Project order is the validated order of the `projects` array and is saved atomically with task data.

Version 6 stores task descriptions, Important state and its independent order, optional inclusive `startDate` and `endDate` values as local `YYYY-MM-DD` dates, and ordinary ordered projects including Archive. Versions 1–5 migrate atomically on first authenticated read. Historical completed tasks are discarded and old notes are removed. Existing task navigation preference files are retained for compatibility but the current homepage does not read or write them.

## API and security

The management API is under `/api/tasks` and `/api/tasks/projects`; the projects collection PATCH endpoint saves a complete validated project order. The legacy `/api/tasks/navigation-order` endpoint remains available for existing clients but is unused by the homepage. Every read and mutation requires a server-verified Supabase bearer token and a successful `site_is_admin` check. Responses use private, no-store caching headers. Browser UI state and client-supplied identity are not treated as authorization.

The API validates request size, UUIDs, field lengths, real calendar dates, ordered date ranges and project references. Completion uses the authenticated task DELETE endpoint and leaves no completed record.

## Backup and restore

Back up the entire Tasks directory, including `preferences/`, with other persistent datasets. An empty directory is valid before the first task or preference is created. The existing backup verifier still recognizes task-data versions 1 through 5; its pre-existing version-6 validation gap is unchanged:

```bash
node scripts/verify-backup.mjs \
  --tasks /restore/tasks \
  --drive /restore/drive
```

Restore only while the application is stopped or into an isolated directory. Do not edit `tasks.json` manually. After restoration, verify Important, Uncategorized and project lists, task dates, completion deletion and confirmed deletion with the administrator account.
