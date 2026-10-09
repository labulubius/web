# Home task descriptions and independent dates — acceptance

Target route: `/` (Home tasks, including All tasks and Gantt).

Approved scope: `app/tasks/**`, `app/lib/tasks-server.ts`, directly relevant tests and this acceptance record. The owner explicitly approved persistence changes and retaining dates when removing/deleting a Project. New and edited tasks must use the same description form.

Files changed:
- `app/tasks/task-types.ts`
- `app/tasks/task-dialogs.tsx`
- `app/tasks/task-manager.tsx`
- `app/tasks/gantt-view.tsx`
- `app/lib/tasks-server.ts`
- `tests/core.test.mjs`
- `tests/tasks-data.test.mjs`
- `tests/tasks-interaction.test.mjs`
- `tests/task-description-acceptance.md`

Reference pages inspected: `/nav` description form and related styles; shared `SiteShell` and `AccessibleDialog`.

Existing components/tokens reused: `AccessibleDialog`, the shared labelled textarea and `.form-error` patterns, existing form rows and color/theme tokens. No CSS changes.

Shared files changed: approved task persistence module `app/lib/tasks-server.ts` only. No changes to shared UI, authentication, global styles, `/nav`, `/feeds`, or `/drive`.

Other routes changed visually or behaviorally: none.

## Requested behavior

- One `TaskDialog` for sidebar-plus creation and edited tasks. Inline quick add saves the title directly without opening a dialog. Optional three-row, 300-character description, saved and populated on edit.
- Start/end dates always available regardless of Project. Existing single-date normalization remains unchanged.
- Uncategorized scheduled tasks appear in lists and Gantt and can be moved/resized through the existing paths.
- Removing a task from a Project or deleting that Project preserves dates and descriptions.
- Task form errors remain visible and announced; failed saves retain inputs. Task-local delayed initial focus preserves the shared dialog trigger restoration.

## States checked

- Loading: existing loading implementation inspected; transient loading was not separately asserted in browser tests.
- Populated: browser-tested creation, editing, description reload, dates, list, and Gantt.
- Empty/no results: browser-tested empty All tasks; unit-tested Gantt date-range filtering. No task search feature.
- Partial/complete error: browser-tested failed save and retry with retained input; complete-load failure and expired-session scenarios not separately exercised.
- Signed-out/non-admin/admin: signed-out and mocked non-admin/owner browser states; actual unauthenticated preview API GET/POST return 401. No real owner credentials used.
- Saving/destructive action: browser-tested disabled saving actions and busy Escape; existing deletion confirmation tests pass; real task storage functions tested for Project deletion/date retention using temporary directories.

## Responsive checks

Automated Chromium checks at widths 1440, 1280, 760, 650, and 390 px, across light/dark/system modes: dialog fits horizontally and has no internal horizontal overflow. A 300-character description was included.

## Accessibility checks

- Keyboard: Tab/Shift+Tab trap, Escape, busy Escape blocking, and edit-trigger focus restoration passed in browser.
- Labels: textarea label association checked; shared accessible dialog name retained.
- Status/error: save progress and alert tested; existing broader loading states inspected.
- Focus visibility and light/dark/system contrast: existing shared token/style rules reused; not manually or numerically contrast-audited.
- Reduced motion: browser checks ran with reduced-motion preference; no new animations.

## Security and data-contract changes

Task storage moves from version 3 to 4 with a validated description field. Versions 1/2/3 remain readable and migrate to blank descriptions while retaining date data. Uncategorized tasks may now have valid date ranges. Private atomic storage, path checks, admin authorization, no-store headers, quotas/request limits, storage locations, CSP, and other routes remain unchanged.

## Automated verification

All executed through `ssh web` in `/home/debian/labulubius`:
- `git diff --check`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 82 passed, 0 failed.
- `npm run build`: passed.
- Isolated Chromium preview: passed; real authentication/API behavior was not mocked for the unauthenticated 401 checks, while owner UI operations used synthetic auth and task API responses. No production task records were created or changed by these checks.

Manual checks not performed: real-account end-to-end mutations, manual pixel/contrast audit, screen-reader testing, touch-device drag/resize, and complete-load/session-expiry simulation. Persistence and Gantt drag dispatch were covered by automated regression tests.

## Quick-add correction (owner screenshot clarification)

Target route: `/`.
Approved scope / files changed: `app/tasks/task-manager.tsx`, `tests/tasks-interaction.test.mjs`, this record.
Requested behavior: inline Add task directly saves; sidebar Tasks plus still opens the same description/date form used for editing.
Reference: owner screenshots and the original quick-add behavior.
Existing components/tokens reused: existing quick-add form, mutation/error path and unchanged TaskDialog; no style changes.
Shared files changed: none. Other routes changed: none. Security/data-contract changes: none.
Verification for this correction is recorded in the follow-up delivery; the earlier 82-test result above is the original feature baseline.

Correction verification: lint, typecheck, 88 tests, production build, and isolated Chromium checks passed. Desktop (1440px) and phone (390px) direct button/Enter creation does not open a dialog, clears input only on success, and retains it on failure. Sidebar-plus and edit dialogs retain description/date fields on both sizes. The previous 5-width/3-theme, keyboard/focus/Escape, error, empty, unauthenticated and mocked permission checks were rerun successfully. Loading, destructive actions and manual-check limitations remain as described above. No production task data was used or changed by browser tests.
